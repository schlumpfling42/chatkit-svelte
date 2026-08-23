# M0 — Core Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Git note:** commit steps are intentionally omitted from this plan — the repo owner handles git operations manually. Do not run `git add`/`git commit` while executing this plan unless the user explicitly asks for it in the moment.

**Goal:** Build `@chatkit-svelte/core` — the framework-agnostic foundation (types, reducer, JSON Patch, plugin host, transport contract, in-memory fixture transport) that every later milestone (AG-UI transport, Svelte bindings, UI, plugins) is built on top of. No Svelte, no DOM dependency, fully testable under Node.

**Architecture:** A single pure-function reducer (`reduceEvent`) folds a stream of normalized `ChatEvent`s into `ChatState`. `ChatTransport` is the seam between wire protocols and the reducer — for M0 the only implementation is an in-memory fixture transport that replays a canned `ChatEvent[]`, proving the reducer/transport contract works end-to-end before a real network transport (M1) exists. `createPluginHost` builds the plugin registry/lifecycle contract that later plugins (M3+) hook into; concrete UI component types are left as `unknown` in `core` since Svelte components don't belong in a DOM-free package.

**Tech Stack:** TypeScript 5.5 (strict), Vite (`--mode lib` + `vite-plugin-dts`) for builds, Vitest for tests, pnpm workspaces. This corresponds to spec section §22 milestone **M0 — Core skeleton: types, reducer, plugin host, in-memory transport with fixture playback. No UI.**

All code in this plan has been written and verified (`tsc --noEmit` clean, all tests passing) in a scratch sandbox before being transcribed here — follow it as written.

---

## File Structure

```
packages/core/
  package.json        # already scaffolded
  tsconfig.json        # new — Task 1
  vite.config.ts        # new — Task 1
  src/
    types.ts                        # Task 2 — ChatEvent, Message, ChatState, etc.
    json-patch.ts                   # Task 3 — RFC 6902 subset: add/remove/replace/move/copy/test
    json-patch.test.ts              # Task 3
    reducer.ts                      # Tasks 4–6 — built incrementally
    reducer.test.ts                 # Tasks 4–6 — built incrementally
    transport.ts                    # Task 7 — ChatTransport interface
    testing/
      fixture-transport.ts          # Task 7 — in-memory transport, replays a ChatEvent[]
      fixture-transport.test.ts     # Task 7
    config.ts                       # Task 8 — minimal ChatConfig (M0 subset)
    plugin-host.ts                  # Task 8 — ChatPlugin, PluginContext, createPluginHost
    plugin-host.test.ts             # Task 8
    index.ts                        # Task 9 — barrel export
docs/fixtures/
  text-streaming-basic.json         # Task 7 — already created
```

---

### Task 0: Prerequisites

**Files:** none (environment setup only)

- [ ] **Step 1: Confirm pnpm is reachable via npx**

pnpm is not globally installed on this machine, and `corepack enable` fails here with `EPERM` (it needs admin rights to write shims into the Node install directory). `npx pnpm@9.0.0` works without any global install or elevated permissions, so every `pnpm` command in this plan is invoked that way.

Run:
```bash
npx --yes pnpm@9.0.0 -v
```
Expected: prints `9.0.0`.

- [ ] **Step 2: Install workspace dependencies**

Run from the repo root (`C:/Data/Projects/chat-ui-boot`):
```bash
npx pnpm@9.0.0 install
```
Expected: lockfile created, `node_modules` populated for the root and `packages/core` (other packages are still empty stubs and may warn about missing `src/index.ts`/exports targets — that's expected until their own milestones).

---

### Task 1: `packages/core` build configuration

**Files:**
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/vite.config.ts`

- [ ] **Step 1: Write `packages/core/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 2: Write `packages/core/vite.config.ts`**

```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig({
  plugins: [dts({ rollupTypes: true })],
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: 'index',
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 3: Install `packages/core`'s own devDependencies**

Run:
```bash
npx pnpm@9.0.0 --filter @chatkit-svelte/core install
```
Expected: succeeds (package.json for `@chatkit-svelte/core` was created during initial scaffolding and already lists `typescript`, `vite`, `vite-plugin-dts`, `vitest`).

---

### Task 2: Core type definitions

**Files:**
- Create: `packages/core/src/types.ts`

Pure type declarations have no runtime behavior, so this task skips the red/green TDD cycle — correctness is verified by `tsc` in Task 9, and every field is exercised by the tests in Tasks 3–8.

- [ ] **Step 1: Write `packages/core/src/types.ts`**

```ts
export type Role = 'user' | 'assistant' | 'system' | 'tool';

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; url: string; alt?: string; mimeType: string }
  | { type: 'file'; url: string; name: string; mimeType: string; sizeBytes?: number }
  | { type: 'tool_call'; toolCallId: string; toolName: string; args: unknown; status: ToolCallStatus; result?: unknown }
  | { type: 'reasoning'; text: string; encrypted?: boolean }
  | { type: 'artifact_ref'; artifactId: string; kind: ArtifactKind }
  | { type: 'custom'; name: string; payload: unknown };

export type ToolCallStatus =
  | 'streaming_args'
  | 'pending_execution'
  | 'awaiting_approval'
  | 'executing'
  | 'complete'
  | 'error'
  | 'rejected';

export interface Message {
  id: string;
  role: Role;
  parts: ContentPart[];
  createdAt: number;
  streaming: boolean;
}

export type ArtifactKind = 'form' | 'document' | 'generic';

export interface ArtifactRecord {
  id: string;
  kind: ArtifactKind;
  version: number;
  createdByMessageId: string;
  data: unknown;
  status: 'draft' | 'streaming' | 'final' | 'submitted' | 'error';
}

export type RunStatus = 'idle' | 'running' | 'awaiting_tool' | 'awaiting_approval' | 'error';

export interface ChatState {
  messages: Message[];
  runStatus: RunStatus;
  sharedState: unknown;
  activities: ActivityItem[];
  steps: StepInfo[];
  artifacts: Record<string, ArtifactRecord>;
  error: ChatError | null;
}

export interface ActivityItem {
  id: string;
  messageId: string;
  kind: string;
  data: unknown;
}

export interface StepInfo {
  id: string;
  name: string;
  status: 'started' | 'finished';
  parentStepId?: string;
}

export interface ChatError {
  code: string;
  message: string;
  recoverable: boolean;
  raw?: unknown;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JSONSchema;
  executesOn: 'frontend' | 'backend';
}

export interface ToolResult {
  toolCallId: string;
  result: unknown;
  isError?: boolean;
}

// The normalized event union the reducer consumes — transports map wire events into this.
export type ChatEvent =
  | { type: 'RUN_STARTED'; runId: string; threadId: string }
  | { type: 'RUN_FINISHED'; runId: string; result?: unknown }
  | { type: 'RUN_ERROR'; runId: string; error: ChatError }
  | { type: 'STEP_STARTED'; stepId: string; name: string; parentStepId?: string }
  | { type: 'STEP_FINISHED'; stepId: string }
  | { type: 'TEXT_MESSAGE_START'; messageId: string; role: Role }
  | { type: 'TEXT_MESSAGE_CONTENT'; messageId: string; delta: string }
  | { type: 'TEXT_MESSAGE_END'; messageId: string }
  | { type: 'TOOL_CALL_START'; toolCallId: string; toolName: string; parentMessageId: string }
  | { type: 'TOOL_CALL_ARGS'; toolCallId: string; delta: string }
  | { type: 'TOOL_CALL_END'; toolCallId: string }
  | { type: 'TOOL_CALL_RESULT'; toolCallId: string; result: unknown; isError?: boolean }
  | { type: 'REASONING_START'; messageId: string }
  | { type: 'REASONING_CONTENT'; messageId: string; delta: string; encrypted?: boolean }
  | { type: 'REASONING_END'; messageId: string }
  | { type: 'STATE_SNAPSHOT'; snapshot: unknown }
  | { type: 'STATE_DELTA'; patch: JsonPatchOperation[] }
  | { type: 'MESSAGES_SNAPSHOT'; messages: Message[] }
  | { type: 'ACTIVITY_SNAPSHOT'; messageId: string; data: unknown }
  | { type: 'ACTIVITY_DELTA'; messageId: string; patch: JsonPatchOperation[] }
  | { type: 'CUSTOM'; name: string; payload: unknown }
  | { type: 'RAW'; payload: unknown };

