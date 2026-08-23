# M1 — AG-UI Transport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Git note:** commit steps are intentionally omitted — the repo owner handles git operations manually. Do not run `git add`/`git commit` while executing this plan unless explicitly asked to in the moment.

**Goal:** Build `@chatkit/transport-agui` — a real `ChatTransport` implementation (per spec §3.2, already defined in `@chatkit/core`) that talks to an AG-UI-style backend over SSE by default or WebSocket opt-in, with reconnect/exponential-backoff, resumeToken-based reconnection, a bounded/coalescing event queue for delta bursts, an `Idempotency-Key` header on every run, and self-healing `STATE_DELTA` conflict recovery.

**Architecture:** Six small, independently-testable modules compose into one factory function, `createAguiTransport(options) => ChatTransport`:
- `sse-parser.ts` — incremental, streaming-safe Server-Sent-Events frame parser (pure, no I/O).
- `backoff.ts` — pure exponential-backoff-with-jitter delay calculator.
- `event-queue.ts` — a bounded FIFO queue that coalesces bursts of same-key delta events (`TEXT_MESSAGE_CONTENT`/`REASONING_CONTENT`/`TOOL_CALL_ARGS`) instead of dropping them.
- `push-pull-bridge.ts` — bridges a callback-driven producer (WebSocket `message` events) into a pull-based `AsyncGenerator`, used only by WebSocket mode (SSE mode already gets pull-based reading for free from `fetch`'s `ReadableStream`).
- `agui-transport.ts` — the `ChatTransport` factory tying the above together for both SSE and WebSocket modes, plus the plain-HTTP control-plane calls (`sendRun`/`sendFrontendToolResult`/`abortRun`/`getCapabilities`) that are the same regardless of streaming mode.
- `index.ts` — barrel export.

Every module and every test in this plan has already been written and verified (`tsc --noEmit` clean, all 44 tests passing against real local `node:http`/`ws` servers — no mocking of `fetch`/`WebSocket` internals). Most of this was validated in a scratch sandbox before being transcribed here; two rounds of review found real bugs afterward and both fixes are folded directly into Tasks 6–7's steps below (not left as separate patches), so following the steps in order gets you the corrected version directly: (1) `minStableConnectionMs` (Task 6 Step 5) — SSE mode was resetting its backoff counter on every successful connection, even one that failed instantly, so a flapping connection never actually escalated backoff; (2) the WebSocket `close` listener (Task 7 Step 6) — it treated every close as clean regardless of `wasClean`, so the same escalation logic was present in `connectViaWebSocket` but structurally unreachable for real socket drops.

**Tech Stack:** TypeScript 5.5 (strict), native `fetch`/`ReadableStream`/`WebSocket`/`AbortController` (all available as globals in Node ≥18/22 and browsers — no HTTP client library dependency), the `ws` package as a **devDependency only** (used to spin up a real WebSocket server in tests; never imported by production code), Vitest, Vite (`--mode lib` + `vite-plugin-dts`).

**Wire conventions this package establishes** (AG-UI's protocol is transport-agnostic and doesn't mandate exact paths — spec §3.1 says "path configurable"): given `endpoint` as the base URL,
- `GET {endpoint}/threads/:threadId/events` — the event stream (SSE by default; same path is used for the WebSocket upgrade in `websocket` mode, with `http(s)://` swapped for `ws(s)://`). Accepts `?resumeToken=...` for reconnection (SSE mode only — see Task 7's scope note).
- `POST {endpoint}/runs` — start a run (`RunAgentInput` as JSON body), always plain HTTP regardless of streaming mode, carries an `Idempotency-Key` header.
- `POST {endpoint}/tool-results` — deliver a frontend tool result (`ToolResult` as JSON body).
- `DELETE {endpoint}/runs/:runId` — best-effort run cancellation; a non-2xx/network error here is swallowed (AG-UI doesn't mandate this endpoint exist).
- `GET {endpoint}/capabilities` — optional capability negotiation, JSON `AgentCapabilities`.
- `GET {endpoint}/threads/:threadId/state` — fresh full-state fetch, used internally to self-heal a `STATE_DELTA` that fails to apply.

---

## File Structure

```
packages/transport-agui/
  package.json          # already scaffolded — Task 1 adds missing devDependencies
  tsconfig.json          # new — Task 1
  vite.config.ts          # new — Task 1
  src/
    sse-parser.ts, sse-parser.test.ts                          # Task 2
    backoff.ts, backoff.test.ts                                # Task 3
    event-queue.ts, event-queue.test.ts                        # Task 4
    push-pull-bridge.ts, push-pull-bridge.test.ts               # Task 5
    agui-transport.ts                                          # Tasks 6–7 (built incrementally)
    agui-transport.test.ts                                     # Task 6 — SSE mode
    agui-transport-websocket.test.ts                           # Task 7 — WebSocket mode
    index.ts                                                   # Task 8
```

---

### Task 1: `packages/transport-agui` build configuration and devDependencies

**Files:**
- Modify: `packages/transport-agui/package.json`
- Create: `packages/transport-agui/tsconfig.json`
- Create: `packages/transport-agui/vite.config.ts`

- [ ] **Step 1: Add missing devDependencies to `packages/transport-agui/package.json`**

The file already exists (from initial monorepo scaffolding) with `@chatkit/core` as a dependency and `typescript`/`vite`/`vitest` as devDependencies. Update the `devDependencies` block to also include `vite-plugin-dts` (for declaration bundling, matching `@chatkit/core`'s setup), `@types/node` (this package's tests spin up real `node:http` servers), and `ws`/`@types/ws` (the WebSocket-mode tests spin up a real `ws` server — `ws` is a devDependency only, never imported by `src/agui-transport.ts` itself, which uses the platform-global `WebSocket`):

```json
{
  "name": "@chatkit/transport-agui",
  "version": "0.0.0",
  "description": "AG-UI protocol client (SSE + WebSocket + HTTP fallback, reconnect/backoff). See README for the AG-UI event-set version this targets.",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./package.json": "./package.json"
  },
  "files": ["dist"],
  "scripts": {
    "build": "vite build --mode lib",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@chatkit/core": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/ws": "^8.5.0",
    "typescript": "^5.5.0",
    "vite": "^5.4.0",
    "vite-plugin-dts": "^4.0.0",
    "vitest": "^2.0.0",
    "ws": "^8.18.0"
  }
}
```

- [ ] **Step 2: Write `packages/transport-agui/tsconfig.json`**

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

- [ ] **Step 3: Write `packages/transport-agui/vite.config.ts`**

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
    testTimeout: 10000,
  },
});
```

- [ ] **Step 4: Install dependencies**

Run from the repo root (`C:/Data/Projects/chat-ui-boot`):
```bash
npx pnpm@9.0.0 install
```
Expected: succeeds, `ws`/`@types/ws`/`@types/node`/`vite-plugin-dts` now present under `packages/transport-agui`'s resolved dependencies (pnpm workspaces hoist/link automatically).

---

### Task 2: SSE frame parser

An incremental parser for the Server-Sent-Events wire format (WHATWG spec): splits arbitrary text chunks into lines (handling `\n`, `\r\n`, or `\r`, and lines split across chunk boundaries), accumulates `data:`/`event:`/`id:`/`retry:` fields, and dispatches a frame on a blank line. Pure and I/O-free — the transport is responsible for decoding bytes to text and feeding this parser.

**Files:**
- Create: `packages/transport-agui/src/sse-parser.test.ts`
- Create: `packages/transport-agui/src/sse-parser.ts`

- [ ] **Step 1: Write the failing tests — `packages/transport-agui/src/sse-parser.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { createSseFrameParser } from './sse-parser';

