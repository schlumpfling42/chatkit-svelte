# M4 — State Sync + HITL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Git note:** commit steps are intentionally omitted — the repo owner handles git operations manually. Do not run `git add`/`git commit` while executing this plan unless explicitly asked to in the moment.

**Goal:** Close out spec §22 M4 ("`STATE_SNAPSHOT`/`STATE_DELTA`, approval flow, activities") by building the one piece of that milestone that doesn't already exist: the human-in-the-loop (HITL) approval flow (spec §10). State sync and activities are **already fully implemented and tested** from earlier milestones — this plan's first task is confirming and closing two small parity gaps, not building new protocol handling.

**What's already done (verified, not rebuilt):**
- `reduceEvent` (`packages/core/src/reducer.ts`) already handles `STATE_SNAPSHOT`, `STATE_DELTA` (via `applyPatch`, with a recoverable `STATE_PATCH_CONFLICT` error on failure), `ACTIVITY_SNAPSHOT`, and `ACTIVITY_DELTA` — built in M0.
- `transport-agui`'s `emitWithStateGuard` (`packages/transport-agui/src/agui-transport.ts`) already implements spec §3.3's "a `STATE_DELTA` that fails to apply triggers an automatic fresh `STATE_SNAPSHOT` request rather than surfacing an error" — built in M1, applies to both SSE and WebSocket modes.

**What this plan adds:**
1. Two small parity gaps: `createChatStore` doesn't expose `sharedState`/`activities` getters yet, even though the reducer state already carries both (spec §7's reference store exposes both).
2. The full HITL approval flow: `ChatConfig.humanInTheLoop`, approval detection when a tool call finishes and matches `requireApprovalFor`, `pendingApprovals`, `approveToolCall`/`rejectToolCall`/`editAndRetry`, and a themed `<ApprovalBar>` component wired into `<ChatWindow>`.

**A design decision this plan has to make that spec §7 leaves as a placeholder comment:** the reference store code for `approveToolCall`/`rejectToolCall`/`editAndRetry` is literally `/* resolve status, resume run via sendFrontendToolResult or re-run */` — not real code. This plan commits to one concrete, testable semantics, chosen for consistency with `ChatTransport.sendFrontendToolResult`'s documented purpose ("deliver a frontend-executed tool's result back to the agent") and with `ToolCallStatus`'s existing `'awaiting_approval'`/`'rejected'` values (already in `types.ts` since M0):
- **Approve**: mark the tool call `'executing'`, ask any plugin implementing the `onToolCall` hook (already in `ChatPluginHooks` since M0) to actually run it, then call `transport.sendFrontendToolResult({ toolCallId, result, isError })` with either that plugin's result or a synthetic `{ approved: true }` fallback when no plugin handles it (e.g. a backend tool that's approval-gated rather than frontend-executed — approval alone is the signal the backend needs). Mark the tool call `'complete'`/`'error'` locally based on the outcome; if the backend later echoes its own `TOOL_CALL_RESULT` for the same id, the reducer's normal path overwrites it idempotently.
- **Reject**: mark the tool call `'rejected'` and send `sendFrontendToolResult({ toolCallId, result: { rejected: true, reason }, isError: true })` — `isError: true` because a user-declined tool call is a failure the agent must handle (retry, ask again, work around), same as any other tool error from the agent's point of view.
- **Edit-and-retry**: update the tool call's `args` locally, then run the exact same approve flow (execute-or-signal, send result) using the edited args.
- `runStatus` returns to `'running'` once no tool call is left in `'awaiting_approval'` after a resolution; stays `'awaiting_approval'` if others are still pending (multi-tool-call runs).

