# M7 — Second Transport Adapter + Devtools Fixture Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Git note:** commit steps are intentionally omitted — the repo owner handles git operations manually. Do not run `git add`/`git commit` while executing this plan unless explicitly asked to in the moment.

**Goal:** Close out spec §22 M7 — the final milestone — *"Second transport adapter (Vercel AI SDK) to prove the abstraction holds; devtools fixture export."* Also closes two items M5/M6 explicitly deferred to "whichever milestone builds this next": `plugin-devtools` not existing yet (M6's CLI dropped the `devtools` plugin checkbox because of this), and the CLI's transport-choice prompt (M6 offered AG-UI only, since Vercel AI SDK transport didn't exist yet).

---

## Design decisions

**1. Target protocol version: the classic "Data Stream Protocol" (type-prefixed lines), not the newer "UI Message Stream Protocol."** The Vercel AI SDK's wire format has changed across major versions (a single-character-prefix line format in `ai` v3/v4, an SSE-based JSON-chunk format with a `type` field in v5's UI Message Stream). Spec §2/§3.1 both say "Vercel AI SDK **data stream protocol**" by name — the older, still-widely-documented format — so that's what this plan targets. This is a version-pinning decision like M5's markdown-vs-richtext split: real, complete, tested for the format it targets, explicitly not attempting to also support the newer format.

**2. Format reference (documented here since there's no spec appendix for it).** Each stream chunk is one line, `TYPE_ID:JSON_VALUE\n`:

| Prefix | Meaning | Payload |
|---|---|---|
| `0` | Text delta | `"text chunk"` |
| `3` | Error | `"error message"` |
| `9` | Complete tool call | `{"toolCallId","toolName","args"}` |
| `b` | Tool call streaming start | `{"toolCallId","toolName"}` |
| `c` | Tool call args delta | `{"toolCallId","argsTextDelta"}` |
| `a` | Tool result | `{"toolCallId","result"}` |
| `d` | Finish message | `{"finishReason","usage"}` |

Other prefixes from the full spec (`1`,`2`,`8`,`e`,`f`,`g`,`h`,`i`,`j`,`k` — data parts, annotations, step boundaries, reasoning, sources, files) are parsed-but-ignored (unrecognized prefixes are skipped, not thrown on — forward-compatible, same "unknown CUSTOM event → no-op" posture the reducer already takes for AG-UI).

**3. `ChatTransport.connect()`/`sendRun()` don't map onto the Vercel AI SDK's request model as separate concepts — bridged with a tiny local push-pull queue.** AG-UI has a persistent server-push event stream (`connect()`) decoupled from POSTing a run (`sendRun()`). The Vercel AI SDK's actual client/server contract is one-fetch-per-turn: POST the full message history, the streamed response *is* that turn's reply. To fit `ChatTransport`'s shape (where `connect()` must return an iterable immediately, before any `sendRun()` call), this transport keeps one small internal async queue for the store's whole lifetime; `connect()` returns its iterable, and each `sendRun()` call performs its own fetch and pushes the parsed events from that fetch's response into the same queue. `transport-agui`'s `push-pull-bridge.ts` already does exactly this, but it's an internal module, not exported from `@chatkit-svelte/transport-agui`'s public API — reimplemented locally here (~20 lines) rather than adding a cross-transport-package dependency two independently-installable transport packages shouldn't need on each other.

**4. Outbound message mapping is text-only.** `RunAgentInput.messages` (chatkit's `Message[]`, with `ContentPart[]` parts) has no one-to-one mapping onto the Vercel AI SDK's message schema for images/files/tool-calls without picking a specific SDK version's exact schema (which, per decision 1, isn't the target here). `toVercelMessages()` maps each chatkit message to `{ role, content }`, where `content` is the concatenation of that message's `text` parts. Non-text parts are dropped from the outbound request. This is enough to prove the transport abstraction holds for real text conversations (the milestone's stated purpose) without taking on full multi-modal protocol parity as unstated scope.

**5. `sendFrontendToolResult` is a documented no-op for this transport.** Vercel AI SDK backends conventionally receive a tool's result as part of the *next* full-history POST (a `tool`-role message), not through a separate side channel — there's no standard "deliver this tool result now" endpoint the way this framework's own `transport-agui` has `/tool-results`. Since decision 4 already doesn't map tool-call content into outbound messages, wiring a result-delivery mechanism that the next request wouldn't even carry forward would be dead code. Documented rather than silently stubbed.

**6. `plugin-devtools` doesn't get a new plugin-host extension point — it's a standalone, manually-mounted component, not auto-wired into `<ChatWindow>`.** Every other themed panel this session added (`ApprovalBar`, `ArtifactPanel`) was auto-wired into `ChatWindow` because it's part of the *end-user* chat experience. Devtools is a *developer* tool, opt-in by nature (the CLI's own prompt defaults it to unchecked) — a consumer decides where and whether to render it, typically behind a debug flag. `devtoolsPlugin()` returns a `ChatPlugin` (so it slots into `config.plugins` like any other plugin) with an attached `log` property (extra field on the returned object — structurally still a valid `ChatPlugin`, no core contract change needed); `<DevtoolsOverlay log={devtools.log} />` is rendered wherever the consuming app chooses.

**7. "Reducer state diffs" (spec §13.4) is scoped down to a live current-state panel, not true per-event before/after diffing.** `ChatPluginHooks.onEvent` fires *before* the reducer applies its event (chat-store calls the hook, then `applyEvent`) — so `ctx.getState()` inside `onEvent` only ever gives the *pre*-event state; there's no `afterEvent` hook to capture the post-event snapshot. Building one is a real, reasonable extension but is its own small design decision belonging to a future pass, not implied by "prove the transport abstraction holds." `<DevtoolsOverlay>` instead shows the event log (the spec-emphasized, fully-real deliverable — "closes the loop between a bug seen in the playground and a regression test") plus the store's live current state via `getChatContext()`, reactively up to date, which covers the same debugging need without the extra hook-contract work.

**8. CLI catch-up (closing M5's and M6's own "notes for next plan" items).** `create-chatkit`'s transport prompt goes from "always AG-UI" to a real choice between `agui` and `vercel-ai`; `devtools` rejoins the plugin checklist (unchecked by default, matching spec §21's own "all default-checked except devtools"). No SvelteKit option yet — still nothing in this repo scaffolds SvelteKit routing conventions, so that stays deferred with no milestone left to revisit it in (noted as a permanent, not just temporary, scope boundary now that M7 is the last planned milestone).

---

## File Structure

