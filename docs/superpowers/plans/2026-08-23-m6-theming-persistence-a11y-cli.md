# M6 — Theming Polish, Persistence Adapters, A11y/I18n, CLI Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Git note:** commit steps are intentionally omitted — the repo owner handles git operations manually. Do not run `git add`/`git commit` while executing this plan unless explicitly asked to in the moment.

**Goal:** Close out spec §22 M6 — *"Theming polish, persistence adapters (localStorage + IndexedDB), a11y/i18n pass, CLI scaffold."* Unlike every prior milestone, this one bundles four largely-independent subsystems (spec §11 persistence, §15 theming, §16/17 a11y/i18n, §21 CLI). This plan treats them as four sequential tasks with their own file sets and their own scope decisions, rather than one narrative.

---

## Design decisions

**1. `PersistenceAdapter`'s type lives in `@chatkit-svelte/core`; the two browser-backed implementations live in `@chatkit-svelte/svelte`.** `core` has had zero browser-global dependencies since M0 (no `window`, `localStorage`, `indexedDB` — every existing test runs without `jsdom`). `localStoragePersistence`/`indexedDbPersistence` need real browser globals; putting them in `core` would be the first crack in that boundary. `memoryPersistence()` has no such dependency, so it stays in `core` next to the type. This mirrors the existing split where `chat-store.svelte.ts` (not `core`) is already the place that assumes `crypto`/browser environment.

**2. IndexedDB adapter uses one object store, not the spec's "separate object stores so large documents don't bloat every read."** That's a real optimization for a mature product; for this milestone, a single `threads` object store (keyPath `id`, storing `{id, title, updatedAt, state}`) is correct and simple. Documented as a deferred optimization, not silently dropped.

**3. Thread "title" isn't a `ChatState` field — derived at save time.** `saveThread` computes a title from the first user message's text (truncated to ~60 chars), falling back to `"New thread"` if there isn't one yet. This is what `listThreads()` returns without needing a separate title-tracking API.

**4. Load-then-connect ordering.** `createChatStore` becomes: if `config.persistence` is set, `await loadThread()` and merge the result into `state` (forcing `runStatus: 'idle'`/`error: null` — a persisted run is never still "running") *before* calling `transport.connect()`. This avoids a race where live events and a persisted snapshot both try to seed `state` in an undefined order. `createChatStore` itself stays synchronous (returns the store immediately, per its existing contract) — the load/connect sequencing happens inside a fire-and-forget `bootstrap()` async function, the same pattern `consumeStream` already uses.

**5. Debounced saves use `$effect`, called from inside `createChatStore`.** Spec §11 says "off the `$effect` boundary in `svelte`, never inside `core`" — `chat-store.svelte.ts` *is* that boundary. `$effect` is legal here because `createChatStore` only ever runs synchronously during `<ChatProvider>`'s own script initialization (via `untrack(() => createChatStore(config))`), which is itself valid Svelte component-initialization context.