**Known pre-existing limitation, not fixed here (out of scope):** `PluginHost.runHook`'s generic implementation (`packages/core/src/plugin-host.ts`) chains every hook's return value into the next plugin's input — correct for `beforeSend`, but not really meaningful for `onToolCall` if *multiple* plugins register it (the second plugin would receive the first plugin's `ToolResult` where it expects a `ToolCall`). This bug already existed before this milestone; this plan's tests only ever register one `onToolCall`-implementing plugin per store (the only realistic case: one plugin owns a given tool), so it doesn't surface here. Worth a dedicated fix in a later plugin-system-focused milestone (M6 devtools/polish), not this one.

---

## File Structure

```
packages/core/src/
  config.ts                          # Task 1 — add HumanInTheLoopConfig
  human-in-the-loop.ts, human-in-the-loop.test.ts   # Task 1 — new
  index.ts                           # Task 1 — barrel export
packages/svelte/src/
  chat-store.svelte.ts               # Task 2 — sharedState/activities getters, approval flow
  chat-store.test.ts                 # Task 2 — new tests
packages/ui/src/
  ApprovalBar.svelte, ApprovalBar.test.ts   # Task 3 — new
  ChatWindow.svelte                  # Task 3 — render ApprovalBar
  index.ts                           # Task 3 — barrel export
```

---

### Task 1: `humanInTheLoop` config + `needsApproval`

**Files:**
- Modify: `packages/core/src/config.ts`
- Create: `packages/core/src/human-in-the-loop.ts`
- Create: `packages/core/src/human-in-the-loop.test.ts`
- Modify: `packages/core/src/index.ts`

- [x] **Step 1: Write the failing tests — `packages/core/src/human-in-the-loop.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { needsApproval } from './human-in-the-loop';

describe('needsApproval', () => {
  it('returns false when no humanInTheLoop config is provided', () => {
    expect(needsApproval('search', undefined)).toBe(false);
  });

  it('returns false when requireApprovalFor is empty or absent', () => {
    expect(needsApproval('search', {})).toBe(false);
  });

  it('returns true when the tool name is listed in requireApprovalFor', () => {
    expect(needsApproval('search', { requireApprovalFor: ['search'] })).toBe(true);
  });

  it('returns false for a tool not listed in requireApprovalFor', () => {
    expect(needsApproval('search', { requireApprovalFor: ['delete_file'] })).toBe(false);
  });

  it('autoApproveTools overrides requireApprovalFor for the same tool name', () => {
    expect(needsApproval('search', { requireApprovalFor: ['search'], autoApproveTools: ['search'] })).toBe(false);
  });
});
```

- [x] **Step 2: Run and confirm failure**

```bash
npx pnpm@9.0.0 --filter @chatkit/core exec vitest run src/human-in-the-loop.test.ts
```
Expected: FAIL — `Cannot find module './human-in-the-loop'`.

- [x] **Step 3: Add `HumanInTheLoopConfig` to `packages/core/src/config.ts`**

Full file content:

```ts
import type { ChatPlugin } from './plugin-host';
import type { ChatTransport } from './transport';
import type { ToolDefinition } from './types';

export interface HumanInTheLoopConfig {
  autoApproveTools?: string[];
  requireApprovalFor?: string[];
}

export interface ChatConfig {
  threadId?: string;
  transport: ChatTransport;
  tools?: ToolDefinition[];
  plugins?: ChatPlugin[];
  initialState?: unknown;
  humanInTheLoop?: HumanInTheLoopConfig;
}
```

- [x] **Step 4: Write `packages/core/src/human-in-the-loop.ts`**

```ts
import type { HumanInTheLoopConfig } from './config';

export function needsApproval(toolName: string, config?: HumanInTheLoopConfig): boolean {
  if (!config?.requireApprovalFor?.length) return false;
  if (config.autoApproveTools?.includes(toolName)) return false;
  return config.requireApprovalFor.includes(toolName);
}
```

- [x] **Step 5: Add the barrel export to `packages/core/src/index.ts`**

```ts
export * from './types';
export * from './json-patch';
export * from './reducer';
export * from './transport';
export * from './config';
export * from './plugin-host';
export * from './human-in-the-loop';
export { createFixtureTransport } from './testing/fixture-transport';
export type { FixtureTransportOptions, FixtureTransportRecorder } from './testing/fixture-transport';
```

