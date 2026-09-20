import { applyPatch } from '@chatkit-svelte/core';
import type { AgentCapabilities, ChatEvent, ChatTransport, RunAgentInput, ToolResult } from '@chatkit-svelte/core';
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
  /**
   * SSE only. Ask the server for the session handshake (default true): a `hello` frame naming the server process,
   * then either the events missed since the last one seen or, if the server cannot resume from there (it restarted,
   * or this is a fresh page), the whole conversation as a MESSAGES_SNAPSHOT. Servers that do not know the handshake
   * ignore the extra query parameter and stream events as before.
   */
  handshake?: boolean;
  /**
   * SSE only. A connection that delivers nothing at all (events or `:keep-alive` comments) for this long is treated
   * as dead and re-opened: a restarted server, a sleeping laptop or a proxy that lost its upstream can leave a stream
   * open but silent forever. Keep it well above the server's keep-alive interval (the chatkit gateway sends one every
   * 15 s). Default 45000; 0 turns it off.
   */
  idleTimeoutMs?: number;
  /**
   * SSE only. After the server accepts a run, the event stream must deliver something within this long, or it is
   * treated as dead and replaced at once (see idleTimeoutMs for the slower general case). Default 3000; 0 turns it off.
   */
  runAckTimeoutMs?: number;
  /** Called whenever the event stream's state changes, so a UI can say "Reconnecting…". */
  onConnectionChange?: (state: ConnectionState) => void;
  /** Called with each `hello` the server sends (SSE handshake). */
  onSession?: (hello: SessionHello) => void;
}

/** Where the event stream is: `stale` is a connection that went silent and is being replaced. */
export type ConnectionState = 'connecting' | 'live' | 'stale' | 'reconnecting' | 'closed';

/** What the server says about itself and the thread when a stream opens. */
export interface SessionHello {
  /** Names the server process; a different one than last time means the server restarted. */
  instanceId: string;
  /** `resume`: only missed events follow. `snapshot`: the conversation follows (if the server has one). */
  mode: 'resume' | 'snapshot';
  threadKnown: boolean;
  events: number;
  runActive: boolean;
}

interface StateMirrorRef {
  value: unknown;
}

// `new URL(str)` throws for a relative `str` unless a base is supplied — but
// `options.endpoint` is legitimately relative for the common case of a
// same-origin app pointing the transport at its own API routes (e.g.
// '/api/agent'). Per the URL spec, a base is *ignored* (not required) when
// the first argument is already absolute, so it's always safe to pass one.
// `location` only exists in a browser; the Node-only test suite always uses
// a fully-qualified http:// endpoint, so `undefined` there is fine too.
function urlBase(): string | undefined {
  return typeof location !== 'undefined' ? location.href : undefined;
}

