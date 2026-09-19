import { needsApproval, reduceEvent, initialState, directionForLocale, translate } from '@chatkit-svelte/core';
import { createPluginHost } from '@chatkit-svelte/core';
import type { ChatConfig, ChatEvent, ContentPart, Message, PluginContext, RunAgentInput, ToolResult, UserInput } from '@chatkit-svelte/core';

type ToolCallPart = ContentPart & { type: 'tool_call' };

function findToolCall(messages: Message[], toolCallId: string): ToolCallPart | undefined {
  for (const m of messages) {
    for (const p of m.parts) {
      if (p.type === 'tool_call' && p.toolCallId === toolCallId) return p;
    }
  }
  return undefined;
}

function updateToolCall(messages: Message[], toolCallId: string, fn: (tc: ToolCallPart) => ToolCallPart): Message[] {
  return messages.map((m) => ({
    ...m,
    parts: m.parts.map((p) => (p.type === 'tool_call' && p.toolCallId === toolCallId ? fn(p) : p)),
  }));
}

export function createChatStore(config: ChatConfig) {
  let state = $state(initialState(config.initialState));
  let currentRunId: string | null = null;
  let disposed = false;
  // True only while a transport.sendRun() call is itself in flight (from
  // just before that call to just after it settles). This is deliberately
  // NOT the same as "a run is open" — a run can stay open for a long time
  // (e.g. paused on a tool-call approval) during which sending a further,
  // separate message is legitimate. This flag exists solely to close the
  // narrow window where two startRun calls issued synchronously (a
  // same-tick double-submit) would both fire transport.sendRun() before
  // either has a chance to be seen by the other.
  let sendRunInFlight = false;

  const transport = config.transport;
  const pluginHost = createPluginHost(config.plugins ?? []);

  const ctx: PluginContext = {
    getState: () => state,
    dispatch: (event: ChatEvent) => {
      applyEvent(event);
    },
    sendRun: (partial) => startRun(partial),
    logger: {
      debug: () => {},
      warn: () => {},
      error: () => {},
    },
    storage: {
      get: () => undefined,
      set: () => {},
    },
    config,
  };

  pluginHost.init(ctx);

  function applyEvent(event: ChatEvent) {
    state = reduceEvent(state, event);
    if (event.type === 'CUSTOM') {
      const reducers = Object.values(pluginHost.registry.artifactReducers).flat();
      const matching = reducers.find((r) => r.matches(event));
      if (matching) {
        state = { ...state, artifacts: matching.apply(state.artifacts, event) };
      }
    }
  }

  const pendingApprovals = $derived(
    state.messages
      .flatMap((m) => m.parts)
      .filter((p): p is ToolCallPart => p.type === 'tool_call' && p.status === 'awaiting_approval')
  );

  async function consumeStream(stream: AsyncIterable<ChatEvent>) {
    try {
      for await (const event of stream) {
        if (disposed) return;
        await pluginHost.runHook('onEvent', event, ctx);
        if (disposed) return;
        applyEvent(event);
        if (event.type === 'RUN_FINISHED' || event.type === 'RUN_ERROR') {
          currentRunId = null;
        }
        if (event.type === 'TOOL_CALL_END') {
          const tc = findToolCall(state.messages, event.toolCallId);
          if (tc && needsApproval(tc.toolName, config.humanInTheLoop)) {
            state = {
              ...state,
              messages: updateToolCall(state.messages, event.toolCallId, (t) => ({ ...t, status: 'awaiting_approval' })),
              runStatus: 'awaiting_approval',
            };
          }
        }
      }
    } catch (error) {
      if (disposed) return;
      const chatError = {
        code: 'STREAM_ERROR',
        message: error instanceof Error ? error.message : String(error),
        recoverable: false,
        raw: error,
      };
      state = { ...state, runStatus: 'error', error: chatError };
      await pluginHost.runHook('onError', chatError, ctx);
    }
  }

  async function startRun(partial: Partial<RunAgentInput>) {
    // Guard on sendRunInFlight, not state.runStatus: runStatus only flips
    // once a RUN_STARTED event round-trips back through the transport, so
    // two startRun calls issued synchronously in the same tick (e.g. a
    // double-submit before any UI has re-rendered) would both see 'idle' and
    // both go through. sendRunInFlight is set synchronously below, before
    // any await, so it closes that window and makes "don't fire two
    // concurrent sendRun() calls" an invariant of the store itself rather
    // than something every caller (Composer, a custom UI, a plugin) has to
    // separately get right.
    if (sendRunInFlight) return;
    sendRunInFlight = true;
    currentRunId = crypto.randomUUID();
    const input: RunAgentInput = {
      threadId: config.threadId ?? 'default',
      runId: currentRunId,
      messages: state.messages,
      tools: config.tools ?? [],
      state: state.sharedState,
      ...partial,
    };
    try {
      await transport.sendRun(input);
    } finally {
      sendRunInFlight = false;
    }
  }

  async function sendMessage(input: UserInput): Promise<void> {
    const processed = (await pluginHost.runHook('beforeSend', input, ctx)) as UserInput;
    // Re-checked here (not just inside startRun) so a message that can't
    // actually be sent never gets appended to the transcript in the first
    // place — otherwise a caller that races past this point would see its
    // message appear as "sent" while startRun silently no-ops on it, with no
    // run ever addressing it.
    if (sendRunInFlight) return;
    const message: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      parts: [
        ...(processed.text ? [{ type: 'text' as const, text: processed.text }] : []),
        ...(processed.attachments ?? []),
      ],
      createdAt: Date.now(),
      streaming: false,
    };
    state = { ...state, messages: [...state.messages, message] };
    await startRun({});
  }

  function settleApprovalRunStatus() {
    const stillPending = state.messages
      .flatMap((m) => m.parts)
      .some((p) => p.type === 'tool_call' && p.status === 'awaiting_approval');
    if (!stillPending && state.runStatus === 'awaiting_approval') {
      state = { ...state, runStatus: 'running' };
    }
  }

  async function resolveApproval(
    toolCallId: string,
    args: unknown,
    options: { rejected: boolean; reason?: string }
  ): Promise<void> {
    if (options.rejected) {
      state = { ...state, messages: updateToolCall(state.messages, toolCallId, (tc) => ({ ...tc, status: 'rejected', args })) };
      await transport.sendFrontendToolResult({ toolCallId, result: { rejected: true, reason: options.reason }, isError: true });
      settleApprovalRunStatus();
      return;
    }

    state = { ...state, messages: updateToolCall(state.messages, toolCallId, (tc) => ({ ...tc, status: 'executing', args })) };
    const tc = findToolCall(state.messages, toolCallId);
    const outcome = tc
      ? ((await pluginHost.runHook('onToolCall', { toolCallId, toolName: tc.toolName, args }, ctx)) as ToolResult | undefined)
      : undefined;
    const result = outcome?.result ?? { approved: true };
    const isError = outcome?.isError ?? false;
    state = {
      ...state,
      messages: updateToolCall(state.messages, toolCallId, (t) => ({ ...t, status: isError ? 'error' : 'complete', result })),
    };
    await transport.sendFrontendToolResult({ toolCallId, result, isError });
    settleApprovalRunStatus();
  }

  async function approveToolCall(toolCallId: string): Promise<void> {
    const tc = findToolCall(state.messages, toolCallId);
    await resolveApproval(toolCallId, tc?.args, { rejected: false });
  }

  async function rejectToolCall(toolCallId: string, reason?: string): Promise<void> {
    const tc = findToolCall(state.messages, toolCallId);
    await resolveApproval(toolCallId, tc?.args, { rejected: true, reason });
  }

  async function editAndRetry(toolCallId: string, newArgs: unknown): Promise<void> {
    await resolveApproval(toolCallId, newArgs, { rejected: false });
  }

  async function abort(): Promise<void> {
    if (currentRunId) await transport.abortRun(currentRunId);
  }

  function t(key: string, params?: Record<string, string>): string {
    return translate(config.i18n?.messages ?? {}, key, params);
  }
  const dir = directionForLocale(config.i18n?.locale);

  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  // createChatStore is called both from <ChatProvider> (inside component
  // initialization) and directly in tests/headless usage (no surrounding
  // component). $effect requires a reactive root that only exists in the
  // former case, so the debounced-save effect gets its own standalone root
  // via $effect.root — Svelte 5's mechanism for using effects outside a
  // component lifecycle — with the returned cleanup function torn down in
  // dispose() alongside the plain setTimeout handle.
  let stopSaveEffect: (() => void) | undefined;

  function dispose(): void {
    clearTimeout(saveTimer);
    stopSaveEffect?.();
    disposed = true;
    pluginHost.dispose();
    transport.dispose();
  }

  async function bootstrap() {
    if (config.persistence) {
      const loaded = await config.persistence.loadThread(config.threadId ?? 'default');
      if (loaded && !disposed) {
        state = { ...loaded, runStatus: 'idle', error: null };
      }
    }
    if (disposed) return;
    const stream = transport.connect({ threadId: config.threadId ?? 'default' });
    void consumeStream(stream);
  }
  void bootstrap();

  if (config.persistence) {
    stopSaveEffect = $effect.root(() => {
      $effect(() => {
        const snapshot = state;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
          config.persistence!.saveThread(config.threadId ?? 'default', snapshot);
        }, 400);
      });
    });
  }

  return {
    get state() {
      return state;
    },
    get messages() {
      return state.messages;
    },
    get runStatus() {
      return state.runStatus;
    },
    get sharedState() {
      return state.sharedState;
    },
    get activities() {
      return state.activities;
    },
    get pendingApprovals() {
      return pendingApprovals;
    },
    registry: pluginHost.registry,
    sendMessage,
    dispatch: applyEvent,
    abort,
    approveToolCall,
    rejectToolCall,
    editAndRetry,
    t,
    get dir() {
      return dir;
    },
    dispose,
  };
}

export type ChatStore = ReturnType<typeof createChatStore>;