export interface JsonPatchOperation {
  op: 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test';
  path: string;
  value?: unknown;
  from?: string;
}

export type JSONSchema = Record<string, unknown>;
```

- [ ] **Step 2: Confirm it compiles in isolation**

Run:
```bash
npx pnpm@9.0.0 --filter @chatkit-svelte/core exec tsc --noEmit
```
Expected: no errors (there's nothing importing `types.ts` yet, but a syntax/type error in the file itself would still surface).

---

### Task 3: JSON Patch (`json-patch.ts`)

RFC 6902 subset — `add`, `remove`, `replace`, `move`, `copy`, `test` — operating on plain JSON-compatible values, immutable (never mutates the input document), used by the reducer to apply `STATE_DELTA`/`ACTIVITY_DELTA` patches.

**Files:**
- Create: `packages/core/src/json-patch.test.ts`
- Create: `packages/core/src/json-patch.ts`

- [ ] **Step 1: Write the failing tests — `packages/core/src/json-patch.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { applyPatch } from './json-patch';

describe('applyPatch', () => {
  it('adds a new key without mutating the original document', () => {
    const doc = { a: 1 };
    const { result, ok } = applyPatch(doc, [{ op: 'add', path: '/b', value: 2 }]);
    expect(ok).toBe(true);
    expect(result).toEqual({ a: 1, b: 2 });
    expect(doc).toEqual({ a: 1 });
  });

  it('replaces an existing key', () => {
    const doc = { a: 1 };
    const { result, ok } = applyPatch(doc, [{ op: 'replace', path: '/a', value: 99 }]);
    expect(ok).toBe(true);
    expect(result).toEqual({ a: 99 });
  });

  it('removes a key', () => {
    const doc = { a: 1, b: 2 };
    const { result, ok } = applyPatch(doc, [{ op: 'remove', path: '/b' }]);
    expect(ok).toBe(true);
    expect(result).toEqual({ a: 1 });
  });

  it('appends to an array with the "-" token', () => {
    const doc = { items: [1, 2] };
    const { result, ok } = applyPatch(doc, [{ op: 'add', path: '/items/-', value: 3 }]);
    expect(ok).toBe(true);
    expect(result).toEqual({ items: [1, 2, 3] });
  });

  it('unescapes ~1 and ~0 in path tokens', () => {
    const doc = { 'a/b': { 'c~d': 1 } };
    const { result, ok } = applyPatch(doc, [{ op: 'replace', path: '/a~1b/c~0d', value: 5 }]);
    expect(ok).toBe(true);
    expect(result).toEqual({ 'a/b': { 'c~d': 5 } });
  });

  it('returns ok:false and the original document when a test operation fails', () => {
    const doc = { a: 1 };
    const { result, ok } = applyPatch(doc, [{ op: 'test', path: '/a', value: 2 }]);
    expect(ok).toBe(false);
    expect(result).toBe(doc);
  });

  it('returns ok:false when replacing a missing key', () => {
    const doc = { a: 1 };
    const { result, ok } = applyPatch(doc, [{ op: 'replace', path: '/missing', value: 1 }]);
    expect(ok).toBe(false);
    expect(result).toBe(doc);
  });

  it('moves a value between paths', () => {
    const doc = { from: 'x', to: null };
    const { result, ok } = applyPatch(doc, [{ op: 'move', from: '/from', path: '/to' }]);
    expect(ok).toBe(true);
    expect(result).toEqual({ to: 'x' });
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run:
```bash
npx pnpm@9.0.0 --filter @chatkit-svelte/core exec vitest run src/json-patch.test.ts
```
Expected: FAIL — `Cannot find module './json-patch'` (file doesn't exist yet).

- [ ] **Step 3: Write `packages/core/src/json-patch.ts`**

```ts
import type { JsonPatchOperation } from './types';

export interface ApplyPatchResult {
  result: unknown;
  ok: boolean;
}

function parsePointer(path: string): string[] {
  if (path === '') return [];
  if (path[0] !== '/') {
    throw new Error(`Invalid JSON Pointer: "${path}"`);
  }
  return path
    .split('/')
    .slice(1)
    .map((token) => token.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function navigate(doc: unknown, tokens: string[]): unknown {
  let current = doc;
  for (const token of tokens) {
    if (Array.isArray(current)) {
      const index = token === '-' ? current.length : Number(token);
      if (Number.isNaN(index) || index < 0 || index >= current.length) {
        throw new Error(`Invalid array index "${token}"`);
      }
      current = current[index];
    } else if (current !== null && typeof current === 'object') {
      if (!(token in (current as Record<string, unknown>))) {
        throw new Error(`Path segment "${token}" not found`);
      }
      current = (current as Record<string, unknown>)[token];
    } else {
      throw new Error(`Cannot navigate into non-object at "${token}"`);
    }
  }
  return current;
}

function setAtPath(doc: unknown, tokens: string[], value: unknown, mode: 'add' | 'replace'): unknown {
  if (tokens.length === 0) {
    return value;
  }
  const parentTokens = tokens.slice(0, -1);
  const key = tokens[tokens.length - 1];
  const parent = navigate(doc, parentTokens);

  if (Array.isArray(parent)) {
    const index = key === '-' ? parent.length : Number(key);
    if (Number.isNaN(index) || index < 0 || index > parent.length) {
      throw new Error(`Invalid array index "${key}"`);
    }
    if (mode === 'add') {
      parent.splice(index, 0, value);
    } else {
      if (index >= parent.length) throw new Error(`Cannot replace missing index "${key}"`);
      parent[index] = value;
    }
  } else if (parent !== null && typeof parent === 'object') {
    const record = parent as Record<string, unknown>;
    if (mode === 'replace' && !(key in record)) {
      throw new Error(`Cannot replace missing key "${key}"`);
    }
    record[key] = value;
  } else {
    throw new Error(`Cannot set property on non-object at "${key}"`);
  }
  return doc;
}

function removeAtPath(doc: unknown, tokens: string[]): unknown {
  if (tokens.length === 0) {
    throw new Error('Cannot remove the root document');
  }
  const parentTokens = tokens.slice(0, -1);
  const key = tokens[tokens.length - 1];
  const parent = navigate(doc, parentTokens);

  if (Array.isArray(parent)) {
    const index = Number(key);
    if (Number.isNaN(index) || index < 0 || index >= parent.length) {
      throw new Error(`Invalid array index "${key}"`);
    }
    parent.splice(index, 1);
  } else if (parent !== null && typeof parent === 'object') {
    const record = parent as Record<string, unknown>;
    if (!(key in record)) throw new Error(`Cannot remove missing key "${key}"`);
    delete record[key];
  } else {
    throw new Error(`Cannot remove property on non-object at "${key}"`);
  }
  return doc;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function deepClone<T>(value: T): T {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : (JSON.parse(JSON.stringify(value)) as T);
}

function applyOperation(doc: unknown, op: JsonPatchOperation): unknown {
  const tokens = parsePointer(op.path);
  switch (op.op) {
    case 'add':
      return setAtPath(doc, tokens, deepClone(op.value), 'add');
    case 'replace':
      return setAtPath(doc, tokens, deepClone(op.value), 'replace');
    case 'remove':
      return removeAtPath(doc, tokens);
    case 'test': {
      const current = navigate(doc, tokens);
      if (!deepEqual(current, op.value)) {
        throw new Error(`Test operation failed at "${op.path}"`);
      }
      return doc;
    }
    case 'move': {
      if (op.from === undefined) throw new Error('"move" requires "from"');
      const fromTokens = parsePointer(op.from);
      const value = deepClone(navigate(doc, fromTokens));
      removeAtPath(doc, fromTokens);
      return setAtPath(doc, tokens, value, 'add');
    }
    case 'copy': {
      if (op.from === undefined) throw new Error('"copy" requires "from"');
      const fromTokens = parsePointer(op.from);
      const value = deepClone(navigate(doc, fromTokens));
      return setAtPath(doc, tokens, value, 'add');
    }
    default:
      throw new Error(`Unknown operation "${(op as JsonPatchOperation).op}"`);
  }
}

export function applyPatch(document: unknown, patch: JsonPatchOperation[]): ApplyPatchResult {
  let working = deepClone(document);
  try {
    for (const op of patch) {
      working = applyOperation(working, op);
    }
    return { result: working, ok: true };
  } catch {
    return { result: document, ok: false };
  }
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run:
```bash
npx pnpm@9.0.0 --filter @chatkit-svelte/core exec vitest run src/json-patch.test.ts
```
Expected: PASS — 8 tests.

---

### Task 4: Reducer — run/step lifecycle and text streaming

**Files:**
- Create: `packages/core/src/reducer.test.ts`
- Create: `packages/core/src/reducer.ts`

- [ ] **Step 1: Write the failing tests — `packages/core/src/reducer.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { initialState, reduceEvent } from './reducer';
import type { ChatEvent } from './types';

function run(events: ChatEvent[]) {
  return events.reduce(reduceEvent, initialState());
}

describe('reduceEvent — lifecycle', () => {
  it('tracks run status through started/finished', () => {
    const state = run([
      { type: 'RUN_STARTED', runId: 'r1', threadId: 't1' },
      { type: 'RUN_FINISHED', runId: 'r1' },
    ]);
    expect(state.runStatus).toBe('idle');
  });

  it('records a run error and status', () => {
    const state = run([
      { type: 'RUN_STARTED', runId: 'r1', threadId: 't1' },
      { type: 'RUN_ERROR', runId: 'r1', error: { code: 'BOOM', message: 'boom', recoverable: false } },
    ]);
    expect(state.runStatus).toBe('error');
    expect(state.error?.code).toBe('BOOM');
  });

  it('tracks step lifecycle', () => {
    const state = run([
      { type: 'STEP_STARTED', stepId: 's1', name: 'plan' },
      { type: 'STEP_FINISHED', stepId: 's1' },
    ]);
    expect(state.steps).toEqual([{ id: 's1', name: 'plan', status: 'finished', parentStepId: undefined }]);
  });
});

describe('reduceEvent — text messages', () => {
  it('streams text content into a single message', () => {
    const state = run([
      { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'Hello' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: ', world!' },
      { type: 'TEXT_MESSAGE_END', messageId: 'm1' },
    ]);
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].parts).toEqual([{ type: 'text', text: 'Hello, world!' }]);
    expect(state.messages[0].streaming).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run:
```bash
npx pnpm@9.0.0 --filter @chatkit-svelte/core exec vitest run src/reducer.test.ts
```
Expected: FAIL — `Cannot find module './reducer'`.

- [ ] **Step 3: Write `packages/core/src/reducer.ts` (lifecycle + text only)**

```ts
import type { ChatEvent, ChatState, ContentPart, Message } from './types';

export const initialState = (initial?: unknown): ChatState => ({
  messages: [],
  runStatus: 'idle',
  sharedState: initial ?? null,
  activities: [],
  steps: [],
  artifacts: {},
  error: null,
});

function mapMessage(messages: Message[], messageId: string, fn: (m: Message) => Message): Message[] {
  return messages.map((m) => (m.id === messageId ? fn(m) : m));
}

function appendText(message: Message, delta: string): Message {
  const parts = [...message.parts];
  const lastTextIndex = [...parts].reverse().findIndex((p) => p.type === 'text');
  if (lastTextIndex === -1) {
    parts.push({ type: 'text', text: delta });
  } else {
    const index = parts.length - 1 - lastTextIndex;
    const existing = parts[index] as ContentPart & { type: 'text' };
    parts[index] = { ...existing, text: existing.text + delta };
  }
  return { ...message, parts };
}

export function reduceEvent(state: ChatState, event: ChatEvent): ChatState {
  switch (event.type) {
    case 'RUN_STARTED':
      return { ...state, runStatus: 'running', error: null };
    case 'RUN_FINISHED':
      return { ...state, runStatus: 'idle' };
    case 'RUN_ERROR':
      return { ...state, runStatus: 'error', error: event.error };
    case 'STEP_STARTED':
      return {
        ...state,
        steps: [...state.steps, { id: event.stepId, name: event.name, status: 'started', parentStepId: event.parentStepId }],
      };
    case 'STEP_FINISHED':
      return { ...state, steps: state.steps.map((s) => (s.id === event.stepId ? { ...s, status: 'finished' } : s)) };
    case 'TEXT_MESSAGE_START':
      return {
        ...state,
        messages: [
          ...state.messages,
          { id: event.messageId, role: event.role, parts: [{ type: 'text', text: '' }], createdAt: Date.now(), streaming: true },
        ],
      };
    case 'TEXT_MESSAGE_CONTENT':
      return { ...state, messages: mapMessage(state.messages, event.messageId, (m) => appendText(m, event.delta)) };
    case 'TEXT_MESSAGE_END':
      return { ...state, messages: mapMessage(state.messages, event.messageId, (m) => ({ ...m, streaming: false })) };
    default:
      return state;
  }
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run:
```bash
npx pnpm@9.0.0 --filter @chatkit-svelte/core exec vitest run src/reducer.test.ts
```
Expected: PASS — 4 tests.

---

### Task 5: Reducer — tool calls

Tool-call args arrive as raw JSON text fragments while `status: 'streaming_args'`. They're accumulated as a string and `JSON.parse`d on `TOOL_CALL_END`. `TOOL_CALL_START` seeds `args: {}` (an object, not a string) — the first delta must start a fresh string accumulator rather than concatenating onto `"[object Object]"`.

**Files:**
- Modify: `packages/core/src/reducer.test.ts`
- Modify: `packages/core/src/reducer.ts`

- [ ] **Step 1: Add the failing tests — append to `packages/core/src/reducer.test.ts`**

Add these two `describe` blocks after the existing `reduceEvent — text messages` block:

```ts
describe('reduceEvent — tool calls', () => {
  it('accumulates streamed arg fragments and parses them on end', () => {
    const state = run([
      { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' },
      { type: 'TOOL_CALL_START', toolCallId: 'tc1', toolName: 'search', parentMessageId: 'm1' },
      { type: 'TOOL_CALL_ARGS', toolCallId: 'tc1', delta: '{"query":' },
      { type: 'TOOL_CALL_ARGS', toolCallId: 'tc1', delta: '"svelte"}' },
      { type: 'TOOL_CALL_END', toolCallId: 'tc1' },
      { type: 'TOOL_CALL_RESULT', toolCallId: 'tc1', result: { hits: 3 } },
    ]);
    const toolCall = state.messages[0].parts.find((p) => p.type === 'tool_call');
    expect(toolCall).toMatchObject({
      toolCallId: 'tc1',
      args: { query: 'svelte' },
      status: 'complete',
      result: { hits: 3 },
    });
  });

  it('leaves unparseable args as the raw string', () => {
    const state = run([
      { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' },
      { type: 'TOOL_CALL_START', toolCallId: 'tc1', toolName: 'search', parentMessageId: 'm1' },
      { type: 'TOOL_CALL_ARGS', toolCallId: 'tc1', delta: 'not json' },
      { type: 'TOOL_CALL_END', toolCallId: 'tc1' },
    ]);
    const toolCall = state.messages[0].parts.find((p) => p.type === 'tool_call');
    expect(toolCall).toMatchObject({ args: 'not json', status: 'pending_execution' });
  });
});
```

- [ ] **Step 2: Run the tests and confirm the new ones fail**

Run:
```bash
npx pnpm@9.0.0 --filter @chatkit-svelte/core exec vitest run src/reducer.test.ts
```
Expected: FAIL — `TOOL_CALL_START` etc. fall into the `default` case, so `state.messages[0].parts` never gets a `tool_call` part and `.find(...)` returns `undefined`.

- [ ] **Step 3: Extend `packages/core/src/reducer.ts` with tool-call handling**

Full file content after this step:

```ts
import type { ChatEvent, ChatState, ContentPart, Message } from './types';

export const initialState = (initial?: unknown): ChatState => ({
  messages: [],
  runStatus: 'idle',
  sharedState: initial ?? null,
  activities: [],
  steps: [],
  artifacts: {},
  error: null,
});

function mapMessage(messages: Message[], messageId: string, fn: (m: Message) => Message): Message[] {
  return messages.map((m) => (m.id === messageId ? fn(m) : m));
}

function appendText(message: Message, delta: string): Message {
  const parts = [...message.parts];
  const lastTextIndex = [...parts].reverse().findIndex((p) => p.type === 'text');
  if (lastTextIndex === -1) {
    parts.push({ type: 'text', text: delta });
  } else {
    const index = parts.length - 1 - lastTextIndex;
    const existing = parts[index] as ContentPart & { type: 'text' };
    parts[index] = { ...existing, text: existing.text + delta };
  }
  return { ...message, parts };
}

function findToolCallMessage(messages: Message[], toolCallId: string): Message | undefined {
  return messages.find((m) => m.parts.some((p) => p.type === 'tool_call' && p.toolCallId === toolCallId));
}

function mapToolCall(
  messages: Message[],
  toolCallId: string,
  fn: (tc: ContentPart & { type: 'tool_call' }) => ContentPart & { type: 'tool_call' }
): Message[] {
  const owner = findToolCallMessage(messages, toolCallId);
  if (!owner) return messages;
  return mapMessage(messages, owner.id, (m) => ({
    ...m,
    parts: m.parts.map((p) => (p.type === 'tool_call' && p.toolCallId === toolCallId ? fn(p) : p)),
  }));
}

// TOOL_CALL_START seeds args as {} (a placeholder object, not a string). The
// first TOOL_CALL_ARGS delta must start a fresh string accumulation rather
// than concatenating onto "[object Object]", so any non-string current value
// is treated as an empty accumulator.
function appendJsonFragment(current: unknown, delta: string): unknown {
  const currentStr = typeof current === 'string' ? current : '';
  return currentStr + delta;
}

function parseToolCallArgs(args: unknown): unknown {
  if (typeof args !== 'string') return args;
  try {
    return JSON.parse(args);
  } catch {
    return args;
  }
}

export function reduceEvent(state: ChatState, event: ChatEvent): ChatState {
  switch (event.type) {
    case 'RUN_STARTED':
      return { ...state, runStatus: 'running', error: null };
    case 'RUN_FINISHED':
      return { ...state, runStatus: 'idle' };
    case 'RUN_ERROR':
      return { ...state, runStatus: 'error', error: event.error };
    case 'STEP_STARTED':
      return {
        ...state,
        steps: [...state.steps, { id: event.stepId, name: event.name, status: 'started', parentStepId: event.parentStepId }],
      };
    case 'STEP_FINISHED':
      return { ...state, steps: state.steps.map((s) => (s.id === event.stepId ? { ...s, status: 'finished' } : s)) };
    case 'TEXT_MESSAGE_START':
      return {
        ...state,
        messages: [
          ...state.messages,
          { id: event.messageId, role: event.role, parts: [{ type: 'text', text: '' }], createdAt: Date.now(), streaming: true },
        ],
      };
    case 'TEXT_MESSAGE_CONTENT':
      return { ...state, messages: mapMessage(state.messages, event.messageId, (m) => appendText(m, event.delta)) };
    case 'TEXT_MESSAGE_END':
      return { ...state, messages: mapMessage(state.messages, event.messageId, (m) => ({ ...m, streaming: false })) };
    case 'TOOL_CALL_START':
      return {
        ...state,
        messages: mapMessage(state.messages, event.parentMessageId, (m) => ({
          ...m,
          parts: [
            ...m.parts,
            { type: 'tool_call', toolCallId: event.toolCallId, toolName: event.toolName, args: {}, status: 'streaming_args' },
          ],
        })),
      };
    case 'TOOL_CALL_ARGS':
      return {
        ...state,
        messages: mapToolCall(state.messages, event.toolCallId, (tc) => ({ ...tc, args: appendJsonFragment(tc.args, event.delta) })),
      };
    case 'TOOL_CALL_END':
      return {
        ...state,
        messages: mapToolCall(state.messages, event.toolCallId, (tc) => ({
          ...tc,
          args: parseToolCallArgs(tc.args),
          status: 'pending_execution',
        })),
      };
    case 'TOOL_CALL_RESULT':
      return {
        ...state,
        messages: mapToolCall(state.messages, event.toolCallId, (tc) => ({
          ...tc,
          status: event.isError ? 'error' : 'complete',
          result: event.result,
        })),
      };
    default:
      return state;
  }
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run:
```bash
npx pnpm@9.0.0 --filter @chatkit-svelte/core exec vitest run src/reducer.test.ts
```
Expected: PASS — 6 tests.

---

### Task 6: Reducer — reasoning, shared state sync, activities, escape hatches

Fills in the remaining `ChatEvent` cases: `REASONING_*` (parallels `TEXT_MESSAGE_*`), `STATE_SNAPSHOT`/`STATE_DELTA` (via `applyPatch` — a failed delta keeps last-known-good state and surfaces a recoverable `STATE_PATCH_CONFLICT` error, per spec §3.3), `MESSAGES_SNAPSHOT`, `ACTIVITY_SNAPSHOT`/`ACTIVITY_DELTA`, and `CUSTOM`/`RAW` (no-ops in `core` — artifact plugins hook these in M5).

**Files:**
- Modify: `packages/core/src/reducer.test.ts`
- Modify: `packages/core/src/reducer.ts`

- [ ] **Step 1: Add the failing tests — append to `packages/core/src/reducer.test.ts`**

Add these `describe` blocks after `reduceEvent — tool calls`:

```ts
describe('reduceEvent — reasoning', () => {
  it('streams reasoning text into its own message', () => {
    const state = run([
      { type: 'REASONING_START', messageId: 'r1' },
      { type: 'REASONING_CONTENT', messageId: 'r1', delta: 'thinking...' },
      { type: 'REASONING_END', messageId: 'r1' },
    ]);
    expect(state.messages[0].parts).toEqual([{ type: 'reasoning', text: 'thinking...', encrypted: undefined }]);
    expect(state.messages[0].streaming).toBe(false);
  });
});

describe('reduceEvent — shared state sync', () => {
  it('applies STATE_SNAPSHOT as a full replace', () => {
    const state = run([{ type: 'STATE_SNAPSHOT', snapshot: { count: 1 } }]);
    expect(state.sharedState).toEqual({ count: 1 });
  });

  it('applies a STATE_DELTA on top of the snapshot', () => {
    const state = run([
      { type: 'STATE_SNAPSHOT', snapshot: { count: 1 } },
      { type: 'STATE_DELTA', patch: [{ op: 'replace', path: '/count', value: 2 }] },
    ]);
    expect(state.sharedState).toEqual({ count: 2 });
  });

  it('surfaces a recoverable error and keeps last-known-good state when a delta fails to apply', () => {
    const state = run([
      { type: 'STATE_SNAPSHOT', snapshot: { count: 1 } },
      { type: 'STATE_DELTA', patch: [{ op: 'replace', path: '/missing', value: 2 }] },
    ]);
    expect(state.sharedState).toEqual({ count: 1 });
    expect(state.error).toEqual({ code: 'STATE_PATCH_CONFLICT', message: 'Failed to apply state patch', recoverable: true });
  });

  it('replaces the full message list on MESSAGES_SNAPSHOT', () => {
    const snapshotMessages = [{ id: 'm9', role: 'user' as const, parts: [], createdAt: 0, streaming: false }];
    const state = run([
      { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' },
      { type: 'MESSAGES_SNAPSHOT', messages: snapshotMessages },
    ]);
    expect(state.messages).toEqual(snapshotMessages);
  });
});

describe('reduceEvent — activities', () => {
  it('creates an activity on snapshot and updates it on delta', () => {
    const state = run([
      { type: 'ACTIVITY_SNAPSHOT', messageId: 'm1', data: { progress: 0 } },
      { type: 'ACTIVITY_DELTA', messageId: 'm1', patch: [{ op: 'replace', path: '/progress', value: 50 }] },
    ]);
    expect(state.activities).toEqual([{ id: 'm1', messageId: 'm1', kind: 'generic', data: { progress: 50 } }]);
  });
});

describe('reduceEvent — escape hatches', () => {
  it('treats CUSTOM and RAW events as no-ops in core', () => {
    const before = initialState();
    const afterCustom = reduceEvent(before, { type: 'CUSTOM', name: 'chatkit.form.snapshot', payload: {} });
    const afterRaw = reduceEvent(before, { type: 'RAW', payload: {} });
    expect(afterCustom).toBe(before);
    expect(afterRaw).toBe(before);
  });
});
```

- [ ] **Step 2: Run the tests and confirm the new ones fail**

Run:
```bash
npx pnpm@9.0.0 --filter @chatkit-svelte/core exec vitest run src/reducer.test.ts
```
Expected: FAIL — `REASONING_*`, `STATE_SNAPSHOT`/`STATE_DELTA`, `ACTIVITY_*` all currently fall into `default: return state`, so shared state/activities/reasoning messages never populate.

- [ ] **Step 3: Extend `packages/core/src/reducer.ts` to its final Task-6 form**

Full file content after this step:

```ts
import { applyPatch } from './json-patch';
import type { ActivityItem, ChatEvent, ChatState, ContentPart, Message } from './types';

export const initialState = (initial?: unknown): ChatState => ({
  messages: [],
  runStatus: 'idle',
  sharedState: initial ?? null,
  activities: [],
  steps: [],
  artifacts: {},
  error: null,
});

function mapMessage(messages: Message[], messageId: string, fn: (m: Message) => Message): Message[] {
  return messages.map((m) => (m.id === messageId ? fn(m) : m));
}

function appendText(message: Message, delta: string): Message {
  const parts = [...message.parts];
  const lastTextIndex = [...parts].reverse().findIndex((p) => p.type === 'text');
  if (lastTextIndex === -1) {
    parts.push({ type: 'text', text: delta });
  } else {
    const index = parts.length - 1 - lastTextIndex;
    const existing = parts[index] as ContentPart & { type: 'text' };
    parts[index] = { ...existing, text: existing.text + delta };
  }
  return { ...message, parts };
}

function findToolCallMessage(messages: Message[], toolCallId: string): Message | undefined {
  return messages.find((m) => m.parts.some((p) => p.type === 'tool_call' && p.toolCallId === toolCallId));
}

function mapToolCall(
  messages: Message[],
  toolCallId: string,
  fn: (tc: ContentPart & { type: 'tool_call' }) => ContentPart & { type: 'tool_call' }
): Message[] {
  const owner = findToolCallMessage(messages, toolCallId);
  if (!owner) return messages;
  return mapMessage(messages, owner.id, (m) => ({
    ...m,
    parts: m.parts.map((p) => (p.type === 'tool_call' && p.toolCallId === toolCallId ? fn(p) : p)),
  }));
}

// TOOL_CALL_START seeds args as {} (a placeholder object, not a string). The
// first TOOL_CALL_ARGS delta must start a fresh string accumulation rather
// than concatenating onto "[object Object]", so any non-string current value
// is treated as an empty accumulator.
function appendJsonFragment(current: unknown, delta: string): unknown {
  const currentStr = typeof current === 'string' ? current : '';
  return currentStr + delta;
}

function parseToolCallArgs(args: unknown): unknown {
  if (typeof args !== 'string') return args;
  try {
    return JSON.parse(args);
  } catch {
    return args;
  }
}

function upsertActivity(activities: ActivityItem[], messageId: string, data: unknown): ActivityItem[] {
  const index = activities.findIndex((a) => a.messageId === messageId);
  if (index === -1) {
    // ACTIVITY_SNAPSHOT/DELTA carry no `kind` on the wire; default to
    // 'generic' for a newly created activity and preserve it on updates.
    return [...activities, { id: messageId, messageId, kind: 'generic', data }];
  }
  const next = [...activities];
  next[index] = { ...next[index], data };
  return next;
}

export function reduceEvent(state: ChatState, event: ChatEvent): ChatState {
  switch (event.type) {
    case 'RUN_STARTED':
      return { ...state, runStatus: 'running', error: null };
    case 'RUN_FINISHED':
      return { ...state, runStatus: 'idle' };
    case 'RUN_ERROR':
      return { ...state, runStatus: 'error', error: event.error };
    case 'STEP_STARTED':
      return {
        ...state,
        steps: [...state.steps, { id: event.stepId, name: event.name, status: 'started', parentStepId: event.parentStepId }],
      };
    case 'STEP_FINISHED':
      return { ...state, steps: state.steps.map((s) => (s.id === event.stepId ? { ...s, status: 'finished' } : s)) };
    case 'TEXT_MESSAGE_START':
      return {
        ...state,
        messages: [
          ...state.messages,
          { id: event.messageId, role: event.role, parts: [{ type: 'text', text: '' }], createdAt: Date.now(), streaming: true },
        ],
      };
    case 'TEXT_MESSAGE_CONTENT':
      return { ...state, messages: mapMessage(state.messages, event.messageId, (m) => appendText(m, event.delta)) };
    case 'TEXT_MESSAGE_END':
      return { ...state, messages: mapMessage(state.messages, event.messageId, (m) => ({ ...m, streaming: false })) };
    case 'TOOL_CALL_START':
      return {
        ...state,
        messages: mapMessage(state.messages, event.parentMessageId, (m) => ({
          ...m,
          parts: [
            ...m.parts,
            { type: 'tool_call', toolCallId: event.toolCallId, toolName: event.toolName, args: {}, status: 'streaming_args' },
          ],
        })),
      };
    case 'TOOL_CALL_ARGS':
      return {
        ...state,
        messages: mapToolCall(state.messages, event.toolCallId, (tc) => ({ ...tc, args: appendJsonFragment(tc.args, event.delta) })),
      };
    case 'TOOL_CALL_END':
      return {
        ...state,
        messages: mapToolCall(state.messages, event.toolCallId, (tc) => ({
          ...tc,
          args: parseToolCallArgs(tc.args),
          status: 'pending_execution',
        })),
      };
    case 'TOOL_CALL_RESULT':
      return {
        ...state,
        messages: mapToolCall(state.messages, event.toolCallId, (tc) => ({
          ...tc,
          status: event.isError ? 'error' : 'complete',
          result: event.result,
        })),
      };
    case 'REASONING_START':
      return {
        ...state,
        messages: [
          ...state.messages,
          { id: event.messageId, role: 'assistant', parts: [{ type: 'reasoning', text: '' }], createdAt: Date.now(), streaming: true },
        ],
      };
    case 'REASONING_CONTENT':
      return {
        ...state,
        messages: mapMessage(state.messages, event.messageId, (m) => ({
          ...m,
          parts: m.parts.map((p) => (p.type === 'reasoning' ? { ...p, text: p.text + event.delta, encrypted: event.encrypted } : p)),
        })),
      };
    case 'REASONING_END':
      return { ...state, messages: mapMessage(state.messages, event.messageId, (m) => ({ ...m, streaming: false })) };
    case 'STATE_SNAPSHOT':
      return { ...state, sharedState: event.snapshot };
    case 'STATE_DELTA': {
      const { result, ok } = applyPatch(state.sharedState, event.patch);
      // Conflict → caller (transport layer, M1) is responsible for requesting
      // a fresh STATE_SNAPSHOT; the reducer just surfaces a recoverable error
      // and keeps last-known-good state.
      return ok
        ? { ...state, sharedState: result }
        : { ...state, error: { code: 'STATE_PATCH_CONFLICT', message: 'Failed to apply state patch', recoverable: true } };
    }
    case 'MESSAGES_SNAPSHOT':
      return { ...state, messages: event.messages };
    case 'ACTIVITY_SNAPSHOT':
      return { ...state, activities: upsertActivity(state.activities, event.messageId, event.data) };
    case 'ACTIVITY_DELTA': {
      const existing = state.activities.find((a) => a.messageId === event.messageId);
      const { result, ok } = applyPatch(existing?.data ?? {}, event.patch);
      return ok ? { ...state, activities: upsertActivity(state.activities, event.messageId, result) } : state;
    }
    case 'CUSTOM':
      // Forms/documents/generic artifacts are routed through registered
      // ArtifactReducers by the plugin host (see plugin-host.ts / M5); core
      // has no built-in knowledge of artifact shapes.
      return state;
    case 'RAW':
      return state;
    default:
      return state;
  }
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run:
```bash
npx pnpm@9.0.0 --filter @chatkit-svelte/core exec vitest run src/reducer.test.ts
```
Expected: PASS — 13 tests.

---

### Task 7: Transport contract and in-memory fixture transport

**Files:**
- Create: `packages/core/src/transport.ts`
- Create: `packages/core/src/testing/fixture-transport.test.ts`
- Create: `packages/core/src/testing/fixture-transport.ts`
- Already created: `docs/fixtures/text-streaming-basic.json`

- [ ] **Step 1: Write `packages/core/src/transport.ts`**

No TDD cycle — this is the interface contract only (mirrors spec §3.2 exactly); its correctness is exercised by the fixture transport tests below and by `tsc`.

```ts
import type { ChatEvent, Message, ToolDefinition, ToolResult } from './types';

export interface RunAgentInput {
  threadId: string;
  runId: string;
  messages: Message[];
  tools: ToolDefinition[];
  state?: unknown;
  context?: Record<string, unknown>;
  forwardedProps?: Record<string, unknown>;
}

export interface AgentCapabilities {
  transports: ('sse' | 'websocket' | 'http-polling')[];
  tools: string[];
  multimodal: boolean;
  reasoning: boolean;
  humanInTheLoop: boolean;
  sharedStateWritable: boolean;
}

export interface ChatTransport {
  /** Open (or resume) the event stream for a thread. Returns an async iterable of normalized events. */
  connect(session: { threadId: string; resumeToken?: string }): AsyncIterable<ChatEvent>;
  /** Start a new run. May be a fire-and-forget POST (events arrive via connect()) or return its own stream. */
  sendRun(input: RunAgentInput): Promise<void>;
  /** Deliver a frontend-executed tool's result back to the agent. */
  sendFrontendToolResult(result: ToolResult): Promise<void>;
  /** Cooperatively cancel an in-flight run. */
  abortRun(runId: string): Promise<void>;
  /** Optional capability negotiation, called once at connect time if the server supports it. */
  getCapabilities?(): Promise<AgentCapabilities>;
  /** Clean up sockets/listeners. */
  dispose(): void;
}
```

- [ ] **Step 2: Write the failing tests — `packages/core/src/testing/fixture-transport.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { createFixtureTransport } from './fixture-transport';
import { initialState, reduceEvent } from '../reducer';
import type { ChatEvent } from '../types';

const events: ChatEvent[] = [
  { type: 'RUN_STARTED', runId: 'run-1', threadId: 'thread-1' },
  { type: 'TEXT_MESSAGE_START', messageId: 'msg-1', role: 'assistant' },
  { type: 'TEXT_MESSAGE_CONTENT', messageId: 'msg-1', delta: 'Hello' },
  { type: 'TEXT_MESSAGE_CONTENT', messageId: 'msg-1', delta: ', world!' },
  { type: 'TEXT_MESSAGE_END', messageId: 'msg-1' },
  { type: 'RUN_FINISHED', runId: 'run-1' },
];

describe('createFixtureTransport', () => {
  it('replays the given events in order through connect()', async () => {
    const transport = createFixtureTransport(events);
    const received: ChatEvent[] = [];
    for await (const event of transport.connect({ threadId: 'thread-1' })) {
      received.push(event);
    }
    expect(received).toEqual(events);
  });

  it('drives the reducer to the expected final state', async () => {
    const transport = createFixtureTransport(events);
    let state = initialState();
    for await (const event of transport.connect({ threadId: 'thread-1' })) {
      state = reduceEvent(state, event);
    }
    expect(state.runStatus).toBe('idle');
    expect(state.messages[0].parts).toEqual([{ type: 'text', text: 'Hello, world!' }]);
  });

  it('records sendRun, sendFrontendToolResult, and abortRun calls', async () => {
    const transport = createFixtureTransport([]);
    await transport.sendRun({ threadId: 't1', runId: 'r1', messages: [], tools: [] });
    await transport.sendFrontendToolResult({ toolCallId: 'tc1', result: 'ok' });
    await transport.abortRun('r1');
    expect(transport.recorder.runs).toHaveLength(1);
    expect(transport.recorder.toolResults).toHaveLength(1);
    expect(transport.recorder.abortedRunIds).toEqual(['r1']);
  });
});
```

- [ ] **Step 3: Run the tests and confirm they fail**

Run:
```bash
npx pnpm@9.0.0 --filter @chatkit-svelte/core exec vitest run src/testing/fixture-transport.test.ts
```
Expected: FAIL — `Cannot find module './fixture-transport'`.

- [ ] **Step 4: Write `packages/core/src/testing/fixture-transport.ts`**

```ts
import type { ChatEvent, ToolResult } from '../types';
import type { ChatTransport, RunAgentInput } from '../transport';

export interface FixtureTransportOptions {
  /** Delay in ms between yielded events; 0 (default) yields as fast as microtasks allow. */
  delayMs?: number;
}

export interface FixtureTransportRecorder {
  runs: RunAgentInput[];
  toolResults: ToolResult[];
  abortedRunIds: string[];
}

export function createFixtureTransport(
  events: ChatEvent[],
  options: FixtureTransportOptions = {}
): ChatTransport & { recorder: FixtureTransportRecorder } {
  const recorder: FixtureTransportRecorder = { runs: [], toolResults: [], abortedRunIds: [] };
  const delayMs = options.delayMs ?? 0;

  async function* replay(): AsyncIterable<ChatEvent> {
    for (const event of events) {
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      yield event;
    }
  }

  return {
    recorder,
    connect() {
      return replay();
    },
    async sendRun(input) {
      recorder.runs.push(input);
    },
    async sendFrontendToolResult(result) {
      recorder.toolResults.push(result);
    },
    async abortRun(runId) {
      recorder.abortedRunIds.push(runId);
    },
    dispose() {
      // no sockets/timers held open by this transport
    },
  };
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run:
```bash
npx pnpm@9.0.0 --filter @chatkit-svelte/core exec vitest run src/testing/fixture-transport.test.ts
```
Expected: PASS — 3 tests.

- [ ] **Step 6: Add a fixture-file-backed conformance test**

`docs/fixtures/text-streaming-basic.json` already exists at the repo root (created during scaffolding) with the same event sequence used above. Add one more test to `packages/core/src/testing/fixture-transport.test.ts` proving the on-disk fixture file itself (not just an inline array) drives the reducer correctly — this is the pattern later conformance tests (§18) and the devtools "export fixture" button (§13.4) will both rely on.

Append to the file:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

describe('docs/fixtures/text-streaming-basic.json', () => {
  it('is a valid ChatEvent[] that drives the reducer to the expected state', async () => {
    const fixturePath = fileURLToPath(new URL('../../../../docs/fixtures/text-streaming-basic.json', import.meta.url));
    const fixtureEvents = JSON.parse(readFileSync(fixturePath, 'utf-8')) as ChatEvent[];
    const transport = createFixtureTransport(fixtureEvents);

    let state = initialState();
    for await (const event of transport.connect({ threadId: 'thread-1' })) {
      state = reduceEvent(state, event);
    }

    expect(state.messages[0].parts).toEqual([{ type: 'text', text: 'Hello, world!' }]);
  });
});
```

Run:
```bash
npx pnpm@9.0.0 --filter @chatkit-svelte/core exec vitest run src/testing/fixture-transport.test.ts
```
Expected: PASS — 4 tests.

---

### Task 8: Config and plugin host

**Files:**
- Create: `packages/core/src/config.ts`
- Create: `packages/core/src/plugin-host.test.ts`
- Create: `packages/core/src/plugin-host.ts`

`ChatConfig` here is the M0 subset only (`threadId`, `transport`, `tools`, `plugins`, `initialState`). The full config surface from spec §8 (`theme`, `humanInTheLoop`, `persistence`, `i18n`, `telemetry`, `limits`) is added in M4/M6 when those subsystems exist — adding the fields now would mean typing against interfaces (`PersistenceAdapter`, `I18nConfig`, etc.) that don't exist yet in `core`.

- [ ] **Step 1: Write `packages/core/src/config.ts`**

```ts
import type { ChatPlugin } from './plugin-host';
import type { ChatTransport } from './transport';
import type { ToolDefinition } from './types';

export interface ChatConfig {
  threadId?: string;
  transport: ChatTransport;
  tools?: ToolDefinition[];
  plugins?: ChatPlugin[];
  initialState?: unknown;
}
```

- [ ] **Step 2: Write the failing tests — `packages/core/src/plugin-host.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest';
import { createPluginHost } from './plugin-host';
import type { ChatPlugin, PluginContext } from './plugin-host';
import { initialState } from './reducer';
import type { ChatConfig } from './config';

function makeCtx(overrides: Partial<PluginContext> = {}): PluginContext {
  return {
    getState: () => initialState(),
    dispatch: vi.fn(),
    sendRun: vi.fn(async () => {}),
    logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
    storage: { get: () => undefined, set: () => {} },
    config: {} as ChatConfig,
    ...overrides,
  };
}

describe('createPluginHost — registration', () => {
  it('throws on duplicate plugin names', () => {
    const plugin: ChatPlugin = { name: 'dup', version: '1.0.0' };
    expect(() => createPluginHost([plugin, { ...plugin }])).toThrow('duplicate plugin name "dup"');
  });

  it('throws on duplicate toolRenderer registrations across plugins', () => {
    const a: ChatPlugin = { name: 'a', version: '1.0.0', toolRenderers: { search: 'ComponentA' } };
    const b: ChatPlugin = { name: 'b', version: '1.0.0', toolRenderers: { search: 'ComponentB' } };
    expect(() => createPluginHost([a, b])).toThrow('duplicate toolRenderer registration for "search"');
  });

  it('throws on duplicate artifactRenderer registrations for the same kind', () => {
    const a: ChatPlugin = { name: 'a', version: '1.0.0', artifactRenderers: { form: 'FormA' } };
    const b: ChatPlugin = { name: 'b', version: '1.0.0', artifactRenderers: { form: 'FormB' } };
    expect(() => createPluginHost([a, b])).toThrow('duplicate artifactRenderer registration for "form"');
  });

  it('sorts messageRenderers by descending priority, preserving registration order on ties', () => {
    const a: ChatPlugin = {
      name: 'a',
      version: '1.0.0',
      messageRenderers: [{ partType: 'text', component: 'Low', priority: 1 }],
    };
    const b: ChatPlugin = {
      name: 'b',
      version: '1.0.0',
      messageRenderers: [
        { partType: 'text', component: 'High', priority: 10 },
        { partType: 'text', component: 'Default' },
      ],
    };
    const host = createPluginHost([a, b]);
    expect(host.registry.messageRenderers.map((r) => r.component)).toEqual(['High', 'Low', 'Default']);
  });

  it('aggregates slashCommands, inputTransforms, and attachmentHandlers across plugins', () => {
    const a: ChatPlugin = {
      name: 'a',
      version: '1.0.0',
      slashCommands: [{ name: 'clear', run: () => {} }],
    };
    const b: ChatPlugin = {
      name: 'b',
      version: '1.0.0',
      slashCommands: [{ name: 'export', run: () => {} }],
    };
    const host = createPluginHost([a, b]);
    expect(host.registry.slashCommands.map((c) => c.name)).toEqual(['clear', 'export']);
  });
});

describe('createPluginHost — lifecycle', () => {
  it('calls setup and onInit for every plugin, and dispose runs setup teardowns', () => {
    const teardown = vi.fn();
    const setup = vi.fn(() => teardown);
    const onInit = vi.fn();
    const plugin: ChatPlugin = { name: 'p', version: '1.0.0', setup, hooks: { onInit } };
    const host = createPluginHost([plugin]);
    const ctx = makeCtx();

    host.init(ctx);
    expect(setup).toHaveBeenCalledWith(ctx);
    expect(onInit).toHaveBeenCalledWith(ctx);
    expect(teardown).not.toHaveBeenCalled();

    host.dispose();
    expect(teardown).toHaveBeenCalledTimes(1);
  });
});

describe('createPluginHost — runHook', () => {
  it('pipes beforeSend output from one plugin into the next', async () => {
    const upper: ChatPlugin = {
      name: 'upper',
      version: '1.0.0',
      hooks: { beforeSend: (input) => ({ ...input, text: input.text.toUpperCase() }) },
    };
    const exclaim: ChatPlugin = {
      name: 'exclaim',
      version: '1.0.0',
      hooks: { beforeSend: (input) => ({ ...input, text: `${input.text}!` }) },
    };
    const host = createPluginHost([upper, exclaim]);
    const result = await host.runHook('beforeSend', { text: 'hello' }, makeCtx());
    expect(result).toEqual({ text: 'HELLO!' });
  });

  it('fires onEvent for observers without requiring a return value', async () => {
    const seen: string[] = [];
    const plugin: ChatPlugin = {
      name: 'observer',
      version: '1.0.0',
      hooks: { onEvent: (event) => { seen.push(event.type); } },
    };
    const host = createPluginHost([plugin]);
    const event = { type: 'RUN_STARTED', runId: 'r1', threadId: 't1' } as const;
    const result = await host.runHook('onEvent', event, makeCtx());
    expect(seen).toEqual(['RUN_STARTED']);
    expect(result).toBe(event);
  });
});
```

- [ ] **Step 3: Run the tests and confirm they fail**

Run:
```bash
npx pnpm@9.0.0 --filter @chatkit-svelte/core exec vitest run src/plugin-host.test.ts
```
Expected: FAIL — `Cannot find module './plugin-host'`.

- [ ] **Step 4: Write `packages/core/src/plugin-host.ts`**

```ts
import type { ArtifactKind, ChatError, ChatEvent, ChatState, ContentPart, Message, ToolResult } from './types';
import type { RunAgentInput } from './transport';
import type { ChatConfig } from './config';

export interface UserInput {
  text: string;
  attachments?: ContentPart[];
}

export interface ToolCall {
  toolCallId: string;
  toolName: string;
  args: unknown;
}

export interface MessageRendererRegistration {
  partType: ContentPart['type'];
  component: unknown; // concrete Svelte component type supplied by @chatkit-svelte/svelte consumers (M2+)
  priority?: number;
}

export type ToolRendererComponent = unknown;
export type ArtifactRendererComponent = unknown;

export interface SlashCommand {
  name: string;
  description?: string;
  run(args: string, ctx: PluginContext): void | Promise<void>;
}

export interface InputTransform {
  name: string;
  transform(input: UserInput, ctx: PluginContext): UserInput | Promise<UserInput>;
}

export interface AttachmentHandler {
  accept: string[];
  maxSizeBytes?: number;
  process(file: { name: string; type: string; size: number }, ctx: { abortSignal?: AbortSignal }): Promise<ContentPart>;
}

export interface ArtifactReducer {
  kind: ArtifactKind;
  matches(event: ChatEvent): boolean;
  apply(artifacts: ChatState['artifacts'], event: ChatEvent): ChatState['artifacts'];
  validate?(data: unknown): boolean;
}

export interface Logger {
  debug(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export interface PluginContext {
  getState(): ChatState;
  dispatch(event: ChatEvent): void;
  sendRun(input: Partial<RunAgentInput>): Promise<void>;
  logger: Logger;
  storage: { get<T>(key: string): T | undefined; set<T>(key: string, value: T): void };
  config: ChatConfig;
}

export interface ChatPluginHooks {
  onInit?(ctx: PluginContext): void;
  beforeSend?(input: UserInput, ctx: PluginContext): UserInput | Promise<UserInput>;
  onEvent?(event: ChatEvent, ctx: PluginContext): void;
  onMessage?(message: Message, ctx: PluginContext): void;
  onToolCall?(call: ToolCall, ctx: PluginContext): ToolResult | Promise<ToolResult> | void;
  onError?(error: ChatError, ctx: PluginContext): void;
}

export interface ChatPlugin {
  name: string;
  version: string;
  setup?(ctx: PluginContext): void | (() => void);
  hooks?: ChatPluginHooks;
  artifactReducers?: ArtifactReducer[];
  messageRenderers?: MessageRendererRegistration[];
  toolRenderers?: Record<string, ToolRendererComponent>;
  artifactRenderers?: Partial<Record<ArtifactKind, ArtifactRendererComponent>>;
  slashCommands?: SlashCommand[];
  inputTransforms?: InputTransform[];
  attachmentHandlers?: AttachmentHandler[];
}

export interface PluginRegistry {
  artifactReducers: Record<string, ArtifactReducer[]>;
  messageRenderers: MessageRendererRegistration[];
  toolRenderers: Record<string, ToolRendererComponent>;
  artifactRenderers: Partial<Record<ArtifactKind, ArtifactRendererComponent>>;
  slashCommands: SlashCommand[];
  inputTransforms: InputTransform[];
  attachmentHandlers: AttachmentHandler[];
}

function indexByKind(reducers: ArtifactReducer[]): Record<string, ArtifactReducer[]> {
  const index: Record<string, ArtifactReducer[]> = {};
  for (const reducer of reducers) {
    (index[reducer.kind] ??= []).push(reducer);
  }
  return index;
}

function sortByPriority(renderers: MessageRendererRegistration[]): MessageRendererRegistration[] {
  return [...renderers].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
}

function mergeUnique(entries: Array<[string, unknown]>, kind: string): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    if (key in merged) {
      throw new Error(`[chatkit] duplicate ${kind} registration for "${key}"`);
    }
    merged[key] = value;
  }
  return merged;
}

export interface PluginHost {
  registry: PluginRegistry;
  init(ctx: PluginContext): void;
  runHook(hook: keyof ChatPluginHooks, arg: unknown, ctx: PluginContext): Promise<unknown>;
  dispose(): void;
}

export function createPluginHost(plugins: ChatPlugin[]): PluginHost {
  const seen = new Set<string>();
  for (const plugin of plugins) {
    if (seen.has(plugin.name)) {
      throw new Error(`[chatkit] duplicate plugin name "${plugin.name}"`);
    }
    seen.add(plugin.name);
  }

  const toolRendererEntries = plugins.flatMap((p) => Object.entries(p.toolRenderers ?? {}));
  const artifactRendererEntries = plugins.flatMap((p) => Object.entries(p.artifactRenderers ?? {}));

  const registry: PluginRegistry = {
    artifactReducers: indexByKind(plugins.flatMap((p) => p.artifactReducers ?? [])),
    messageRenderers: sortByPriority(plugins.flatMap((p) => p.messageRenderers ?? [])),
    toolRenderers: mergeUnique(toolRendererEntries, 'toolRenderer'),
    artifactRenderers: mergeUnique(artifactRendererEntries, 'artifactRenderer') as Partial<Record<ArtifactKind, ArtifactRendererComponent>>,
    slashCommands: plugins.flatMap((p) => p.slashCommands ?? []),
    inputTransforms: plugins.flatMap((p) => p.inputTransforms ?? []),
    attachmentHandlers: plugins.flatMap((p) => p.attachmentHandlers ?? []),
  };

  const teardowns: Array<() => void> = [];

  function init(ctx: PluginContext) {
    for (const plugin of plugins) {
      const teardown = plugin.setup?.(ctx);
      if (typeof teardown === 'function') teardowns.push(teardown);
      plugin.hooks?.onInit?.(ctx);
    }
  }

  async function runHook(hook: keyof ChatPluginHooks, arg: unknown, ctx: PluginContext): Promise<unknown> {
    let value = arg;
    for (const plugin of plugins) {
      const fn = plugin.hooks?.[hook] as ((a: unknown, c: PluginContext) => unknown) | undefined;
      if (!fn) continue;
      const out = await fn(value, ctx);
      if (out !== undefined) value = out;
    }
    return value;
  }

  function dispose() {
    for (const teardown of teardowns) teardown();
  }

  return { registry, init, runHook, dispose };
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run:
```bash
npx pnpm@9.0.0 --filter @chatkit-svelte/core exec vitest run src/plugin-host.test.ts
```
Expected: PASS — 8 tests.

---

### Task 9: Barrel export and full package verification

**Files:**
- Create: `packages/core/src/index.ts`

- [ ] **Step 1: Write `packages/core/src/index.ts`**

```ts
export * from './types';
export * from './json-patch';
export * from './reducer';
export * from './transport';
export * from './config';
export * from './plugin-host';
export { createFixtureTransport } from './testing/fixture-transport';
export type { FixtureTransportOptions, FixtureTransportRecorder } from './testing/fixture-transport';
```

- [ ] **Step 2: Run the full test suite**

Run:
```bash
npx pnpm@9.0.0 --filter @chatkit-svelte/core exec vitest run
```
Expected: PASS — 4 test files, 33 tests (8 json-patch + 13 reducer + 4 fixture-transport + 8 plugin-host — note reducer.test.ts's final count is 13, not the 6 from Task 5, since Task 6 appended more; fixture-transport.test.ts's final count is 4 after Task 7 Step 6).

- [ ] **Step 3: Typecheck the whole package**

Run:
```bash
npx pnpm@9.0.0 --filter @chatkit-svelte/core exec tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Build the package**

Run:
```bash
npx pnpm@9.0.0 --filter @chatkit-svelte/core build
```
Expected: succeeds, producing `packages/core/dist/index.js` and `packages/core/dist/index.d.ts`.

- [ ] **Step 5: Update the milestone checklist in the root README**

In [README.md](../../../README.md), change:
```markdown
- [ ] M0 — Core skeleton (types, reducer, plugin host, in-memory transport + fixture playback)
```
to:
```markdown
- [x] M0 — Core skeleton (types, reducer, plugin host, in-memory transport + fixture playback)
```

- [ ] **Step 6: Mark the milestone complete**

No git commit — per repo owner preference, commits are handled manually. This is the natural stopping point for M0; M1 (real AG-UI transport) is a separate plan.

---

## Notes for the next plan (M1)

- `transport-agui` (packages/transport-agui) implements `ChatTransport` against real SSE/WebSocket per spec §3.3 — reconnect/backoff, `Idempotency-Key`, bounded event queue with coalescing, `MESSAGES_SNAPSHOT` recovery on reconnect. `createFixtureTransport` from this plan is a useful test double once that package has its own tests.
- `ChatConfig.transport` is currently typed as an already-constructed `ChatTransport`. Spec §8 implies a `TransportConfig` union (`aguiTransport({...})`-style factories) — introduce that indirection in M1 once there's more than one transport implementation to choose between; don't add it speculatively now.
- Reasoning handling (`REASONING_*`) was implemented in Task 6 even though the spec's §5 reference reducer omitted it "for brevity" — the event types are part of `ChatEvent` and the category table in §3.1 lists Reasoning as implemented, so treating it the same as `TEXT_MESSAGE_*` closes an obvious gap rather than adding new scope.