export function createAguiTransport(options: AguiTransportOptions): ChatTransport {
  const fetchImpl = options.fetchImpl ?? fetch;
  const WebSocketImpl = options.WebSocketImpl ?? WebSocket;
  const maxRetries = options.maxRetries ?? Infinity;
  let disposed = false;
  let activeAbortController: AbortController | null = null;
  let activeWebSocket: WebSocket | null = null;
  let connectionState: ConnectionState | undefined;
  // When the event stream last delivered anything at all, and a handle to replace the stream that is open now (SSE).
  // A run that the server accepted should be answered on the stream within moments; these let sendRun check.
  let lastBytesAt = Date.now();
  let currentConnection: { replace: () => void } | null = null;

  function setConnection(next: ConnectionState): void {
    if (next === connectionState) return;
    connectionState = next;
    try {
      options.onConnectionChange?.(next);
    } catch {
      // a broken listener must not break the stream
    }
  }

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
    // Which server process this position belongs to. Sent back on every reconnect; if the server answers with a
    // different one, it restarted and the position is void (the server then sends the whole conversation).
    let instanceId: string | undefined;
    let attempt = 0;
    let everConnected = false;
    const mirror: StateMirrorRef = { value: undefined };
    const minStableMs = options.minStableConnectionMs ?? 1000;
    const idleMs = options.idleTimeoutMs ?? 45_000;
    const handshake = options.handshake ?? true;

    while (!disposed) {
      const controller = new AbortController();
      activeAbortController = controller;
      setConnection(everConnected ? 'reconnecting' : 'connecting');
      const url = new URL(`${options.endpoint}/threads/${encodeURIComponent(session.threadId)}/events`, urlBase());
      if (handshake) url.searchParams.set('instance', instanceId ?? '');
      if (resumeToken) url.searchParams.set('resumeToken', resumeToken);
      const connectStartedAt = Date.now();

      let connectedOk = false;
      // The watchdog is re-armed before every wait, and any bytes at all (a keep-alive comment included) satisfy it.
      let stale = false;
      let thisConnection: { replace: () => void } | null = null;
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      const armIdle = () => {
        clearTimeout(idleTimer);
        if (idleMs > 0) {
          idleTimer = setTimeout(() => {
            stale = true;
            controller.abort();
          }, idleMs);
        }
      };
      try {
        armIdle();
        const response = await fetchImpl(url.toString(), { signal: controller.signal });
        // An error page is not a stream: without this, a 500 reads as an empty "clean close" and is retried in a
        // tight loop with no backoff.
        if (response.ok === false) throw new Error(`AG-UI SSE connection refused (HTTP ${response.status})`);
        if (!response.body) throw new Error('AG-UI SSE response has no body');
        connectedOk = true;
        everConnected = true;
        lastBytesAt = Date.now();
        thisConnection = {
          replace: () => {
            stale = true;
            controller.abort();
          },
        };
        currentConnection = thisConnection;
        setConnection('live');

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const parser = createSseFrameParser();
        const queue = new BoundedEventQueue(options.queueCapacity ?? 500);

        while (true) {
          armIdle();
          const { done, value } = await reader.read();
          if (done) break;
          lastBytesAt = Date.now();
          const chunk = decoder.decode(value, { stream: true });
          for (const frame of parser.push(chunk)) {
            if (frame.event === 'hello') {
              try {
                const hello = JSON.parse(frame.data) as SessionHello;
                instanceId = hello.instanceId;
                // A snapshot means the position we held meant nothing to this server; the snapshot frame carries the
                // position to continue from.
                if (hello.mode === 'snapshot') resumeToken = undefined;
                options.onSession?.(hello);
              } catch {
                // a hello we cannot read is not worth breaking the stream over
              }
              continue;
            }
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
      } finally {
        clearTimeout(idleTimer);
        if (currentConnection === thisConnection) currentConnection = null;
      }

      if (disposed) return;

      if (stale) {
        // Silent for too long: replace the connection at once. If the server really is gone the next attempt fails
        // and the usual backoff takes over.
        setConnection('stale');
        attempt = 0;
        continue;
      }

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
    const url = new URL(`${options.endpoint}/threads/${encodeURIComponent(threadId)}/events`, urlBase());
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
    const response = await fetchImpl(`${options.endpoint}/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify(input),
    });
    // The event stream is where a run's outcome arrives, but a refused request never starts one: say so.
    if (response.ok === false) throw new Error(`Could not start the run (HTTP ${response.status})`);

    // The run was accepted, so a live server is about to write to the stream (the first event follows within
    // milliseconds). If nothing at all has arrived a few seconds on, the stream is dead even if nothing said so (a
    // restarted server behind a proxy that never passed the close on): replace it now rather than waiting for the
    // idle watchdog. The new stream is sent whatever the old one missed.
    const ackMs = options.runAckTimeoutMs ?? 3000;
    const connection = currentConnection;
    if (ackMs > 0 && connection) {
      const acceptedAt = Date.now();
      setTimeout(() => {
        if (disposed || currentConnection !== connection) return;
        if (lastBytesAt < acceptedAt) connection.replace();
      }, ackMs);
    }
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
    setConnection('closed');
    activeAbortController?.abort();
    activeWebSocket?.close();
  }

  return { connect, sendRun, sendFrontendToolResult, abortRun, getCapabilities, dispose };
}