describe('createSseFrameParser', () => {
  it('parses a single complete event in one push', () => {
    const parser = createSseFrameParser();
    const frames = parser.push('data: {"hello":"world"}\n\n');
    expect(frames).toEqual([{ event: undefined, data: '{"hello":"world"}', id: undefined, retry: undefined }]);
  });

  it('buffers a chunk split mid-line and only dispatches once complete', () => {
    const parser = createSseFrameParser();
    expect(parser.push('data: {"hel')).toEqual([]);
    expect(parser.push('lo":"world"}\n')).toEqual([]);
    expect(parser.push('\n')).toEqual([{ event: undefined, data: '{"hello":"world"}', id: undefined, retry: undefined }]);
  });

  it('concatenates multiple data: lines with \\n', () => {
    const parser = createSseFrameParser();
    const frames = parser.push('data: line1\ndata: line2\n\n');
    expect(frames).toEqual([{ event: undefined, data: 'line1\nline2', id: undefined, retry: undefined }]);
  });

  it('ignores comment lines starting with ":"', () => {
    const parser = createSseFrameParser();
    const frames = parser.push(': this is a comment\ndata: payload\n\n');
    expect(frames).toEqual([{ event: undefined, data: 'payload', id: undefined, retry: undefined }]);
  });

  it('supports CRLF line endings', () => {
    const parser = createSseFrameParser();
    const frames = parser.push('data: payload\r\n\r\n');
    expect(frames).toEqual([{ event: undefined, data: 'payload', id: undefined, retry: undefined }]);
  });

  it('dispatches multiple events found in a single push', () => {
    const parser = createSseFrameParser();
    const frames = parser.push('data: first\n\ndata: second\n\n');
    expect(frames).toEqual([
      { event: undefined, data: 'first', id: undefined, retry: undefined },
      { event: undefined, data: 'second', id: undefined, retry: undefined },
    ]);
  });

  it('captures event, id, and retry fields', () => {
    const parser = createSseFrameParser();
    const frames = parser.push('event: custom\nid: 42\nretry: 3000\ndata: payload\n\n');
    expect(frames).toEqual([{ event: 'custom', data: 'payload', id: '42', retry: 3000 }]);
  });

  it('does not dispatch an incomplete trailing event with no blank line', () => {
    const parser = createSseFrameParser();
    const frames = parser.push('data: incomplete\n');
    expect(frames).toEqual([]);
  });

  it('does not dispatch a fully empty event (blank line with no fields)', () => {
    const parser = createSseFrameParser();
    const frames = parser.push('\n\n');
    expect(frames).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run:
```bash
npx pnpm@9.0.0 --filter @chatkit/transport-agui exec vitest run src/sse-parser.test.ts
```
Expected: FAIL — `Cannot find module './sse-parser'`.

- [ ] **Step 3: Write `packages/transport-agui/src/sse-parser.ts`**

```ts
export interface SseFrame {
  event?: string;
  data: string;
  id?: string;
  retry?: number;
}

const LINE_BREAK = /\r\n|\r|\n/;

export interface SseFrameParser {
  /** Feed a decoded text chunk; returns any frames completed by this chunk. */
  push(chunk: string): SseFrame[];
}

export function createSseFrameParser(): SseFrameParser {
  let buffer = '';
  let eventField: string | undefined;
  let dataLines: string[] = [];
  let idField: string | undefined;
  let retryField: number | undefined;

  function reset(): void {
    eventField = undefined;
    dataLines = [];
    idField = undefined;
    retryField = undefined;
  }

  function isEmptyEvent(): boolean {
    return dataLines.length === 0 && eventField === undefined && idField === undefined && retryField === undefined;
  }

  function processLine(line: string, frames: SseFrame[]): void {
    if (line === '') {
      if (!isEmptyEvent()) {
        frames.push({ event: eventField, data: dataLines.join('\n'), id: idField, retry: retryField });
      }
      reset();
      return;
    }
    if (line.startsWith(':')) {
      return;
    }
    const colonIndex = line.indexOf(':');
    const field = colonIndex === -1 ? line : line.slice(0, colonIndex);
    let value = colonIndex === -1 ? '' : line.slice(colonIndex + 1);
    if (value.startsWith(' ')) value = value.slice(1);

    switch (field) {
      case 'event':
        eventField = value;
        break;
      case 'data':
        dataLines.push(value);
        break;
      case 'id':
        idField = value;
        break;
      case 'retry': {
        const ms = Number(value);
        if (!Number.isNaN(ms)) retryField = ms;
        break;
      }
      default:
        break;
    }
  }

  return {
    push(chunk: string): SseFrame[] {
      buffer += chunk;
      const frames: SseFrame[] = [];
      let match: RegExpExecArray | null;
      while ((match = LINE_BREAK.exec(buffer))) {
        const line = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        processLine(line, frames);
      }
      return frames;
    },
  };
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run:
```bash
npx pnpm@9.0.0 --filter @chatkit/transport-agui exec vitest run src/sse-parser.test.ts
```
Expected: PASS — 9 tests.

---

### Task 3: Backoff calculator

A pure function computing exponential-backoff-with-jitter delays (spec §3.3: `base=500ms, factor=2, max=15s, jitter=±20%`).

**Files:**
- Create: `packages/transport-agui/src/backoff.test.ts`
- Create: `packages/transport-agui/src/backoff.ts`

- [ ] **Step 1: Write the failing tests — `packages/transport-agui/src/backoff.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { computeBackoffDelay } from './backoff';

describe('computeBackoffDelay', () => {
  it('returns base delay for the first retry with no jitter', () => {
    const delay = computeBackoffDelay(1, { base: 500, factor: 2, max: 15000, jitter: 0, random: () => 0.5 });
    expect(delay).toBe(500);
  });

  it('doubles per attempt with the default factor', () => {
    const opts = { base: 500, factor: 2, max: 15000, jitter: 0, random: () => 0.5 };
    expect(computeBackoffDelay(1, opts)).toBe(500);
    expect(computeBackoffDelay(2, opts)).toBe(1000);
    expect(computeBackoffDelay(3, opts)).toBe(2000);
    expect(computeBackoffDelay(4, opts)).toBe(4000);
  });

  it('caps the exponential growth at max before jitter', () => {
    const delay = computeBackoffDelay(10, { base: 500, factor: 2, max: 15000, jitter: 0, random: () => 0.5 });
    expect(delay).toBe(15000);
  });

  it('applies symmetric jitter within ±jitter fraction of the capped delay', () => {
    const opts = { base: 500, factor: 2, max: 15000, jitter: 0.2 };
    const atMinRandom = computeBackoffDelay(1, { ...opts, random: () => 0 });
    const atMaxRandom = computeBackoffDelay(1, { ...opts, random: () => 1 });
    const atMidRandom = computeBackoffDelay(1, { ...opts, random: () => 0.5 });
    expect(atMinRandom).toBe(400); // 500 - 20%
    expect(atMaxRandom).toBe(600); // 500 + 20%
    expect(atMidRandom).toBe(500); // no offset at random()=0.5
  });

  it('never returns a negative delay even with extreme jitter', () => {
    const delay = computeBackoffDelay(1, { base: 10, factor: 2, max: 15000, jitter: 1, random: () => 0 });
    expect(delay).toBeGreaterThanOrEqual(0);
  });

  it('treats attempt <= 1 the same as attempt 1 (no negative exponents)', () => {
    const opts = { base: 500, factor: 2, max: 15000, jitter: 0, random: () => 0.5 };
    expect(computeBackoffDelay(0, opts)).toBe(500);
    expect(computeBackoffDelay(1, opts)).toBe(500);
  });

  it('uses documented defaults when no options are passed', () => {
    const delay = computeBackoffDelay(1);
    expect(delay).toBeGreaterThanOrEqual(400);
    expect(delay).toBeLessThanOrEqual(600);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run:
```bash
npx pnpm@9.0.0 --filter @chatkit/transport-agui exec vitest run src/backoff.test.ts
```
Expected: FAIL — `Cannot find module './backoff'`.

- [ ] **Step 3: Write `packages/transport-agui/src/backoff.ts`**

```ts
export interface BackoffOptions {
  /** Base delay in ms before the first retry. Default 500. */
  base?: number;
  /** Multiplier applied per attempt. Default 2. */
  factor?: number;
  /** Ceiling for the delay, before jitter is applied. Default 15000. */
  max?: number;
  /** Jitter as a fraction of the delay (0.2 = ±20%). Default 0.2. */
  jitter?: number;
  /** Random source, injectable for deterministic tests. Default Math.random. */
  random?: () => number;
}

/**
 * Computes the delay (ms) before retry number `attempt` (1-indexed: the delay
 * before the FIRST retry is attempt=1). Exponential backoff capped at `max`,
 * with symmetric jitter applied on top of the capped value.
 */
export function computeBackoffDelay(attempt: number, options: BackoffOptions = {}): number {
  const base = options.base ?? 500;
  const factor = options.factor ?? 2;
  const max = options.max ?? 15000;
  const jitter = options.jitter ?? 0.2;
  const random = options.random ?? Math.random;

  const exponential = base * factor ** Math.max(0, attempt - 1);
  const capped = Math.min(exponential, max);
  const jitterRange = capped * jitter;
  const jitterOffset = (random() * 2 - 1) * jitterRange;
  return Math.max(0, Math.round(capped + jitterOffset));
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run:
```bash
npx pnpm@9.0.0 --filter @chatkit/transport-agui exec vitest run src/backoff.test.ts
```
Expected: PASS — 7 tests.

---

### Task 4: Bounded, coalescing event queue

A FIFO queue of `ChatEvent`s with a soft capacity (spec §3.3, default 500): once at capacity, a new coalescable delta event (`TEXT_MESSAGE_CONTENT`/`REASONING_CONTENT`/`TOOL_CALL_ARGS`) sharing a key (`messageId`/`toolCallId`) with an already-queued event of the same type merges into that entry instead of growing the queue. Structural events (lifecycle, START/END/RESULT events, or a coalescable type with no existing match) always enqueue normally — capacity bounds runaway delta streams, it never drops structurally necessary events.

**Files:**
- Create: `packages/transport-agui/src/event-queue.test.ts`
- Create: `packages/transport-agui/src/event-queue.ts`

- [ ] **Step 1: Write the failing tests — `packages/transport-agui/src/event-queue.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { BoundedEventQueue } from './event-queue';
import type { ChatEvent } from '@chatkit/core';

describe('BoundedEventQueue', () => {
  it('enqueues events in order under capacity', () => {
    const queue = new BoundedEventQueue(10);
    queue.push({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' });
    queue.push({ type: 'RUN_FINISHED', runId: 'r1' });
    expect(queue.size).toBe(2);
    expect(queue.shift()).toEqual({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' });
    expect(queue.shift()).toEqual({ type: 'RUN_FINISHED', runId: 'r1' });
    expect(queue.shift()).toBeUndefined();
  });

  it('coalesces TEXT_MESSAGE_CONTENT deltas for the same messageId once at capacity', () => {
    const queue = new BoundedEventQueue(1);
    queue.push({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'Hello' });
    queue.push({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: ', world!' });
    expect(queue.size).toBe(1);
    expect(queue.shift()).toEqual({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'Hello, world!' });
  });

  it('coalesces TOOL_CALL_ARGS deltas for the same toolCallId once at capacity', () => {
    const queue = new BoundedEventQueue(1);
    queue.push({ type: 'TOOL_CALL_ARGS', toolCallId: 'tc1', delta: '{"a":' });
    queue.push({ type: 'TOOL_CALL_ARGS', toolCallId: 'tc1', delta: '1}' });
    expect(queue.size).toBe(1);
    expect(queue.shift()).toEqual({ type: 'TOOL_CALL_ARGS', toolCallId: 'tc1', delta: '{"a":1}' });
  });

  it('coalesces REASONING_CONTENT deltas, keeping the latest encrypted flag', () => {
    const queue = new BoundedEventQueue(1);
    queue.push({ type: 'REASONING_CONTENT', messageId: 'r1', delta: 'foo', encrypted: false });
    queue.push({ type: 'REASONING_CONTENT', messageId: 'r1', delta: 'bar', encrypted: true });
    expect(queue.shift()).toEqual({ type: 'REASONING_CONTENT', messageId: 'r1', delta: 'foobar', encrypted: true });
  });

  it('does not coalesce across different messageIds even at capacity', () => {
    const queue = new BoundedEventQueue(1);
    queue.push({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'Hello' });
    queue.push({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm2', delta: 'World' });
    expect(queue.size).toBe(2);
  });

  it('finds the correct coalescing target when multiple keys are interleaved in the queue', () => {
    const queue = new BoundedEventQueue(2);
    queue.push({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'A' });
    queue.push({ type: 'TOOL_CALL_ARGS', toolCallId: 'tc1', delta: '{' });
    queue.push({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'B' });
    expect(queue.size).toBe(2);
    expect(queue.shift()).toEqual({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'AB' });
    expect(queue.shift()).toEqual({ type: 'TOOL_CALL_ARGS', toolCallId: 'tc1', delta: '{' });
  });

  it('always enqueues non-coalescable (structural) events even at capacity', () => {
    const queue = new BoundedEventQueue(1);
    queue.push({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'A' });
    queue.push({ type: 'RUN_FINISHED', runId: 'r1' });
    expect(queue.size).toBe(2);
  });

  it('drain() empties the queue and returns everything in order', () => {
    const queue = new BoundedEventQueue(10);
    const events: ChatEvent[] = [
      { type: 'RUN_STARTED', runId: 'r1', threadId: 't1' },
      { type: 'RUN_FINISHED', runId: 'r1' },
    ];
    events.forEach((e) => queue.push(e));
    expect(queue.drain()).toEqual(events);
    expect(queue.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run:
```bash
npx pnpm@9.0.0 --filter @chatkit/transport-agui exec vitest run src/event-queue.test.ts
```
Expected: FAIL — `Cannot find module './event-queue'`.

- [ ] **Step 3: Write `packages/transport-agui/src/event-queue.ts`**

```ts
import type { ChatEvent } from '@chatkit/core';

function coalesceKey(event: ChatEvent): string | undefined {
  switch (event.type) {
    case 'TEXT_MESSAGE_CONTENT':
      return `TEXT_MESSAGE_CONTENT:${event.messageId}`;
    case 'REASONING_CONTENT':
      return `REASONING_CONTENT:${event.messageId}`;
    case 'TOOL_CALL_ARGS':
      return `TOOL_CALL_ARGS:${event.toolCallId}`;
    default:
      return undefined;
  }
}

function mergeCoalescable(existing: ChatEvent, incoming: ChatEvent): ChatEvent {
  if (existing.type === 'TEXT_MESSAGE_CONTENT' && incoming.type === 'TEXT_MESSAGE_CONTENT') {
    return { ...existing, delta: existing.delta + incoming.delta };
  }
  if (existing.type === 'REASONING_CONTENT' && incoming.type === 'REASONING_CONTENT') {
    return { ...existing, delta: existing.delta + incoming.delta, encrypted: incoming.encrypted };
  }
  if (existing.type === 'TOOL_CALL_ARGS' && incoming.type === 'TOOL_CALL_ARGS') {
    return { ...existing, delta: existing.delta + incoming.delta };
  }
  return incoming;
}

/**
 * A FIFO queue of ChatEvents with a soft capacity: once at capacity, a new
 * *coalescable* event (TEXT_MESSAGE_CONTENT / REASONING_CONTENT /
 * TOOL_CALL_ARGS) that shares a key (messageId/toolCallId) with an
 * already-queued event of the same type is merged into that entry instead of
 * growing the queue. Non-coalescable events (lifecycle, START/END/RESULT,
 * or a coalescable type with no existing match) always enqueue normally —
 * capacity bounds runaway delta streams, it does not drop structurally
 * necessary events.
 */
export class BoundedEventQueue {
  private items: ChatEvent[] = [];

  constructor(private readonly capacity: number = 500) {}

  get size(): number {
    return this.items.length;
  }

  push(event: ChatEvent): void {
    const key = coalesceKey(event);
    if (this.items.length >= this.capacity && key !== undefined) {
      for (let i = this.items.length - 1; i >= 0; i--) {
        if (coalesceKey(this.items[i]) === key) {
          this.items[i] = mergeCoalescable(this.items[i], event);
          return;
        }
      }
    }
    this.items.push(event);
  }

  shift(): ChatEvent | undefined {
    return this.items.shift();
  }

  drain(): ChatEvent[] {
    const drained = this.items;
    this.items = [];
    return drained;
  }
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run:
```bash
npx pnpm@9.0.0 --filter @chatkit/transport-agui exec vitest run src/event-queue.test.ts
```
Expected: PASS — 8 tests.

---

### Task 5: Push-pull bridge (for WebSocket mode)

WebSocket delivers messages via callbacks (`message` events); `ChatTransport.connect()` needs to return a pull-based `AsyncIterable`. This bridge buffers pushed items until a consumer pulls them, and parks the generator on a pending promise when the buffer is empty. (SSE mode doesn't need this — `fetch`'s `ReadableStream.getReader()` is already pull-based.)

**Files:**
- Create: `packages/transport-agui/src/push-pull-bridge.test.ts`
- Create: `packages/transport-agui/src/push-pull-bridge.ts`

- [ ] **Step 1: Write the failing tests — `packages/transport-agui/src/push-pull-bridge.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { createPushPullBridge } from './push-pull-bridge';

describe('createPushPullBridge', () => {
  it('yields items pushed before iteration starts', async () => {
    const bridge = createPushPullBridge<number>();
    bridge.push(1);
    bridge.push(2);
    const iterator = bridge.iterate()[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toBe(1);
    expect((await iterator.next()).value).toBe(2);
  });

  it('parks the generator until an item is pushed, then resumes', async () => {
    const bridge = createPushPullBridge<number>();
    const iterator = bridge.iterate()[Symbol.asyncIterator]();
    const pending = iterator.next();
    let resolved = false;
    pending.then(() => {
      resolved = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(resolved).toBe(false);
    bridge.push(42);
    const result = await pending;
    expect(result.value).toBe(42);
  });

  it('ends the generator cleanly when close() is called with no error', async () => {
    const bridge = createPushPullBridge<number>();
    bridge.push(1);
    bridge.close();
    const iterator = bridge.iterate()[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toBe(1);
    expect((await iterator.next()).done).toBe(true);
  });

  it('throws from the generator when close() is called with an error', async () => {
    const bridge = createPushPullBridge<number>();
    bridge.close(new Error('boom'));
    const iterator = bridge.iterate()[Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toThrow('boom');
  });

  it('ignores pushes after close()', async () => {
    const bridge = createPushPullBridge<number>();
    bridge.close();
    bridge.push(1);
    const iterator = bridge.iterate()[Symbol.asyncIterator]();
    expect((await iterator.next()).done).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run:
```bash
npx pnpm@9.0.0 --filter @chatkit/transport-agui exec vitest run src/push-pull-bridge.test.ts
```
Expected: FAIL — `Cannot find module './push-pull-bridge'`.

- [ ] **Step 3: Write `packages/transport-agui/src/push-pull-bridge.ts`**

```ts
/**
 * Bridges a callback-driven producer (e.g. WebSocket 'message' events) into a
 * pull-based AsyncGenerator, buffering pushed items until a consumer pulls
 * them and parking the generator on a pending promise when the buffer is
 * empty and nothing has closed it yet.
 */
export interface PushPullBridge<T> {
  push(item: T): void;
  close(error?: unknown): void;
  iterate(): AsyncGenerator<T>;
}

export function createPushPullBridge<T>(): PushPullBridge<T> {
  const buffer: T[] = [];
  let resolveWaiting: (() => void) | null = null;
  let closed = false;
  let closeError: unknown;

  function push(item: T): void {
    if (closed) return;
    buffer.push(item);
    if (resolveWaiting) {
      const resolve = resolveWaiting;
      resolveWaiting = null;
      resolve();
    }
  }

  function close(error?: unknown): void {
    if (closed) return;
    closed = true;
    closeError = error;
    if (resolveWaiting) {
      const resolve = resolveWaiting;
      resolveWaiting = null;
      resolve();
    }
  }

  async function* iterate(): AsyncGenerator<T> {
    while (true) {
      while (buffer.length > 0) {
        yield buffer.shift() as T;
      }
      if (closed) {
        if (closeError !== undefined) throw closeError;
        return;
      }
      await new Promise<void>((resolve) => {
        resolveWaiting = resolve;
      });
    }
  }

  return { push, close, iterate };
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run:
```bash
npx pnpm@9.0.0 --filter @chatkit/transport-agui exec vitest run src/push-pull-bridge.test.ts
```
Expected: PASS — 5 tests.

---

### Task 6: `createAguiTransport` — SSE mode, control-plane calls, and STATE_DELTA self-healing

This is the main transport factory. This task builds the SSE (`connect()`) path plus all four plain-HTTP control-plane methods; Task 7 adds WebSocket mode on top of the same file.

**Files:**
- Create: `packages/transport-agui/src/agui-transport.test.ts`
- Create: `packages/transport-agui/src/agui-transport.ts`

- [ ] **Step 1: Write the failing tests — `packages/transport-agui/src/agui-transport.test.ts`**

```ts
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createAguiTransport } from './agui-transport';

async function startServer(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<{ server: Server; endpoint: string }> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('expected an AddressInfo');
  return { server, endpoint: `http://127.0.0.1:${address.port}` };
}

function sseFrame(event: unknown, id?: string): string {
  const idLine = id ? `id: ${id}\n` : '';
  return `${idLine}data: ${JSON.stringify(event)}\n\n`;
}

let activeServer: Server | undefined;

afterEach(async () => {
  if (activeServer) {
    // Force-close any lingering keep-alive sockets (e.g. from a connection
    // the client aborted but didn't cleanly finish) — otherwise server.close()
    // waits out Node's default keep-alive timeout (~5s) before resolving.
    activeServer.closeAllConnections();
    await new Promise<void>((resolve) => activeServer!.close(() => resolve()));
    activeServer = undefined;
  }
});

describe('createAguiTransport — connect', () => {
  it('streams SSE events as ChatEvents in order', async () => {
    const { server, endpoint } = await startServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(sseFrame({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' }, '1'));
      res.write(sseFrame({ type: 'RUN_FINISHED', runId: 'r1' }, '2'));
      res.end();
    });
    activeServer = server;

    const transport = createAguiTransport({ endpoint });
    const generator = transport.connect({ threadId: 't1' })[Symbol.asyncIterator]();
    const first = await generator.next();
    const second = await generator.next();
    transport.dispose();

    expect(first.value).toEqual({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' });
    expect(second.value).toEqual({ type: 'RUN_FINISHED', runId: 'r1' });
  });

  it('reconnects with the last-seen frame id as resumeToken after a dropped connection', async () => {
    let connectionCount = 0;
    const seenResumeTokens: (string | null)[] = [];
    const { server, endpoint } = await startServer((req, res) => {
      connectionCount += 1;
      const url = new URL(req.url ?? '/', 'http://localhost');
      seenResumeTokens.push(url.searchParams.get('resumeToken'));
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      if (connectionCount === 1) {
        // Simulate a dropped connection: destroy the socket without a clean
        // end(), but only after the write is actually flushed to the wire —
        // destroying synchronously right after write() can race the buffered
        // write and drop the frame entirely.
        res.write(sseFrame({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' }, 'frame-1'), () => {
          res.destroy();
        });
      } else {
        res.write(sseFrame({ type: 'RUN_FINISHED', runId: 'r1' }, 'frame-2'));
        res.end();
      }
    });
    activeServer = server;

    const transport = createAguiTransport({ endpoint, backoff: { base: 5, max: 20, jitter: 0 } });
    const generator = transport.connect({ threadId: 't1' })[Symbol.asyncIterator]();
    const first = await generator.next();
    const second = await generator.next();
    transport.dispose();

    expect(first.value).toEqual({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' });
    expect(second.value).toEqual({ type: 'RUN_FINISHED', runId: 'r1' });
    expect(connectionCount).toBe(2);
    expect(seenResumeTokens).toEqual([null, 'frame-1']);
  });

  it('requests a fresh snapshot and substitutes it when a STATE_DELTA fails to apply', async () => {
    const { server, endpoint } = await startServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname.endsWith('/state')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ count: 99 }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(sseFrame({ type: 'STATE_SNAPSHOT', snapshot: { count: 1 } }, '1'));
      // This delta targets a path that doesn't exist in { count: 1 }, so it fails to apply.
      res.write(sseFrame({ type: 'STATE_DELTA', patch: [{ op: 'replace', path: '/missing', value: 2 }] }, '2'));
      res.end();
    });
    activeServer = server;

    const transport = createAguiTransport({ endpoint });
    const generator = transport.connect({ threadId: 't1' })[Symbol.asyncIterator]();
    const first = await generator.next();
    const second = await generator.next();
    transport.dispose();

    expect(first.value).toEqual({ type: 'STATE_SNAPSHOT', snapshot: { count: 1 } });
    // The broken STATE_DELTA is never yielded; a fresh STATE_SNAPSHOT from
    // GET /threads/:id/state is synthesized and yielded instead.
    expect(second.value).toEqual({ type: 'STATE_SNAPSHOT', snapshot: { count: 99 } });
  });

  it('stops without reconnecting once dispose() is called', async () => {
    let connectionCount = 0;
    const { server, endpoint } = await startServer((req, res) => {
      connectionCount += 1;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(sseFrame({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' }, '1'));
      // never end() — keep the connection open until the client aborts it
    });
    activeServer = server;

    const transport = createAguiTransport({ endpoint, backoff: { base: 5, max: 20, jitter: 0 } });
    const generator = transport.connect({ threadId: 't1' })[Symbol.asyncIterator]();
    await generator.next();
    transport.dispose();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(connectionCount).toBe(1);
  });
});

describe('createAguiTransport — sendRun', () => {
  it('POSTs to /runs with an Idempotency-Key header and the run input as JSON', async () => {
    let capturedBody: unknown;
    let capturedIdempotencyKey: string | undefined;
    const { server, endpoint } = await startServer((req, res) => {
      capturedIdempotencyKey = req.headers['idempotency-key'] as string | undefined;
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        capturedBody = JSON.parse(raw);
        res.writeHead(200);
        res.end();
      });
    });
    activeServer = server;

    const transport = createAguiTransport({ endpoint });
    await transport.sendRun({ threadId: 't1', runId: 'r1', messages: [], tools: [] });

    expect(capturedBody).toEqual({ threadId: 't1', runId: 'r1', messages: [], tools: [] });
    expect(capturedIdempotencyKey).toBeTruthy();
  });
});

describe('createAguiTransport — sendFrontendToolResult', () => {
  it('POSTs to /tool-results with the result as JSON', async () => {
    let capturedBody: unknown;
    const { server, endpoint } = await startServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        capturedBody = JSON.parse(raw);
        res.writeHead(200);
        res.end();
      });
    });
    activeServer = server;

    const transport = createAguiTransport({ endpoint });
    await transport.sendFrontendToolResult({ toolCallId: 'tc1', result: 'ok' });

    expect(capturedBody).toEqual({ toolCallId: 'tc1', result: 'ok' });
  });
});

describe('createAguiTransport — abortRun', () => {
  it('sends DELETE /runs/:runId', async () => {
    let capturedMethod: string | undefined;
    let capturedPath: string | undefined;
    const { server, endpoint } = await startServer((req, res) => {
      capturedMethod = req.method;
      capturedPath = req.url;
      res.writeHead(200);
      res.end();
    });
    activeServer = server;

    const transport = createAguiTransport({ endpoint });
    await transport.abortRun('r1');

    expect(capturedMethod).toBe('DELETE');
    expect(capturedPath).toBe('/runs/r1');
  });

  it('swallows errors when the server does not support cancellation', async () => {
    const { server, endpoint } = await startServer((req, res) => {
      res.writeHead(404);
      res.end();
    });
    activeServer = server;

    const transport = createAguiTransport({ endpoint });
    await expect(transport.abortRun('r1')).resolves.toBeUndefined();
  });
});

describe('createAguiTransport — getCapabilities', () => {
  it('GETs /capabilities and parses the JSON response', async () => {
    const capabilities = {
      transports: ['sse'],
      tools: ['search'],
      multimodal: false,
      reasoning: true,
      humanInTheLoop: true,
      sharedStateWritable: false,
    };
    const { server, endpoint } = await startServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(capabilities));
    });
    activeServer = server;

    const transport = createAguiTransport({ endpoint });
    const result = await transport.getCapabilities?.();

    expect(result).toEqual(capabilities);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run:
```bash
npx pnpm@9.0.0 --filter @chatkit/transport-agui exec vitest run src/agui-transport.test.ts
```
Expected: FAIL — `Cannot find module './agui-transport'`.

- [ ] **Step 3: Write `packages/transport-agui/src/agui-transport.ts` (SSE mode + control-plane calls)**

```ts
import { applyPatch } from '@chatkit/core';
import type { AgentCapabilities, ChatEvent, ChatTransport, RunAgentInput, ToolResult } from '@chatkit/core';
import { createSseFrameParser } from './sse-parser';
import { computeBackoffDelay, type BackoffOptions } from './backoff';
import { BoundedEventQueue } from './event-queue';

export interface AguiTransportOptions {
  /** Base URL, e.g. 'http://localhost:3000/api/agent'. Paths are appended: /threads/:id/events, /runs, /tool-results, /runs/:id, /capabilities, /threads/:id/state. */
  endpoint: string;
  fetchImpl?: typeof fetch;
  backoff?: BackoffOptions;
  /** Max reconnect attempts after a dropped connection. Default Infinity (keep retrying with backoff). */
  maxRetries?: number;
  /** BoundedEventQueue capacity for coalescing bursts parsed from a single chunk. Default 500. */
  queueCapacity?: number;
}

interface StateMirrorRef {
  value: unknown;
}

export function createAguiTransport(options: AguiTransportOptions): ChatTransport {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxRetries = options.maxRetries ?? Infinity;
  let disposed = false;
  let activeAbortController: AbortController | null = null;

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

    while (!disposed) {
      activeAbortController = new AbortController();
      const url = new URL(`${options.endpoint}/threads/${encodeURIComponent(session.threadId)}/events`);
      if (resumeToken) url.searchParams.set('resumeToken', resumeToken);

      let connectedOk = false;
      try {
        const response = await fetchImpl(url.toString(), { signal: activeAbortController.signal });
        if (!response.body) throw new Error('AG-UI SSE response has no body');
        connectedOk = true;
        attempt = 0;

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
      if (connectedOk) {
        continue; // clean server-initiated close — reconnect immediately, no backoff
      }

      attempt += 1;
      if (attempt > maxRetries) return;
      await new Promise((resolve) => setTimeout(resolve, computeBackoffDelay(attempt, options.backoff)));
    }
  }

  function connect(session: { threadId: string; resumeToken?: string }): AsyncIterable<ChatEvent> {
    return connectViaSse(session);
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
  }

  return { connect, sendRun, sendFrontendToolResult, abortRun, getCapabilities, dispose };
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run:
```bash
npx pnpm@9.0.0 --filter @chatkit/transport-agui exec vitest run src/agui-transport.test.ts
```
Expected: PASS — 9 tests.

- [ ] **Step 5: Close two coverage gaps found by review**

Two follow-up tests were added after the initial 9, closing real gaps a code-quality review found:

1. **STATE_DELTA success-path coverage.** All the STATE_DELTA-related assertions above only exercise the *failure* path (a delta that doesn't apply, triggering fresh-snapshot recovery) — nothing proved a delta that DOES apply gets forwarded unchanged. A broken implementation that always treats every delta as failed would still pass all 9 tests. Add this test to the `describe('createAguiTransport — connect', ...)` block, right after the "requests a fresh snapshot..." test:

```ts
  it('forwards a STATE_DELTA unchanged when it applies successfully', async () => {
    let stateEndpointHit = false;
    const { server, endpoint } = await startServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname.endsWith('/state')) {
        stateEndpointHit = true;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ count: -1 }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(sseFrame({ type: 'STATE_SNAPSHOT', snapshot: { count: 1 } }, '1'));
      // This delta targets a path that DOES exist in { count: 1 }, so it applies cleanly.
      res.write(sseFrame({ type: 'STATE_DELTA', patch: [{ op: 'replace', path: '/count', value: 2 }] }, '2'));
      res.end();
    });
    activeServer = server;

    const transport = createAguiTransport({ endpoint });
    const generator = transport.connect({ threadId: 't1' })[Symbol.asyncIterator]();
    const first = await generator.next();
    const second = await generator.next();
    transport.dispose();

    expect(first.value).toEqual({ type: 'STATE_SNAPSHOT', snapshot: { count: 1 } });
    // The delta applies cleanly, so it's forwarded exactly as received —
    // not synthesized into a STATE_SNAPSHOT, and /state is never called.
    expect(second.value).toEqual({ type: 'STATE_DELTA', patch: [{ op: 'replace', path: '/count', value: 2 }] });
    expect(stateEndpointHit).toBe(false);
  });
```

2. **Backoff must escalate across repeated near-instant failures, not reset every time.** This is what motivated the `minStableConnectionMs` option already included in Step 3's code above — without it, a connection that's accepted and then immediately drops, repeatedly, would reset to the base delay on every attempt and never back off further. Add this test to the same `describe` block:

```ts
  it('escalates backoff across repeated near-instant connection failures instead of resetting each time', async () => {
    const connectionTimestamps: number[] = [];
    let connectionCount = 0;
    const { server, endpoint } = await startServer((req, res) => {
      connectionCount += 1;
      connectionTimestamps.push(Date.now());
      if (connectionCount <= 2) {
        // Accept the connection, then drop it almost immediately — well
        // under minStableConnectionMs — to simulate a flapping connection.
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.destroy();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(sseFrame({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' }, '1'));
      res.end();
    });
    activeServer = server;

    const transport = createAguiTransport({
      endpoint,
      backoff: { base: 30, factor: 2, max: 1000, jitter: 0 },
      minStableConnectionMs: 10000, // effectively "never stable" for this fast test
    });
    const generator = transport.connect({ threadId: 't1' })[Symbol.asyncIterator]();
    await generator.next();
    transport.dispose();

    expect(connectionCount).toBe(3);
    const gap1 = connectionTimestamps[1] - connectionTimestamps[0];
    const gap2 = connectionTimestamps[2] - connectionTimestamps[1];
    // With correct escalation: gap1 ~= backoff(attempt=1) = 30ms, gap2 ~= backoff(attempt=2) = 60ms.
    // With the bug (reset every time): both gaps would be ~30ms. Assert gap2
    // is meaningfully larger than gap1 rather than asserting exact values,
    // to tolerate normal timer/CI scheduling slop.
    expect(gap2).toBeGreaterThan(gap1 * 1.4);
  }, 10000);
```

Run:
```bash
npx pnpm@9.0.0 --filter @chatkit/transport-agui exec vitest run src/agui-transport.test.ts
```
Expected: PASS — 11 tests. Run it 2-3 times in a row to check for flakiness (real timers, real sockets — if the `1.4` multiplier is ever borderline flaky in this environment, loosening it to `1.3` is acceptable, but don't drop the assertion's intent).

---

### Task 7: `createAguiTransport` — WebSocket mode

Extends the same file with `mode: 'websocket'`, reusing the shared `emitWithStateGuard`/backoff/queue logic. WebSocket delivers whole JSON messages (no incremental line-parsing needed, unlike SSE), so it uses the `push-pull-bridge` from Task 5 instead of a `ReadableStream` reader.

**Scope note:** unlike SSE mode, WebSocket mode in this version does **not** track a `resumeToken`/`id` for reconnection — there's no equivalent envelope-id convention defined for WS messages here, so a WS reconnect always starts fresh and relies on the server sending a `MESSAGES_SNAPSHOT`/`STATE_SNAPSHOT` on the new connection. This is a deliberate, documented scope boundary, not an oversight — extending WS with resumeToken support is a reasonable follow-up once a wire convention for it is needed.

**Files:**
- Create: `packages/transport-agui/src/agui-transport-websocket.test.ts`
- Modify: `packages/transport-agui/src/agui-transport.ts`

- [ ] **Step 1: Write the failing tests — `packages/transport-agui/src/agui-transport-websocket.test.ts`**

```ts
import { WebSocketServer, WebSocket as NodeWebSocket } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { createAguiTransport } from './agui-transport';

async function startWsServer(onConnection: (ws: import('ws').WebSocket) => void): Promise<{ wss: WebSocketServer; endpoint: string }> {
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise<void>((resolve) => wss.once('listening', resolve));
  wss.on('connection', onConnection);
  const address = wss.address();
  if (address === null || typeof address === 'string') throw new Error('expected an AddressInfo');
  return { wss, endpoint: `http://127.0.0.1:${address.port}` };
}

let activeWss: WebSocketServer | undefined;

afterEach(async () => {
  if (activeWss) {
    for (const client of activeWss.clients) client.terminate();
    await new Promise<void>((resolve) => activeWss!.close(() => resolve()));
    activeWss = undefined;
  }
});

describe('createAguiTransport — websocket mode', () => {
  it('streams JSON messages as ChatEvents in order', async () => {
    const { wss, endpoint } = await startWsServer((ws) => {
      ws.send(JSON.stringify({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' }));
      ws.send(JSON.stringify({ type: 'RUN_FINISHED', runId: 'r1' }));
    });
    activeWss = wss;

    const transport = createAguiTransport({ endpoint, mode: 'websocket', WebSocketImpl: NodeWebSocket as unknown as typeof WebSocket });
    const iterator = transport.connect({ threadId: 't1' })[Symbol.asyncIterator]();
    const first = await iterator.next();
    const second = await iterator.next();
    transport.dispose();

    expect(first.value).toEqual({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' });
    expect(second.value).toEqual({ type: 'RUN_FINISHED', runId: 'r1' });
  });

  it('reconnects with backoff after the socket closes unexpectedly', async () => {
    let connectionCount = 0;
    const { wss, endpoint } = await startWsServer((ws) => {
      connectionCount += 1;
      if (connectionCount === 1) {
        ws.send(JSON.stringify({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' }));
        setTimeout(() => ws.terminate(), 10); // simulate an abrupt drop, not a clean close
      } else {
        ws.send(JSON.stringify({ type: 'RUN_FINISHED', runId: 'r1' }));
      }
    });
    activeWss = wss;

    const transport = createAguiTransport({
      endpoint,
      mode: 'websocket',
      WebSocketImpl: NodeWebSocket as unknown as typeof WebSocket,
      backoff: { base: 5, max: 20, jitter: 0 },
    });
    const iterator = transport.connect({ threadId: 't1' })[Symbol.asyncIterator]();
    const first = await iterator.next();
    const second = await iterator.next();
    transport.dispose();

    expect(first.value).toEqual({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' });
    expect(second.value).toEqual({ type: 'RUN_FINISHED', runId: 'r1' });
    expect(connectionCount).toBe(2);
  });

  it('requests a fresh snapshot when a STATE_DELTA fails to apply', async () => {
    // WebSocket mode still recovers state via plain HTTP GET /threads/:id/state
    // (only the event stream itself differs by mode), so this test attaches
    // the WebSocketServer to a real http.Server that also answers that route
    // — both share one origin, matching how a real AG-UI server would.
    const { createServer } = await import('node:http');
    const httpServer = createServer((req, res) => {
      if (req.url?.endsWith('/state')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ count: 99 }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    const wss = new WebSocketServer({ server: httpServer });
    wss.on('connection', (ws) => {
      ws.send(JSON.stringify({ type: 'STATE_SNAPSHOT', snapshot: { count: 1 } }));
      ws.send(JSON.stringify({ type: 'STATE_DELTA', patch: [{ op: 'replace', path: '/missing', value: 2 }] }));
    });
    activeWss = wss;
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const address = httpServer.address();
    if (address === null || typeof address === 'string') throw new Error('bad address');
    const endpoint = `http://127.0.0.1:${address.port}`;

    const transport = createAguiTransport({ endpoint, mode: 'websocket', WebSocketImpl: NodeWebSocket as unknown as typeof WebSocket });
    const iterator = transport.connect({ threadId: 't1' })[Symbol.asyncIterator]();
    const first = await iterator.next();
    const second = await iterator.next();
    transport.dispose();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));

    expect(first.value).toEqual({ type: 'STATE_SNAPSHOT', snapshot: { count: 1 } });
    expect(second.value).toEqual({ type: 'STATE_SNAPSHOT', snapshot: { count: 99 } });
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run:
```bash
npx pnpm@9.0.0 --filter @chatkit/transport-agui exec vitest run src/agui-transport-websocket.test.ts
```
Expected: FAIL — `createAguiTransport` doesn't accept a `mode`/`WebSocketImpl` option yet, and `connect()` never opens a WebSocket, so nothing is ever yielded and the test times out waiting on `iterator.next()`. (If you hit this timeout while implementing Step 3, don't just wait it out — that's expected until the WebSocket path exists.)

- [ ] **Step 3: Extend `packages/transport-agui/src/agui-transport.ts` with WebSocket mode**

Full file content after this step (replace the entire file with this):

```ts
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
  /** BoundedEventQueue capacity for coalescing bursts parsed from a single chunk/message batch. Default 500. */
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
        // wasClean reflects whether the WebSocket closing handshake
        // completed (true for a graceful close INCLUDING non-1000 codes like
        // a server-sent error close, false for terminate()/network
        // drops/crashes with no handshake). An unclean close must make
        // iterate() throw so the `catch { streamFailed = true }` below is
        // reachable — otherwise backoff never escalates on a real drop.
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
```

> **Note on this step:** by the time you execute this task, `packages/transport-agui/src/agui-transport.ts` already exists from Task 6 and already contains the `minStableConnectionMs`/stability-check fix in `connectViaSse` shown above (a code-quality review during Task 6 caught that resetting the backoff counter immediately on every successful connection — before it's even proven stable — lets a "flapping" connection (accepts, then drops instantly, repeatedly) hammer the server at a constant minimal interval forever instead of escalating). **Do not remove or simplify that fix when replacing the file with the content above** — the block above already includes it plus the new WebSocket mode with the equivalent fix applied. If Task 6's actual file on disk differs from this block in ways beyond adding WebSocket support, treat the disk version's `connectViaSse` as authoritative and only add the WebSocket portions.

- [ ] **Step 4: Run the tests and confirm they pass**

Run:
```bash
npx pnpm@9.0.0 --filter @chatkit/transport-agui exec vitest run src/agui-transport-websocket.test.ts
```
Expected: PASS — 3 tests.

- [ ] **Step 5: Re-run the SSE-mode tests to confirm the refactor didn't regress them**

Run:
```bash
npx pnpm@9.0.0 --filter @chatkit/transport-agui exec vitest run src/agui-transport.test.ts
```
Expected: PASS — still 11 tests (Task 6 ends with 11, not 9 — see Task 6 Step 5).

- [ ] **Step 6: Fix a real backoff bug found by review, and add a regression test**

A code-quality review of Step 3's code found that the WebSocket `close` listener as written above —

```ts
      ws.addEventListener('close', () => bridge.close());
```

— calls `bridge.close()` with no error for EVERY close, clean or abrupt. Per `push-pull-bridge.ts`, that makes `iterate()` return (not throw), so the `catch { streamFailed = true }` in `connectViaWebSocket`'s read loop is never reached for a real socket drop — `streamFailed` stays `false` forever, and the code always takes the "clean close, reconnect immediately, no backoff" path. The `minStableConnectionMs` stability-check logic is syntactically present but **unreachable**: backoff never actually escalates for WebSocket disconnects, no matter how many times the socket drops abruptly in a row. This was confirmed experimentally — reconnect gaps came out at ~4ms regardless of configured backoff settings.

The fix uses the WebSocket `CloseEvent`'s `wasClean` field (verified against `ws@8.18.0`: `ws.terminate()` → `{wasClean: false, code: 1006}`; `ws.close(code, reason)` for any code, including non-1000 error codes → `{wasClean: true}` — `wasClean` reflects whether the closing *handshake* completed, not application-level success). Replace the listener with:

```ts
      ws.addEventListener('close', (ev: CloseEvent) => {
        // wasClean reflects whether the WebSocket closing handshake
        // completed (true for a graceful close INCLUDING non-1000 codes like
        // a server-sent error close, false for terminate()/network
        // drops/crashes with no handshake). An unclean close must make
        // iterate() throw so the `catch { streamFailed = true }` below is
        // reachable — otherwise backoff never escalates on a real drop.
        bridge.close(ev.wasClean ? undefined : new Error(`WebSocket closed abnormally (code ${ev.code})`));
      });
```

This is the only change to `agui-transport.ts` in this step — the version shown in Step 3 above already has this fix folded in, so if you're implementing fresh from this plan you already have it; this step exists to explain WHY that line looks the way it does, and to add the regression test below (the original 3-test file in Step 1 has no test that would have caught this — it only checks that messages eventually arrive across reconnects, never that backoff timing actually happens).

Add this test to `packages/transport-agui/src/agui-transport-websocket.test.ts`, inside the `describe('createAguiTransport — websocket mode', ...)` block, alongside (not replacing) the existing "reconnects with backoff after the socket closes unexpectedly" test:

```ts
  it('escalates backoff across repeated abrupt socket drops instead of resetting each time', async () => {
    const connectionTimestamps: number[] = [];
    let connectionCount = 0;
    const { wss, endpoint } = await startWsServer((ws) => {
      connectionCount += 1;
      connectionTimestamps.push(Date.now());
      if (connectionCount <= 2) {
        ws.terminate(); // abrupt drop, not a clean close
        return;
      }
      ws.send(JSON.stringify({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' }));
    });
    activeWss = wss;

    const transport = createAguiTransport({
      endpoint,
      mode: 'websocket',
      WebSocketImpl: NodeWebSocket as unknown as typeof WebSocket,
      backoff: { base: 40, factor: 3, max: 1000, jitter: 0 },
      minStableConnectionMs: 10000, // effectively "never stable" for this fast test
    });
    const iterator = transport.connect({ threadId: 't1' })[Symbol.asyncIterator]();
    await iterator.next();
    transport.dispose();

    expect(connectionCount).toBe(3);
    const gap1 = connectionTimestamps[1] - connectionTimestamps[0];
    const gap2 = connectionTimestamps[2] - connectionTimestamps[1];
    expect(gap2).toBeGreaterThan(gap1 * 1.4);
  }, 10000);
```

Run:
```bash
npx pnpm@9.0.0 --filter @chatkit/transport-agui exec vitest run src/agui-transport-websocket.test.ts
```
Expected: PASS — 4 tests. (If you want to confirm this test actually catches the bug it's guarding against, temporarily reverting the `close` listener to the one-liner from Step 3's "before" version should make this test fail with both gaps near-equal at a few ms; re-apply the fix afterward.)

Then re-run the full package suite:
```bash
npx pnpm@9.0.0 --filter @chatkit/transport-agui exec vitest run
npx pnpm@9.0.0 --filter @chatkit/transport-agui exec tsc --noEmit
```
Expected: PASS — 6 test files, 44 tests, zero type errors.

---

### Task 8: Barrel export and full package verification

**Files:**
- Create: `packages/transport-agui/src/index.ts`

- [ ] **Step 1: Write `packages/transport-agui/src/index.ts`**

```ts
export { createAguiTransport } from './agui-transport';
export type { AguiTransportOptions } from './agui-transport';
export { createSseFrameParser } from './sse-parser';
export type { SseFrame, SseFrameParser } from './sse-parser';
export { computeBackoffDelay } from './backoff';
export type { BackoffOptions } from './backoff';
export { BoundedEventQueue } from './event-queue';
export { createPushPullBridge } from './push-pull-bridge';
export type { PushPullBridge } from './push-pull-bridge';
```

- [ ] **Step 2: Run the full test suite**

Run:
```bash
npx pnpm@9.0.0 --filter @chatkit/transport-agui exec vitest run
```
Expected: PASS — 6 test files, 44 tests (9 sse-parser + 7 backoff + 8 event-queue + 5 push-pull-bridge + 11 agui-transport (SSE — 9 original plus the two coverage-gap tests added in Task 6 Step 5) + 4 agui-transport-websocket — 3 original plus the backoff-escalation regression test added in Task 7 Step 6).

- [ ] **Step 3: Typecheck the whole package**

Run:
```bash
npx pnpm@9.0.0 --filter @chatkit/transport-agui exec tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Build the package**

Run:
```bash
npx pnpm@9.0.0 --filter @chatkit/transport-agui build
```
Expected: succeeds, producing `packages/transport-agui/dist/index.js` and `packages/transport-agui/dist/index.d.ts`.

- [ ] **Step 5: Confirm `@chatkit/core` still builds and tests clean too**

This package imports types and `applyPatch` from `@chatkit/core`; confirm the dependency direction hasn't introduced any issue on the core side:
```bash
npx pnpm@9.0.0 --filter @chatkit/core exec vitest run
npx pnpm@9.0.0 --filter @chatkit/core exec tsc --noEmit
```
Expected: PASS — 33 tests, no errors (unchanged from M0).

- [ ] **Step 6: Update the milestone checklist in the root README**

In [README.md](../../../README.md), change:
```markdown
- [ ] M1 — AG-UI transport (SSE + WebSocket, reconnect/backoff, run lifecycle)
```
to:
```markdown
- [x] M1 — AG-UI transport (SSE + WebSocket, reconnect/backoff, run lifecycle)
```

- [ ] **Step 7: Mark the milestone complete**

No git commit — per repo owner preference, commits are handled manually. This is the natural stopping point for M1; M2 (Svelte bindings + minimal UI) is a separate plan.

---

## Notes for the next plan (M2)

- M2 builds `@chatkit/svelte`'s `createChatStore` (spec §7), which is the first consumer of `createAguiTransport` alongside `@chatkit/core`'s `reduceEvent`/`createPluginHost`. It should also exercise `createFixtureTransport` from M0 for tests that don't need a real server.
- The "AG-UI protocol version compatibility" note from spec §20 ("tracked explicitly in `transport-agui`'s README") hasn't been written yet — worth adding a short README to `packages/transport-agui` documenting the wire conventions this plan established (paths, Idempotency-Key, resumeToken semantics, WebSocket's current no-resumeToken scope boundary) once M2 or M7 (Vercel AI SDK adapter) puts pressure on formalizing it.
- WebSocket mode's lack of resumeToken support (Task 7's scope note) is the most likely thing a real backend integration will need extended — if that need materializes, it likely wants a small envelope convention (`{ id, event }` per WS message) mirroring SSE's `id:` field, plumbed through the same `push-pull-bridge`.