```
packages/transport-vercel-ai/
  package.json, tsconfig.json, vite.config.ts                      # Task 1
  src/data-stream-parser.ts, data-stream-parser.test.ts             # Task 1
  src/bridge.ts                                                     # Task 1
  src/to-vercel-messages.ts, to-vercel-messages.test.ts             # Task 1
  src/vercel-ai-transport.ts, vercel-ai-transport.test.ts           # Task 1
  src/index.ts                                                      # Task 1
packages/plugin-devtools/
  package.json, tsconfig.json, vite.config.ts, vitest-setup.ts      # Task 2
  src/log.svelte.ts, log.test.ts                                    # Task 2
  src/export-fixture.ts, export-fixture.test.ts                     # Task 2
  src/DevtoolsOverlay.svelte, DevtoolsOverlay.test.ts, TestHarness.svelte # Task 2
  src/index.ts                                                      # Task 2
packages/cli/src/generate-project.ts, generate-project.test.ts, index.ts, prompts.ts # Task 3
docs/superpowers/plans/2026-08-23-m6-theming-persistence-a11y-cli.md # Task 3 — close out notes
```

---

### Task 1: `@chatkit-svelte/transport-vercel-ai`

- [x] **Step 1: Build config**

`packages/transport-vercel-ai/package.json` (adds the missing `vitest`-adjacent nothing — this package is pure TS, no Svelte, same shape as `@chatkit-svelte/core`/`@chatkit-svelte/transport-agui`; the scaffold already has the right dependencies, only `vite.config.ts`/`tsconfig.json` are missing):

```json
{
  "name": "@chatkit-svelte/transport-vercel-ai",
  "version": "0.0.0",
  "description": "Adapter for the Vercel AI SDK data stream protocol, normalized into ChatEvent. Proves the transport abstraction holds (M7).",
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
    "@chatkit-svelte/core": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vite": "^5.4.0",
    "vite-plugin-dts": "^4.0.0",
    "vitest": "^2.0.0"
  }
}
```

`packages/transport-vercel-ai/tsconfig.json`:
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

`packages/transport-vercel-ai/vite.config.ts` (no `jsdom`/Svelte — pure Node-testable TS, same pattern as `@chatkit-svelte/core`):
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
    rollupOptions: {
      external: ['@chatkit-svelte/core'],
    },
  },
  test: {
    environment: 'node',
  },
});
```

```bash
npx pnpm@9.0.0 install
```

- [x] **Step 2: Write the failing tests — `packages/transport-vercel-ai/src/data-stream-parser.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { createDataStreamParser } from './data-stream-parser';

describe('createDataStreamParser', () => {
  it('parses a complete text delta line into a typed part', () => {
    const parser = createDataStreamParser();
    const parts = parser.push('0:"hello"\n');
    expect(parts).toEqual([{ prefix: '0', value: 'hello' }]);
  });

  it('parses multiple lines arriving in one chunk', () => {
    const parser = createDataStreamParser();
    const parts = parser.push('0:"hi"\n0:" there"\n');
    expect(parts).toEqual([
      { prefix: '0', value: 'hi' },
      { prefix: '0', value: ' there' },
    ]);
  });

  it('buffers a line split across two chunks and only yields it once complete', () => {
    const parser = createDataStreamParser();
    expect(parser.push('0:"par')).toEqual([]);
    expect(parser.push('tial"\n')).toEqual([{ prefix: '0', value: 'partial' }]);
  });

  it('parses object-payload prefixes (tool call parts)', () => {
    const parser = createDataStreamParser();
    const parts = parser.push('9:{"toolCallId":"tc1","toolName":"search","args":{"q":"x"}}\n');
    expect(parts).toEqual([{ prefix: '9', value: { toolCallId: 'tc1', toolName: 'search', args: { q: 'x' } } }]);
  });

  it('skips a malformed line instead of throwing', () => {
    const parser = createDataStreamParser();
    expect(() => parser.push('not a valid line\n')).not.toThrow();
    expect(parser.push('not a valid line\n')).toEqual([]);
  });

  it('skips an unrecognized-but-well-formed prefix without throwing', () => {
    const parser = createDataStreamParser();
    expect(parser.push('z:"unknown prefix"\n')).toEqual([]);
  });
});
```

- [x] **Step 3: Run and confirm failure**

```bash
npx pnpm@9.0.0 --filter @chatkit-svelte/transport-vercel-ai exec vitest run src/data-stream-parser.test.ts
```
Expected: FAIL — module missing.

- [x] **Step 4: Write `packages/transport-vercel-ai/src/data-stream-parser.ts`**

```ts
export type DataStreamPart =
  | { prefix: '0'; value: string }
  | { prefix: '3'; value: string }
  | { prefix: '9'; value: { toolCallId: string; toolName: string; args: unknown } }
  | { prefix: 'b'; value: { toolCallId: string; toolName: string } }
  | { prefix: 'c'; value: { toolCallId: string; argsTextDelta: string } }
  | { prefix: 'a'; value: { toolCallId: string; result: unknown } }
  | { prefix: 'd'; value: { finishReason: string; usage?: unknown } };

const KNOWN_PREFIXES = new Set(['0', '3', '9', 'b', 'c', 'a', 'd']);

export interface DataStreamParser {
  push(chunk: string): DataStreamPart[];
}

export function createDataStreamParser(): DataStreamParser {
  let buffer = '';

  return {
    push(chunk: string): DataStreamPart[] {
      buffer += chunk;
      const parts: DataStreamPart[] = [];
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        const colonIndex = line.indexOf(':');
        if (colonIndex === -1) continue;
        const prefix = line.slice(0, colonIndex);
        if (!KNOWN_PREFIXES.has(prefix)) continue;
        try {
          const value = JSON.parse(line.slice(colonIndex + 1));
          parts.push({ prefix, value } as DataStreamPart);
        } catch {
          continue;
        }
      }
      return parts;
    },
  };
}
```

- [x] **Step 5: Run and confirm pass**

```bash
npx pnpm@9.0.0 --filter @chatkit-svelte/transport-vercel-ai exec vitest run src/data-stream-parser.test.ts
```
Expected: PASS — 6 tests.

- [x] **Step 6: Write `packages/transport-vercel-ai/src/bridge.ts`** (the local push-pull queue from decision 3)

```ts
export interface Bridge<T> {
  push(value: T): void;
  close(error?: Error): void;
  iterate(): AsyncIterable<T>;
}