- [x] **Step 6: Run and confirm pass**

```bash
npx pnpm@9.0.0 --filter @chatkit/core exec vitest run
npx pnpm@9.0.0 --filter @chatkit/core exec tsc --noEmit
```
Expected: PASS — 38 tests (33 existing + 5 new), 0 type errors.

---

### Task 2: `createChatStore` — `sharedState`/`activities` getters + approval flow

**Files:**
- Modify: `packages/svelte/src/chat-store.svelte.ts`
- Modify: `packages/svelte/src/chat-store.test.ts`

- [x] **Step 1: Write the failing tests**

Add these to `packages/svelte/src/chat-store.test.ts`. The file needs `ChatPlugin` added to its `@chatkit/core` type import alongside the existing `ChatEvent` import.

```ts
describe('sharedState and activities getters', () => {
  it('exposes sharedState reactively', async () => {
    const events: ChatEvent[] = [{ type: 'STATE_SNAPSHOT', snapshot: { count: 1 } }];
    const transport = createFixtureTransport(events);
    const store = createChatStore({ transport, threadId: 't1' });

    await vi.waitFor(() => {
      expect(store.sharedState).toEqual({ count: 1 });
    });

    store.dispose();
  });

  it('exposes activities reactively', async () => {
    const events: ChatEvent[] = [{ type: 'ACTIVITY_SNAPSHOT', messageId: 'm1', data: { progress: 0.5 } }];
    const transport = createFixtureTransport(events);
    const store = createChatStore({ transport, threadId: 't1' });

    await vi.waitFor(() => {
      expect(store.activities).toHaveLength(1);
    });

    expect(store.activities[0]).toMatchObject({ messageId: 'm1', data: { progress: 0.5 } });

    store.dispose();
  });
});

describe('human-in-the-loop approval flow', () => {
  function toolCallEvents(toolName: string): ChatEvent[] {
    return [
      { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' },
      { type: 'TOOL_CALL_START', toolCallId: 'tc1', toolName, parentMessageId: 'm1' },
      { type: 'TOOL_CALL_ARGS', toolCallId: 'tc1', delta: '{"query":"weather"}' },
      { type: 'TOOL_CALL_END', toolCallId: 'tc1' },
    ];
  }

  it('transitions to awaiting_approval when a tool call matches requireApprovalFor', async () => {
    const transport = createFixtureTransport(toolCallEvents('delete_file'));
    const store = createChatStore({
      transport,
      threadId: 't1',
      humanInTheLoop: { requireApprovalFor: ['delete_file'] },
    });

    await vi.waitFor(() => {
      expect(store.runStatus).toBe('awaiting_approval');
    });

    expect(store.pendingApprovals).toHaveLength(1);
    expect(store.pendingApprovals[0]).toMatchObject({ toolCallId: 'tc1', toolName: 'delete_file', status: 'awaiting_approval' });

    store.dispose();
  });

  it('does not require approval for a tool listed in autoApproveTools even if it matches requireApprovalFor', async () => {
    const transport = createFixtureTransport(toolCallEvents('delete_file'));
    const store = createChatStore({
      transport,
      threadId: 't1',
      humanInTheLoop: { requireApprovalFor: ['delete_file'], autoApproveTools: ['delete_file'] },
    });

    await vi.waitFor(() => {
      expect(store.messages[0]?.parts.some((p) => p.type === 'tool_call')).toBe(true);
    });

    expect(store.runStatus).not.toBe('awaiting_approval');
    expect(store.pendingApprovals).toHaveLength(0);

    store.dispose();
  });

  it('approveToolCall executes via a registered onToolCall plugin hook and sends the result through the transport', async () => {
    const transport = createFixtureTransport(toolCallEvents('delete_file'));
    const plugin: ChatPlugin = {
      name: 'executor',
      version: '1.0.0',
      hooks: {
        onToolCall: async (call) => ({ toolCallId: call.toolCallId, result: { deleted: true }, isError: false }),
      },
    };
    const store = createChatStore({
      transport,
      threadId: 't1',
      plugins: [plugin],
      humanInTheLoop: { requireApprovalFor: ['delete_file'] },
    });

    await vi.waitFor(() => {
      expect(store.runStatus).toBe('awaiting_approval');
    });

    await store.approveToolCall('tc1');

    expect(transport.recorder.toolResults).toHaveLength(1);
    expect(transport.recorder.toolResults[0]).toMatchObject({ toolCallId: 'tc1', result: { deleted: true }, isError: false });
    const tc = store.messages[0].parts.find((p) => p.type === 'tool_call');
    expect(tc).toMatchObject({ status: 'complete', result: { deleted: true } });
    expect(store.runStatus).toBe('running');

    store.dispose();
  });

  it('approveToolCall falls back to a synthetic approved result when no plugin handles the tool', async () => {
    const transport = createFixtureTransport(toolCallEvents('delete_file'));
    const store = createChatStore({
      transport,
      threadId: 't1',
      humanInTheLoop: { requireApprovalFor: ['delete_file'] },
    });

    await vi.waitFor(() => {
      expect(store.runStatus).toBe('awaiting_approval');
    });

    await store.approveToolCall('tc1');

    expect(transport.recorder.toolResults[0]).toMatchObject({ toolCallId: 'tc1', result: { approved: true }, isError: false });

    store.dispose();
  });

  it('rejectToolCall marks the tool call rejected and sends an error result', async () => {
    const transport = createFixtureTransport(toolCallEvents('delete_file'));
    const store = createChatStore({
      transport,
      threadId: 't1',
      humanInTheLoop: { requireApprovalFor: ['delete_file'] },
    });

    await vi.waitFor(() => {
      expect(store.runStatus).toBe('awaiting_approval');
    });

    await store.rejectToolCall('tc1', 'too risky');

    expect(transport.recorder.toolResults[0]).toMatchObject({
      toolCallId: 'tc1',
      result: { rejected: true, reason: 'too risky' },
      isError: true,
    });
    const tc = store.messages[0].parts.find((p) => p.type === 'tool_call');
    expect(tc).toMatchObject({ status: 'rejected' });
    expect(store.runStatus).toBe('running');

    store.dispose();
  });

  it('editAndRetry updates the args before resolving the approval', async () => {
    const transport = createFixtureTransport(toolCallEvents('delete_file'));
    const store = createChatStore({
      transport,
      threadId: 't1',
      humanInTheLoop: { requireApprovalFor: ['delete_file'] },
    });

    await vi.waitFor(() => {
      expect(store.runStatus).toBe('awaiting_approval');
    });

    await store.editAndRetry('tc1', { query: 'sunny places' });

    const tc = store.messages[0].parts.find((p) => p.type === 'tool_call');
    expect(tc).toMatchObject({ status: 'complete', args: { query: 'sunny places' } });
    expect(transport.recorder.toolResults[0]).toMatchObject({ toolCallId: 'tc1', result: { approved: true } });

    store.dispose();
  });

  it('leaves runStatus at awaiting_approval if another tool call is still pending after one is resolved', async () => {
    const events: ChatEvent[] = [
      { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' },
      { type: 'TOOL_CALL_START', toolCallId: 'tc1', toolName: 'delete_file', parentMessageId: 'm1' },
      { type: 'TOOL_CALL_END', toolCallId: 'tc1' },
      { type: 'TOOL_CALL_START', toolCallId: 'tc2', toolName: 'delete_file', parentMessageId: 'm1' },
      { type: 'TOOL_CALL_END', toolCallId: 'tc2' },
    ];
    const transport = createFixtureTransport(events);
    const store = createChatStore({
      transport,
      threadId: 't1',
      humanInTheLoop: { requireApprovalFor: ['delete_file'] },
    });

    await vi.waitFor(() => {
      expect(store.pendingApprovals).toHaveLength(2);
    });

    await store.approveToolCall('tc1');

    expect(store.runStatus).toBe('awaiting_approval');
    expect(store.pendingApprovals).toHaveLength(1);

    store.dispose();
  });
});
```