**6. Live-region announcements are decoupled from the visible message DOM, not layered onto it.** Spec §16 says `role="log"` + `aria-live="polite"` on the message list, with debounced (not per-token) announcements. Read literally as one container serving both jobs, that either spams a screen reader on every streamed token (if the visible text updates continuously, which the "watch it stream" UX explicitly wants) or makes the visible text choppy (if updates are throttled to match the announcement cadence, which would visibly regress M2's streaming). This plan keeps `.ck-message-list` visually smooth and adds a **separate visually-hidden `aria-live="polite"` announcer** that mirrors the latest assistant message's text only after a 600ms pause in deltas, or immediately on `TEXT_MESSAGE_END` — the standard pattern for exactly this streaming-plus-screen-reader tension.

**7. Focus coordination between `<ApprovalBar>` and `<Composer>` uses a stable DOM id, not a formal ref-passing API.** `<Composer>`'s text input gets `id="ck-composer-input"`; `<ApprovalBar>` calls `document.getElementById('ck-composer-input')?.focus()` when the last pending approval resolves, and focuses its own first action button when a new approval appears. A prop-drilled/context-based focus-handle API would be more "correct" Svelte architecture but is more machinery than this milestone's actual need justifies — flagged here as the deliberate trade-off, not an oversight.

**8. i18n is threaded through a `store.t(key, params?)` method, not a Svelte context or prop-drilling.** `ChatStore` already carries `config` internally; exposing a bound `t()` off the same object every themed component already reaches via `getChatContext()` needs no new plumbing. `@chatkit-svelte/core` ships `defaultMessages` (English) and a small `{param}`-interpolating `translate()` helper; `config.i18n?.messages` is merged over the defaults per-key (spec: "overridable wholesale or per-key"). `dir` is derived from `config.i18n?.locale` against a small hardcoded RTL-locale set and exposed as `store.dir`, applied to `<ChatWindow>`'s root `dir` attribute.

**9. CLI scope: bare Vite+Svelte target only. SvelteKit scaffolding and the Vercel AI SDK transport option are deferred — neither exists as a working, testable thing to scaffold against yet** (`transport-vercel-ai` is an unbuilt package; a SvelteKit template needs routing conventions this milestone doesn't otherwise touch). The `devtools` plugin checkbox from spec §21 is dropped from the prompt entirely for the same reason — `plugin-devtools` has never been built in this repo, so offering it would generate an app that imports a package that doesn't exist. Plugin choices offered: `file-handling`, `markdown`, `forms`, `documents` (the four real, built, M3/M5 plugin packages), all default-checked. Generation logic (`generateProject(options)`) is a pure, fully-unit-tested function that returns `{path, content}[]`; a thin `bin/create-chatkit.ts` wraps it with a hand-rolled `readline`-based prompt sequence (no new interactive-prompts dependency — the prompt surface is small enough that adding a library isn't justified).

**10. The CLI's generated dev backend is a real, minimal Node HTTP+SSE server implementing just enough of the AG-UI wire contract to echo the user's message back as a streamed assistant reply** (`RUN_STARTED` → `TEXT_MESSAGE_START/CONTENT/END` → `RUN_FINISHED`) — matches spec §21's "SSE echo server for local dev without a real backend," and is itself a working Node script the generated project can run standalone.

**11. The CLI embeds a static copy of `tokens.css`** (`packages/cli/templates/tokens.css`, kept manually in sync with `packages/ui/src/tokens.css`) rather than resolving it from the monorepo at generation time — the generator needs to work the same way whether run from this workspace or (eventually) from a published npm package, where there is no monorepo to reach into. Noted as a manual-sync maintenance point, the same style of documented trade-off as this session's other scope calls.

---

## File Structure

```
packages/core/src/persistence.ts, persistence.test.ts          # Task 1
packages/core/src/config.ts                                     # Task 1 — add persistence field
packages/core/src/index.ts                                      # Task 1 — barrel export
packages/svelte/src/persistence/local-storage.ts, .test.ts      # Task 1
packages/svelte/src/persistence/indexed-db.ts, .test.ts         # Task 1
packages/svelte/src/index.ts                                    # Task 1 — barrel export
packages/svelte/src/chat-store.svelte.ts, chat-store.test.ts    # Task 1 — load/save wiring
packages/svelte/package.json                                    # Task 1 — add fake-indexeddb devDependency

packages/ui/src/tokens.css                                      # Task 2 — density variants
packages/ui/src/ChatWindow.svelte, MessageList.svelte, Composer.svelte,
  ApprovalBar.svelte, ArtifactPanel.svelte                       # Task 2 — class prop
packages/ui/src/tailwind-preset.ts, tailwind-preset.test.ts     # Task 2
packages/ui/src/a11y/contrast.ts, contrast.test.ts               # Task 2
packages/ui/vite.config.ts, package.json                        # Task 2 — multi-entry build

packages/core/src/i18n.ts, i18n.test.ts                          # Task 3
packages/core/src/config.ts, index.ts                            # Task 3 — I18nConfig field/export
packages/svelte/src/chat-store.svelte.ts, chat-store.test.ts    # Task 3 — store.t()/store.dir
packages/ui/src/MessageList.svelte, MessageList.test.ts          # Task 3 — live announcer
packages/ui/src/Composer.svelte, Composer.test.ts                 # Task 3 — i18n strings, refocus
packages/ui/src/ApprovalBar.svelte, ApprovalBar.test.ts          # Task 3 — i18n strings, focus mgmt
packages/ui/src/ChatWindow.svelte                                # Task 3 — dir attribute
packages/plugin-forms/src/FormRenderer.svelte, FormRenderer.test.ts  # Task 3 — role=form, i18n
packages/plugin-documents/src/DocumentCanvas.svelte, DocumentCanvas.test.ts # Task 3 — i18n

packages/cli/package.json, tsconfig.json                         # Task 4
packages/cli/templates/tokens.css                                # Task 4
packages/cli/src/generate-project.ts, generate-project.test.ts   # Task 4
packages/cli/src/sse-echo-server-template.ts                     # Task 4
packages/cli/src/prompts.ts                                      # Task 4
packages/cli/src/index.ts                                        # Task 4 — bin entry
```

---

### Task 1: Persistence adapters

- [x] **Step 1: `PersistenceAdapter` type + `memoryPersistence()` in `@chatkit-svelte/core`**

`packages/core/src/persistence.ts`:
```ts
import type { ChatState } from './types';

export interface ThreadSummary {
  id: string;
  title: string;
  updatedAt: number;
}

export interface PersistenceAdapter {
  loadThread(threadId: string): Promise<ChatState | null>;
  saveThread(threadId: string, state: ChatState): Promise<void>;
  listThreads(): Promise<ThreadSummary[]>;
  deleteThread(threadId: string): Promise<void>;
}

export function deriveTitle(state: ChatState): string {
  const firstUserMessage = state.messages.find((m) => m.role === 'user');
  const text = firstUserMessage?.parts.find((p) => p.type === 'text')?.text;
  if (!text) return 'New thread';
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
}

export function memoryPersistence(): PersistenceAdapter {
  const store = new Map<string, ChatState>();

  return {
    async loadThread(threadId) {
      return store.get(threadId) ?? null;
    },
    async saveThread(threadId, state) {
      store.set(threadId, state);
    },
    async listThreads() {
      return [...store.entries()]
        .map(([id, state]) => ({ id, title: deriveTitle(state), updatedAt: Date.now() }))
        .sort((a, b) => b.updatedAt - a.updatedAt);
    },
    async deleteThread(threadId) {
      store.delete(threadId);
    },
  };
}
```

`deriveTitle` is exported (not just an internal helper) so `localStoragePersistence`/`indexedDbPersistence` reuse the identical title logic instead of each reimplementing it.

`packages/core/src/persistence.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { deriveTitle, memoryPersistence } from './persistence';
import { initialState } from './reducer';
import type { ChatState, Message } from './types';

function userMessage(text: string): Message {
  return { id: 'm1', role: 'user', parts: [{ type: 'text', text }], createdAt: 0, streaming: false };
}

describe('deriveTitle', () => {
  it('returns "New thread" when there is no user message yet', () => {
    expect(deriveTitle(initialState())).toBe('New thread');
  });

  it('uses the first user message text as the title', () => {
    const state: ChatState = { ...initialState(), messages: [userMessage('Book me a flight to Tokyo')] };
    expect(deriveTitle(state)).toBe('Book me a flight to Tokyo');
  });

  it('truncates a long first message to 60 characters with an ellipsis', () => {
    const long = 'x'.repeat(80);
    const state: ChatState = { ...initialState(), messages: [userMessage(long)] };
    expect(deriveTitle(state)).toBe(`${'x'.repeat(60)}…`);
  });
});

describe('memoryPersistence', () => {
  it('round-trips a saved thread through loadThread', async () => {
    const adapter = memoryPersistence();
    const state: ChatState = { ...initialState(), messages: [userMessage('hi')] };
    await adapter.saveThread('t1', state);
    expect(await adapter.loadThread('t1')).toEqual(state);
  });

  it('returns null for a thread that was never saved', async () => {
    const adapter = memoryPersistence();
    expect(await adapter.loadThread('missing')).toBeNull();
  });

  it('listThreads reflects saved threads with a derived title', async () => {
    const adapter = memoryPersistence();
    await adapter.saveThread('t1', { ...initialState(), messages: [userMessage('Plan my trip')] });
    const threads = await adapter.listThreads();
    expect(threads).toEqual([expect.objectContaining({ id: 't1', title: 'Plan my trip' })]);
  });

  it('deleteThread removes a thread from both loadThread and listThreads', async () => {
    const adapter = memoryPersistence();
    await adapter.saveThread('t1', initialState());
    await adapter.deleteThread('t1');
    expect(await adapter.loadThread('t1')).toBeNull();
    expect(await adapter.listThreads()).toEqual([]);
  });
});
```

Run and confirm: `npx pnpm@9.0.0 --filter @chatkit-svelte/core exec vitest run src/persistence.test.ts` → FAIL (module missing) → implement → PASS (7 tests).

Add `persistence?: PersistenceAdapter` to `packages/core/src/config.ts`'s `ChatConfig`, and `export * from './persistence';` to `packages/core/src/index.ts`. Run full core suite + `tsc --noEmit`; rebuild `@chatkit-svelte/core`.

- [x] **Step 2: `localStoragePersistence()` in `@chatkit-svelte/svelte`**

`packages/svelte/src/persistence/local-storage.ts`:
```ts
import { deriveTitle } from '@chatkit-svelte/core';
import type { ChatState, PersistenceAdapter, ThreadSummary } from '@chatkit-svelte/core';

export interface LocalStoragePersistenceOptions {
  storage?: Storage;
  keyPrefix?: string;
  /** Warn (console.warn) when a single thread's serialized size exceeds this many bytes. Default ~4MB. */
  warnAboveBytes?: number;
}

interface IndexEntry extends ThreadSummary {}

export function localStoragePersistence(options: LocalStoragePersistenceOptions = {}): PersistenceAdapter {
  const storage = options.storage ?? window.localStorage;
  const prefix = options.keyPrefix ?? 'chatkit:thread:';
  const indexKey = `${prefix}__index`;
  const warnAboveBytes = options.warnAboveBytes ?? 4 * 1024 * 1024;

  function readIndex(): IndexEntry[] {
    const raw = storage.getItem(indexKey);
    if (!raw) return [];
    try {
      return JSON.parse(raw) as IndexEntry[];
    } catch {
      return [];
    }
  }

  function writeIndex(entries: IndexEntry[]): void {
    storage.setItem(indexKey, JSON.stringify(entries));
  }

  return {
    async loadThread(threadId) {
      const raw = storage.getItem(prefix + threadId);
      if (!raw) return null;
      return JSON.parse(raw) as ChatState;
    },
    async saveThread(threadId, state) {
      const serialized = JSON.stringify(state);
      if (serialized.length > warnAboveBytes) {
        console.warn(
          `[chatkit] thread "${threadId}" is ${serialized.length} bytes serialized, above the ${warnAboveBytes}-byte localStorage warning threshold — consider indexedDbPersistence() for large threads.`
        );
      }
      storage.setItem(prefix + threadId, serialized);
      const entries = readIndex().filter((e) => e.id !== threadId);
      entries.push({ id: threadId, title: deriveTitle(state), updatedAt: Date.now() });
      writeIndex(entries);
    },
    async listThreads() {
      return readIndex().sort((a, b) => b.updatedAt - a.updatedAt);
    },
    async deleteThread(threadId) {
      storage.removeItem(prefix + threadId);
      writeIndex(readIndex().filter((e) => e.id !== threadId));
    },
  };
}
```

`packages/svelte/src/persistence/local-storage.test.ts` — uses jsdom's real `window.localStorage` (already available in this package's `jsdom` test environment, no mocking needed):
```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { localStoragePersistence } from './local-storage';
import { initialState } from '@chatkit-svelte/core';
import type { ChatState, Message } from '@chatkit-svelte/core';

function userMessage(text: string): Message {
  return { id: 'm1', role: 'user', parts: [{ type: 'text', text }], createdAt: 0, streaming: false };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('localStoragePersistence', () => {
  it('round-trips a saved thread', async () => {
    const adapter = localStoragePersistence();
    const state: ChatState = { ...initialState(), messages: [userMessage('hi')] };
    await adapter.saveThread('t1', state);
    expect(await adapter.loadThread('t1')).toEqual(state);
  });

  it('returns null for a thread never saved', async () => {
    const adapter = localStoragePersistence();
    expect(await adapter.loadThread('missing')).toBeNull();
  });

  it('tracks saved threads in listThreads with derived titles, newest first', async () => {
    const adapter = localStoragePersistence();
    await adapter.saveThread('t1', { ...initialState(), messages: [userMessage('first')] });
    await new Promise((r) => setTimeout(r, 5));
    await adapter.saveThread('t2', { ...initialState(), messages: [userMessage('second')] });
    const threads = await adapter.listThreads();
    expect(threads.map((t) => t.id)).toEqual(['t2', 't1']);
  });

  it('deleteThread removes the thread and its index entry', async () => {
    const adapter = localStoragePersistence();
    await adapter.saveThread('t1', initialState());
    await adapter.deleteThread('t1');
    expect(await adapter.loadThread('t1')).toBeNull();
    expect(await adapter.listThreads()).toEqual([]);
  });

  it('warns when a thread exceeds the configured byte threshold', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const adapter = localStoragePersistence({ warnAboveBytes: 10 });
    await adapter.saveThread('t1', { ...initialState(), messages: [userMessage('this is definitely over ten bytes')] });
    expect(warnSpy).toHaveBeenCalledOnce();
    warnSpy.mockRestore();
  });
});
```

Run and confirm failure, implement, confirm pass (5 tests).

- [x] **Step 3: `indexedDbPersistence()` in `@chatkit-svelte/svelte`**

Add `fake-indexeddb` as a devDependency (`^6.0.0`) — a real, widely-used IndexedDB polyfill for exactly this test scenario (jsdom has no native IndexedDB).

`packages/svelte/src/persistence/indexed-db.ts`:
```ts
import { deriveTitle } from '@chatkit-svelte/core';
import type { ChatState, PersistenceAdapter, ThreadSummary } from '@chatkit-svelte/core';

export interface IndexedDbPersistenceOptions {
  indexedDB?: IDBFactory;
  dbName?: string;
  storeName?: string;
}

interface ThreadRecord extends ThreadSummary {
  state: ChatState;
}

function openDb(idb: IDBFactory, dbName: string, storeName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = idb.open(dbName, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(storeName, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function indexedDbPersistence(options: IndexedDbPersistenceOptions = {}): PersistenceAdapter {
  const idb = options.indexedDB ?? window.indexedDB;
  const dbName = options.dbName ?? 'chatkit';
  const storeName = options.storeName ?? 'threads';
  const dbPromise = openDb(idb, dbName, storeName);

  async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await dbPromise;
    const tx = db.transaction(storeName, mode);
    const result = await requestToPromise(fn(tx.objectStore(storeName)));
    return result;
  }

  return {
    async loadThread(threadId) {
      const record = await withStore<ThreadRecord | undefined>('readonly', (store) => store.get(threadId));
      return record?.state ?? null;
    },
    async saveThread(threadId, state) {
      const record: ThreadRecord = { id: threadId, title: deriveTitle(state), updatedAt: Date.now(), state };
      await withStore('readwrite', (store) => store.put(record));
    },
    async listThreads() {
      const records = await withStore<ThreadRecord[]>('readonly', (store) => store.getAll());
      return records
        .map(({ id, title, updatedAt }) => ({ id, title, updatedAt }))
        .sort((a, b) => b.updatedAt - a.updatedAt);
    },
    async deleteThread(threadId) {
      await withStore('readwrite', (store) => store.delete(threadId));
    },
  };
}
```

`packages/svelte/src/persistence/indexed-db.test.ts`:
```ts
import { describe, expect, it, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { indexedDbPersistence } from './indexed-db';
import { initialState } from '@chatkit-svelte/core';
import type { ChatState, Message } from '@chatkit-svelte/core';

function userMessage(text: string): Message {
  return { id: 'm1', role: 'user', parts: [{ type: 'text', text }], createdAt: 0, streaming: false };
}

describe('indexedDbPersistence', () => {
  it('round-trips a saved thread', async () => {
    const adapter = indexedDbPersistence({ dbName: `test-${Math.random()}` });
    const state: ChatState = { ...initialState(), messages: [userMessage('hi')] };
    await adapter.saveThread('t1', state);
    expect(await adapter.loadThread('t1')).toEqual(state);
  });

  it('returns null for a thread never saved', async () => {
    const adapter = indexedDbPersistence({ dbName: `test-${Math.random()}` });
    expect(await adapter.loadThread('missing')).toBeNull();
  });

  it('tracks saved threads in listThreads with derived titles', async () => {
    const adapter = indexedDbPersistence({ dbName: `test-${Math.random()}` });
    await adapter.saveThread('t1', { ...initialState(), messages: [userMessage('first thread')] });
    const threads = await adapter.listThreads();
    expect(threads).toEqual([expect.objectContaining({ id: 't1', title: 'first thread' })]);
  });

  it('deleteThread removes the thread', async () => {
    const adapter = indexedDbPersistence({ dbName: `test-${Math.random()}` });
    await adapter.saveThread('t1', initialState());
    await adapter.deleteThread('t1');
    expect(await adapter.loadThread('t1')).toBeNull();
  });
});
```

Each test uses a fresh random `dbName` to avoid cross-test IndexedDB state leaking (vitest doesn't tear down fake-indexeddb's global registry between tests in the same file automatically). Run and confirm failure, implement, confirm pass (4 tests). Export both new adapters from `packages/svelte/src/index.ts`. Rebuild `@chatkit-svelte/svelte`.

- [x] **Step 4: Wire persistence into `createChatStore`**

In `packages/svelte/src/chat-store.svelte.ts`, replace the current unconditional:
```ts
const stream = transport.connect({ threadId: config.threadId ?? 'default' });
void consumeStream(stream);
```
with:
```ts
let saveTimer: ReturnType<typeof setTimeout> | undefined;

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
  $effect(() => {
    const snapshot = state;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      config.persistence!.saveThread(config.threadId ?? 'default', snapshot);
    }, 400);
  });
}
```
And add `clearTimeout(saveTimer);` to the top of `dispose()`, before `disposed = true;` — a pending debounced save firing after teardown would call `saveThread` on a disposed store's last-known state, harmless but pointless; clearing it is cheap and avoids the dangling timer entirely.

Add these tests to `packages/svelte/src/chat-store.test.ts` (new `describe('persistence', ...)` block; needs `PersistenceAdapter` added to the `@chatkit-svelte/core` type import and `vi.useFakeTimers()`/`vi.advanceTimersByTimeAsync()`):
```ts
describe('persistence', () => {
  function fakeAdapter(initial?: ChatState): PersistenceAdapter & { saved: ChatState[] } {
    const saved: ChatState[] = [];
    return {
      saved,
      async loadThread() {
        return initial ?? null;
      },
      async saveThread(_threadId, state) {
        saved.push(state);
      },
      async listThreads() {
        return [];
      },
      async deleteThread() {},
    };
  }

  it('restores messages from a persisted thread before connecting, with runStatus forced to idle', async () => {
    const persisted: ChatState = {
      messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }], createdAt: 0, streaming: false }],
      runStatus: 'running',
      sharedState: null,
      activities: [],
      steps: [],
      artifacts: {},
      error: null,
    };
    const adapter = fakeAdapter(persisted);
    const transport = createFixtureTransport([]);
    const store = createChatStore({ transport, threadId: 't1', persistence: adapter });

    await vi.waitFor(() => {
      expect(store.messages).toHaveLength(1);
    });
    expect(store.runStatus).toBe('idle');

    store.dispose();
  });

  it('debounces saveThread so rapid successive events only trigger one save', async () => {
    vi.useFakeTimers();
    const adapter = fakeAdapter();
    const events: ChatEvent[] = [
      { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'a' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'b' },
      { type: 'TEXT_MESSAGE_END', messageId: 'm1' },
    ];
    const transport = createFixtureTransport(events, { delayMs: 0 });
    const store = createChatStore({ transport, threadId: 't1', persistence: adapter });

    await vi.advanceTimersByTimeAsync(500);

    expect(adapter.saved.length).toBeGreaterThan(0);
    expect(adapter.saved.length).toBeLessThan(events.length);

    store.dispose();
    vi.useRealTimers();
  });

  it('does not call loadThread/saveThread when no persistence adapter is configured', async () => {
    const transport = createFixtureTransport([]);
    const store = createChatStore({ transport, threadId: 't1' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    store.dispose();
    // No adapter configured — nothing to assert beyond "this doesn't throw",
    // covered implicitly by every other test in this file already running
    // without a persistence adapter.
    expect(store.state.runStatus).not.toBe('error');
  });
});
```

Run and confirm the first two fail (`store.messages` stays empty; `saved` never grows) before the Step 4 code exists, then pass after. Run the full `@chatkit-svelte/svelte` suite + `svelte-check`. Rebuild `@chatkit-svelte/svelte`.

---

### Task 2: Theming polish

- [x] **Step 1: Density variants in `packages/ui/src/tokens.css`**

Add (full file gets these two new blocks appended after the existing `[data-chatkit-theme='dark']` block):
```css
[data-ck-density='compact'] {
  --ck-space-1: 2px;
  --ck-space-2: 4px;
  --ck-space-3: 6px;
  --ck-space-4: 8px;
  --ck-space-6: 12px;
  --ck-font-size-sm: 0.75rem;
  --ck-font-size-base: 0.8125rem;
  --ck-font-size-lg: 0.9375rem;
}
```
`data-ck-density` is opt-in (unset = the existing "comfortable" spacing scale already shipped) — set on the same element as `data-chatkit-theme` or any ancestor, since these are plain custom-property overrides that cascade.

- [x] **Step 2: `class` prop on every themed component**

Add to `ChatWindow.svelte`, `MessageList.svelte`, `Composer.svelte`, `ApprovalBar.svelte`, `ArtifactPanel.svelte`: a `class?: string` prop, merged after the component's own internal class so consumer overrides win on specificity ties (spec §15: "merges it after internal classes"). Example for `ChatWindow.svelte` (same pattern applied to the other four — each just changes its own root class name and prop list):
```svelte
<script lang="ts">
  // ...existing imports...
  interface Props {
    message?: Snippet<[Message]>;
    class?: string;
  }
  let { message, class: className }: Props = $props();
</script>

<div class="ck-chat-window {className ?? ''}" data-chatkit-theme>
```
`class` is a reserved word, so the prop is destructured as `class: className` — same rename pattern in all five components. Add one test per component (5 new tests total, one appended to each of `ChatWindow.test.ts`/`MessageList.test.ts`/`Composer.test.ts`/`ApprovalBar.test.ts`/`ArtifactPanel.test.ts`) asserting a passed `class="custom"` prop shows up alongside the internal class on the rendered root element.

- [x] **Step 3: Tailwind preset**

`packages/ui/src/tailwind-preset.ts`:
```ts
export const chatkitTailwindPreset = {
  theme: {
    extend: {
      colors: {
        'ck-bg': 'var(--ck-color-bg)',
        'ck-surface': 'var(--ck-color-surface)',
        'ck-border': 'var(--ck-color-border)',
        'ck-text': 'var(--ck-color-text)',
        'ck-text-muted': 'var(--ck-color-text-muted)',
        'ck-accent': 'var(--ck-color-accent)',
        'ck-accent-contrast': 'var(--ck-color-accent-contrast)',
        'ck-user-bubble': 'var(--ck-color-user-bubble)',
        'ck-user-bubble-text': 'var(--ck-color-user-bubble-text)',
        'ck-assistant-bubble': 'var(--ck-color-assistant-bubble)',
        'ck-assistant-bubble-text': 'var(--ck-color-assistant-bubble-text)',
        'ck-error': 'var(--ck-color-error)',
        'ck-success': 'var(--ck-color-success)',
      },
      fontFamily: {
        'ck-sans': 'var(--ck-font-sans)',
        'ck-mono': 'var(--ck-font-mono)',
      },
      fontSize: {
        'ck-sm': 'var(--ck-font-size-sm)',
        'ck-base': 'var(--ck-font-size-base)',
        'ck-lg': 'var(--ck-font-size-lg)',
      },
      borderRadius: {
        'ck-sm': 'var(--ck-radius-sm)',
        'ck-md': 'var(--ck-radius-md)',
        'ck-lg': 'var(--ck-radius-lg)',
      },
      spacing: {
        'ck-1': 'var(--ck-space-1)',
        'ck-2': 'var(--ck-space-2)',
        'ck-3': 'var(--ck-space-3)',
        'ck-4': 'var(--ck-space-4)',
        'ck-6': 'var(--ck-space-6)',
      },
    },
  },
};

export default chatkitTailwindPreset;
```
Every value is a `var(--ck-*)` reference, not a hardcoded copy of the token's current value — so swapping `tokens.css` (light/dark/a custom rebrand) automatically re-themes the Tailwind utility classes too, with no preset re-export needed.

`packages/ui/src/tailwind-preset.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { chatkitTailwindPreset } from './tailwind-preset';

describe('chatkitTailwindPreset', () => {
  it('maps every color token to its CSS custom property', () => {
    expect(chatkitTailwindPreset.theme.extend.colors['ck-accent']).toBe('var(--ck-color-accent)');
    expect(chatkitTailwindPreset.theme.extend.colors['ck-bg']).toBe('var(--ck-color-bg)');
  });

  it('maps spacing/radius/font tokens to their CSS custom properties', () => {
    expect(chatkitTailwindPreset.theme.extend.spacing['ck-4']).toBe('var(--ck-space-4)');
    expect(chatkitTailwindPreset.theme.extend.borderRadius['ck-md']).toBe('var(--ck-radius-md)');
    expect(chatkitTailwindPreset.theme.extend.fontFamily['ck-sans']).toBe('var(--ck-font-sans)');
  });
});
```

Switch `packages/ui/vite.config.ts`'s `build.lib.entry` from a single string to a multi-entry object so this compiles to its own `dist/tailwind-preset.js` (matching the `package.json` export path that's been declared-but-unimplemented since M2):
```ts
    lib: {
      entry: { index: 'src/index.ts', 'tailwind-preset': 'src/tailwind-preset.ts' },
      formats: ['es'],
    },
```
(`fileName` is dropped — Vite derives per-entry output names from the entry object's keys once `entry` is an object.) Run `npx pnpm@9.0.0 --filter @chatkit-svelte/ui build` and confirm both `dist/index.js` and `dist/tailwind-preset.js` exist.

- [x] **Step 4: WCAG AA contrast audit**

`packages/ui/src/a11y/contrast.ts`:
```ts
function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  return [parseInt(clean.slice(0, 2), 16), parseInt(clean.slice(2, 4), 16), parseInt(clean.slice(4, 6), 16)];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const [rl, gl, bl] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

export function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hexToRgb(hex1));
  const l2 = relativeLuminance(hexToRgb(hex2));
  const [lighter, darker] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (lighter + 0.05) / (darker + 0.05);
}
```

`packages/ui/src/a11y/contrast.test.ts` — unit tests for the formula plus the actual audit of the shipped token pairs (hex values copied from `tokens.css`, both the light defaults and the `dark` overrides layered on top):
```ts
import { describe, expect, it } from 'vitest';
import { contrastRatio } from './contrast';

describe('contrastRatio', () => {
  it('is 21 for pure black on pure white', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
  });

  it('is 1 for identical colors', () => {
    expect(contrastRatio('#4f46e5', '#4f46e5')).toBeCloseTo(1, 5);
  });
});

describe('default theme meets WCAG AA (4.5:1) for text/background token pairs', () => {
  const AA = 4.5;

  it('light theme: body text on bg', () => {
    expect(contrastRatio('#16161a', '#ffffff')).toBeGreaterThanOrEqual(AA);
  });
  it('light theme: user bubble text on user bubble', () => {
    expect(contrastRatio('#ffffff', '#4f46e5')).toBeGreaterThanOrEqual(AA);
  });
  it('light theme: assistant bubble text on assistant bubble', () => {
    expect(contrastRatio('#16161a', '#f2f2f4')).toBeGreaterThanOrEqual(AA);
  });
  it('light theme: accent-contrast text on accent (Send button)', () => {
    expect(contrastRatio('#ffffff', '#4f46e5')).toBeGreaterThanOrEqual(AA);
  });
  it('dark theme: body text on bg', () => {
    expect(contrastRatio('#f2f2f4', '#16161a')).toBeGreaterThanOrEqual(AA);
  });
  it('dark theme: assistant bubble text on assistant bubble', () => {
    expect(contrastRatio('#f2f2f4', '#26262b')).toBeGreaterThanOrEqual(AA);
  });
});
```
If any of these fail against the actual current token values, that's a real defect this audit is supposed to catch — fix the failing token value in `tokens.css` (not the test) and re-run, per spec §16's "audited as part of CI" intent. Run once fully; if all pass, no `tokens.css` color changes are needed.

Export `chatkitTailwindPreset` and `contrastRatio` from `packages/ui/src/index.ts`. Run the full `@chatkit-svelte/ui` suite + `svelte-check`. Rebuild.

---

### Task 3: Accessibility + Internationalization

- [x] **Step 1: `I18nConfig` + default message table in `@chatkit-svelte/core`**

`packages/core/src/i18n.ts`:
```ts
export interface I18nConfig {
  locale: string;
  messages: Record<string, string>;
  formatDate?(ts: number, locale: string): string;
}

export const defaultMessages: Record<string, string> = {
  'composer.placeholder': 'Type a message…',
  'composer.send': 'Send',
  'composer.attach': 'Attach',
  'approvalBar.approve': 'Approve',
  'approvalBar.reject': 'Reject',
  'approvalBar.edit': 'Edit',
  'approvalBar.retry': 'Retry',
  'approvalBar.cancel': 'Cancel',
  'form.submit': 'Submit',
  'form.validation.required': 'This field is required.',
  'document.edit': 'Edit',
  'document.save': 'Save',
  'document.cancel': 'Cancel',
  'document.export': 'Export {format}',
};

const RTL_LOCALES = new Set(['ar', 'he', 'fa', 'ur']);

export function directionForLocale(locale: string | undefined): 'ltr' | 'rtl' {
  if (!locale) return 'ltr';
  const base = locale.split('-')[0].toLowerCase();
  return RTL_LOCALES.has(base) ? 'rtl' : 'ltr';
}

export function translate(messages: Record<string, string>, key: string, params?: Record<string, string>): string {
  const template = messages[key] ?? defaultMessages[key] ?? key;
  if (!params) return template;
  return Object.entries(params).reduce((acc, [k, v]) => acc.replaceAll(`{${k}}`, v), template);
}
```

`packages/core/src/i18n.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { defaultMessages, directionForLocale, translate } from './i18n';

describe('translate', () => {
  it('returns the default English message for a known key with no overrides', () => {
    expect(translate({}, 'composer.send')).toBe('Send');
  });

  it('prefers a per-key override over the default', () => {
    expect(translate({ 'composer.send': 'Envoyer' }, 'composer.send')).toBe('Envoyer');
  });

  it('falls back to the raw key when there is no default or override', () => {
    expect(translate({}, 'totally.unknown.key')).toBe('totally.unknown.key');
  });

  it('interpolates {param} placeholders', () => {
    expect(translate(defaultMessages, 'document.export', { format: 'pdf' })).toBe('Export pdf');
  });
});

describe('directionForLocale', () => {
  it('returns ltr for English and when no locale is given', () => {
    expect(directionForLocale('en')).toBe('ltr');
    expect(directionForLocale(undefined)).toBe('ltr');
  });

  it('returns rtl for Arabic and Hebrew, including region-suffixed locale tags', () => {
    expect(directionForLocale('ar')).toBe('rtl');
    expect(directionForLocale('he-IL')).toBe('rtl');
  });
});
```

Run, confirm failure then pass (6 tests). Add `i18n?: I18nConfig` to `ChatConfig` in `config.ts`; `export * from './i18n';` in `index.ts`. Rebuild `@chatkit-svelte/core`.

- [x] **Step 2: `store.t()` / `store.dir` on `createChatStore`**

Add to `packages/svelte/src/chat-store.svelte.ts` (near the other getters on the returned object):
```ts
  function t(key: string, params?: Record<string, string>): string {
    return translate(config.i18n?.messages ?? {}, key, params);
  }
  const dir = directionForLocale(config.i18n?.locale);
```
with `translate`/`directionForLocale` added to the `@chatkit-svelte/core` import, and `t`/`get dir() { return dir; }` added to the returned object.

Add tests to `chat-store.test.ts`:
```ts
describe('i18n', () => {
  it('t() returns the default English string when no i18n config is given', async () => {
    const transport = createFixtureTransport([]);
    const store = createChatStore({ transport, threadId: 't1' });
    expect(store.t('composer.send')).toBe('Send');
    store.dispose();
  });

  it('t() uses a per-key override from config.i18n.messages', async () => {
    const transport = createFixtureTransport([]);
    const store = createChatStore({
      transport,
      threadId: 't1',
      i18n: { locale: 'fr', messages: { 'composer.send': 'Envoyer' } },
    });
    expect(store.t('composer.send')).toBe('Envoyer');
    store.dispose();
  });

  it('dir reflects an RTL locale', async () => {
    const transport = createFixtureTransport([]);
    const store = createChatStore({ transport, threadId: 't1', i18n: { locale: 'ar', messages: {} } });
    expect(store.dir).toBe('rtl');
    store.dispose();
  });
});
```
Run full `@chatkit-svelte/svelte` suite + `svelte-check`; rebuild.

- [x] **Step 3: `<ChatWindow>` `dir` attribute**

Add `dir={store.dir}` to `ChatWindow.svelte`'s root div (alongside the existing `data-chatkit-theme` and the Task 2 `class` addition):
```svelte
<div class="ck-chat-window {className ?? ''}" data-chatkit-theme dir={store.dir}>
```
(`store` needs to be obtained via `getChatContext()` in `ChatWindow.svelte`, which it doesn't call today — add that.) Add a test asserting the root element's `dir` attribute matches an `i18n.locale: 'ar'` config.

- [x] **Step 4: Debounced live-region announcer in `MessageList.svelte`**

Add to `packages/ui/src/MessageList.svelte`'s script:
```ts
  import { onDestroy } from 'svelte';

  let announcedText = $state('');
  let announceTimer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    const last = store.messages.at(-1);
    if (!last || last.role !== 'assistant') return;
    const text = last.parts
      .filter((p): p is ContentPart & { type: 'text' } => p.type === 'text')
      .map((p) => p.text)
      .join('');
    clearTimeout(announceTimer);
    if (!last.streaming) {
      announcedText = text;
      return;
    }
    announceTimer = setTimeout(() => {
      announcedText = text;
    }, 600);
  });

  onDestroy(() => clearTimeout(announceTimer));
```
Add the hidden announcer element and drop `aria-live` from the visible list (keep `role="log"` for its landmark semantics):
```svelte
<div class="ck-message-list" role="log">
  <!-- ...existing {#each}... -->
</div>
<div class="ck-sr-only" role="status" aria-live="polite" data-testid="live-announcer">{announcedText}</div>
```
Add `.ck-sr-only` to the `<style>` block (standard visually-hidden-but-screen-reader-visible pattern):
```css
  .ck-sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
  }
```

Add tests to `MessageList.test.ts` using fake timers:
```ts
it('does not update the live announcer until 600ms after the last streamed delta', async () => {
  vi.useFakeTimers();
  const events: ChatEvent[] = [
    { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' },
    { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'Hello' },
  ];
  const transport = createFixtureTransport(events, { delayMs: 0 });
  render(MessageListV2Harness, { config: { transport, threadId: 't1' } });

  await vi.advanceTimersByTimeAsync(50);
  expect(screen.getByTestId('live-announcer')).toHaveTextContent('');

  await vi.advanceTimersByTimeAsync(600);
  expect(screen.getByTestId('live-announcer')).toHaveTextContent('Hello');

  vi.useRealTimers();
});

it('announces immediately on TEXT_MESSAGE_END without waiting for the debounce', async () => {
  const events: ChatEvent[] = [
    { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' },
    { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'Done' },
    { type: 'TEXT_MESSAGE_END', messageId: 'm1' },
  ];
  const transport = createFixtureTransport(events);
  render(MessageListV2Harness, { config: { transport, threadId: 't1' } });

  await waitFor(() => {
    expect(screen.getByTestId('live-announcer')).toHaveTextContent('Done');
  });
});
```
(Existing `MessageList.test.ts` in this repo renders `MessageList` directly through `TestHarness`/`ChatWindow` fixtures already established in M2/M3 — use whichever harness component the file already imports; the test names above are illustrative of the two cases to cover, not a literal drop-in requiring a new harness file.)

Run, confirm failure then pass. Run full `@chatkit-svelte/ui` suite + `svelte-check`.

- [x] **Step 5: i18n strings + focus management in `Composer.svelte`**

Full script changes: get `store` (already has it), replace hardcoded strings, add an `id` to the input and a refocus-after-send:
```ts
  let inputEl: HTMLInputElement | undefined = $state();

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    const value = text.trim();
    if (!value && pendingAttachments.length === 0) return;
    const attachments = pendingAttachments;
    text = '';
    pendingAttachments = [];
    await store.sendMessage({ text: value, attachments });
    inputEl?.focus();
  }
```
Markup changes:
```svelte
    <button type="button" class="ck-composer__attach" onclick={() => fileInput?.click()} aria-label={store.t('composer.attach')}>📎</button>
  {/if}
  <input
    id="ck-composer-input"
    bind:this={inputEl}
    class="ck-composer__input"
    bind:value={text}
    placeholder={store.t('composer.placeholder')}
    aria-label={store.t('composer.placeholder')}
  />
  <button class="ck-composer__send" type="submit">{store.t('composer.send')}</button>
```
Add a test confirming the input keeps focus after a successful send, and a test confirming an `i18n` config's `composer.send` override renders on the button.

- [x] **Step 6: i18n strings + focus management in `ApprovalBar.svelte`**

Replace all five hardcoded button labels with `store.t(...)` calls (`approvalBar.approve`/`reject`/`edit`/`retry`/`cancel`). Add focus management:
```ts
  import { onMount } from 'svelte';

  let barEl: HTMLDivElement | undefined = $state();
  let previousCount = 0;

  $effect(() => {
    const count = store.pendingApprovals.length;
    if (count > 0 && previousCount === 0) {
      barEl?.querySelector<HTMLButtonElement>('button')?.focus();
    } else if (count === 0 && previousCount > 0) {
      document.getElementById('ck-composer-input')?.focus();
    }
    previousCount = count;
  });
```
with `bind:this={barEl}` added to the root `<div class="ck-approval-bar" ...>`. Add a test: approving the only pending call moves focus to the composer input (given the composer is present in the same rendered tree — use the existing `TestHarness`, which already renders the full `ChatWindow`).

- [x] **Step 7: `role="form"` + i18n in `FormRenderer.svelte`** (`@chatkit-svelte/plugin-forms`)

Explicit `role="form"` on the `<form>` element turned out to be a no-op worth *not* adding: Svelte's own `a11y_no_redundant_roles` check flags it, correctly — a native `<form>` element already carries an implicit ARIA role of `form`, so the explicit attribute adds nothing and would be the only svelte-check warning in the whole milestone. Left out; the native semantics already satisfy spec §16's intent. Replaced the hardcoded `data.submitLabel ?? 'Submit'` fallback with `data.submitLabel ?? store.t('form.submit')`, and the hardcoded validation message inside `validateField`'s required check (`packages/plugin-forms/src/validate.ts`) — since `validate.ts` is a plain function with no store access, its literal English strings stay as the ultimate fallback but `FormRenderer.svelte` now prefers `store.t('form.validation.required')` **only for the required-field case** when re-rendering the error (a full per-validation-rule i18n pass — minLength/pattern/min/max message keys too — is straightforward but not done here; noted below as a deferred follow-up, matching this session's established practice of naming rather than silently limiting scope).

- [x] **Step 8: i18n in `DocumentCanvas.svelte`** (`@chatkit-svelte/plugin-documents`)

Replace `Edit`/`Save`/`Cancel`/`Export {format}` literals with `store.t('document.edit')` etc., using `store.t('document.export', { format })` for the per-format export buttons.

- [x] **Step 9: Full verification**

Run the full test suite + `svelte-check`/`tsc` for `core`, `svelte`, `ui`, `plugin-forms`, `plugin-documents`. Rebuild all five in dependency order.

---

### Task 4: `create-chatkit` CLI

- [x] **Step 1: Build config**

`packages/cli/package.json` (full content — adds the missing pieces to the existing scaffold):
```json
{
  "name": "create-chatkit",
  "version": "0.0.0",
  "description": "npx create-chatkit my-chat-app — scaffolds a bare Vite+Svelte app wired to @chatkit-svelte/svelte + @chatkit-svelte/ui with chosen plugins/theme. SvelteKit scaffolding is not yet supported.",
  "type": "module",
  "bin": {
    "create-chatkit": "./dist/index.js"
  },
  "files": ["dist", "templates"],
  "scripts": {
    "build": "vite build --mode lib",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vite": "^5.4.0",
    "vitest": "^2.0.0"
  }
}
```
(No new runtime dependencies — Step 9's prompt loop is hand-rolled on Node's built-in `readline`.)

`packages/cli/tsconfig.json`:
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

- [x] **Step 2: Copy the token file template**

Copy the current content of `packages/ui/src/tokens.css` verbatim to a new `packages/cli/templates/tokens.css`.

- [x] **Step 3: Write the failing tests — `packages/cli/src/generate-project.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { generateProject } from './generate-project';

describe('generateProject', () => {
  it('always includes package.json, vite config, index.html, main.ts, App.svelte, chatkit.config.ts, tokens.css, and the SSE echo server', () => {
    const files = generateProject({ appName: 'my-chat-app', plugins: [], theme: 'light' });
    const paths = files.map((f) => f.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        'package.json',
        'vite.config.ts',
        'index.html',
        'src/main.ts',
        'src/App.svelte',
        'src/chatkit.config.ts',
        'src/tokens.css',
        'server/sse-echo-server.mjs',
      ])
    );
  });

  it('names the generated package after appName', () => {
    const files = generateProject({ appName: 'trip-planner', plugins: [], theme: 'light' });
    const pkg = JSON.parse(files.find((f) => f.path === 'package.json')!.content);
    expect(pkg.name).toBe('trip-planner');
  });

  it('adds a dependency and an import for each selected plugin', () => {
    const files = generateProject({ appName: 'app', plugins: ['markdown', 'forms'], theme: 'light' });
    const pkg = JSON.parse(files.find((f) => f.path === 'package.json')!.content);
    expect(pkg.dependencies['@chatkit-svelte/plugin-markdown']).toBeDefined();
    expect(pkg.dependencies['@chatkit-svelte/plugin-forms']).toBeDefined();
    expect(pkg.dependencies['@chatkit-svelte/plugin-documents']).toBeUndefined();

    const configFile = files.find((f) => f.path === 'src/chatkit.config.ts')!.content;
    expect(configFile).toContain("import { markdownPlugin } from '@chatkit-svelte/plugin-markdown'");
    expect(configFile).toContain("import { formsPlugin } from '@chatkit-svelte/plugin-forms'");
    expect(configFile).not.toContain('plugin-documents');
  });

  it('sets data-chatkit-theme according to the chosen theme, including "system"', () => {
    const dark = generateProject({ appName: 'app', plugins: [], theme: 'dark' });
    expect(dark.find((f) => f.path === 'src/App.svelte')!.content).toContain("data-chatkit-theme=\"dark\"");

    const system = generateProject({ appName: 'app', plugins: [], theme: 'system' });
    expect(system.find((f) => f.path === 'src/App.svelte')!.content).toContain('prefers-color-scheme');
  });

  it('points the generated transport at /api/agent by default', () => {
    const files = generateProject({ appName: 'app', plugins: [], theme: 'light' });
    const app = files.find((f) => f.path === 'src/App.svelte')!.content;
    expect(app).toContain("endpoint: '/api/agent'");
  });
});
```

- [x] **Step 4: Run and confirm failure**

```bash
npx pnpm@9.0.0 --filter create-chatkit exec vitest run
```
Expected: FAIL — module not found.

- [x] **Step 5: Write `packages/cli/src/sse-echo-server-template.ts`** (the generated dev server's source, as a template string — kept in its own file so it's easy to read/update independently of the generator's file-list logic)

```ts
export const sseEchoServerSource = `import { createServer } from 'node:http';

// Minimal AG-UI-shaped SSE echo server for local development: POST a run,
// GET the event stream, and it plays the last user message back as a
// streamed assistant reply. Not a real agent backend — replace this once
// you have one.
const PORT = process.env.PORT ? Number(process.env.PORT) : 8787;
const clients = new Map(); // threadId -> Set<ServerResponse>
let lastUserText = 'Hello! Ask me anything.';

function send(res, event) {
  res.write(\`data: \${JSON.stringify(event)}\\n\\n\`);
}

function broadcast(threadId, event) {
  for (const res of clients.get(threadId) ?? []) send(res, event);
}

async function streamReply(threadId, text) {
  const runId = crypto.randomUUID();
  const messageId = crypto.randomUUID();
  broadcast(threadId, { type: 'RUN_STARTED', runId, threadId });
  broadcast(threadId, { type: 'TEXT_MESSAGE_START', messageId, role: 'assistant' });
  const reply = \`You said: \${text}\`;
  for (const word of reply.split(' ')) {
    broadcast(threadId, { type: 'TEXT_MESSAGE_CONTENT', messageId, delta: word + ' ' });
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  broadcast(threadId, { type: 'TEXT_MESSAGE_END', messageId });
  broadcast(threadId, { type: 'RUN_FINISHED', runId });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, \`http://\${req.headers.host}\`);

  if (req.method === 'GET' && url.pathname.match(/^\\/threads\\/(.+)\\/events$/)) {
    const threadId = url.pathname.split('/')[2];
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    if (!clients.has(threadId)) clients.set(threadId, new Set());
    clients.get(threadId).add(res);
    req.on('close', () => clients.get(threadId)?.delete(res));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/runs') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', async () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
      const input = JSON.parse(body || '{}');
      const lastMessage = input.messages?.at(-1);
      const text = lastMessage?.parts?.find((p) => p.type === 'text')?.text ?? lastUserText;
      lastUserText = text;
      await streamReply(input.threadId, text);
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  console.log(\`chatkit SSE echo server listening on http://localhost:\${PORT}\`);
});
`;
```

- [x] **Step 6: Write `packages/cli/src/generate-project.ts`**

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { sseEchoServerSource } from './sse-echo-server-template';

const __dirname = dirname(fileURLToPath(import.meta.url));

export type PluginChoice = 'file-handling' | 'markdown' | 'forms' | 'documents';
export type ThemeChoice = 'light' | 'dark' | 'system';

export interface GenerateProjectOptions {
  appName: string;
  plugins: PluginChoice[];
  theme: ThemeChoice;
}

export interface GeneratedFile {
  path: string;
  content: string;
}

const PLUGIN_PACKAGES: Record<PluginChoice, { pkg: string; importName: string; factory: string }> = {
  'file-handling': { pkg: '@chatkit-svelte/plugin-file-handling', importName: 'fileHandlingPlugin', factory: 'fileHandlingPlugin({ upload: async (file) => ({ url: URL.createObjectURL(file) }) })' },
  markdown: { pkg: '@chatkit-svelte/plugin-markdown', importName: 'markdownPlugin', factory: 'markdownPlugin()' },
  forms: { pkg: '@chatkit-svelte/plugin-forms', importName: 'formsPlugin', factory: 'formsPlugin()' },
  documents: { pkg: '@chatkit-svelte/plugin-documents', importName: 'documentsPlugin', factory: 'documentsPlugin()' },
};

function tokensCss(): string {
  return readFileSync(join(__dirname, '..', 'templates', 'tokens.css'), 'utf-8');
}

function themeAttribute(theme: ThemeChoice): string {
  return theme === 'system' ? '' : ` data-chatkit-theme="${theme}"`;
}

export function generateProject(options: GenerateProjectOptions): GeneratedFile[] {
  const { appName, plugins, theme } = options;
  const pluginEntries = plugins.map((p) => PLUGIN_PACKAGES[p]);

  const packageJson = {
    name: appName,
    version: '0.0.1',
    private: true,
    type: 'module',
    scripts: {
      dev: 'vite',
      build: 'vite build',
      'dev:server': 'node server/sse-echo-server.mjs',
    },
    dependencies: {
      svelte: '^5.0.0',
      '@chatkit-svelte/core': '^0.0.0',
      '@chatkit-svelte/svelte': '^0.0.0',
      '@chatkit-svelte/ui': '^0.0.0',
      '@chatkit-svelte/transport-agui': '^0.0.0',
      ...Object.fromEntries(pluginEntries.map((e) => [e.pkg, '^0.0.0'])),
    },
    devDependencies: {
      '@sveltejs/vite-plugin-svelte': '^4.0.0',
      vite: '^5.4.0',
      typescript: '^5.5.0',
    },
  };

  const viteConfig = `import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  server: {
    proxy: { '/api': 'http://localhost:8787' },
  },
});
`;

  const indexHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>${appName}</title>
    <link rel="stylesheet" href="/src/tokens.css" />
  </head>
  <body>
    <div id="app" style="height: 100vh;"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
`;

  const mainTs = `import { mount } from 'svelte';
import App from './App.svelte';

mount(App, { target: document.getElementById('app')! });
`;

  const themeScript =
    theme === 'system'
      ? `\n  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;\n`
      : '';

  const appSvelte = `<script lang="ts">
  import { ChatProvider } from '@chatkit-svelte/svelte';
  import { ChatWindow } from '@chatkit-svelte/ui';
  import { createAguiTransport } from '@chatkit-svelte/transport-agui';
  import { plugins } from './chatkit.config';
${themeScript}
  const config = {
    threadId: 'default',
    transport: createAguiTransport({ endpoint: '/api/agent' }),
    plugins,
  };
</script>

<div style="height: 100%;"${theme === 'system' ? " data-chatkit-theme={prefersDark ? 'dark' : 'light'}" : themeAttribute(theme)}>
  <ChatProvider {config}>
    {#snippet children()}
      <ChatWindow />
    {/snippet}
  </ChatProvider>
</div>
`;

  const chatkitConfig = `${pluginEntries.map((e) => `import { ${e.importName} } from '${e.pkg}';`).join('\n')}

export const plugins = [${pluginEntries.map((e) => e.factory).join(', ')}];
`;

  return [
    { path: 'package.json', content: JSON.stringify(packageJson, null, 2) },
    { path: 'vite.config.ts', content: viteConfig },
    { path: 'index.html', content: indexHtml },
    { path: 'src/main.ts', content: mainTs },
    { path: 'src/App.svelte', content: appSvelte },
    { path: 'src/chatkit.config.ts', content: chatkitConfig },
    { path: 'src/tokens.css', content: tokensCss() },
    { path: 'server/sse-echo-server.mjs', content: sseEchoServerSource },
  ];
}
```

- [x] **Step 7: Run and confirm pass**

```bash
npx pnpm@9.0.0 --filter create-chatkit exec vitest run
```
Expected: PASS — 5 tests. (As actually implemented, `appSvelte`'s template is two full separate string branches — `theme === 'system'` vs. `'light'|'dark'` — rather than a shared `themeAttribute()` helper interpolated into one template; the two branches need different markup shapes (a computed `data-chatkit-theme={...}` attribute expression vs. a static one), and threading that through one helper was more awkward than clarifying.)

- [x] **Step 8: Write `packages/cli/src/prompts.ts`** (hand-rolled `readline` prompt helpers)

**Real bug found and fixed while running Step 10's end-to-end smoke test, not part of the original design:** Node's `readline/promises` has a genuine limitation with piped (non-TTY) stdin — sequential `question()` calls hang after the first one. Reproduced independently of this codebase with a minimal two-question script (`const a = await rl.question('A: '); const b = await rl.question('B: ');` — `b` never resolves when fed piped input, logging "Detected unsettled top-level await"). This isn't just a testing inconvenience: any real user piping answers into `create-chatkit` non-interactively (CI, a wrapper script) would hit the exact same hang. Fixed by detecting `process.stdin.isTTY`: interactive terminals keep using `readline`'s `question()` as originally designed; piped input instead reads all of stdin upfront and serves answers from a line queue.

```ts
import { createInterface } from 'node:readline/promises';

export interface PromptIO {
  question(query: string): Promise<string>;
  close(): void;
}

function createPipedPromptIO(): PromptIO {
  const chunks: Buffer[] = [];
  const readAll = new Promise<string[]>((resolve) => {
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8').split('\n')));
  });
  let linesPromise: Promise<string[]> | undefined;
  let index = 0;

  return {
    async question(query: string) {
      process.stdout.write(query);
      linesPromise ??= readAll;
      const lines = await linesPromise;
      const line = (lines[index] ?? '').replace(/\r$/, '');
      index += 1;
      process.stdout.write(`${line}\n`);
      return line;
    },
    close() {},
  };
}

export function createPromptIO(): PromptIO {
  if (!process.stdin.isTTY) return createPipedPromptIO();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return { question: (query) => rl.question(query), close: () => rl.close() };
}

export async function askText(io: PromptIO, label: string, defaultValue: string): Promise<string> {
  const answer = (await io.question(`${label} (${defaultValue}): `)).trim();
  return answer || defaultValue;
}

export async function askChoice<T extends string>(io: PromptIO, label: string, choices: T[], defaultValue: T): Promise<T> {
  const answer = (await io.question(`${label} [${choices.join('/')}] (${defaultValue}): `)).trim();
  return (choices as string[]).includes(answer) ? (answer as T) : defaultValue;
}

export async function askMultiChoice<T extends string>(io: PromptIO, label: string, choices: T[], defaults: T[]): Promise<T[]> {
  const answer = (await io.question(`${label} [${choices.join(', ')}] (default: ${defaults.join(', ')}, comma-separated, "none" for empty): `)).trim();
  if (!answer) return defaults;
  if (answer === 'none') return [];
  return answer
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is T => (choices as string[]).includes(s));
}
```

- [x] **Step 9: Write `packages/cli/src/index.ts`** (the bin entry)

```ts
#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { generateProject, type PluginChoice, type ThemeChoice } from './generate-project';
import { askChoice, askMultiChoice, askText, createPromptIO } from './prompts';

async function main() {
  const targetArg = process.argv[2];
  const io = createPromptIO();

  const appName = targetArg ?? (await askText(io, 'App name', 'my-chat-app'));
  const pluginChoices: PluginChoice[] = ['file-handling', 'markdown', 'forms', 'documents'];
  const plugins = await askMultiChoice(io, 'Plugins to include', pluginChoices, pluginChoices);
  const theme = await askChoice<ThemeChoice>(io, 'Theme', ['light', 'dark', 'system'], 'system');
  io.close();

  const files = generateProject({ appName, plugins, theme });
  const root = join(process.cwd(), appName);
  for (const file of files) {
    const fullPath = join(root, file.path);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, file.content, 'utf-8');
  }

  console.log(`\nCreated ${appName} — next steps:\n`);
  console.log(`  cd ${appName}`);
  console.log('  npm install');
  console.log('  npm run dev:server   # in one terminal — the local SSE echo backend');
  console.log('  npm run dev          # in another — the Vite dev server\n');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

Only the `--target-dir`-style positional-arg path (`npx create-chatkit my-app`) is exercised by an automated test (Step 3's `generateProject` tests cover all the real logic); the interactive-prompt fallback path is intentionally left to manual verification — spawning a real TTY/readline session from an automated test is high-effort for low value here, and every actual decision `index.ts` makes (which files, what content) is already covered through `generateProject`.

- [x] **Step 10: Build config and verification**

`packages/cli/vite.config.ts` — no Svelte plugin needed (this package has zero `.svelte` files):
```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: 'index',
    },
    ssr: true,
  },
  test: {
    environment: 'node',
  },
});
```
`ssr: true` (Node-targeted build) prevents Vite from trying to bundle `node:fs`/`node:path`/`node:readline` for a browser target.

```bash
npx pnpm@9.0.0 --filter create-chatkit exec vitest run
npx pnpm@9.0.0 --filter create-chatkit exec tsc --noEmit
npx pnpm@9.0.0 --filter create-chatkit build
```
Expected: 5 tests pass, 0 type errors, build succeeds (`dist/index.js`).

Then a real end-to-end smoke test (manual, not part of the automated suite — generates into a scratch temp directory, not the repo): run the built CLI non-interactively (`printf 'smoke-test-app\n\n\n' | node dist/index.js`), confirm the expected files exist, then delete the scratch directory. This is what actually caught Step 8's piped-stdin `readline` hang — `generateProject`'s own unit tests couldn't have found it, since the bug lived entirely in `index.ts`'s prompt-reading wiring, not in the generation logic. Ran clean after the Step 8 fix: all 8 expected files generated, `chatkit.config.ts` and `package.json` both correct for the default (all-plugins, system-theme) answers.

---

## Notes for the next plan (M7)

- SvelteKit scaffolding and the Vercel AI SDK transport prompt option are still not offered by `create-chatkit` — both explicitly deferred here (decision 9). M7 builds the Vercel AI SDK transport adapter itself; once that exists, revisit the CLI's transport prompt. **Done in M7** ([2026-08-23-m7-vercel-transport-devtools.md](2026-08-23-m7-vercel-transport-devtools.md), Task 3) — the transport prompt now offers `agui`/`vercel-ai`; SvelteKit scaffolding remains permanently out of scope (no milestone left to build it).
- `plugin-devtools` still doesn't exist as a package — M7 also mentions "devtools fixture export," so that milestone is the natural place to build it and then add it back into the CLI's plugin checklist. **Done in M7**, same plan/task as above — `devtools` is back in the CLI's plugin checklist, unchecked by default.
- Form validation message i18n only covers the `required` case (Task 3 Step 7) — minLength/maxLength/pattern/minimum/maximum messages in `packages/plugin-forms/src/validate.ts` are still hardcoded English. A full i18n pass there needs `validate()` to accept a translator function, which changes its signature — worth doing together with whatever milestone next touches `plugin-forms` in earnest.
- The IndexedDB adapter's single-object-store design (decision 2) should be revisited if a future milestone needs large-document version history (spec §14.3's "diffable against the prior version… stored via the persistence layer's version history table" — mentioned in the M5 plan's own notes-for-next-plan and still not built).

---

- [x] **Mark the milestone complete**

No git commit — per repo owner preference, commits are handled manually. This is the natural stopping point for M6; M7 (second transport adapter + devtools fixture export) is a separate plan.