export function createBridge<T>(): Bridge<T> {
  const queue: T[] = [];
  const waiters: Array<(result: IteratorResult<T>) => void> = [];
  let closed = false;
  let closeError: Error | undefined;

  function push(value: T): void {
    const waiter = waiters.shift();
    if (waiter) {
      waiter({ value, done: false });
    } else {
      queue.push(value);
    }
  }

  function close(error?: Error): void {
    closed = true;
    closeError = error;
    while (waiters.length > 0) {
      waiters.shift()!({ value: undefined, done: true });
    }
  }

  function iterate(): AsyncIterable<T> {
    return {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<T>> {
            if (queue.length > 0) return { value: queue.shift()!, done: false };
            if (closed) {
              if (closeError) throw closeError;
              return { value: undefined, done: true };
            }
            return new Promise<IteratorResult<T>>((resolve) => waiters.push(resolve));
          },
        };
      },
    };
  }

  return { push, close, iterate };
}
```

- [x] **Step 7: Write the failing tests — `packages/transport-vercel-ai/src/to-vercel-messages.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { toVercelMessages } from './to-vercel-messages';
import type { Message } from '@chatkit-svelte/core';

describe('toVercelMessages', () => {
  it('concatenates text parts into a single content string per message', () => {
    const messages: Message[] = [
      {
        id: 'm1',
        role: 'user',
        parts: [{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'world' }],
        createdAt: 0,
        streaming: false,
      },
    ];
    expect(toVercelMessages(messages)).toEqual([{ role: 'user', content: 'Hello world' }]);
  });

  it('drops non-text parts and still includes the message with just its text content', () => {
    const messages: Message[] = [
      {
        id: 'm1',
        role: 'user',
        parts: [{ type: 'text', text: 'see attached' }, { type: 'file', url: 'x', name: 'y', mimeType: 'text/plain' }],
        createdAt: 0,
        streaming: false,
      },
    ];
    expect(toVercelMessages(messages)).toEqual([{ role: 'user', content: 'see attached' }]);
  });

  it('maps an empty-text message to an empty content string rather than omitting it', () => {
    const messages: Message[] = [
      { id: 'm1', role: 'user', parts: [{ type: 'file', url: 'x', name: 'y', mimeType: 'text/plain' }], createdAt: 0, streaming: false },
    ];
    expect(toVercelMessages(messages)).toEqual([{ role: 'user', content: '' }]);
  });
});
```

- [x] **Step 8: Run and confirm failure, then write `packages/transport-vercel-ai/src/to-vercel-messages.ts`**

```bash
npx pnpm@9.0.0 --filter @chatkit-svelte/transport-vercel-ai exec vitest run src/to-vercel-messages.test.ts
```
Expected: FAIL — module missing.

```ts
import type { Message } from '@chatkit-svelte/core';

export interface VercelMessage {
  role: string;
  content: string;
}

export function toVercelMessages(messages: Message[]): VercelMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.parts
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join(''),
  }));
}
```

Run and confirm pass — 3 tests.

- [x] **Step 9: Write the failing tests — `packages/transport-vercel-ai/src/vercel-ai-transport.test.ts`** (real HTTP server, same style `transport-agui`'s tests use)

```ts
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createVercelAiTransport } from './vercel-ai-transport';

async function startServer(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<{ server: Server; endpoint: string }> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('expected an AddressInfo');
  return { server, endpoint: `http://127.0.0.1:${address.port}` };
}

let activeServer: Server | undefined;

afterEach(async () => {
  if (activeServer) {
    activeServer.closeAllConnections();
    await new Promise<void>((resolve) => activeServer!.close(() => resolve()));
    activeServer = undefined;
  }
});

function baseInput(overrides: Partial<Parameters<ReturnType<typeof createVercelAiTransport>['sendRun']>[0]> = {}) {
  return { threadId: 't1', runId: 'r1', messages: [], tools: [], ...overrides };
}

describe('createVercelAiTransport', () => {
  it('streams a text reply as RUN_STARTED, TEXT_MESSAGE_*, RUN_FINISHED', async () => {
    const { server, endpoint } = await startServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.write('0:"Hello"\n');
      res.write('0:", world"\n');
      res.write('d:{"finishReason":"stop"}\n');
      res.end();
    });
    activeServer = server;

    const transport = createVercelAiTransport({ endpoint });
    const events: unknown[] = [];
    const iterator = transport.connect({ threadId: 't1' })[Symbol.asyncIterator]();
    const collectPromise = (async () => {
      for (let i = 0; i < 5; i++) events.push((await iterator.next()).value);
    })();

    await transport.sendRun(baseInput());
    await collectPromise;
    transport.dispose();

    expect(events[0]).toMatchObject({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' });
    expect(events[1]).toMatchObject({ type: 'TEXT_MESSAGE_START', role: 'assistant' });
    expect(events[2]).toMatchObject({ type: 'TEXT_MESSAGE_CONTENT', delta: 'Hello' });
    expect(events[3]).toMatchObject({ type: 'TEXT_MESSAGE_CONTENT', delta: ', world' });
    expect(events[4]).toMatchObject({ type: 'TEXT_MESSAGE_END' });
  });

  it('emits RUN_ERROR on a server error part instead of throwing out of sendRun', async () => {
    const { server, endpoint } = await startServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.write('3:"something broke"\n');
      res.end();
    });
    activeServer = server;

    const transport = createVercelAiTransport({ endpoint });
    const iterator = transport.connect({ threadId: 't1' })[Symbol.asyncIterator]();
    const first = iterator.next();

    await transport.sendRun(baseInput());
    const event = (await first).value;
    transport.dispose();

    expect(event).toMatchObject({ type: 'RUN_ERROR', runId: 'r1' });
    expect((event as { error: { message: string } }).error.message).toContain('something broke');
  });

  it('maps complete tool call parts to TOOL_CALL_START/ARGS/END', async () => {
    const { server, endpoint } = await startServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.write('9:{"toolCallId":"tc1","toolName":"search","args":{"q":"x"}}\n');
      res.write('d:{"finishReason":"tool-calls"}\n');
      res.end();
    });
    activeServer = server;

    const transport = createVercelAiTransport({ endpoint });
    const events: unknown[] = [];
    const iterator = transport.connect({ threadId: 't1' })[Symbol.asyncIterator]();
    const collectPromise = (async () => {
      for (let i = 0; i < 4; i++) events.push((await iterator.next()).value);
    })();

    await transport.sendRun(baseInput());
    await collectPromise;
    transport.dispose();

    expect(events[1]).toMatchObject({ type: 'TOOL_CALL_START', toolCallId: 'tc1', toolName: 'search' });
    expect(events[2]).toMatchObject({ type: 'TOOL_CALL_ARGS', toolCallId: 'tc1' });
    expect(events[3]).toMatchObject({ type: 'TOOL_CALL_END', toolCallId: 'tc1' });
  });

  it('POSTs a text-only mapping of the message history to the endpoint', async () => {
    let receivedBody: unknown;
    const { server, endpoint } = await startServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        receivedBody = JSON.parse(body);
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('d:{"finishReason":"stop"}\n');
      });
    });
    activeServer = server;

    const transport = createVercelAiTransport({ endpoint });
    const iterator = transport.connect({ threadId: 't1' })[Symbol.asyncIterator]();
    const drain = iterator.next();

    await transport.sendRun(
      baseInput({
        messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }], createdAt: 0, streaming: false }],
      })
    );
    await drain;
    transport.dispose();

    expect(receivedBody).toEqual({ messages: [{ role: 'user', content: 'hi' }] });
  });

  it('abortRun aborts the in-flight fetch', async () => {
    const { server, endpoint } = await startServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      // Never ends on its own — the test drives the abort.
    });
    activeServer = server;

    const transport = createVercelAiTransport({ endpoint });
    transport.connect({ threadId: 't1' });
    const runPromise = transport.sendRun(baseInput());
    await transport.abortRun('r1');
    await runPromise;
    transport.dispose();
    // No assertion beyond "this resolves and doesn't hang" — an aborted
    // fetch rejects internally and sendRun's own catch handles it.
  });

  it('sendFrontendToolResult resolves without making a request (documented no-op — see plan decision 5)', async () => {
    const transport = createVercelAiTransport({ endpoint: 'http://127.0.0.1:1' });
    await expect(transport.sendFrontendToolResult({ toolCallId: 'tc1', result: {} })).resolves.toBeUndefined();
    transport.dispose();
  });
});
```

- [x] **Step 10: Run and confirm failure**

```bash
npx pnpm@9.0.0 --filter @chatkit-svelte/transport-vercel-ai exec vitest run src/vercel-ai-transport.test.ts
```
Expected: FAIL — module missing.

- [x] **Step 11: Write `packages/transport-vercel-ai/src/vercel-ai-transport.ts`**

```ts
import type { AgentCapabilities, ChatEvent, ChatTransport, RunAgentInput, ToolResult } from '@chatkit-svelte/core';
import { createDataStreamParser, type DataStreamPart } from './data-stream-parser';
import { createBridge } from './bridge';
import { toVercelMessages } from './to-vercel-messages';