- [x] **Step 2: Run and confirm failure**

```bash
npx pnpm@9.0.0 --filter @chatkit/svelte exec vitest run src/chat-store.test.ts
```
Expected: FAIL — `store.sharedState`/`store.activities`/`store.pendingApprovals`/`store.approveToolCall` etc. are `undefined`.

- [x] **Step 3: Write the full updated `packages/svelte/src/chat-store.svelte.ts`**

```ts
import { needsApproval, reduceEvent, initialState } from '@chatkit/core';
import { createPluginHost } from '@chatkit/core';
import type { ChatConfig, ChatEvent, ContentPart, Message, PluginContext, RunAgentInput, ToolResult, UserInput } from '@chatkit/core';

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

  const transport = config.transport;
  const pluginHost = createPluginHost(config.plugins ?? []);

  const ctx: PluginContext = {
    getState: () => state,
    dispatch: (event: ChatEvent) => {
      state = reduceEvent(state, event);
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
        state = reduceEvent(state, event);
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
    currentRunId = crypto.randomUUID();
    const input: RunAgentInput = {
      threadId: config.threadId ?? 'default',
      runId: currentRunId,
      messages: state.messages,
      tools: config.tools ?? [],
      state: state.sharedState,
      ...partial,
    };
    await transport.sendRun(input);
  }

  async function sendMessage(input: UserInput): Promise<void> {
    const processed = (await pluginHost.runHook('beforeSend', input, ctx)) as UserInput;
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

  async function resolveApproval(toolCallId: string, args: unknown, options: { rejected: boolean; reason?: string }): Promise<void> {
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

  function dispose(): void {
    disposed = true;
    pluginHost.dispose();
    transport.dispose();
  }

  const stream = transport.connect({ threadId: config.threadId ?? 'default' });
  void consumeStream(stream);

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
    abort,
    approveToolCall,
    rejectToolCall,
    editAndRetry,
    dispose,
  };
}

export type ChatStore = ReturnType<typeof createChatStore>;
```

