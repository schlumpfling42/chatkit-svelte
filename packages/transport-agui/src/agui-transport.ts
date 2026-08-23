import { applyPatch } from '@chatkit/core';
import type { AgentCapabilities, ChatEvent, ChatTransport, RunAgentInput, ToolResult } from '@chatkit/core';
import { createSseFrameParser } from './sse-parser';
import { computeBackoffDelay, type BackoffOptions } from './backoff';
import { BoundedEventQueue } from './event-queue';
import { createPushPullBridge } from './push-pull-bridge';

export interface AguiTransportOptions {
  /** Base URL, e.g. 'http://localhost:3000/api/agent'. Paths are appended: /threads/:id/events, /runs, /tool-results, /runs/:id, /capabilities, /threads/:id/state. */
  endpoint: string;
  /** 'sse' (default) or 'websocket'. Only the event stream in connect() differs by mode — sendRun/sendFrontendToolResult/abortRun/getCapabilities are always plain HTTP, per AG-UI's RunAgentInput-is-POSTed convention. */
  mode?: 'sse' | 'websocket';
  fetchImpl?: typeof fetch;
  WebSocketImpl?: typeof WebSocket;
  backoff?: BackoffOptions;
  /** Max reconnect attempts after a dropped connection. Default Infinity (keep retrying with backoff). */
  maxRetries?: number;
  /** BoundedEventQueue capacity for coalescing bursts parsed from a single chunk. Default 500. */
  queueCapacity?: number;
  /** Minimum time (ms) a connection must stay open before a subsequent failure resets the backoff attempt counter to 0. Prevents a "flapping" connection (accepts then immediately drops, repeatedly) from being treated as fresh each time and hammering the server at a constant minimal interval instead of escalating backoff. Default 1000. */
  minStableConnectionMs?: number;
}

interface StateMirrorRef {
  value: unknown;
}