export interface VercelAiTransportOptions {
  endpoint: string;
  fetchImpl?: typeof fetch;
  headers?: Record<string, string> | (() => Record<string, string>);
}

export function createVercelAiTransport(options: VercelAiTransportOptions): ChatTransport {
  const fetchImpl = options.fetchImpl ?? fetch;
  const bridge = createBridge<ChatEvent>();
  let disposed = false;
  let activeAbortController: AbortController | null = null;

  function resolveHeaders(): Record<string, string> {
    const configured = typeof options.headers === 'function' ? options.headers() : (options.headers ?? {});
    return { 'Content-Type': 'application/json', ...configured };
  }

  function connect(): AsyncIterable<ChatEvent> {
    return bridge.iterate();
  }

  function mapPart(part: DataStreamPart, ctx: { messageId: string; textOpen: boolean }): { events: ChatEvent[]; textOpen: boolean } {
    switch (part.prefix) {
      case '0': {
        const events: ChatEvent[] = [];
        if (!ctx.textOpen) events.push({ type: 'TEXT_MESSAGE_START', messageId: ctx.messageId, role: 'assistant' });
        events.push({ type: 'TEXT_MESSAGE_CONTENT', messageId: ctx.messageId, delta: part.value });
        return { events, textOpen: true };
      }
      case '3':
        return { events: [], textOpen: ctx.textOpen };
      case '9':
        return {
          events: [
            { type: 'TOOL_CALL_START', toolCallId: part.value.toolCallId, toolName: part.value.toolName, parentMessageId: ctx.messageId },
            { type: 'TOOL_CALL_ARGS', toolCallId: part.value.toolCallId, delta: JSON.stringify(part.value.args) },
            { type: 'TOOL_CALL_END', toolCallId: part.value.toolCallId },
          ],
          textOpen: ctx.textOpen,
        };
      case 'b':
        return {
          events: [{ type: 'TOOL_CALL_START', toolCallId: part.value.toolCallId, toolName: part.value.toolName, parentMessageId: ctx.messageId }],
          textOpen: ctx.textOpen,
        };
      case 'c':
        return { events: [{ type: 'TOOL_CALL_ARGS', toolCallId: part.value.toolCallId, delta: part.value.argsTextDelta }], textOpen: ctx.textOpen };
      case 'a':
        return { events: [{ type: 'TOOL_CALL_RESULT', toolCallId: part.value.toolCallId, result: part.value.result }], textOpen: ctx.textOpen };
      case 'd':
        return { events: ctx.textOpen ? [{ type: 'TEXT_MESSAGE_END', messageId: ctx.messageId }] : [], textOpen: false };
      default:
        return { events: [], textOpen: ctx.textOpen };
    }
  }

  async function sendRun(input: RunAgentInput): Promise<void> {
    activeAbortController = new AbortController();
    const messageId = crypto.randomUUID();
    let textOpen = false;
    let sawError: string | undefined;

    bridge.push({ type: 'RUN_STARTED', runId: input.runId, threadId: input.threadId });

    try {
      const response = await fetchImpl(options.endpoint, {
        method: 'POST',
        headers: resolveHeaders(),
        body: JSON.stringify({ messages: toVercelMessages(input.messages) }),
        signal: activeAbortController.signal,
      });
      if (!response.body) throw new Error('Vercel AI SDK response has no body');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const parser = createDataStreamParser();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const part of parser.push(chunk)) {
          if (part.prefix === '3') sawError = part.value;
          const { events, textOpen: nextTextOpen } = mapPart(part, { messageId, textOpen });
          textOpen = nextTextOpen;
          for (const event of events) bridge.push(event);
        }
      }

      if (sawError) {
        bridge.push({
          type: 'RUN_ERROR',
          runId: input.runId,
          error: { code: 'VERCEL_STREAM_ERROR', message: sawError, recoverable: false },
        });
        return;
      }
      bridge.push({ type: 'RUN_FINISHED', runId: input.runId });
    } catch (error) {
      if (disposed) return;
      bridge.push({
        type: 'RUN_ERROR',
        runId: input.runId,
        error: {
          code: 'VERCEL_STREAM_ERROR',
          message: error instanceof Error ? error.message : String(error),
          recoverable: false,
        },
      });
    }
  }

  // See plan decision 5: Vercel AI SDK backends conventionally receive a
  // tool's result as part of the *next* full-history POST, not a separate
  // channel — and toVercelMessages() (decision 4) doesn't carry tool-call
  // content outbound yet either, so there's nothing for this to deliver to.
  async function sendFrontendToolResult(_result: ToolResult): Promise<void> {}

  async function abortRun(_runId: string): Promise<void> {
    activeAbortController?.abort();
  }

  async function getCapabilities(): Promise<AgentCapabilities> {
    return { transports: ['http-polling'], tools: [], multimodal: false, reasoning: false, humanInTheLoop: false, sharedStateWritable: false };
  }

  function dispose(): void {
    disposed = true;
    activeAbortController?.abort();
    bridge.close();
  }

  return { connect, sendRun, sendFrontendToolResult, abortRun, getCapabilities, dispose };
}
```

- [x] **Step 12: Run and confirm pass**

```bash
npx pnpm@9.0.0 --filter @chatkit-svelte/transport-vercel-ai exec vitest run
```
Expected: PASS — 15 tests (6 parser + 3 message-mapping + 6 transport; the bridge has no dedicated test file, exercised transitively by the transport tests).

- [x] **Step 13: Write `packages/transport-vercel-ai/src/index.ts`**

```ts
export { createVercelAiTransport } from './vercel-ai-transport';
export type { VercelAiTransportOptions } from './vercel-ai-transport';
export { createDataStreamParser } from './data-stream-parser';
export type { DataStreamPart, DataStreamParser } from './data-stream-parser';
export { toVercelMessages } from './to-vercel-messages';
export type { VercelMessage } from './to-vercel-messages';
```

- [x] **Step 14: Typecheck and build**

```bash
npx pnpm@9.0.0 --filter @chatkit-svelte/transport-vercel-ai exec tsc --noEmit
npx pnpm@9.0.0 --filter @chatkit-svelte/transport-vercel-ai build
```
Expected: 0 errors; `dist/index.js`/`dist/index.d.ts` produced.

---

### Task 2: `@chatkit-svelte/plugin-devtools`

- [x] **Step 1: Build config**

`packages/plugin-devtools/package.json` (scaffold already has the right shape — add missing devDependencies, same pattern as every other Svelte plugin package this session):
```json
{
  "name": "@chatkit-svelte/plugin-devtools",
  "version": "0.0.0",
  "description": "Overlay logging raw wire events + live state inspection; export-fixture button that dumps event sequences in the fixture format used by conformance tests.",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "svelte": "./dist/index.js",
      "import": "./dist/index.js"
    },
    "./package.json": "./package.json"
  },
  "files": ["dist"],
  "scripts": {
    "build": "vite build --mode lib",
    "test": "vitest run",
    "typecheck": "svelte-check --tsconfig ./tsconfig.json"
  },
  "peerDependencies": {
    "svelte": "^5.0.0"
  },
  "dependencies": {
    "@chatkit-svelte/core": "workspace:*",
    "@chatkit-svelte/svelte": "workspace:*"
  },
  "devDependencies": {
    "@sveltejs/vite-plugin-svelte": "^4.0.0",
    "@testing-library/jest-dom": "^6.5.0",
    "@testing-library/svelte": "^5.2.0",
    "jsdom": "^25.0.0",
    "svelte": "^5.0.0",
    "svelte-check": "^3.8.0",
    "typescript": "^5.5.0",
    "vite": "^5.4.0",
    "vite-plugin-dts": "^4.0.0",
    "vitest": "^2.0.0"
  }
}
```
`tsconfig.json`/`vite.config.ts`/`vitest-setup.ts` — identical shape to `plugin-forms`'s (Svelte + `@chatkit-svelte/core`/`@chatkit-svelte/svelte` externalized), not repeated verbatim here.

```bash
npx pnpm@9.0.0 install
```

- [x] **Step 2: Write the failing tests — `packages/plugin-devtools/src/log.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { createDevtoolsLog } from './log.svelte';
import type { ChatEvent } from '@chatkit-svelte/core';