Note on `settleApprovalRunStatus`: it's called after both the reject path and the approve/edit path, rather than folded into `resolveApproval`'s single tail, because both branches `return` at different points once more logic is added later — keeping it as an explicit small helper called from both places is clearer than trying to share one exit path with an early `return`.

- [x] **Step 4: Run and confirm pass**

```bash
npx pnpm@9.0.0 --filter @chatkit/svelte exec vitest run
npx pnpm@9.0.0 --filter @chatkit/svelte exec svelte-check --tsconfig ./tsconfig.json
```
Expected: PASS — 19 tests (10 existing + 2 getters + 7 approval-flow), 0 svelte-check errors/warnings.

---

### Task 3: `<ApprovalBar>` themed component

**Files:**
- Create: `packages/ui/src/ApprovalBar.svelte`
- Create: `packages/ui/src/ApprovalBar.test.ts`
- Modify: `packages/ui/src/ChatWindow.svelte`
- Modify: `packages/ui/src/index.ts`

- [x] **Step 1: Write the failing tests — `packages/ui/src/ApprovalBar.test.ts`**

Reuses the existing `TestHarness.svelte` (wraps `ChatProvider` + `ChatWindow`, forwards a `config` prop) from Task 6 of the M2 plan — no changes needed to it since `humanInTheLoop` is just another field on the `ChatConfig` object it already forwards.