export function createAguiTransport(options: AguiTransportOptions): ChatTransport {
  const fetchImpl = options.fetchImpl ?? fetch;
  const WebSocketImpl = options.WebSocketImpl ?? WebSocket;
  const maxRetries = options.maxRetries ?? Infinity;
  let disposed = false;
  let activeAbortController: AbortController | null = null;
  let activeWebSocket: WebSocket | null = null;

  async function requestFreshSnapshot(threadId: string): Promise<unknown> {
    const response = await fetchImpl(`${options.endpoint}/threads/${encodeURIComponent(threadId)}/state`, {
      signal: activeAbortController?.signal,
    });
    return response.json();
  }

  // STATE_SNAPSHOT/STATE_DELTA handling is shared between SSE and WebSocket
  // modes: track a local mirror of sharedState, and self-heal a STATE_DELTA
  // that fails to apply by substituting a freshly-fetched STATE_SNAPSHOT
  // instead of ever forwarding the broken delta downstream (spec §3.3).
  async function* emitWithStateGuard(event: ChatEvent, mirror: StateMirrorRef, threadId: string): AsyncGenerator<ChatEvent> {
    if (event.type === 'STATE_SNAPSHOT') {
      mirror.value = event.snapshot;
      yield event;
      return;
    }
    if (event.type === 'STATE_DELTA') {
      const { result, ok } = applyPatch(mirror.value, event.patch);
      if (ok) {
        mirror.value = result;
        yield event;
      } else {
        const snapshot = await requestFreshSnapshot(threadId);
        mirror.value = snapshot;
        yield { type: 'STATE_SNAPSHOT', snapshot };
      }
      return;
    }
    yield event;
  }

  async function* connectViaSse(session: { threadId: string; resumeToken?: string }): AsyncGenerator<ChatEvent> {
    let resumeToken = session.resumeToken;
    let attempt = 0;
    const mirror: StateMirrorRef = { value: undefined };
    const minStableMs = options.minStableConnectionMs ?? 1000;

    while (!disposed) {
      activeAbortController = new AbortController();
      const url = new URL(`${options.endpoint}/threads/${encodeURIComponent(session.threadId)}/events`);
      if (resumeToken) url.searchParams.set('resumeToken', resumeToken);
      const connectStartedAt = Date.now();

      let connectedOk = false;
      try {
        const response = await fetchImpl(url.toString(), { signal: activeAbortController.signal });
        if (!response.body) throw new Error('AG-UI SSE response has no body');
        connectedOk = true;

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const parser = createSseFrameParser();
        const queue = new BoundedEventQueue(options.queueCapacity ?? 500);

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          for (const frame of parser.push(chunk)) {
            if (frame.id) resumeToken = frame.id;
            let event: ChatEvent;
            try {
              event = JSON.parse(frame.data) as ChatEvent;
            } catch {
              continue;
            }
            queue.push(event);
          }

          let next: ChatEvent | undefined;
          while ((next = queue.shift()) !== undefined) {
            for await (const outEvent of emitWithStateGuard(next, mirror, session.threadId)) {
              yield outEvent;
            }
          }
        }
      } catch {
        connectedOk = false;
      }

      if (disposed) return;

      // Reset the backoff counter on a clean close, or on a connection that
      // survived long enough to be considered healthy before it failed.
      // Without the duration check, a connection that's accepted and then
      // immediately drops (repeatedly) would reset to the base delay every
      // time and never escalate — this is what actually prevents that.
      if (connectedOk || Date.now() - connectStartedAt >= minStableMs) {
        attempt = 0;
      }

      if (connectedOk) {
        continue; // clean server-initiated close — reconnect immediately, no backoff
      }

      attempt += 1;
      if (attempt > maxRetries) return;
      await new Promise((resolve) => setTimeout(resolve, computeBackoffDelay(attempt, options.backoff)));
    }
  }

  function toWebSocketUrl(threadId: string): string {
    const url = new URL(`${options.endpoint}/threads/${encodeURIComponent(threadId)}/events`);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return url.toString();
  }

  async function* connectViaWebSocket(session: { threadId: string }): AsyncGenerator<ChatEvent> {
    let attempt = 0;
    const mirror: StateMirrorRef = { value: undefined };
    const minStableMs = options.minStableConnectionMs ?? 1000;

    while (!disposed) {
      const connectStartedAt = Date.now();
      const ws = new WebSocketImpl(toWebSocketUrl(session.threadId));
      activeWebSocket = ws;
      const bridge = createPushPullBridge<ChatEvent>();

      // Attach message/close listeners synchronously, before awaiting
      // 'open' below — a server can send its first message the instant the
      // handshake completes, and on loopback that can arrive before our
      // `await` continuation resumes to attach listeners. Attaching now
      // means any such message is safely buffered by the bridge instead of
      // being emitted to no listener and lost.
      ws.addEventListener('message', (ev: MessageEvent) => {
        try {
          bridge.push(JSON.parse(ev.data as string) as ChatEvent);
        } catch {
          // malformed frame, ignore
        }
      });
      ws.addEventListener('close', (ev: CloseEvent) => {
        bridge.close(ev.wasClean ? undefined : new Error(`WebSocket closed abnormally (code ${ev.code})`));
      });

      const opened = await new Promise<boolean>((resolve) => {
        ws.addEventListener('open', () => resolve(true), { once: true });
        ws.addEventListener('error', () => resolve(false), { once: true });
      });

      if (!opened) {
        if (disposed) return;
        // Same stability check as connectViaSse: only reset backoff once the
        // failed attempt has been given `minStableMs` to prove itself, so a
        // socket that fails the handshake repeatedly still escalates.
        if (Date.now() - connectStartedAt >= minStableMs) attempt = 0;
        attempt += 1;
        if (attempt > maxRetries) return;
        await new Promise((resolve) => setTimeout(resolve, computeBackoffDelay(attempt, options.backoff)));
        continue;
      }

      const queue = new BoundedEventQueue(options.queueCapacity ?? 500);
      let streamFailed = false;
      try {
        for await (const event of bridge.iterate()) {
          queue.push(event);
          let next: ChatEvent | undefined;
          while ((next = queue.shift()) !== undefined) {
            for await (const outEvent of emitWithStateGuard(next, mirror, session.threadId)) {
              yield outEvent;
            }
          }
        }
      } catch {
        streamFailed = true;
      }

      if (disposed) return;

      if (!streamFailed || Date.now() - connectStartedAt >= minStableMs) {
        attempt = 0;
      }

      if (!streamFailed) {
        continue; // clean close — reconnect immediately, no backoff
      }

      attempt += 1;
      if (attempt > maxRetries) return;
      await new Promise((resolve) => setTimeout(resolve, computeBackoffDelay(attempt, options.backoff)));
    }
  }

  function connect(session: { threadId: string; resumeToken?: string }): AsyncIterable<ChatEvent> {
    return options.mode === 'websocket' ? connectViaWebSocket(session) : connectViaSse(session);
  }

  async function sendRun(input: RunAgentInput): Promise<void> {
    await fetchImpl(`${options.endpoint}/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify(input),
    });
  }

  async function sendFrontendToolResult(result: ToolResult): Promise<void> {
    await fetchImpl(`${options.endpoint}/tool-results`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    });
  }

  async function abortRun(runId: string): Promise<void> {
    try {
      await fetchImpl(`${options.endpoint}/runs/${encodeURIComponent(runId)}`, { method: 'DELETE' });
    } catch {
      // Server may not support explicit cancellation (AG-UI doesn't mandate
      // one); the caller just stops consuming and lets the server time out.
    }
  }

  async function getCapabilities(): Promise<AgentCapabilities> {
    const response = await fetchImpl(`${options.endpoint}/capabilities`);
    return (await response.json()) as AgentCapabilities;
  }

  function dispose(): void {
    disposed = true;
    activeAbortController?.abort();
    activeWebSocket?.close();
  }

  return { connect, sendRun, sendFrontendToolResult, abortRun, getCapabilities, dispose };
}
