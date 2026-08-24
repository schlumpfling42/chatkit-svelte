# Managed Agent Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `apps/managed-agent-demo`, a SvelteKit app that drives a real, hosted Claude Managed Agent through `@chatkit-svelte/transport-agui`, proving the transport's REST+SSE contract works end to end against a live Anthropic-hosted agent.

**Architecture:** A minimal chat UI (`@chatkit-svelte/svelte` + `@chatkit-svelte/ui`) talks to `createAguiTransport({ endpoint: '/api/agent' })`, which hits six SvelteKit server routes. Those routes wrap Anthropic's official `@ag-ui/claude-managed-agents` adapter (`ManagedAgentsAgent`) through a small in-memory session/event-log module (`src/lib/agent-sessions.ts`) that fans out one agent's event stream to any number of SSE subscribers, including reconnects.

**Tech Stack:** SvelteKit (`@sveltejs/adapter-node`), `@chatkit-svelte/core` / `svelte` / `ui` / `transport-agui` / `plugin-tool-render`, `@ag-ui/claude-managed-agents`, `@anthropic-ai/sdk`, Vitest.

**Reference:** Design doc at `docs/superpowers/specs/2026-08-23-managed-agent-demo-design.md`. Two corrections from that doc's route table, discovered while reading the actual client code (`packages/transport-agui/src/agui-transport.ts`) — this plan reflects the corrected, real contract:
- Abort is `DELETE /runs/:runId`, not `POST`.
- `/tool-results` and `/runs/:runId` carry no `threadId` — the client contract doesn't include it. `/runs/:runId` is resolved by scanning sessions for a matching active `runId`; `/tool-results` is implemented as a documented no-op (this demo registers no frontend-executing tools, so the route is never actually invoked — see Task 6).
- `/threads/:id/state` does not 404 on an unknown thread — it auto-creates a session (via `getOrCreateSession`) and returns its (initially `undefined`) state. `transport-agui`'s self-heal path (`requestFreshSnapshot`) calls this route whenever a `STATE_DELTA` fails to apply, including for a thread that hasn't run yet; a 404 there would break that client-side `.json()` call rather than degrade gracefully.

---

### Task 1: Scaffold the app