describe('createDevtoolsLog', () => {
  it('starts empty', () => {
    const log = createDevtoolsLog();
    expect(log.events).toEqual([]);
  });

  it('record() appends events in order', () => {
    const log = createDevtoolsLog();
    const a: ChatEvent = { type: 'RUN_STARTED', runId: 'r1', threadId: 't1' };
    const b: ChatEvent = { type: 'RUN_FINISHED', runId: 'r1' };
    log.record(a);
    log.record(b);
    expect(log.events).toEqual([a, b]);
  });

  it('clear() empties the log', () => {
    const log = createDevtoolsLog();
    log.record({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' });
    log.clear();
    expect(log.events).toEqual([]);
  });
});
```

- [x] **Step 3: Run and confirm failure, then write `packages/plugin-devtools/src/log.svelte.ts`**

```bash
npx pnpm@9.0.0 --filter @chatkit-svelte/plugin-devtools exec vitest run src/log.test.ts
```
Expected: FAIL — module missing.

```ts
import type { ChatEvent } from '@chatkit-svelte/core';

export interface DevtoolsLog {
  readonly events: ChatEvent[];
  record(event: ChatEvent): void;
  clear(): void;
}

export function createDevtoolsLog(): DevtoolsLog {
  let events: ChatEvent[] = $state([]);

  return {
    get events() {
      return events;
    },
    record(event: ChatEvent) {
      events = [...events, event];
    },
    clear() {
      events = [];
    },
  };
}
```

Run and confirm pass — 3 tests. (`$state` works standalone here the same way it already does in `chat-store.svelte.ts` — no reactive root needed, unlike `$effect`; see the M6 plan's Task 1 decision 5 for why that distinction matters.)

- [x] **Step 4: Write the failing tests — `packages/plugin-devtools/src/export-fixture.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { exportFixture } from './export-fixture';
import type { ChatEvent } from '@chatkit-svelte/core';

describe('exportFixture', () => {
  it('serializes the event log as pretty-printed JSON matching createFixtureTransport\'s expected input shape', () => {
    const events: ChatEvent[] = [
      { type: 'RUN_STARTED', runId: 'r1', threadId: 't1' },
      { type: 'RUN_FINISHED', runId: 'r1' },
    ];
    const json = exportFixture(events);
    expect(JSON.parse(json)).toEqual(events);
    expect(json).toContain('\n'); // pretty-printed, not minified
  });
});
```

- [x] **Step 5: Run and confirm failure, then write `packages/plugin-devtools/src/export-fixture.ts`**

```bash
npx pnpm@9.0.0 --filter @chatkit-svelte/plugin-devtools exec vitest run src/export-fixture.test.ts
```
Expected: FAIL — module missing.

```ts
import type { ChatEvent } from '@chatkit-svelte/core';

// Matches createFixtureTransport(events)'s expected input shape exactly —
// paste this file's output straight into a test as
// `createFixtureTransport(JSON.parse(fixtureJson))` (spec §13.4's "closes
// the loop between a bug seen in the playground and a regression test").
export function exportFixture(events: ChatEvent[]): string {
  return JSON.stringify(events, null, 2);
}
```

Run and confirm pass — 1 test.

- [x] **Step 6: Write the test harness and failing tests for `DevtoolsOverlay.svelte`**

`packages/plugin-devtools/src/TestHarness.svelte` (devtools reads the live store via `getChatContext()` for its state panel, so it still needs `<ChatProvider>`, alongside a directly-passed `log`):
```svelte
<script lang="ts">
  import { ChatProvider } from '@chatkit-svelte/svelte';
  import DevtoolsOverlay from './DevtoolsOverlay.svelte';
  import type { ChatConfig } from '@chatkit-svelte/core';
  import type { DevtoolsLog } from './log.svelte';

  interface Props {
    config: ChatConfig;
    log: DevtoolsLog;
  }

  let { config, log }: Props = $props();
</script>

<ChatProvider {config}>
  {#snippet children()}
    <DevtoolsOverlay {log} />
  {/snippet}
</ChatProvider>
```

`packages/plugin-devtools/src/DevtoolsOverlay.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import TestHarness from './TestHarness.svelte';
import { createDevtoolsLog } from './log.svelte';
import { createFixtureTransport } from '@chatkit-svelte/core';
import type { ChatEvent } from '@chatkit-svelte/core';

describe('DevtoolsOverlay', () => {
  it('renders one entry per logged event, in order', () => {
    const log = createDevtoolsLog();
    log.record({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' });
    log.record({ type: 'RUN_FINISHED', runId: 'r1' });
    const transport = createFixtureTransport([]);
    render(TestHarness, { config: { transport, threadId: 't1' }, log });

    const items = screen.getAllByTestId('devtools-event');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('RUN_STARTED');
    expect(items[1]).toHaveTextContent('RUN_FINISHED');
  });

  it('reflects events recorded after mount reactively', async () => {
    const log = createDevtoolsLog();
    const transport = createFixtureTransport([]);
    render(TestHarness, { config: { transport, threadId: 't1' }, log });

    expect(screen.queryAllByTestId('devtools-event')).toHaveLength(0);
    log.record({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' });

    await waitFor(() => {
      expect(screen.getAllByTestId('devtools-event')).toHaveLength(1);
    });
  });

  it('the Clear button empties the log', async () => {
    const log = createDevtoolsLog();
    log.record({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' });
    const transport = createFixtureTransport([]);
    render(TestHarness, { config: { transport, threadId: 't1' }, log });

    await fireEvent.click(screen.getByText('Clear'));

    expect(screen.queryAllByTestId('devtools-event')).toHaveLength(0);
  });

  it('the Export fixture button triggers a download of the current event log', async () => {
    const log = createDevtoolsLog();
    log.record({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' });
    const transport = createFixtureTransport([]);
    const createObjectURL = vi.fn(() => 'blob:fake');
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL: vi.fn() });

    render(TestHarness, { config: { transport, threadId: 't1' }, log });
    await fireEvent.click(screen.getByTestId('devtools-export'));

    expect(createObjectURL).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('shows the live current state from the store', async () => {
    const events: ChatEvent[] = [{ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' }];
    const transport = createFixtureTransport(events);
    const log = createDevtoolsLog();
    render(TestHarness, { config: { transport, threadId: 't1' }, log });

    await waitFor(() => {
      expect(screen.getByTestId('devtools-state')).toHaveTextContent('"running"');
    });
  });
});
```

- [x] **Step 7: Run and confirm failure**

```bash
npx pnpm@9.0.0 --filter @chatkit-svelte/plugin-devtools exec vitest run src/DevtoolsOverlay.test.ts
```
Expected: FAIL — module missing.

- [x] **Step 8: Write `packages/plugin-devtools/src/DevtoolsOverlay.svelte`**

```svelte
<script lang="ts">
  import { getChatContext } from '@chatkit-svelte/svelte';
  import { exportFixture } from './export-fixture';
  import type { DevtoolsLog } from './log.svelte';

  interface Props {
    log: DevtoolsLog;
  }

  let { log }: Props = $props();
  const store = getChatContext();

  function handleExport() {
    const blob = new Blob([exportFixture(log.events)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'chatkit-fixture.json';
    link.click();
    URL.revokeObjectURL(url);
  }
</script>

<div class="ck-devtools">
  <div class="ck-devtools__header">
    <span class="ck-devtools__count">Devtools — {log.events.length} events</span>
    <button type="button" onclick={handleExport} data-testid="devtools-export">Export fixture</button>
    <button type="button" onclick={() => log.clear()}>Clear</button>
  </div>
  <div class="ck-devtools__body">
    <ul class="ck-devtools__list">
      {#each log.events as event, i (i)}
        <li class="ck-devtools__event" data-testid="devtools-event">
          <span class="ck-devtools__event-type">{event.type}</span>
          <pre class="ck-devtools__event-json">{JSON.stringify(event, null, 2)}</pre>
        </li>
      {/each}
    </ul>
    <pre class="ck-devtools__state" data-testid="devtools-state">{JSON.stringify(store.state, null, 2)}</pre>
  </div>
</div>

<style>
  .ck-devtools {
    display: flex;
    flex-direction: column;
    gap: var(--ck-space-2);
    font-family: var(--ck-font-mono);
    font-size: var(--ck-font-size-sm);
    border: 1px solid var(--ck-color-border);
    border-radius: var(--ck-radius-md);
    background: var(--ck-color-surface);
    color: var(--ck-color-text);
    padding: var(--ck-space-3);
  }

  .ck-devtools__header {
    display: flex;
    align-items: center;
    gap: var(--ck-space-2);
  }

  .ck-devtools__body {
    display: flex;
    gap: var(--ck-space-3);
    max-height: 20rem;
  }

  .ck-devtools__list,
  .ck-devtools__state {
    flex: 1;
    overflow: auto;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .ck-devtools__event {
    border-bottom: 1px solid var(--ck-color-border);
    padding: var(--ck-space-1) 0;
  }

  .ck-devtools__event-type {
    font-weight: 600;
  }
</style>
```

`store.state` is already the exact live `ChatState` object exposed by `createChatStore` since M0 — no new store API needed, matching decision 7.

- [x] **Step 9: Run and confirm pass**

```bash
npx pnpm@9.0.0 --filter @chatkit-svelte/plugin-devtools exec vitest run
npx pnpm@9.0.0 --filter @chatkit-svelte/plugin-devtools exec svelte-check --tsconfig ./tsconfig.json
```
Expected: PASS — 9 tests (3 log + 1 export-fixture + 5 DevtoolsOverlay), 0 svelte-check errors/warnings.

- [x] **Step 10: Write `packages/plugin-devtools/src/index.ts`**

```ts
import { createDevtoolsLog, type DevtoolsLog } from './log.svelte';
import type { ChatPlugin } from '@chatkit-svelte/core';

export interface DevtoolsPlugin extends ChatPlugin {
  log: DevtoolsLog;
}

// Not auto-wired into <ChatWindow> — devtools is a developer tool a
// consumer mounts deliberately (e.g. behind a debug flag), unlike
// ApprovalBar/ArtifactPanel which are part of the end-user chat surface.
// See the M7 plan's decision 6.
export function devtoolsPlugin(): DevtoolsPlugin {
  const log = createDevtoolsLog();
  return {
    name: 'devtools',
    version: '1.0.0',
    hooks: {
      onEvent: (event) => log.record(event),
    },
    log,
  };
}

export { default as DevtoolsOverlay } from './DevtoolsOverlay.svelte';
export { createDevtoolsLog } from './log.svelte';
export type { DevtoolsLog } from './log.svelte';
export { exportFixture } from './export-fixture';
```

- [x] **Step 11: Full verification and build**

```bash
npx pnpm@9.0.0 --filter @chatkit-svelte/plugin-devtools exec vitest run
npx pnpm@9.0.0 --filter @chatkit-svelte/plugin-devtools exec svelte-check --tsconfig ./tsconfig.json
npx pnpm@9.0.0 --filter @chatkit-svelte/plugin-devtools build
```

---

### Task 3: CLI catch-up — transport choice + devtools checkbox

Closes the M5/M6 "notes for next plan" commitments now that both `@chatkit-svelte/transport-vercel-ai` and `@chatkit-svelte/plugin-devtools` exist.

**Files:**
- Modify: `packages/cli/src/generate-project.ts`, `generate-project.test.ts`
- Modify: `packages/cli/src/index.ts`, `prompts.ts` (no functional change to `prompts.ts` — just confirming the existing `askChoice` helper covers the new transport prompt without modification)

- [x] **Step 1: Write the failing tests** (add to `packages/cli/src/generate-project.test.ts`)

```ts
it('defaults to the AG-UI transport when no transport option is given', () => {
  const files = generateProject({ appName: 'app', plugins: [], theme: 'light' });
  const app = files.find((f) => f.path === 'src/App.svelte')!.content;
  expect(app).toContain('@chatkit-svelte/transport-agui');
});

it('generates a Vercel AI SDK transport wiring when transport: "vercel-ai" is chosen', () => {
  const files = generateProject({ appName: 'app', plugins: [], theme: 'light', transport: 'vercel-ai' });
  const pkg = JSON.parse(files.find((f) => f.path === 'package.json')!.content);
  expect(pkg.dependencies['@chatkit-svelte/transport-vercel-ai']).toBeDefined();
  expect(pkg.dependencies['@chatkit-svelte/transport-agui']).toBeUndefined();

  const app = files.find((f) => f.path === 'src/App.svelte')!.content;
  expect(app).toContain("import { createVercelAiTransport } from '@chatkit-svelte/transport-vercel-ai'");
  expect(app).toContain('createVercelAiTransport(');
});

it('offers devtools as a selectable plugin again', () => {
  const files = generateProject({ appName: 'app', plugins: ['devtools'], theme: 'light' });
  const pkg = JSON.parse(files.find((f) => f.path === 'package.json')!.content);
  expect(pkg.dependencies['@chatkit-svelte/plugin-devtools']).toBeDefined();
});
```

- [x] **Step 2: Run and confirm failure**

```bash
npx pnpm@9.0.0 --filter create-chatkit exec vitest run
```
Expected: FAIL — `transport` option not accepted by the type, `devtools` not a valid `PluginChoice`.

- [x] **Step 3: Update `packages/cli/src/generate-project.ts`**

**Real gap found and fixed while implementing this step, not part of the original plan:** wiring `transport: 'vercel-ai'` through the app template alone would have generated a *broken* local dev loop — the CLI's generated `server/sse-echo-server.mjs` only ever spoke AG-UI's SSE wire format, so a `vercel-ai`-transport app would ship pointed at a dev backend that doesn't speak the protocol its own client expects. Fixed by adding `packages/cli/src/vercel-echo-server-template.ts` (a second dev-server template emitting the Data Stream Protocol's `0:"text"\n` / `d:{"finishReason":"stop"}\n` lines instead of SSE frames) and having `generateProject` pick between the two templates based on the chosen transport.

Add `'devtools'` to `PluginChoice`, a `TransportChoice` type, `transport?: TransportChoice` to `GenerateProjectOptions` (default `'agui'`), a `devtools` entry in `PLUGIN_PACKAGES`, and branch `App.svelte`'s transport-import/construction lines on the chosen transport instead of hardcoding AG-UI. Only the changed regions are shown — everything else in the file is unchanged:

```ts
export type PluginChoice = 'file-handling' | 'markdown' | 'forms' | 'documents' | 'devtools';
export type ThemeChoice = 'light' | 'dark' | 'system';
export type TransportChoice = 'agui' | 'vercel-ai';

export interface GenerateProjectOptions {
  appName: string;
  plugins: PluginChoice[];
  theme: ThemeChoice;
  transport?: TransportChoice;
}
```

```ts
const PLUGIN_PACKAGES: Record<PluginChoice, { pkg: string; importName: string; factory: string }> = {
  'file-handling': {
    pkg: '@chatkit-svelte/plugin-file-handling',
    importName: 'fileHandlingPlugin',
    factory: 'fileHandlingPlugin({ upload: async (file) => ({ url: URL.createObjectURL(file) }) })',
  },
  markdown: { pkg: '@chatkit-svelte/plugin-markdown', importName: 'markdownPlugin', factory: 'markdownPlugin()' },
  forms: { pkg: '@chatkit-svelte/plugin-forms', importName: 'formsPlugin', factory: 'formsPlugin()' },
  documents: { pkg: '@chatkit-svelte/plugin-documents', importName: 'documentsPlugin', factory: 'documentsPlugin()' },
  devtools: { pkg: '@chatkit-svelte/plugin-devtools', importName: 'devtoolsPlugin', factory: 'devtoolsPlugin()' },
};

const TRANSPORT_PACKAGES: Record<TransportChoice, { pkg: string; importName: string; factory: string }> = {
  agui: {
    pkg: '@chatkit-svelte/transport-agui',
    importName: 'createAguiTransport',
    factory: "createAguiTransport({ endpoint: '/api/agent' })",
  },
  'vercel-ai': {
    pkg: '@chatkit-svelte/transport-vercel-ai',
    importName: 'createVercelAiTransport',
    factory: "createVercelAiTransport({ endpoint: '/api/agent' })",
  },
};
```

Inside `generateProject`, add:
```ts
  const transportChoice = TRANSPORT_PACKAGES[options.transport ?? 'agui'];
```
Replace the `dependencies` object's fixed `'@chatkit-svelte/transport-agui': '^0.0.0'` line with `[transportChoice.pkg]: '^0.0.0'`.

Replace both `appSvelte` branches' fixed lines:
```ts
  import { createAguiTransport } from '@chatkit-svelte/transport-agui';
```
and
```ts
    transport: createAguiTransport({ endpoint: '/api/agent' }),
```
with the transport-agnostic equivalents built from `transportChoice`:
```ts
  import { ${transportChoice.importName} } from '${transportChoice.pkg}';
```
```ts
    transport: ${transportChoice.factory},
```
(Both `appSvelte` template branches — `theme === 'system'` and `'light'|'dark'` — get this same substitution; they already diverge only on the theme attribute, per Task Notes above.)

- [x] **Step 4: Run and confirm pass**

```bash
npx pnpm@9.0.0 --filter create-chatkit exec vitest run
```
Expected: PASS — 9 tests (5 existing + 4 new — the 4th covering the dev-server-template gap found in Step 3).

- [x] **Step 5: Update `packages/cli/src/index.ts`'s prompt sequence**

Add a transport prompt between the plugin and theme prompts, and restore `devtools` to the plugin choices with it excluded from the default selection (spec §21: "all default-checked except devtools"):
```ts
  const pluginChoices: PluginChoice[] = ['file-handling', 'markdown', 'forms', 'documents', 'devtools'];
  const defaultPlugins: PluginChoice[] = ['file-handling', 'markdown', 'forms', 'documents'];
  const plugins = await askMultiChoice(io, 'Plugins to include', pluginChoices, defaultPlugins);
  const transport = await askChoice<TransportChoice>(io, 'Transport', ['agui', 'vercel-ai'], 'agui');
  const theme = await askChoice<ThemeChoice>(io, 'Theme', ['light', 'dark', 'system'], 'system');
```
with `TransportChoice` added to the `generate-project` import, and `transport` passed into `generateProject({ appName, plugins, theme, transport })`.

- [x] **Step 6: Rebuild and re-run the end-to-end smoke test**

```bash
npx pnpm@9.0.0 --filter create-chatkit build
```
```bash
printf 'smoke-test-app\n\n\nvercel-ai\n\n' | node packages/cli/dist/index.js
```
(run from a scratch temp directory, same as the M6 plan's Step 10 — generate, spot-check `package.json`'s dependencies include `@chatkit-svelte/transport-vercel-ai` and `src/App.svelte` imports `createVercelAiTransport`, then delete the scratch directory.)

- [x] **Step 7: Close out the M5/M6 plan notes**

In `docs/superpowers/plans/2026-08-23-m6-theming-persistence-a11y-cli.md`'s "Notes for the next plan (M7)" section — the file that actually names both deferred items (M3's own notes don't mention `plugin-devtools`/Vercel AI SDK at all) — add a one-line pointer to this plan next to each of the two relevant bullets, so a reader following the plan-history trail lands here.

---

### Task 4: Full rebuild, full regression suite, README

- [x] **Step 1: Rebuild all 12 packages in dependency order**

```bash
npx pnpm@9.0.0 --filter @chatkit-svelte/core build
npx pnpm@9.0.0 --filter @chatkit-svelte/transport-agui build
npx pnpm@9.0.0 --filter @chatkit-svelte/transport-vercel-ai build
npx pnpm@9.0.0 --filter @chatkit-svelte/svelte build
npx pnpm@9.0.0 --filter @chatkit-svelte/ui build
npx pnpm@9.0.0 --filter @chatkit-svelte/plugin-tool-render build
npx pnpm@9.0.0 --filter @chatkit-svelte/plugin-markdown build
npx pnpm@9.0.0 --filter @chatkit-svelte/plugin-file-handling build
npx pnpm@9.0.0 --filter @chatkit-svelte/plugin-forms build
npx pnpm@9.0.0 --filter @chatkit-svelte/plugin-documents build
npx pnpm@9.0.0 --filter @chatkit-svelte/plugin-devtools build
npx pnpm@9.0.0 --filter create-chatkit build
```

- [x] **Step 2: Full regression suite**

Run `vitest run` for every package above (skipping `create-chatkit`'s build-only step). Actual final total: 51 (core) + 44 (transport-agui) + 15 (transport-vercel-ai) + 37 (svelte) + 40 (ui) + 4 (plugin-tool-render) + 21 (plugin-markdown) + 5 (plugin-file-handling) + 16 (plugin-forms) + 13 (plugin-documents) + 9 (plugin-devtools) + 9 (create-chatkit) = 264 tests, all passing, no regressions in any previously-green package.

- [x] **Step 3: Update the milestone checklist in the root README**

In [README.md](../../../README.md), change:
```markdown
- [ ] M7 — Second transport adapter (Vercel AI SDK), devtools fixture export
```
to:
```markdown
- [x] M7 — Second transport adapter (Vercel AI SDK), devtools fixture export
```

This is the last milestone in spec §22 — once this box is checked, all of M0–M7 are complete.

---

## Notes for the next plan

There isn't one — M7 is the last milestone spec §22 defines. Anything past this point (richtext documents, SvelteKit CLI scaffolding, per-validation-rule form i18n, a real `afterEvent` plugin hook for true reducer state diffs, the "eject and re-layout" theming story) is scope this session's plans have named explicitly as deferred, not implied work still owed by this milestone sequence. Spec §23's "Open Questions" section is the closest thing to a forward-looking backlog if this project continues past M7.

---

- [x] **Mark the milestone complete**

No git commit — per repo owner preference, commits are handled manually. This is the natural stopping point for M7 — and for the whole M0–M7 milestone sequence.