```ts
import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import TestHarness from './TestHarness.svelte';
import { createFixtureTransport } from '@chatkit/core';
import type { ChatEvent } from '@chatkit/core';

function toolCallEvents(): ChatEvent[] {
  return [
    { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' },
    { type: 'TOOL_CALL_START', toolCallId: 'tc1', toolName: 'delete_file', parentMessageId: 'm1' },
    { type: 'TOOL_CALL_ARGS', toolCallId: 'tc1', delta: '{"path":"/tmp/x"}' },
    { type: 'TOOL_CALL_END', toolCallId: 'tc1' },
  ];
}

describe('ApprovalBar (via ChatWindow)', () => {
  it('renders nothing when there are no pending approvals', async () => {
    const transport = createFixtureTransport([]);
    render(TestHarness, { config: { transport, threadId: 't1' } });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(screen.queryByTestId('approval')).not.toBeInTheDocument();
  });

  it('shows a pending approval with tool name and args', async () => {
    const transport = createFixtureTransport(toolCallEvents());
    render(TestHarness, {
      config: { transport, threadId: 't1', humanInTheLoop: { requireApprovalFor: ['delete_file'] } },
    });

    await waitFor(() => {
      expect(screen.getByTestId('approval')).toHaveTextContent('delete_file');
    });
    expect(screen.getByTestId('approval')).toHaveTextContent('/tmp/x');
  });

  it('clicking Approve resolves the approval and removes the bar', async () => {
    const transport = createFixtureTransport(toolCallEvents());
    render(TestHarness, {
      config: { transport, threadId: 't1', humanInTheLoop: { requireApprovalFor: ['delete_file'] } },
    });

    await waitFor(() => screen.getByTestId('approval'));
    await fireEvent.click(screen.getByText('Approve'));

    await waitFor(() => {
      expect(screen.queryByTestId('approval')).not.toBeInTheDocument();
    });
    expect(transport.recorder.toolResults).toHaveLength(1);
  });

  it('clicking Reject sends a rejected/error result', async () => {
    const transport = createFixtureTransport(toolCallEvents());
    render(TestHarness, {
      config: { transport, threadId: 't1', humanInTheLoop: { requireApprovalFor: ['delete_file'] } },
    });

    await waitFor(() => screen.getByTestId('approval'));
    await fireEvent.click(screen.getByText('Reject'));

    await waitFor(() => {
      expect(transport.recorder.toolResults[0]).toMatchObject({ toolCallId: 'tc1', isError: true });
    });
  });

  it('Edit then Retry sends the edited args', async () => {
    const transport = createFixtureTransport(toolCallEvents());
    render(TestHarness, {
      config: { transport, threadId: 't1', humanInTheLoop: { requireApprovalFor: ['delete_file'] } },
    });

    await waitFor(() => screen.getByTestId('approval'));
    await fireEvent.click(screen.getByText('Edit'));

    const textarea = screen.getByLabelText('Edit arguments') as HTMLTextAreaElement;
    await fireEvent.input(textarea, { target: { value: '{"path":"/tmp/y"}' } });
    await fireEvent.click(screen.getByText('Retry'));

    await waitFor(() => {
      expect(transport.recorder.toolResults[0]).toMatchObject({ toolCallId: 'tc1' });
    });
  });
});
```

- [x] **Step 2: Run and confirm failure**