**Files:**
- Create: `apps/managed-agent-demo/package.json`
- Create: `apps/managed-agent-demo/svelte.config.js`
- Create: `apps/managed-agent-demo/vite.config.ts`
- Create: `apps/managed-agent-demo/tsconfig.json`
- Create: `apps/managed-agent-demo/src/app.html`
- Create: `apps/managed-agent-demo/src/app.d.ts`
- Create: `apps/managed-agent-demo/.env.example`
- Modify: `apps/managed-agent-demo/.gitignore` (create)

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "managed-agent-demo",
  "version": "0.1.0",
  "license": "MIT",
  "private": true,
  "description": "Live demo: @chatkit-svelte/transport-agui driving a hosted Claude Managed Agent.",
  "type": "module",
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "start": "node build",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@chatkit-svelte/core": "workspace:*",
    "@chatkit-svelte/svelte": "workspace:*",
    "@chatkit-svelte/ui": "workspace:*",
    "@chatkit-svelte/transport-agui": "workspace:*",
    "@chatkit-svelte/plugin-tool-render": "workspace:*",
    "@ag-ui/claude-managed-agents": "^0.1.0",
    "@anthropic-ai/sdk": "^0.70.0"
  },
  "devDependencies": {
    "@sveltejs/adapter-node": "^5.0.0",
    "@sveltejs/kit": "^2.5.0",
    "@sveltejs/vite-plugin-svelte": "^4.0.0",
    "svelte": "^5.0.0",
    "typescript": "^5.5.0",
    "vite": "^5.4.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Write `svelte.config.js`**

```js
import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
  },
};
```

- [ ] **Step 3: Write `vite.config.ts`**

```ts
/// <reference types="vitest/config" />
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// Same pnpm-symlink dep-duplication issue documented in apps/playground's
// vite.config.ts — excluded here for the same reason.
const CHATKIT_PACKAGES = [
  '@chatkit-svelte/core',
  '@chatkit-svelte/svelte',
  '@chatkit-svelte/ui',
  '@chatkit-svelte/transport-agui',
  '@chatkit-svelte/plugin-tool-render',
];

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    port: 5181,
  },
  optimizeDeps: {
    exclude: CHATKIT_PACKAGES,
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Write `tsconfig.json`**

```json
{
  "extends": "./.svelte-kit/tsconfig.json",
  "compilerOptions": {
    "strict": true,
    "moduleResolution": "bundler"
  }
}
```

- [ ] **Step 5: Write `src/app.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    %sveltekit.head%
  </head>
  <body data-sveltekit-preload-data="hover" style="height: 100vh; margin: 0;">
    <div style="display: contents; height: 100%;">%sveltekit.body%</div>
  </body>
</html>
```

- [ ] **Step 6: Write `src/app.d.ts`**

```ts
declare global {
  namespace App {}
}

export {};
```

- [ ] **Step 7: Write `.env.example`**

```
# Either set ANTHROPIC_API_KEY, or run `ant auth login` and leave this unset.
ANTHROPIC_API_KEY=
ANTHROPIC_AGENT_ID=
ANTHROPIC_ENVIRONMENT_ID=
```

- [ ] **Step 8: Write `.gitignore`**

```
.svelte-kit/
build/
node_modules/
.env
```

- [ ] **Step 9: Install and verify the skeleton typechecks**

Run: `npx pnpm@9.0.0 install`
Expected: workspace resolves the new app, no errors.

Run: `cd apps/managed-agent-demo && npx pnpm@9.0.0 exec svelte-kit sync && cd ../..`
Expected: generates `.svelte-kit/` without error (needed before `tsconfig.json`'s `extends` resolves).

- [ ] **Step 10: Commit**

```bash
git add apps/managed-agent-demo
git commit -m "chore: scaffold managed-agent-demo app"
```

---

### Task 2: `src/lib/env.ts` — required env var validation

**Files:**
- Create: `apps/managed-agent-demo/src/lib/env.ts`
- Test: `apps/managed-agent-demo/test/env.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

describe('getManagedAgentEnv', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    delete process.env.ANTHROPIC_AGENT_ID;
    delete process.env.ANTHROPIC_ENVIRONMENT_ID;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('returns agentId and environmentId when both are set', async () => {
    process.env.ANTHROPIC_AGENT_ID = 'agent_123';
    process.env.ANTHROPIC_ENVIRONMENT_ID = 'env_456';
    const { getManagedAgentEnv } = await import('../src/lib/env');
    expect(getManagedAgentEnv()).toEqual({ agentId: 'agent_123', environmentId: 'env_456' });
  });

  it('throws naming ANTHROPIC_AGENT_ID when missing', async () => {
    process.env.ANTHROPIC_ENVIRONMENT_ID = 'env_456';
    const { getManagedAgentEnv } = await import('../src/lib/env');
    expect(() => getManagedAgentEnv()).toThrow('ANTHROPIC_AGENT_ID');
  });

  it('throws naming ANTHROPIC_ENVIRONMENT_ID when missing', async () => {
    process.env.ANTHROPIC_AGENT_ID = 'agent_123';
    const { getManagedAgentEnv } = await import('../src/lib/env');
    expect(() => getManagedAgentEnv()).toThrow('ANTHROPIC_ENVIRONMENT_ID');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/managed-agent-demo && npx pnpm@9.0.0 exec vitest run test/env.test.ts`
Expected: FAIL — `Cannot find module '../src/lib/env'`

- [ ] **Step 3: Write minimal implementation**

```ts
export interface ManagedAgentEnv {
  agentId: string;
  environmentId: string;
}

export function getManagedAgentEnv(): ManagedAgentEnv {
  const agentId = process.env.ANTHROPIC_AGENT_ID;
  const environmentId = process.env.ANTHROPIC_ENVIRONMENT_ID;
  if (!agentId) {
    throw new Error('Missing required environment variable: ANTHROPIC_AGENT_ID');
  }
  if (!environmentId) {
    throw new Error('Missing required environment variable: ANTHROPIC_ENVIRONMENT_ID');
  }
  return { agentId, environmentId };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/managed-agent-demo && npx pnpm@9.0.0 exec vitest run test/env.test.ts`
Expected: PASS — 3 tests

- [ ] **Step 5: Commit**

```bash
git add apps/managed-agent-demo/src/lib/env.ts apps/managed-agent-demo/test/env.test.ts
git commit -m "feat: validate required Managed Agent env vars"
```

---

### Task 3: `src/lib/agent-sessions.ts` — session + event-log module

This is the core of the app: one `ManagedAgentsAgent` per AG-UI thread, an
append-only event log per thread (so a reconnecting SSE client can replay from
any index), and lookup-by-`runId` for abort (the client's abort request carries
only `runId`, not `threadId`).

**Files:**
- Create: `apps/managed-agent-demo/src/lib/agent-sessions.ts`
- Test: `apps/managed-agent-demo/test/agent-sessions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ChatEvent, RunAgentInput } from '@chatkit-svelte/core';

const mockRun = vi.fn();
const mockUnsubscribe = vi.fn();

vi.mock('@ag-ui/claude-managed-agents', () => ({
  ManagedAgentsAgent: vi.fn().mockImplementation(() => ({
    run: mockRun,
  })),
}));

vi.mock('../src/lib/env', () => ({
  getManagedAgentEnv: () => ({ agentId: 'agent_test', environmentId: 'env_test' }),
}));

const baseInput: RunAgentInput = {
  threadId: 't1',
  runId: 'run1',
  messages: [],
  tools: [],
};

function fakeObservable(events: ChatEvent[]) {
  return {
    subscribe(observer: { next: (e: ChatEvent) => void; error: (e: unknown) => void; complete: () => void }) {
      queueMicrotask(() => {
        for (const event of events) observer.next(event);
        observer.complete();
      });
      return { unsubscribe: mockUnsubscribe };
    },
  };
}

describe('agent-sessions', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../src/lib/agent-sessions');
    mod.__resetSessionsForTest();
  });

  it('reuses the same ManagedAgentsAgent instance for the same threadId', async () => {
    const { getOrCreateSession } = await import('../src/lib/agent-sessions');
    const a = getOrCreateSession('t1');
    const b = getOrCreateSession('t1');
    expect(a.agent).toBe(b.agent);
  });

  it('startRun appends emitted events to the thread log', async () => {
    const events: ChatEvent[] = [
      { type: 'RUN_STARTED', runId: 'run1', threadId: 't1' },
      { type: 'RUN_FINISHED', runId: 'run1' },
    ];
    mockRun.mockReturnValue(fakeObservable(events));
    const { startRun, getOrCreateSession } = await import('../src/lib/agent-sessions');
    startRun('t1', baseInput);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getOrCreateSession('t1').events).toEqual(events);
  });

  it('subscribeFromIndex replays buffered events then yields new ones', async () => {
    const events: ChatEvent[] = [
      { type: 'RUN_STARTED', runId: 'run1', threadId: 't1' },
      { type: 'RUN_FINISHED', runId: 'run1' },
    ];
    mockRun.mockReturnValue(fakeObservable(events));
    const { startRun, subscribeFromIndex } = await import('../src/lib/agent-sessions');
    startRun('t1', baseInput);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const seen: ChatEvent[] = [];
    const gen = subscribeFromIndex('t1', 0);
    seen.push((await gen.next()).value.event);
    seen.push((await gen.next()).value.event);
    expect(seen).toEqual(events);
  });

  it('findSessionByRunId locates the thread with a matching active run', async () => {
    mockRun.mockReturnValue({ subscribe: () => ({ unsubscribe: mockUnsubscribe }) });
    const { startRun, findSessionByRunId } = await import('../src/lib/agent-sessions');
    startRun('t1', baseInput);
    const found = findSessionByRunId('run1');
    expect(found?.threadId).toBe('t1');
  });

  it('abortRun unsubscribes and clears the active run', async () => {
    mockRun.mockReturnValue({ subscribe: () => ({ unsubscribe: mockUnsubscribe }) });
    const { startRun, abortRun, findSessionByRunId } = await import('../src/lib/agent-sessions');
    startRun('t1', baseInput);
    abortRun('t1');
    expect(mockUnsubscribe).toHaveBeenCalled();
    expect(findSessionByRunId('run1')).toBeUndefined();
  });

  it('getCurrentState reflects the most recent STATE_SNAPSHOT', async () => {
    const events: ChatEvent[] = [{ type: 'STATE_SNAPSHOT', snapshot: { count: 1 } }];
    mockRun.mockReturnValue(fakeObservable(events));
    const { startRun, getCurrentState } = await import('../src/lib/agent-sessions');
    startRun('t1', baseInput);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getCurrentState('t1')).toEqual({ count: 1 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/managed-agent-demo && npx pnpm@9.0.0 exec vitest run test/agent-sessions.test.ts`
Expected: FAIL — `Cannot find module '../src/lib/agent-sessions'`

- [ ] **Step 3: Write minimal implementation**

```ts
import { ManagedAgentsAgent } from '@ag-ui/claude-managed-agents';
import type { ChatEvent, RunAgentInput } from '@chatkit-svelte/core';
import { getManagedAgentEnv } from './env';

interface Subscription {
  unsubscribe: () => void;
}

interface ThreadSession {
  agent: ManagedAgentsAgent;
  events: ChatEvent[];
  currentState: unknown;
  activeRunId: string | null;
  activeSubscription: Subscription | null;
  waiters: Array<() => void>;
}

const sessions = new Map<string, ThreadSession>();

function notifyWaiters(session: ThreadSession): void {
  const waiters = session.waiters;
  session.waiters = [];
  for (const resolve of waiters) resolve();
}

function appendEvent(session: ThreadSession, event: ChatEvent): void {
  session.events.push(event);
  if (event.type === 'STATE_SNAPSHOT') {
    session.currentState = event.snapshot;
  }
  notifyWaiters(session);
}

export function getOrCreateSession(threadId: string): ThreadSession {
  let session = sessions.get(threadId);
  if (!session) {
    const env = getManagedAgentEnv();
    session = {
      agent: new ManagedAgentsAgent({ managedAgentId: env.agentId, environmentId: env.environmentId }),
      events: [],
      currentState: undefined,
      activeRunId: null,
      activeSubscription: null,
      waiters: [],
    };
    sessions.set(threadId, session);
  }
  return session;
}

export function startRun(threadId: string, input: RunAgentInput): void {
  const session = getOrCreateSession(threadId);
  session.activeRunId = input.runId;
  session.activeSubscription = session.agent.run(input).subscribe({
    next: (event: ChatEvent) => appendEvent(session, event),
    error: (err: unknown) => {
      appendEvent(session, {
        type: 'RUN_ERROR',
        runId: input.runId,
        error: {
          code: 'managed_agent_error',
          message: err instanceof Error ? err.message : String(err),
          recoverable: false,
          raw: err,
        },
      });
      session.activeRunId = null;
      session.activeSubscription = null;
    },
    complete: () => {
      session.activeRunId = null;
      session.activeSubscription = null;
    },
  });
}

export async function* subscribeFromIndex(
  threadId: string,
  fromIndex: number
): AsyncGenerator<{ index: number; event: ChatEvent }> {
  const session = getOrCreateSession(threadId);
  let index = fromIndex;
  while (true) {
    while (index < session.events.length) {
      yield { index, event: session.events[index] };
      index += 1;
    }
    await new Promise<void>((resolve) => {
      session.waiters.push(resolve);
    });
  }
}

export function getCurrentState(threadId: string): unknown {
  return getOrCreateSession(threadId).currentState;
}

export function findSessionByRunId(runId: string): { threadId: string; session: ThreadSession } | undefined {
  for (const [threadId, session] of sessions) {
    if (session.activeRunId === runId) return { threadId, session };
  }
  return undefined;
}

export function abortRun(threadId: string): void {
  const session = sessions.get(threadId);
  if (!session) return;
  session.activeSubscription?.unsubscribe();
  session.activeSubscription = null;
  session.activeRunId = null;
}

/** Test-only: clears all in-memory sessions between test cases. */
export function __resetSessionsForTest(): void {
  sessions.clear();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/managed-agent-demo && npx pnpm@9.0.0 exec vitest run test/agent-sessions.test.ts`
Expected: PASS — 6 tests

If `ManagedAgentsAgent`'s actual constructor or `.run()` signature differs from
what's mocked here once `@ag-ui/claude-managed-agents` is really installed
(Step 9 of Task 1 only installs it as a version range — the real package may
have compiled type errors against this usage), fix the call site to match the
compiler's error rather than the mock — the mock only needs to match the real
shape, not vice versa.

- [ ] **Step 5: Commit**

```bash
git add apps/managed-agent-demo/src/lib/agent-sessions.ts apps/managed-agent-demo/test/agent-sessions.test.ts
git commit -m "feat: add per-thread Managed Agent session/event-log module"
```

---

### Task 3b: `src/lib/agui-translate.ts` — real AG-UI ↔ chatkit translation

Discovered mid-Task-3: `@ag-ui/claude-managed-agents`'s `.run()` uses `@ag-ui/client`'s own `RunAgentInput`/event types (from `@ag-ui/core@0.0.58`), which are NOT structurally compatible with `@chatkit-svelte/core`'s types of the same conceptual purpose — both are independent implementations of "the AG-UI protocol," not one shared type. Confirmed by reading the installed `@ag-ui/core@0.0.58` schemas directly. Concretely:

- Chatkit messages use `parts: ContentPart[]`; AG-UI messages use `content: string` + a separate `toolCalls` array.
- Several same-named events have different field names: `TOOL_CALL_START` uses `toolCallName` (not `toolName`); `STATE_DELTA` uses `delta` (not `patch`); `STEP_STARTED`/`STEP_FINISHED` carry only `stepName`, no `stepId`; `TOOL_CALL_RESULT` carries `content: string`, not `result`/`isError`; `RUN_ERROR` carries `{message, code?}`, not a nested `error: ChatError` object.
- AG-UI has several event types chatkit's `ChatEvent` union doesn't (`TEXT_MESSAGE_CHUNK`, `TOOL_CALL_CHUNK`, `THINKING_*`, `REASONING_MESSAGE_*`, etc.).

Task 3's implementation currently bridges this gap with unchecked casts through `unknown` — this task replaces that with real translation functions.

**Scope decision:** full field-level translation for the event types this demo's UI actually renders (conversational flow: run/step lifecycle, text streaming, tool calls, state). Anything else is preserved losslessly as a `CUSTOM` event rather than dropped or crashing, since this demo has no dedicated UI for reasoning/activity/thinking events — see the `default` case below.

**Files:**
- Create: `apps/managed-agent-demo/src/lib/agui-translate.ts`
- Test: `apps/managed-agent-demo/test/agui-translate.test.ts`
- Modify: `apps/managed-agent-demo/src/lib/agent-sessions.ts`

- [ ] **Step 1: Write the failing test** at `apps/managed-agent-demo/test/agui-translate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Message } from '@chatkit-svelte/core';
import { toAguiMessages, fromAguiEvent } from '../src/lib/agui-translate';

describe('toAguiMessages', () => {
  it('translates a user text message', () => {
    const messages: Message[] = [
      { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hello' }], createdAt: 0, streaming: false },
    ];
    expect(toAguiMessages(messages)).toEqual([{ id: 'm1', role: 'user', content: 'hello' }]);
  });

  it('translates an assistant message with a tool call into content + toolCalls', () => {
    const messages: Message[] = [
      {
        id: 'm2',
        role: 'assistant',
        parts: [
          { type: 'text', text: 'checking...' },
          {
            type: 'tool_call',
            toolCallId: 'tc1',
            toolName: 'get_weather',
            args: { city: 'Boston' },
            status: 'complete',
          },
        ],
        createdAt: 0,
        streaming: false,
      },
    ];
    expect(toAguiMessages(messages)).toEqual([
      {
        id: 'm2',
        role: 'assistant',
        content: 'checking...',
        toolCalls: [{ id: 'tc1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Boston"}' } }],
      },
    ]);
  });

  it('translates a tool result message', () => {
    const messages: Message[] = [
      {
        id: 'm3',
        role: 'tool',
        parts: [
          {
            type: 'tool_call',
            toolCallId: 'tc1',
            toolName: 'get_weather',
            args: {},
            status: 'complete',
            result: { tempF: 52 },
          },
        ],
        createdAt: 0,
        streaming: false,
      },
    ];
    expect(toAguiMessages(messages)).toEqual([
      { id: 'm3', role: 'tool', toolCallId: 'tc1', content: '{"tempF":52}' },
    ]);
  });
});

describe('fromAguiEvent', () => {
  it('passes through RUN_STARTED', () => {
    expect(fromAguiEvent({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' }, 'r1')).toEqual({
      type: 'RUN_STARTED',
      runId: 'r1',
      threadId: 't1',
    });
  });

  it('maps STEP_STARTED (stepName only) into chatkit shape (stepId + name)', () => {
    expect(fromAguiEvent({ type: 'STEP_STARTED', stepName: 'thinking' }, 'r1')).toEqual({
      type: 'STEP_STARTED',
      stepId: 'thinking',
      name: 'thinking',
    });
  });

  it('maps TOOL_CALL_START field name toolCallName -> toolName', () => {
    expect(
      fromAguiEvent(
        { type: 'TOOL_CALL_START', toolCallId: 'tc1', toolCallName: 'get_weather', parentMessageId: 'm1' },
        'r1'
      )
    ).toEqual({ type: 'TOOL_CALL_START', toolCallId: 'tc1', toolName: 'get_weather', parentMessageId: 'm1' });
  });

  it('maps TOOL_CALL_RESULT content -> result', () => {
    expect(
      fromAguiEvent({ type: 'TOOL_CALL_RESULT', toolCallId: 'tc1', messageId: 'm1', content: '{"tempF":52}' }, 'r1')
    ).toEqual({ type: 'TOOL_CALL_RESULT', toolCallId: 'tc1', result: '{"tempF":52}' });
  });

  it('maps STATE_DELTA field name delta -> patch', () => {
    const patch = [{ op: 'replace', path: '/count', value: 2 }];
    expect(fromAguiEvent({ type: 'STATE_DELTA', delta: patch }, 'r1')).toEqual({ type: 'STATE_DELTA', patch });
  });

  it('maps RUN_ERROR (message/code) into chatkit ChatError shape, using the fallback runId', () => {
    expect(fromAguiEvent({ type: 'RUN_ERROR', message: 'boom', code: 'timeout' }, 'r1')).toEqual({
      type: 'RUN_ERROR',
      runId: 'r1',
      error: { code: 'timeout', message: 'boom', recoverable: false, raw: { type: 'RUN_ERROR', message: 'boom', code: 'timeout' } },
    });
  });

  it('preserves an unmapped event type losslessly as CUSTOM instead of dropping it', () => {
    const event = { type: 'THINKING_START', foo: 'bar' };
    expect(fromAguiEvent(event, 'r1')).toEqual({ type: 'CUSTOM', name: 'agui:THINKING_START', payload: event });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/managed-agent-demo && npx pnpm@9.0.0 exec vitest run test/agui-translate.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation** at `apps/managed-agent-demo/src/lib/agui-translate.ts`:

```ts
import type { ChatEvent, ContentPart, Message } from '@chatkit-svelte/core';

interface AguiToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export type AguiMessage =
  | { id: string; role: 'system'; content: string }
  | { id: string; role: 'user'; content: string }
  | { id: string; role: 'assistant'; content?: string; toolCalls?: AguiToolCall[] }
  | { id: string; role: 'tool'; content: string; toolCallId: string };

function textOf(parts: ContentPart[]): string {
  return parts
    .filter((p): p is Extract<ContentPart, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('');
}

function toolCallsOf(parts: ContentPart[]): AguiToolCall[] {
  return parts
    .filter((p): p is Extract<ContentPart, { type: 'tool_call' }> => p.type === 'tool_call')
    .map((p) => ({
      id: p.toolCallId,
      type: 'function' as const,
      function: { name: p.toolName, arguments: JSON.stringify(p.args ?? {}) },
    }));
}

/**
 * Translates chatkit's Message[] (content as ContentPart[]) into the shape
 * @ag-ui/client's RunAgentInput actually expects (content as a plain string,
 * tool calls as a separate array) — see Task 3b's design note for why this
 * translation is necessary rather than a pass-through cast.
 */
export function toAguiMessages(messages: Message[]): AguiMessage[] {
  return messages.map((message): AguiMessage => {
    if (message.role === 'system') {
      return { id: message.id, role: 'system', content: textOf(message.parts) };
    }
    if (message.role === 'user') {
      return { id: message.id, role: 'user', content: textOf(message.parts) };
    }
    if (message.role === 'tool') {
      const toolCallPart = message.parts.find(
        (p): p is Extract<ContentPart, { type: 'tool_call' }> => p.type === 'tool_call'
      );
      return {
        id: message.id,
        role: 'tool',
        toolCallId: toolCallPart?.toolCallId ?? message.id,
        content: toolCallPart ? JSON.stringify(toolCallPart.result ?? null) : textOf(message.parts),
      };
    }
    // assistant
    const content = textOf(message.parts);
    const toolCalls = toolCallsOf(message.parts);
    return {
      id: message.id,
      role: 'assistant',
      ...(content ? { content } : {}),
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    };
  });
}

const TEXT_MESSAGE_ROLE: Record<string, ChatEvent extends { type: 'TEXT_MESSAGE_START'; role: infer R } ? R : never> = {
  developer: 'system',
  system: 'system',
  assistant: 'assistant',
  user: 'user',
} as never;

/**
 * Translates a real AG-UI event (from @ag-ui/client) into chatkit's
 * ChatEvent union. NOT a blind pass-through — several same-named event types
 * have different field shapes between the two protocols (see Task 3b's
 * design note). `fallbackRunId` is used for events (e.g. RUN_ERROR) whose
 * real schema doesn't reliably carry a runId of its own — the caller already
 * knows which run this event belongs to from its own subscription context.
 * Anything not explicitly mapped below is preserved losslessly as a CUSTOM
 * event rather than dropped, since this demo has no dedicated UI for
 * reasoning/activity/thinking/chunk event types but shouldn't crash or lose
 * data if the agent emits them.
 */
export function fromAguiEvent(event: { type: string; [key: string]: unknown }, fallbackRunId: string): ChatEvent {
  switch (event.type) {
    case 'RUN_STARTED':
      return { type: 'RUN_STARTED', runId: event.runId as string, threadId: event.threadId as string };
    case 'RUN_FINISHED':
      return { type: 'RUN_FINISHED', runId: event.runId as string, result: event.result };
    case 'RUN_ERROR':
      return {
        type: 'RUN_ERROR',
        runId: (event.runId as string) ?? fallbackRunId,
        error: {
          code: (event.code as string) ?? 'agent_error',
          message: event.message as string,
          recoverable: false,
          raw: event,
        },
      };
    case 'STEP_STARTED':
      return { type: 'STEP_STARTED', stepId: event.stepName as string, name: event.stepName as string };
    case 'STEP_FINISHED':
      return { type: 'STEP_FINISHED', stepId: event.stepName as string };
    case 'TEXT_MESSAGE_START':
      return {
        type: 'TEXT_MESSAGE_START',
        messageId: event.messageId as string,
        role: TEXT_MESSAGE_ROLE[event.role as string] ?? 'assistant',
      };
    case 'TEXT_MESSAGE_CONTENT':
      return { type: 'TEXT_MESSAGE_CONTENT', messageId: event.messageId as string, delta: event.delta as string };
    case 'TEXT_MESSAGE_END':
      return { type: 'TEXT_MESSAGE_END', messageId: event.messageId as string };
    case 'TOOL_CALL_START':
      return {
        type: 'TOOL_CALL_START',
        toolCallId: event.toolCallId as string,
        toolName: event.toolCallName as string,
        parentMessageId: (event.parentMessageId as string) ?? '',
      };
    case 'TOOL_CALL_ARGS':
      return { type: 'TOOL_CALL_ARGS', toolCallId: event.toolCallId as string, delta: event.delta as string };
    case 'TOOL_CALL_END':
      return { type: 'TOOL_CALL_END', toolCallId: event.toolCallId as string };
    case 'TOOL_CALL_RESULT':
      return { type: 'TOOL_CALL_RESULT', toolCallId: event.toolCallId as string, result: event.content };
    case 'STATE_SNAPSHOT':
      return { type: 'STATE_SNAPSHOT', snapshot: event.snapshot };
    case 'STATE_DELTA':
      return { type: 'STATE_DELTA', patch: event.delta as ChatEvent extends { type: 'STATE_DELTA'; patch: infer P } ? P : never };
    default:
      return { type: 'CUSTOM', name: `agui:${event.type}`, payload: event };
  }
}
```

If `tsc` disagrees with any of the `as`-cast field access above once checked against the real installed `@ag-ui/client`/`@ag-ui/core` types (this code was written against the schema read directly from `node_modules/.pnpm/@ag-ui+core@0.0.58/...`, but the exact TS type surface `@ag-ui/client` re-exports may differ slightly), fix the discrepancy and note exactly what changed in your report — same rule as Task 3.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/managed-agent-demo && npx pnpm@9.0.0 exec vitest run test/agui-translate.test.ts`
Expected: PASS — 10 tests

- [ ] **Step 5: Wire the translation into `agent-sessions.ts`**

Modify `startRun` in `apps/managed-agent-demo/src/lib/agent-sessions.ts` to use `toAguiMessages`/`fromAguiEvent` instead of the unchecked `as`/`unknown` casts from Task 3. The exact call sites depend on what Task 3 actually wrote (which itself may have deviated from its own description per its report) — read the current file first, then:
- Wherever `session.agent.run(input)` is called, build its argument from `{ ...input, messages: toAguiMessages(input.messages) }` (keep `threadId`/`runId`/`state`/`context`/`forwardedProps` as-is — only `messages` needs translating; `tools` also likely needs no translation since both sides use a similar flat `{name, description, parameters}` shape, but verify against the real type and fix if `tsc` disagrees).
- Wherever the `next: (event) => appendEvent(session, event)` handler receives a raw AG-UI event, change it to `next: (event) => appendEvent(session, fromAguiEvent(event, input.runId))`.

Re-run both test files after this change:
```
cd apps/managed-agent-demo && npx pnpm@9.0.0 exec vitest run test/agent-sessions.test.ts test/agui-translate.test.ts
```
Expected: both pass (agent-sessions.test.ts's mocked events are already valid chatkit `ChatEvent` shapes, e.g. `{type:'RUN_STARTED', runId, threadId}` — `fromAguiEvent` must treat these as already-chatkit-shaped and pass them through unchanged for the mapped cases, which the switch above does correctly since chatkit's RUN_STARTED/RUN_FINISHED/TEXT_MESSAGE_*/TOOL_CALL_START,ARGS,END fields are a subset/match of the AG-UI ones being read — if any agent-sessions test starts failing because a mocked event's shape doesn't have the AG-UI-side field name `fromAguiEvent` now reads, that's expected only for STEP_STARTED/STEP_FINISHED/TOOL_CALL_RESULT/RUN_ERROR/STATE_DELTA mocks if agent-sessions.test.ts used any of those with chatkit field names — check and fix by using AG-UI-shaped mock events in agent-sessions.test.ts if needed, since after this change the boundary genuinely expects real AG-UI event shapes, not chatkit ones).

Also run: `cd apps/managed-agent-demo && npx pnpm@9.0.0 exec tsc --noEmit`
Expected: clean.

Do NOT run `git add`/`git commit` — leave everything uncommitted, per standing instruction for this execution run.

## After completing all steps

1. Self-review: did `agent-sessions.test.ts`'s existing mocked fixture events need adjusting because they were chatkit-shaped and the boundary now expects AG-UI-shaped input? If so, what did you change and why is the new mock still a faithful test of the real boundary?
2. Report status (DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED), what you built/changed, any deviations, and confirm no git commands were run beyond read-only ones.

---

### Task 4: `POST /api/agent/runs`

**Files:**
- Create: `apps/managed-agent-demo/src/routes/api/agent/runs/+server.ts`
- Test: `apps/managed-agent-demo/test/routes/runs.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { RunAgentInput } from '@chatkit-svelte/core';

const mockStartRun = vi.fn();
vi.mock('../../src/lib/agent-sessions', () => ({
  startRun: mockStartRun,
}));

describe('POST /api/agent/runs', () => {
  beforeEach(() => vi.clearAllMocks());

  it('parses the body and starts a run', async () => {
    const { POST } = await import('../../src/routes/api/agent/runs/+server');
    const input: RunAgentInput = { threadId: 't1', runId: 'run1', messages: [], tools: [] };
    const request = new Request('http://localhost/api/agent/runs', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    const response = await POST({ request } as never);
    expect(response.status).toBe(202);
    expect(mockStartRun).toHaveBeenCalledWith('t1', input);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/managed-agent-demo && npx pnpm@9.0.0 exec vitest run test/routes/runs.test.ts`
Expected: FAIL — `Cannot find module '../../src/routes/api/agent/runs/+server'`

- [ ] **Step 3: Write minimal implementation**

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { RunAgentInput } from '@chatkit-svelte/core';
import { startRun } from '$lib/agent-sessions';

export const POST: RequestHandler = async ({ request }) => {
  const input = (await request.json()) as RunAgentInput;
  startRun(input.threadId, input);
  return json({ ok: true }, { status: 202 });
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/managed-agent-demo && npx pnpm@9.0.0 exec vitest run test/routes/runs.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/managed-agent-demo/src/routes/api/agent/runs apps/managed-agent-demo/test/routes/runs.test.ts
git commit -m "feat: add POST /api/agent/runs route"
```

---

### Task 5: `GET /api/agent/threads/[id]/events` (SSE)

**Files:**
- Create: `apps/managed-agent-demo/src/routes/api/agent/threads/[id]/events/+server.ts`
- Test: `apps/managed-agent-demo/test/routes/events.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from 'vitest';
import type { ChatEvent } from '@chatkit-svelte/core';

vi.mock('../../src/lib/agent-sessions', () => ({
  subscribeFromIndex: async function* (threadId: string, fromIndex: number) {
    const events: ChatEvent[] = [
      { type: 'RUN_STARTED', runId: 'run1', threadId },
      { type: 'RUN_FINISHED', runId: 'run1' },
    ];
    for (let i = fromIndex; i < events.length; i += 1) {
      yield { index: i, event: events[i] };
    }
  },
}));

describe('GET /api/agent/threads/[id]/events', () => {
  it('streams SSE frames with id and data fields', async () => {
    const { GET } = await import('../../src/routes/api/agent/threads/[id]/events/+server');
    const url = new URL('http://localhost/api/agent/threads/t1/events');
    const response = await GET({ params: { id: 't1' }, url } as never);

    expect(response.headers.get('Content-Type')).toBe('text/event-stream');

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    for (let i = 0; i < 2; i += 1) {
      const { value } = await reader.read();
      text += decoder.decode(value);
    }
    expect(text).toContain('id: 0\ndata: {"type":"RUN_STARTED","runId":"run1","threadId":"t1"}\n\n');
    expect(text).toContain('id: 1\ndata: {"type":"RUN_FINISHED","runId":"run1"}\n\n');
  });

  it('resumes from resumeToken + 1', async () => {
    const { GET } = await import('../../src/routes/api/agent/threads/[id]/events/+server');
    const url = new URL('http://localhost/api/agent/threads/t1/events?resumeToken=0');
    const response = await GET({ params: { id: 't1' }, url } as never);

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const { value } = await reader.read();
    const text = decoder.decode(value);
    expect(text).toBe('id: 1\ndata: {"type":"RUN_FINISHED","runId":"run1"}\n\n');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/managed-agent-demo && npx pnpm@9.0.0 exec vitest run test/routes/events.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```ts
import type { RequestHandler } from './$types';
import { subscribeFromIndex } from '$lib/agent-sessions';

export const GET: RequestHandler = async ({ params, url }) => {
  const threadId = params.id;
  const resumeToken = url.searchParams.get('resumeToken');
  const fromIndex = resumeToken ? Number(resumeToken) + 1 : 0;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const { index, event } of subscribeFromIndex(threadId, fromIndex)) {
          const frame = `id: ${index}\ndata: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(encoder.encode(frame));
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/managed-agent-demo && npx pnpm@9.0.0 exec vitest run test/routes/events.test.ts`
Expected: PASS — 2 tests

Note: `subscribeFromIndex` in the real (non-mocked) implementation never
completes on its own (it waits for more events indefinitely) — that's correct
SSE keep-alive behavior for production. The test above uses a finite mock
generator so it can assert on framing without hanging.

- [ ] **Step 5: Commit**

```bash
git add "apps/managed-agent-demo/src/routes/api/agent/threads/[id]/events" apps/managed-agent-demo/test/routes/events.test.ts
git commit -m "feat: add SSE event stream route"
```

---

### Task 6: `POST /api/agent/tool-results`

This demo registers no frontend-executing tools (Managed Agents runs tools
server-side, in Anthropic's own sandbox), so `transport-agui`'s
`sendFrontendToolResult()` is never actually invoked by this app in practice.
The route still must exist to satisfy the transport's contract — implemented as
a documented no-op rather than wiring up cross-thread tool-call lookup for a
path this demo can't exercise (YAGNI, per the design doc's Out of Scope
section).

**Files:**
- Create: `apps/managed-agent-demo/src/routes/api/agent/tool-results/+server.ts`
- Test: `apps/managed-agent-demo/test/routes/tool-results.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';

describe('POST /api/agent/tool-results', () => {
  it('returns 200 ok', async () => {
    const { POST } = await import('../../src/routes/api/agent/tool-results/+server');
    const response = await POST!({} as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/managed-agent-demo && npx pnpm@9.0.0 exec vitest run test/routes/tool-results.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// This demo has no frontend-executing tools — Managed Agents runs tools
// server-side in Anthropic's own sandbox, so transport-agui's
// sendFrontendToolResult() is never actually invoked here. This route exists
// only to satisfy the transport's existing contract.
export const POST: RequestHandler = async () => {
  return json({ ok: true }, { status: 200 });
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/managed-agent-demo && npx pnpm@9.0.0 exec vitest run test/routes/tool-results.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/managed-agent-demo/src/routes/api/agent/tool-results apps/managed-agent-demo/test/routes/tool-results.test.ts
git commit -m "feat: add tool-results no-op route"
```

---

### Task 7: `DELETE /api/agent/runs/[runId]`

**Files:**
- Create: `apps/managed-agent-demo/src/routes/api/agent/runs/[runId]/+server.ts`
- Test: `apps/managed-agent-demo/test/routes/abort.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockFindSessionByRunId = vi.fn();
const mockAbortRun = vi.fn();
vi.mock('../../src/lib/agent-sessions', () => ({
  findSessionByRunId: mockFindSessionByRunId,
  abortRun: mockAbortRun,
}));

describe('DELETE /api/agent/runs/[runId]', () => {
  beforeEach(() => vi.clearAllMocks());

  it('aborts the run when the runId is known', async () => {
    mockFindSessionByRunId.mockReturnValue({ threadId: 't1', session: {} });
    const { DELETE } = await import('../../src/routes/api/agent/runs/[runId]/+server');
    const response = await DELETE({ params: { runId: 'run1' } } as never);
    expect(response.status).toBe(200);
    expect(mockAbortRun).toHaveBeenCalledWith('t1');
  });

  it('404s when the runId is unknown', async () => {
    mockFindSessionByRunId.mockReturnValue(undefined);
    const { DELETE } = await import('../../src/routes/api/agent/runs/[runId]/+server');
    await expect(DELETE({ params: { runId: 'missing' } } as never)).rejects.toMatchObject({
      status: 404,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/managed-agent-demo && npx pnpm@9.0.0 exec vitest run test/routes/abort.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { abortRun, findSessionByRunId } from '$lib/agent-sessions';

export const DELETE: RequestHandler = async ({ params }) => {
  const found = findSessionByRunId(params.runId);
  if (!found) {
    throw error(404, 'Unknown run');
  }
  abortRun(found.threadId);
  return json({ ok: true });
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/managed-agent-demo && npx pnpm@9.0.0 exec vitest run test/routes/abort.test.ts`
Expected: PASS — 2 tests

- [ ] **Step 5: Commit**

```bash
git add "apps/managed-agent-demo/src/routes/api/agent/runs/[runId]" apps/managed-agent-demo/test/routes/abort.test.ts
git commit -m "feat: add run abort route"
```

---

### Task 8: `GET /api/agent/capabilities`

**Files:**
- Create: `apps/managed-agent-demo/src/routes/api/agent/capabilities/+server.ts`
- Test: `apps/managed-agent-demo/test/routes/capabilities.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';

describe('GET /api/agent/capabilities', () => {
  it('returns the static capabilities payload', async () => {
    const { GET } = await import('../../src/routes/api/agent/capabilities/+server');
    const response = await GET!({} as never);
    expect(await response.json()).toEqual({
      transports: ['sse'],
      tools: [],
      multimodal: false,
      reasoning: true,
      humanInTheLoop: false,
      sharedStateWritable: false,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/managed-agent-demo && npx pnpm@9.0.0 exec vitest run test/routes/capabilities.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { AgentCapabilities } from '@chatkit-svelte/core';

const capabilities: AgentCapabilities = {
  transports: ['sse'],
  tools: [],
  multimodal: false,
  reasoning: true,
  humanInTheLoop: false,
  sharedStateWritable: false,
};

export const GET: RequestHandler = async () => json(capabilities);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/managed-agent-demo && npx pnpm@9.0.0 exec vitest run test/routes/capabilities.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/managed-agent-demo/src/routes/api/agent/capabilities apps/managed-agent-demo/test/routes/capabilities.test.ts
git commit -m "feat: add capabilities route"
```

---

### Task 9: `GET /api/agent/threads/[id]/state`

**Files:**
- Create: `apps/managed-agent-demo/src/routes/api/agent/threads/[id]/state/+server.ts`
- Test: `apps/managed-agent-demo/test/routes/state.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/agent-sessions', () => ({
  getCurrentState: (threadId: string) => ({ threadId, count: 3 }),
}));

describe('GET /api/agent/threads/[id]/state', () => {
  it('returns the current state snapshot for the thread', async () => {
    const { GET } = await import('../../src/routes/api/agent/threads/[id]/state/+server');
    const response = await GET({ params: { id: 't1' } } as never);
    expect(await response.json()).toEqual({ threadId: 't1', count: 3 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/managed-agent-demo && npx pnpm@9.0.0 exec vitest run test/routes/state.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getCurrentState } from '$lib/agent-sessions';

export const GET: RequestHandler = async ({ params }) => {
  return json(getCurrentState(params.id));
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/managed-agent-demo && npx pnpm@9.0.0 exec vitest run test/routes/state.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add "apps/managed-agent-demo/src/routes/api/agent/threads/[id]/state" apps/managed-agent-demo/test/routes/state.test.ts
git commit -m "feat: add thread state snapshot route"
```

---

### Task 10: Frontend — layout and chat page

**Files:**
- Create: `apps/managed-agent-demo/src/routes/+layout.svelte`
- Create: `apps/managed-agent-demo/src/routes/+page.svelte`

No automated test for this task — it's UI wiring, and real verification needs
a live agent (Task 12 covers manual browser verification once credentials
exist). Follows the exact pattern already used in `apps/playground`.

- [ ] **Step 1: Write `src/routes/+layout.svelte`**

```svelte
<script lang="ts">
  import '@chatkit-svelte/ui/tokens.css';
  import type { Snippet } from 'svelte';

  interface Props {
    children: Snippet;
  }

  let { children }: Props = $props();
</script>

{@render children()}
```

- [ ] **Step 2: Write `src/routes/+page.svelte`**

```svelte
<script lang="ts">
  import { ChatProvider } from '@chatkit-svelte/svelte';
  import { ChatWindow } from '@chatkit-svelte/ui';
  import { createAguiTransport } from '@chatkit-svelte/transport-agui';
  import { toolRenderPlugin } from '@chatkit-svelte/plugin-tool-render';
  import type { ChatConfig } from '@chatkit-svelte/core';

  const config: ChatConfig = {
    threadId: crypto.randomUUID(),
    transport: createAguiTransport({ endpoint: '/api/agent' }),
    plugins: [toolRenderPlugin()],
  };
</script>

<svelte:head>
  <title>chatkit — Claude Managed Agent demo</title>
</svelte:head>

<div class="demo" data-chatkit-theme>
  <ChatProvider {config}>
    {#snippet children()}
      <ChatWindow />
    {/snippet}
  </ChatProvider>
</div>

<style>
  .demo {
    display: flex;
    flex-direction: column;
    height: 100vh;
    font-family: system-ui, sans-serif;
  }
</style>
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/managed-agent-demo && npx pnpm@9.0.0 exec svelte-check --tsconfig ./tsconfig.json`
Expected: 0 errors (will only pass once `@ag-ui/claude-managed-agents` is
actually resolvable from Task 1's install — if Task 1's version pin doesn't
match what's published, adjust `package.json` to the real published version
and re-run `pnpm install` before this check).

- [ ] **Step 4: Commit**

```bash
git add apps/managed-agent-demo/src/routes/+layout.svelte apps/managed-agent-demo/src/routes/+page.svelte
git commit -m "feat: wire chat UI to the AG-UI Managed Agent backend"
```

---

### Task 11: README, launch config, and workspace verification

**Files:**
- Create: `apps/managed-agent-demo/README.md`
- Modify: `.claude/launch.json` (project root, i.e. `C:\Data\Projects\.claude\launch.json`)
- Modify: `chat-ui-boot/.claude/launch.json`

- [ ] **Step 1: Write `README.md`**

```markdown
# managed-agent-demo

Live demo: `@chatkit-svelte/transport-agui` driving a real, hosted Claude
Managed Agent via Anthropic's `@ag-ui/claude-managed-agents` adapter.

## One-time setup (you must run this yourself — it's credential-gated)

1. Install the `ant` CLI and run `ant auth login` (or set `ANTHROPIC_API_KEY`).
2. Provision an environment and agent:
   ```bash
   ant environments create --name managed-agent-demo
   ant agents create --name managed-agent-demo --environment <environment-id>
   ```
   (Exact subcommands may differ — see `ant agents create --help` and
   `ant environments create --help` for your installed CLI version. Your org
   also needs Managed Agents beta access and 30-day data retention enabled.)
3. Copy `.env.example` to `.env` and fill in `ANTHROPIC_AGENT_ID` and
   `ANTHROPIC_ENVIRONMENT_ID` from step 2 (and `ANTHROPIC_API_KEY` if you're
   not using an `ant auth login` profile).

## Run it

```bash
pnpm install
pnpm --filter managed-agent-demo dev
```

Open the printed local URL and chat with your Managed Agent.

## Known limitations

- In-memory session storage only — restarting the dev server drops in-flight
  threads. Fine for a demo; would need a persisted store for production.
- No authentication — AG-UI thread IDs are not bound to user identity here.
  Don't deploy this publicly as-is; see Anthropic's
  `shared/managed-agents-client-patterns.md` guidance on binding threads to
  user identity via a `sessionStore` before doing so.
- No frontend-executing tools are registered, so `/api/agent/tool-results` is
  a no-op — Managed Agents runs tools server-side in Anthropic's own sandbox.
```

- [ ] **Step 2: Read the current root launch config**

Run: `cat C:\Data\Projects\.claude\launch.json` (or open it) — confirm the
existing `playground` entry's exact shape before adding a sibling entry.

- [ ] **Step 3: Add a `managed-agent-demo` entry to both launch.json files**

Add this object to the `configurations` array in both
`C:\Data\Projects\.claude\launch.json` and
`C:\Data\Projects\chat-ui-boot\.claude\launch.json`, alongside the existing
`playground` entry:

```json
{
  "name": "managed-agent-demo",
  "runtimeExecutable": "npx",
  "runtimeArgs": ["pnpm@9.0.0", "-C", "C:\\Data\\Projects\\chat-ui-boot\\apps\\managed-agent-demo", "exec", "vite", "dev"],
  "port": 5181
}
```

- [ ] **Step 4: Full workspace verification**

Run: `npx pnpm@9.0.0 install`
Expected: no errors.

Run: `npx pnpm@9.0.0 run build`
Expected: all workspace packages build, including `managed-agent-demo`.

Run: `npx pnpm@9.0.0 run test`
Expected: all workspace tests pass, including the new route/module tests —
none of them make real network calls (everything's mocked), so this passes
with no credentials configured.

Run: `npx pnpm@9.0.0 run typecheck`
Expected: 0 errors across the workspace.

- [ ] **Step 5: Commit**

```bash
git add apps/managed-agent-demo/README.md
git commit -m "docs: add managed-agent-demo setup instructions"
```

(The two `.claude/launch.json` files are outside the git repo root / are local
tooling config — check whether either is tracked by git before deciding
whether to include them in this commit; if untracked, leave them as local-only
changes.)

---

### Task 12: Manual end-to-end verification (requires real credentials)

This task cannot be completed by an automated worker — it requires the
project owner to have finished the README's one-time setup with real
`ANTHROPIC_AGENT_ID` / `ANTHROPIC_ENVIRONMENT_ID` values in `.env`.

- [ ] **Step 1: Start the dev server**

Use the `managed-agent-demo` entry added to `.claude/launch.json` in Task 11
(via the Browser pane's `preview_start`), or run
`pnpm --filter managed-agent-demo dev` directly.

- [ ] **Step 2: Open the app and send a message**

Type a simple message (e.g. "What's 12 * 7?") into the composer and confirm:
- The message appears in the UI immediately.
- A streamed response arrives from the real Managed Agent (not a canned
  fixture).
- No console errors (check via `read_console_messages`).

- [ ] **Step 3: Confirm SSE reconnect works**

Reload the page mid-conversation (or throttle the network briefly) and
confirm the transport reconnects and the conversation continues without
duplicating or dropping messages — this exercises the `resumeToken` /
`subscribeFromIndex` replay path built in Task 3 and Task 5.

- [ ] **Step 4: Report results**

Note any real-world deviations from `@ag-ui/claude-managed-agents`'s assumed
API shape (Task 3's `ManagedAgentsAgent` constructor/`.run()` usage) that
surfaced only once real credentials made the agent actually run — fix them in
`src/lib/agent-sessions.ts` and re-run Task 3's test suite to confirm the fix
didn't break the mocked behavior.