```bash
npx pnpm@9.0.0 --filter @chatkit/ui exec vitest run src/ApprovalBar.test.ts
```
Expected: FAIL — no `approval` testid exists yet (ChatWindow doesn't render an ApprovalBar).

- [x] **Step 3: Write `packages/ui/src/ApprovalBar.svelte`**

```svelte
<script lang="ts">
  import { getChatContext } from '@chatkit/svelte';

  const store = getChatContext();
  let editingId: string | null = $state(null);
  let editText: string = $state('');

  function startEdit(toolCallId: string, currentArgs: unknown) {
    editingId = toolCallId;
    editText = JSON.stringify(currentArgs, null, 2);
  }

  function cancelEdit() {
    editingId = null;
    editText = '';
  }

  async function submitEdit(toolCallId: string) {
    try {
      const parsed = JSON.parse(editText);
      editingId = null;
      await store.editAndRetry(toolCallId, parsed);
    } catch {
      // invalid JSON — leave the editor open so the user can fix it
    }
  }
</script>

{#if store.pendingApprovals.length > 0}
  <div class="ck-approval-bar" role="region" aria-label="Pending tool approvals">
    {#each store.pendingApprovals as call (call.toolCallId)}
      <div class="ck-approval" data-testid="approval">
        <div class="ck-approval__tool">{call.toolName}</div>
        {#if editingId === call.toolCallId}
          <textarea class="ck-approval__edit" bind:value={editText} aria-label="Edit arguments"></textarea>
          <div class="ck-approval__actions">
            <button type="button" onclick={() => submitEdit(call.toolCallId)}>Retry</button>
            <button type="button" onclick={cancelEdit}>Cancel</button>
          </div>
        {:else}
          <pre class="ck-approval__args">{JSON.stringify(call.args, null, 2)}</pre>
          <div class="ck-approval__actions">
            <button type="button" onclick={() => store.approveToolCall(call.toolCallId)}>Approve</button>
            <button type="button" onclick={() => store.rejectToolCall(call.toolCallId)}>Reject</button>
            <button type="button" onclick={() => startEdit(call.toolCallId, call.args)}>Edit</button>
          </div>
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .ck-approval-bar {
    display: flex;
    flex-direction: column;
    gap: var(--ck-space-2);
    padding: var(--ck-space-3);
    border-top: 1px solid var(--ck-color-border);
    background: var(--ck-color-surface);
  }

  .ck-approval {
    border: 1px solid var(--ck-color-border);
    border-radius: var(--ck-radius-md);
    padding: var(--ck-space-3);
  }

  .ck-approval__tool {
    font-weight: 600;
    margin-bottom: var(--ck-space-1);
    color: var(--ck-color-text);
  }

  .ck-approval__args,
  .ck-approval__edit {
    font-family: var(--ck-font-mono);
    font-size: var(--ck-font-size-sm);
    background: var(--ck-color-bg);
    color: var(--ck-color-text);
    border: 1px solid var(--ck-color-border);
    border-radius: var(--ck-radius-sm);
    padding: var(--ck-space-2);
    width: 100%;
    box-sizing: border-box;
  }

  .ck-approval__actions {
    display: flex;
    gap: var(--ck-space-2);
    margin-top: var(--ck-space-2);
  }

  .ck-approval__actions button {
    border-radius: var(--ck-radius-sm);
    border: 1px solid var(--ck-color-border);
    padding: var(--ck-space-1) var(--ck-space-3);
    cursor: pointer;
    background: var(--ck-color-bg);
    color: var(--ck-color-text);
  }
</style>
```

- [x] **Step 4: Wire `<ApprovalBar>` into `packages/ui/src/ChatWindow.svelte`**

Full file content:

```svelte
<script lang="ts">
  import MessageList from './MessageList.svelte';
  import Composer from './Composer.svelte';
  import ApprovalBar from './ApprovalBar.svelte';
  import type { Snippet } from 'svelte';
  import type { Message } from '@chatkit/core';

  interface Props {
    message?: Snippet<[Message]>;
  }

  let { message }: Props = $props();
</script>

<div class="ck-chat-window" data-chatkit-theme>
  <MessageList {message} />
  <ApprovalBar />
  <Composer />
</div>

<style>
  .ck-chat-window {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--ck-color-bg);
    color: var(--ck-color-text);
    font-family: var(--ck-font-sans);
    border: 1px solid var(--ck-color-border);
    border-radius: var(--ck-radius-lg);
  }
</style>
```

`<ApprovalBar>` is positioned between the message list and the composer — visible above the input while a run is paused on approval, out of the layout entirely (renders nothing) otherwise. It's also exported standalone (Step 5) for consumers building a custom layout who don't want `<ChatWindow>`'s default composition.

- [x] **Step 5: Add the barrel export — `packages/ui/src/index.ts`**

```ts
export { default as ChatWindow } from './ChatWindow.svelte';
export { default as MessageList } from './MessageList.svelte';
export { default as Composer } from './Composer.svelte';
export { default as ApprovalBar } from './ApprovalBar.svelte';
```

- [x] **Step 6: Run and confirm pass**

```bash
npx pnpm@9.0.0 --filter @chatkit/ui exec vitest run
npx pnpm@9.0.0 --filter @chatkit/ui exec svelte-check --tsconfig ./tsconfig.json
```
Expected: PASS — 16 tests (11 existing + 5 new), 0 svelte-check errors/warnings. The two pre-existing `ChatWindow.test.ts` tests are unaffected — they don't configure `humanInTheLoop`, so `pendingApprovals` is always empty and `<ApprovalBar>` renders nothing for them.

---

### Task 4: Externalize workspace deps in any new build config, full rebuild, and final review

M4 touches no *new* packages (`ui`/`svelte`/`core` already exist with `vite.config.ts` files that — per the M3 fix — already externalize their `@chatkit/*` workspace dependencies correctly), so there's no new externalization gap to introduce here. This task is a rebuild-and-verify pass, not a fix.

- [x] **Step 1: Rebuild in dependency order**

```bash
npx pnpm@9.0.0 --filter @chatkit/core build
npx pnpm@9.0.0 --filter @chatkit/transport-agui build
npx pnpm@9.0.0 --filter @chatkit/svelte build
npx pnpm@9.0.0 --filter @chatkit/ui build
npx pnpm@9.0.0 --filter @chatkit/plugin-tool-render build
npx pnpm@9.0.0 --filter @chatkit/plugin-markdown build
npx pnpm@9.0.0 --filter @chatkit/plugin-file-handling build
```
Expected: all succeed.

- [x] **Step 2: Full regression suite across all 7 packages**

```bash
npx pnpm@9.0.0 --filter @chatkit/core exec vitest run
npx pnpm@9.0.0 --filter @chatkit/transport-agui exec vitest run
npx pnpm@9.0.0 --filter @chatkit/svelte exec vitest run
npx pnpm@9.0.0 --filter @chatkit/ui exec vitest run
npx pnpm@9.0.0 --filter @chatkit/plugin-tool-render exec vitest run
npx pnpm@9.0.0 --filter @chatkit/plugin-markdown exec vitest run
npx pnpm@9.0.0 --filter @chatkit/plugin-file-handling exec vitest run
```
Expected: 38 / 44 / 19 / 16 / 4 / 21 / 5 = 147 tests passing, no regressions in the 5 untouched packages.

- [x] **Step 3: Update the milestone checklist in the root README**

In [README.md](../../../README.md), change:
```markdown
- [ ] M4 — State sync + HITL
```
to:
```markdown
- [x] M4 — State sync + HITL
```

---

## Notes for the next plan (M5)

- M5 is forms & documents (spec §14), which reuses this milestone's `awaiting_approval` status/`<ApprovalBar>`-adjacent pattern for form/document submission approval (spec §10's last bullet: "Document and form artifacts that require explicit user submission/approval before being sent back to the agent reuse this same `awaiting_approval` status rather than inventing a parallel state machine"). Expect M5 to add `artifactReducers` (already typed in `plugin-host.ts` since M0, unused until now) and `<FormRenderer>`/`<DocumentCanvas>` components, not to touch this milestone's approval flow itself.
- The known `PluginHost.runHook` multi-plugin `onToolCall` chaining wrinkle (noted above) is still open — worth fixing whenever a milestone first needs two plugins registering `onToolCall` for different tools at once.
- `<ApprovalBar>`'s edit affordance is deliberately minimal (a raw JSON textarea, silently keeping the editor open on invalid JSON) — a real UX pass belongs in M6 (theming/polish), same as the rest of `@chatkit/ui`'s current styling.

---

- [x] **Mark the milestone complete**

No git commit — per repo owner preference, commits are handled manually. This is the natural stopping point for M4; M5 (forms & documents) is a separate plan.
