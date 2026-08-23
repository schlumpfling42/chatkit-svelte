# M5 — Forms & Documents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Git note:** commit steps are intentionally omitted — the repo owner handles git operations manually. Do not run `git add`/`git commit` while executing this plan unless explicitly asked to in the moment.

**Goal:** Close out spec §22 M5, whose own wording scopes it down explicitly: *"artifact reducer contract, `plugin-forms`, `plugin-documents` (markdown mode first, richtext second)."* This plan builds the artifact reducer contract's actual wiring (typed since M0, never consumed until now), `plugin-forms` (JSON-Schema-driven form artifacts), and `plugin-documents` in **markdown mode only** — richtext (ProseMirror) is explicitly "second" per the milestone's own text and is deferred, not attempted here.

**Spec §14 sections consulted:** §14.1 (transport convention: `chatkit.form.*`/`chatkit.document.*` `CUSTOM` events), §14.2 (`plugin-forms`), §14.3 (`plugin-documents`), §14.4 (artifact reducer contract), §14.5 (config example).

---

## Design decisions this plan has to make (spec §14 is descriptive prose + one reference interface block, not exhaustive wire/API contracts)

**1. Where artifact-reducer routing actually happens.** `reducer.ts`'s `CUSTOM` case has been a documented no-op since M0 ("delegated to registered ArtifactReducers by the plugin host — a later milestone"). `core` has no knowledge of plugins, so this routing belongs in `@chatkit/svelte`'s `chat-store.svelte.ts`, next to where `pluginHost.registry` already lives. A shared `applyEvent(event)` helper replaces the current bare `state = reduceEvent(state, event)` call in `consumeStream`: it runs the reducer, then — for `CUSTOM` events only — finds the first registered `ArtifactReducer` (across all kinds, flattened) whose `.matches(event)` is true and folds its `.apply(state.artifacts, event)` result into state.

**2. The chat store needs a generic, artifact-agnostic way for a renderer component to push a local event.** Spec's prose says `store.submitForm(artifactId, values)` — but adding form-shaped methods to the generic core store would mean `@chatkit/svelte` importing form-specific types from a plugin package, inverting the dependency direction every other plugin in this codebase respects (plugins depend on `svelte`/`core`, never the reverse). Instead, this plan exposes one new generic method on the public `ChatStore`: `dispatch(event: ChatEvent): void` (delegating to the same `applyEvent` helper `PluginContext.dispatch` already uses internally). `FormRenderer`/`DocumentCanvas` use it to apply a local, synchronous status change (e.g. `chatkit.form.result` flips the artifact to `'submitted'` immediately, without waiting on a round trip), then use the existing `store.sendMessage()` to actually deliver the result to the backend as a `custom` content part — reusing two already-generic primitives instead of inventing form/document-specific store methods.

**3. `PluginRegistry.artifactRenderers`'s value shape needs to support renderer options, or `formsPlugin(options)`/`documentsPlugin(options)` can't reach their own components.** Nothing has consumed `artifactRenderers` before this milestone (typed since M0, never read), so this plan gets to define its actual runtime contract. A naive module-level singleton for plugin options (the initially-tempting shortcut) would break spec §8's own explicitly-stated multi-instance use case (a dashboard with several concurrent `<ChatWindow>`s, each independently configured) — two `formsPlugin({...})` calls with different `onBeforeSubmit` callbacks would silently clobber each other. Instead, a registered `artifactRenderers[kind]` entry may now be **either** a bare component **or** `{ component, props }`; the new `<ArtifactPanel>` consumer (built in this plan, `@chatkit/ui`) unwraps whichever shape it finds and spreads `props` onto the rendered component alongside `artifact`. This is a purely additive contract change (the type was already `unknown`) that lets `formsPlugin(options)`/`documentsPlugin(options)` bake their options into `props` at construction time — correct per-instance, no singleton.

**4. `chatkit.document.delta`'s payload, for markdown-format documents.** Spec describes it generically as "RFC 6902 over the document's JSON representation" — that phrasing is written for richtext's structured ProseMirror doc model (deferred here). Applying RFC 6902 patch *operations* to a bare markdown *string* doesn't have an obvious mapping. Scoped for markdown mode only: `chatkit.document.delta`'s payload is `{ artifactId, append: string }` — a plain text append, mirroring how `TEXT_MESSAGE_CONTENT` streams chat text. Full JSON-Patch deltas are reserved for richtext mode once it's built.

**5. Document status transitions, given the wire contract defines no explicit "stream finished" event.** `chatkit.document.snapshot` ("creates or fully replaces... full document content") sets status `'final'` — a full replace is, by its own description, the complete/authoritative content. `chatkit.document.delta` sets status `'streaming'` and appends. A backend that wants the "watch it get written" experience sends an initial (possibly empty-content) snapshot, then deltas (status stays `'streaming'`), then a final snapshot with the complete content once done (status flips back to `'final'`). This is a known, documented gap inherited from the spec's wire contract, not something this plan invents a fix for.

**6. `chatkit.document.comment` is explicitly "Optional" per spec's own table — not built.** No comment UI, no reducer handling for it this milestone.

**7. Form `mode: 'live'` and `widgetOverrides` (custom field components per JSON Schema `format`) are accepted in the config type but not wired.** `'live'` mode (values streaming back via `STATE_DELTA`-style updates as the user types) needs the same kind of client→server incremental-state-push machinery the transport layer doesn't have yet (only server→client `STATE_DELTA` exists today). `widgetOverrides` needs a dynamic-component-per-format registry beyond this milestone's scope. Both are typed and accepted by `formsPlugin(options)` (so call sites written against the full spec compile) but documented here as not-yet-functional — same treatment M3 gave `shiki` syntax highlighting and M4 gave the `PluginHost.runHook` multi-plugin wrinkle: named, not silently dropped.

**8. `onBeforeSubmit` IS wired** (cheap, high-value, no missing infrastructure) — called with the form's local values before `dispatch`/`sendMessage`, via the `props`-passing mechanism from decision 3.

**9. Document export.** `exportDocument(artifact, format, handlers)` is a plain exported function from `@chatkit/plugin-documents` (not a store method, for the same reasoning as decision 2 — `core`/`svelte` stay artifact-agnostic). `md`/`txt` return `artifact.data.content` directly; `docx`/`pdf` call a consumer-supplied handler from `documentsPlugin({ exportHandlers })` (threaded via decision 3's `props`) or throw a clear "register an export handler" error, per spec §14.3.

---

## File Structure

```
packages/core/src/plugin-host.ts        # Task 1 — doc comment only, ArtifactRendererComponent shape note
packages/svelte/src/chat-store.svelte.ts # Task 1 — applyEvent() helper, public dispatch()
packages/svelte/src/chat-store.test.ts   # Task 1 — new tests
packages/ui/src/ArtifactPanel.svelte, ArtifactPanel.test.ts   # Task 2 — new
packages/ui/src/ChatWindow.svelte        # Task 2 — render ArtifactPanel
packages/ui/src/index.ts                 # Task 2 — barrel export
packages/plugin-forms/
  package.json, tsconfig.json, vite.config.ts, vitest-setup.ts   # Task 3
  src/types.ts, validate.ts, validate.test.ts                     # Task 3
  src/artifact-reducer.ts, artifact-reducer.test.ts                # Task 3
  src/FormRenderer.svelte, FormRenderer.test.ts, TestHarness.svelte # Task 3
  src/index.ts                                                     # Task 3
packages/plugin-documents/
  package.json, tsconfig.json, vite.config.ts, vitest-setup.ts    # Task 4
  src/types.ts                                                     # Task 4
  src/artifact-reducer.ts, artifact-reducer.test.ts                # Task 4
  src/export.ts, export.test.ts                                    # Task 4
  src/DocumentCanvas.svelte, DocumentCanvas.test.ts, TestHarness.svelte # Task 4
  src/index.ts                                                     # Task 4
```

---

### Task 1: Artifact-reducer routing + `store.dispatch()` in `@chatkit/svelte`

**Files:**
- Modify: `packages/svelte/src/chat-store.svelte.ts`
- Modify: `packages/svelte/src/chat-store.test.ts`

- [x] **Step 1: Write the failing tests**

Add to `packages/svelte/src/chat-store.test.ts` (needs `ArtifactReducer` added to the `@chatkit/core` type import):

```ts
describe('artifact reducer routing', () => {
  function testReducer(): ArtifactReducer {
    return {
      kind: 'generic',
      matches: (event) => event.type === 'CUSTOM' && event.name === 'test.artifact.snapshot',
      apply: (artifacts, event) => {
        if (event.type !== 'CUSTOM') return artifacts;
        const payload = event.payload as { artifactId: string; value: string };
        return {
          ...artifacts,
          [payload.artifactId]: {
            id: payload.artifactId,
            kind: 'generic',
            version: (artifacts[payload.artifactId]?.version ?? 0) + 1,
            createdByMessageId: '',
            data: { value: payload.value },
            status: 'final',
          },
        };
      },
    };
  }

  it('routes a CUSTOM event through a matching registered ArtifactReducer', async () => {
    const events: ChatEvent[] = [
      { type: 'CUSTOM', name: 'test.artifact.snapshot', payload: { artifactId: 'a1', value: 'hello' } },
    ];
    const transport = createFixtureTransport(events);
    const plugin: ChatPlugin = { name: 'test-artifacts', version: '1.0.0', artifactReducers: [testReducer()] };
    const store = createChatStore({ transport, threadId: 't1', plugins: [plugin] });

    await vi.waitFor(() => {
      expect(store.state.artifacts.a1).toBeDefined();
    });

    expect(store.state.artifacts.a1).toMatchObject({ kind: 'generic', data: { value: 'hello' }, status: 'final' });

    store.dispose();
  });

  it('leaves artifacts untouched when no registered reducer matches the CUSTOM event', async () => {
    const events: ChatEvent[] = [{ type: 'CUSTOM', name: 'unknown.thing', payload: {} }];
    const transport = createFixtureTransport(events);
    const store = createChatStore({ transport, threadId: 't1' });

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(store.state.artifacts).toEqual({});

    store.dispose();
  });

  it('store.dispatch() applies a local event through the same artifact-reducer routing as the stream', async () => {
    const transport = createFixtureTransport([]);
    const plugin: ChatPlugin = { name: 'test-artifacts', version: '1.0.0', artifactReducers: [testReducer()] };
    const store = createChatStore({ transport, threadId: 't1', plugins: [plugin] });

    store.dispatch({ type: 'CUSTOM', name: 'test.artifact.snapshot', payload: { artifactId: 'a2', value: 'local' } });

    expect(store.state.artifacts.a2).toMatchObject({ data: { value: 'local' } });

    store.dispose();
  });
});
```

- [x] **Step 2: Run and confirm failure**

```bash
npx pnpm@9.0.0 --filter @chatkit/svelte exec vitest run src/chat-store.test.ts
```
Expected: FAIL — `store.dispatch` is not a function; artifacts never populate.

- [x] **Step 3: Refactor `consumeStream` and add `dispatch` in `packages/svelte/src/chat-store.svelte.ts`**

Replace the `ctx.dispatch` definition and the `state = reduceEvent(state, event);` line inside `consumeStream` with a shared helper, and add `dispatch` to the returned store. Only the changed regions are shown — everything else in the file (from the M4 plan's final version) is unchanged:

```ts
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
```

`applyEvent` must be declared before `ctx` (which references it) — hoisted `function` declarations make this safe regardless of source order, but keep `applyEvent` textually above `ctx` for readability.

Inside `consumeStream`'s loop, replace:
```ts
        state = reduceEvent(state, event);
```
with:
```ts
        applyEvent(event);
```

Add `dispatch` to the returned object, alongside the other public methods:
```ts
    dispatch: applyEvent,
```

- [x] **Step 4: Run and confirm pass**

```bash
npx pnpm@9.0.0 --filter @chatkit/svelte exec vitest run
npx pnpm@9.0.0 --filter @chatkit/svelte exec svelte-check --tsconfig ./tsconfig.json
```
Expected: PASS — 22 tests (19 existing + 3 new), 0 svelte-check errors/warnings.

- [x] **Step 5: Rebuild `@chatkit/svelte`** (its `dist/` is what every downstream package/test resolves `@chatkit/svelte` from)

```bash
npx pnpm@9.0.0 --filter @chatkit/svelte build
```

---

### Task 2: `<ArtifactPanel>` in `@chatkit/ui`

The generic consumer of `registry.artifactRenderers` — resolves either registration shape from decision 3 above and renders each artifact full-width, between the message list and the approval bar.

**Files:**
- Create: `packages/ui/src/ArtifactPanel.svelte`
- Create: `packages/ui/src/ArtifactPanel.test.ts`
- Modify: `packages/ui/src/ChatWindow.svelte`
- Modify: `packages/ui/src/index.ts`

- [x] **Step 1: Write the failing tests — `packages/ui/src/ArtifactPanel.test.ts`**

Reuses `TestHarness.svelte` (wraps `ChatProvider` + `ChatWindow`).

```ts
import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import TestHarness from './TestHarness.svelte';
import { createFixtureTransport } from '@chatkit/core';
import type { ArtifactRecord, ChatEvent, ChatPlugin } from '@chatkit/core';
import CustomArtifactCard from './CustomArtifactCard.test-helper.svelte';

function snapshotEvent(artifactId: string, value: string): ChatEvent {
  return { type: 'CUSTOM', name: 'test.artifact.snapshot', payload: { artifactId, value } };
}

function testPlugin(rendererRegistration: unknown): ChatPlugin {
  return {
    name: 'test-artifacts',
    version: '1.0.0',
    artifactReducers: [
      {
        kind: 'generic',
        matches: (event) => event.type === 'CUSTOM' && event.name === 'test.artifact.snapshot',
        apply: (artifacts, event) => {
          if (event.type !== 'CUSTOM') return artifacts;
          const payload = event.payload as { artifactId: string; value: string };
          const record: ArtifactRecord = {
            id: payload.artifactId,
            kind: 'generic',
            version: (artifacts[payload.artifactId]?.version ?? 0) + 1,
            createdByMessageId: '',
            data: { value: payload.value },
            status: 'final',
          };
          return { ...artifacts, [record.id]: record };
        },
      },
    ],
    artifactRenderers: { generic: rendererRegistration as never },
  };
}

describe('ArtifactPanel (via ChatWindow)', () => {
  it('renders nothing when there are no artifacts', async () => {
    const transport = createFixtureTransport([]);
    render(TestHarness, { config: { transport, threadId: 't1' } });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(screen.queryByTestId('artifact')).not.toBeInTheDocument();
  });

  it('renders a bare-component artifact renderer registration', async () => {
    const transport = createFixtureTransport([snapshotEvent('a1', 'hello')]);
    render(TestHarness, { config: { transport, threadId: 't1', plugins: [testPlugin(CustomArtifactCard)] } });

    await waitFor(() => {
      expect(screen.getByTestId('custom-artifact')).toHaveTextContent('hello');
    });
  });

  it('renders a { component, props } artifact renderer registration and spreads the extra props', async () => {
    const transport = createFixtureTransport([snapshotEvent('a1', 'hello')]);
    render(TestHarness, {
      config: {
        transport,
        threadId: 't1',
        plugins: [testPlugin({ component: CustomArtifactCard, props: { label: 'Extra' } })],
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId('custom-artifact')).toHaveTextContent('Extra: hello');
    });
  });
});
```

Create the tiny test-helper component `packages/ui/src/CustomArtifactCard.test-helper.svelte` (not part of the package's public build — a `*.test-helper.svelte` naming convention keeps it visually distinct from real source in `src/`; it's picked up by the test's own import, not by `index.ts`):

```svelte
<script lang="ts">
  import type { ArtifactRecord } from '@chatkit/core';

  interface Props {
    artifact: ArtifactRecord;
    label?: string;
  }

  let { artifact, label }: Props = $props();
  const value = $derived((artifact.data as { value: string }).value);
</script>

<div data-testid="custom-artifact">{label ? `${label}: ${value}` : value}</div>
```

- [x] **Step 2: Run and confirm failure**

```bash
npx pnpm@9.0.0 --filter @chatkit/ui exec vitest run src/ArtifactPanel.test.ts
```
Expected: FAIL — no `artifact`/`custom-artifact` testid rendered (no `<ArtifactPanel>` yet).

- [x] **Step 3: Write `packages/ui/src/ArtifactPanel.svelte`**

```svelte
<script lang="ts">
  import { getChatContext } from '@chatkit/svelte';
  import type { Component } from 'svelte';

  const store = getChatContext();

  function resolve(kind: string): { component: Component<Record<string, unknown>>; props: Record<string, unknown> } | undefined {
    const registration = (store.registry.artifactRenderers as Record<string, unknown>)[kind];
    if (!registration) return undefined;
    if (typeof registration === 'object' && registration !== null && 'component' in registration) {
      const r = registration as { component: Component<Record<string, unknown>>; props?: Record<string, unknown> };
      return { component: r.component, props: r.props ?? {} };
    }
    return { component: registration as Component<Record<string, unknown>>, props: {} };
  }
</script>

{#if Object.keys(store.state.artifacts).length > 0}
  <div class="ck-artifact-panel">
    {#each Object.values(store.state.artifacts) as artifact (artifact.id)}
      {@const resolved = resolve(artifact.kind)}
      {#if resolved}
        {@const Comp = resolved.component}
        <div class="ck-artifact" data-testid="artifact">
          <Comp {artifact} {...resolved.props} />
        </div>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .ck-artifact-panel {
    display: flex;
    flex-direction: column;
    gap: var(--ck-space-3);
    padding: var(--ck-space-3);
    border-bottom: 1px solid var(--ck-color-border);
  }

  .ck-artifact {
    border: 1px solid var(--ck-color-border);
    border-radius: var(--ck-radius-md);
    padding: var(--ck-space-3);
    background: var(--ck-color-surface);
  }
</style>
```

- [x] **Step 4: Wire `<ArtifactPanel>` into `packages/ui/src/ChatWindow.svelte`**

Full file content:

```svelte
<script lang="ts">
  import MessageList from './MessageList.svelte';
  import Composer from './Composer.svelte';
  import ApprovalBar from './ApprovalBar.svelte';
  import ArtifactPanel from './ArtifactPanel.svelte';
  import type { Snippet } from 'svelte';
  import type { Message } from '@chatkit/core';

  interface Props {
    message?: Snippet<[Message]>;
  }

  let { message }: Props = $props();
</script>

<div class="ck-chat-window" data-chatkit-theme>
  <ArtifactPanel />
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

`<ArtifactPanel>` is placed above `<MessageList>` — forms/documents are meant to sit "alongside the conversation" (spec §14) as a distinct full-width region, not inline in message bubbles, so it reads first, above the scrolling message log.

- [x] **Step 5: Add the barrel export — `packages/ui/src/index.ts`**

```ts
export { default as ChatWindow } from './ChatWindow.svelte';
export { default as MessageList } from './MessageList.svelte';
export { default as Composer } from './Composer.svelte';
export { default as ApprovalBar } from './ApprovalBar.svelte';
export { default as ArtifactPanel } from './ArtifactPanel.svelte';
```

- [x] **Step 6: Run and confirm pass**

```bash
npx pnpm@9.0.0 --filter @chatkit/ui exec vitest run
npx pnpm@9.0.0 --filter @chatkit/ui exec svelte-check --tsconfig ./tsconfig.json
```
Expected: PASS — 19 tests (16 existing + 3 new), 0 svelte-check errors/warnings. The two `ChatWindow.test.ts` and five `ApprovalBar.test.ts` tests are unaffected (no artifacts registered in those configs, so `<ArtifactPanel>` renders nothing for them).

- [x] **Step 7: Rebuild `@chatkit/ui`**

```bash
npx pnpm@9.0.0 --filter @chatkit/ui build
```

---

### Task 3: `@chatkit/plugin-forms`

**Files:** (all new except `package.json`, which already has a scaffold)
- Modify: `packages/plugin-forms/package.json`
- Create: `packages/plugin-forms/tsconfig.json`, `vite.config.ts`, `vitest-setup.ts`
- Create: `packages/plugin-forms/src/types.ts`
- Create: `packages/plugin-forms/src/validate.ts`, `validate.test.ts`
- Create: `packages/plugin-forms/src/artifact-reducer.ts`, `artifact-reducer.test.ts`
- Create: `packages/plugin-forms/src/FormRenderer.svelte`, `FormRenderer.test.ts`, `TestHarness.svelte`
- Create: `packages/plugin-forms/src/index.ts`

- [x] **Step 1: Build config — `package.json`/`tsconfig.json`/`vite.config.ts`/`vitest-setup.ts`**

`package.json` (full content — the scaffold already has name/description/exports/scripts/`@chatkit/core` dependency; this adds `@chatkit/svelte` as a real dependency, since `FormRenderer` calls `getChatContext()`, and the missing devDependencies):

```json
{
  "name": "@chatkit/plugin-forms",
  "version": "0.0.0",
  "description": "Agent-driven dynamic forms artifact (chatkit.form.* CUSTOM events): JSON-Schema-to-form renderer, client-side validation, submit round-trip.",
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
    "@chatkit/core": "workspace:*",
    "@chatkit/svelte": "workspace:*"
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

`tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "types": ["@testing-library/jest-dom"]
  },
  "include": ["src"]
}
```

`vite.config.ts` — externalizes both `@chatkit/core` and `@chatkit/svelte` (the M3/M4-established pattern; skipping this would re-introduce the exact `Symbol('chatkit')` duplication bug fixed in M3):
```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import dts from 'vite-plugin-dts';

export default defineConfig({
  plugins: [svelte(), dts({ rollupTypes: true })],
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: 'index',
    },
    rollupOptions: {
      external: ['svelte', /^svelte\//, '@chatkit/core', '@chatkit/svelte'],
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./vitest-setup.ts'],
  },
  resolve: {
    conditions: ['browser'],
  },
});
```

`vitest-setup.ts`:
```ts
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/svelte';

afterEach(() => {
  cleanup();
});
```

- [x] **Step 2: Install dependencies**

```bash
npx pnpm@9.0.0 install
```

- [x] **Step 3: Write `packages/plugin-forms/src/types.ts`**

```ts
import type { JSONSchema } from '@chatkit/core';

export type FormFieldWidget = 'text' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'date' | 'file' | 'slider';

export interface UiSchemaHints {
  order?: string[];
  widgets?: Record<string, FormFieldWidget>;
  groups?: { title: string; fields: string[] }[];
}

export interface FormArtifactData {
  schema: JSONSchema;
  uiSchema?: UiSchemaHints;
  submitLabel?: string;
  initialValues?: Record<string, unknown>;
  /** 'live' is accepted but not yet wired — see plan decision 7. Only 'single-submit' actually streams a result today. */
  mode: 'single-submit' | 'live';
  presentedAs?: 'tool_call' | 'artifact';
  toolCallId?: string;
  values?: Record<string, unknown>;
}

export interface FormSnapshotPayload {
  artifactId: string;
  createdByMessageId?: string;
  data: FormArtifactData;
}

export interface FormResultPayload {
  artifactId: string;
  values: Record<string, unknown>;
}
```

- [x] **Step 4: Write the failing tests — `packages/plugin-forms/src/validate.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { validateForm } from './validate';
import type { JSONSchema } from '@chatkit/core';

describe('validateForm', () => {
  it('reports a required field that is missing as an error', () => {
    const schema: JSONSchema = { type: 'object', required: ['name'], properties: { name: { type: 'string' } } };
    expect(validateForm(schema, {})).toEqual({ name: 'This field is required.' });
  });

  it('does not error on an optional field left empty', () => {
    const schema: JSONSchema = { type: 'object', properties: { nickname: { type: 'string' } } };
    expect(validateForm(schema, {})).toEqual({});
  });

  it('enforces minLength/maxLength/pattern on string fields', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: { code: { type: 'string', minLength: 3, maxLength: 5, pattern: '^[A-Z]+$' } },
    };
    expect(validateForm(schema, { code: 'ab' }).code).toBe('Must be at least 3 characters.');
    expect(validateForm(schema, { code: 'abcdef' }).code).toBe('Must be at most 5 characters.');
    expect(validateForm(schema, { code: 'abc' }).code).toBe('Invalid format.');
    expect(validateForm(schema, { code: 'ABC' })).toEqual({});
  });

  it('enforces minimum/maximum on number fields', () => {
    const schema: JSONSchema = { type: 'object', properties: { age: { type: 'number', minimum: 18, maximum: 120 } } };
    expect(validateForm(schema, { age: 10 }).age).toBe('Must be at least 18.');
    expect(validateForm(schema, { age: 200 }).age).toBe('Must be at most 120.');
    expect(validateForm(schema, { age: 30 })).toEqual({});
  });

  it('passes a fully valid set of values with no errors', () => {
    const schema: JSONSchema = {
      type: 'object',
      required: ['name'],
      properties: { name: { type: 'string', minLength: 1 }, age: { type: 'number', minimum: 0 } },
    };
    expect(validateForm(schema, { name: 'Ada', age: 30 })).toEqual({});
  });
});
```

- [x] **Step 5: Run and confirm failure**

```bash
npx pnpm@9.0.0 --filter @chatkit/plugin-forms exec vitest run src/validate.test.ts
```
Expected: FAIL — `Cannot find module './validate'`.

- [x] **Step 6: Write `packages/plugin-forms/src/validate.ts`**

```ts
import type { JSONSchema } from '@chatkit/core';

function isRequired(schema: JSONSchema, field: string): boolean {
  const required = schema.required as string[] | undefined;
  return Array.isArray(required) && required.includes(field);
}

export function validateField(fieldSchema: JSONSchema, value: unknown, required: boolean): string | undefined {
  const isEmpty = value === undefined || value === null || value === '';
  if (required && isEmpty) return 'This field is required.';
  if (isEmpty) return undefined;

  const type = fieldSchema.type as string | undefined;
  if (type === 'string' && typeof value === 'string') {
    const minLength = fieldSchema.minLength as number | undefined;
    const maxLength = fieldSchema.maxLength as number | undefined;
    const pattern = fieldSchema.pattern as string | undefined;
    if (minLength !== undefined && value.length < minLength) return `Must be at least ${minLength} characters.`;
    if (maxLength !== undefined && value.length > maxLength) return `Must be at most ${maxLength} characters.`;
    if (pattern !== undefined && !new RegExp(pattern).test(value)) return 'Invalid format.';
  }
  if (type === 'number' || type === 'integer') {
    const num = typeof value === 'number' ? value : Number(value);
    if (Number.isNaN(num)) return 'Must be a number.';
    const minimum = fieldSchema.minimum as number | undefined;
    const maximum = fieldSchema.maximum as number | undefined;
    if (minimum !== undefined && num < minimum) return `Must be at least ${minimum}.`;
    if (maximum !== undefined && num > maximum) return `Must be at most ${maximum}.`;
  }
  return undefined;
}

export function validateForm(schema: JSONSchema, values: Record<string, unknown>): Record<string, string> {
  const properties = (schema.properties as Record<string, JSONSchema>) ?? {};
  const errors: Record<string, string> = {};
  for (const [field, fieldSchema] of Object.entries(properties)) {
    const error = validateField(fieldSchema, values[field], isRequired(schema, field));
    if (error) errors[field] = error;
  }
  return errors;
}
```

- [x] **Step 7: Run and confirm pass**

```bash
npx pnpm@9.0.0 --filter @chatkit/plugin-forms exec vitest run src/validate.test.ts
```
Expected: PASS — 5 tests.

- [x] **Step 8: Write the failing tests — `packages/plugin-forms/src/artifact-reducer.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest';
import { formArtifactReducer } from './artifact-reducer';
import type { ChatEvent } from '@chatkit/core';

describe('formArtifactReducer', () => {
  it('matches chatkit.form.snapshot and chatkit.form.result CUSTOM events only', () => {
    expect(formArtifactReducer.matches({ type: 'CUSTOM', name: 'chatkit.form.snapshot', payload: {} })).toBe(true);
    expect(formArtifactReducer.matches({ type: 'CUSTOM', name: 'chatkit.form.result', payload: {} })).toBe(true);
    expect(formArtifactReducer.matches({ type: 'CUSTOM', name: 'chatkit.document.snapshot', payload: {} })).toBe(false);
    expect(formArtifactReducer.matches({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' })).toBe(false);
  });

  it('creates a draft form artifact from a chatkit.form.snapshot event', () => {
    const event: ChatEvent = {
      type: 'CUSTOM',
      name: 'chatkit.form.snapshot',
      payload: {
        artifactId: 'f1',
        createdByMessageId: 'm1',
        data: { schema: { type: 'object', properties: {} }, mode: 'single-submit' },
      },
    };
    const artifacts = formArtifactReducer.apply({}, event);
    expect(artifacts.f1).toMatchObject({ id: 'f1', kind: 'form', version: 1, status: 'draft', createdByMessageId: 'm1' });
  });

  it('increments version on a second snapshot for the same artifactId', () => {
    const first = formArtifactReducer.apply({}, {
      type: 'CUSTOM',
      name: 'chatkit.form.snapshot',
      payload: { artifactId: 'f1', data: { schema: {}, mode: 'single-submit' } },
    });
    const second = formArtifactReducer.apply(first, {
      type: 'CUSTOM',
      name: 'chatkit.form.snapshot',
      payload: { artifactId: 'f1', data: { schema: {}, mode: 'single-submit' } },
    });
    expect(second.f1.version).toBe(2);
  });

  it('drops a malformed snapshot payload with a warning instead of throwing', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const artifacts = formArtifactReducer.apply({}, { type: 'CUSTOM', name: 'chatkit.form.snapshot', payload: 'not an object' });
    expect(artifacts).toEqual({});
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('flips status to submitted and stores values on a chatkit.form.result event', () => {
    const withForm = formArtifactReducer.apply({}, {
      type: 'CUSTOM',
      name: 'chatkit.form.snapshot',
      payload: { artifactId: 'f1', data: { schema: {}, mode: 'single-submit' } },
    });
    const withResult = formArtifactReducer.apply(withForm, {
      type: 'CUSTOM',
      name: 'chatkit.form.result',
      payload: { artifactId: 'f1', values: { name: 'Ada' } },
    });
    expect(withResult.f1).toMatchObject({ status: 'submitted', version: 2 });
    expect((withResult.f1.data as { values?: Record<string, unknown> }).values).toEqual({ name: 'Ada' });
  });

  it('ignores a chatkit.form.result for an artifact id that does not exist', () => {
    const artifacts = formArtifactReducer.apply({}, {
      type: 'CUSTOM',
      name: 'chatkit.form.result',
      payload: { artifactId: 'missing', values: {} },
    });
    expect(artifacts).toEqual({});
  });
});
```

- [x] **Step 9: Run and confirm failure**

```bash
npx pnpm@9.0.0 --filter @chatkit/plugin-forms exec vitest run src/artifact-reducer.test.ts
```
Expected: FAIL — `Cannot find module './artifact-reducer'`.

- [x] **Step 10: Write `packages/plugin-forms/src/artifact-reducer.ts`**

```ts
import type { ArtifactKind, ArtifactRecord, ChatEvent } from '@chatkit/core';
import type { FormArtifactData, FormResultPayload, FormSnapshotPayload } from './types';

function isFormSnapshotPayload(payload: unknown): payload is FormSnapshotPayload {
  if (typeof payload !== 'object' || payload === null) return false;
  const p = payload as Record<string, unknown>;
  return typeof p.artifactId === 'string' && typeof p.data === 'object' && p.data !== null;
}

function isFormResultPayload(payload: unknown): payload is FormResultPayload {
  if (typeof payload !== 'object' || payload === null) return false;
  const p = payload as Record<string, unknown>;
  return typeof p.artifactId === 'string' && typeof p.values === 'object' && p.values !== null;
}

export const formArtifactReducer = {
  kind: 'form' as ArtifactKind,
  matches(event: ChatEvent): boolean {
    return event.type === 'CUSTOM' && (event.name === 'chatkit.form.snapshot' || event.name === 'chatkit.form.result');
  },
  apply(artifacts: Record<string, ArtifactRecord>, event: ChatEvent): Record<string, ArtifactRecord> {
    if (event.type !== 'CUSTOM') return artifacts;

    if (event.name === 'chatkit.form.snapshot') {
      if (!isFormSnapshotPayload(event.payload)) {
        console.warn('[chatkit.plugin-forms] dropped malformed chatkit.form.snapshot payload', event.payload);
        return artifacts;
      }
      const existing = artifacts[event.payload.artifactId];
      const record: ArtifactRecord = {
        id: event.payload.artifactId,
        kind: 'form',
        version: (existing?.version ?? 0) + 1,
        createdByMessageId: event.payload.createdByMessageId ?? existing?.createdByMessageId ?? '',
        data: event.payload.data,
        status: 'draft',
      };
      return { ...artifacts, [record.id]: record };
    }

    if (event.name === 'chatkit.form.result') {
      if (!isFormResultPayload(event.payload)) {
        console.warn('[chatkit.plugin-forms] dropped malformed chatkit.form.result payload', event.payload);
        return artifacts;
      }
      const existing = artifacts[event.payload.artifactId];
      if (!existing || existing.kind !== 'form') return artifacts;
      const data = existing.data as FormArtifactData;
      const record: ArtifactRecord = {
        ...existing,
        version: existing.version + 1,
        data: { ...data, values: event.payload.values },
        status: 'submitted',
      };
      return { ...artifacts, [record.id]: record };
    }

    return artifacts;
  },
};
```

- [x] **Step 11: Run and confirm pass**

```bash
npx pnpm@9.0.0 --filter @chatkit/plugin-forms exec vitest run src/artifact-reducer.test.ts
```
Expected: PASS — 6 tests.

- [x] **Step 12: Write the test harness and failing tests for `FormRenderer.svelte`**

`packages/plugin-forms/src/TestHarness.svelte` (wraps `ChatProvider` around a bare `FormRenderer` so tests get a real `getChatContext()`):

```svelte
<script lang="ts">
  import { ChatProvider } from '@chatkit/svelte';
  import FormRenderer from './FormRenderer.svelte';
  import type { ChatConfig } from '@chatkit/core';
  import type { ArtifactRecord } from '@chatkit/core';

  interface Props {
    config: ChatConfig;
    artifact: ArtifactRecord;
    onBeforeSubmit?: (values: Record<string, unknown>) => Record<string, unknown> | Promise<Record<string, unknown>>;
  }

  let { config, artifact, onBeforeSubmit }: Props = $props();
</script>

<ChatProvider {config}>
  {#snippet children()}
    <FormRenderer {artifact} {onBeforeSubmit} />
  {/snippet}
</ChatProvider>
```

`packages/plugin-forms/src/FormRenderer.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import TestHarness from './TestHarness.svelte';
import { createFixtureTransport } from '@chatkit/core';
import type { ArtifactRecord } from '@chatkit/core';
import type { FormArtifactData } from './types';

function makeArtifact(data: Partial<FormArtifactData>, status: ArtifactRecord['status'] = 'draft'): ArtifactRecord {
  return {
    id: 'f1',
    kind: 'form',
    version: 1,
    createdByMessageId: 'm1',
    status,
    data: {
      schema: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', title: 'Name' },
          plan: { type: 'string', enum: ['free', 'pro'], title: 'Plan' },
        },
      },
      mode: 'single-submit',
      ...data,
    },
  };
}

describe('FormRenderer', () => {
  it('renders a field per schema property with initial values pre-filled', () => {
    const transport = createFixtureTransport([]);
    const artifact = makeArtifact({ initialValues: { name: 'Ada' } });
    render(TestHarness, { config: { transport, threadId: 't1' }, artifact });

    expect(screen.getByLabelText('name')).toHaveValue('Ada');
  });

  it('shows a validation error and blocks submit when a required field is empty', async () => {
    const transport = createFixtureTransport([]);
    const artifact = makeArtifact({});
    render(TestHarness, { config: { transport, threadId: 't1' }, artifact });

    await fireEvent.click(screen.getByText('Submit'));

    expect(screen.getByTestId('form-error-name')).toHaveTextContent('This field is required.');
    expect(transport.recorder.runs).toHaveLength(0);
  });

  it('dispatches chatkit.form.result and sends it through the transport on a valid submit', async () => {
    const transport = createFixtureTransport([]);
    const artifact = makeArtifact({ initialValues: { name: 'Ada', plan: 'free' } });
    render(TestHarness, { config: { transport, threadId: 't1' }, artifact });

    await fireEvent.click(screen.getByText('Submit'));

    await waitFor(() => {
      expect(transport.recorder.runs).toHaveLength(1);
    });
    const sentMessage = transport.recorder.runs[0].messages.at(-1);
    expect(sentMessage?.parts[0]).toMatchObject({
      type: 'custom',
      name: 'chatkit.form.result',
      payload: { artifactId: 'f1', values: { name: 'Ada', plan: 'free' } },
    });
  });

  it('calls onBeforeSubmit and sends its returned values instead of the raw form values', async () => {
    const transport = createFixtureTransport([]);
    const artifact = makeArtifact({ initialValues: { name: 'Ada', plan: 'free' } });
    const onBeforeSubmit = vi.fn(async (values: Record<string, unknown>) => ({ ...values, enriched: true }));
    render(TestHarness, { config: { transport, threadId: 't1' }, artifact, onBeforeSubmit });

    await fireEvent.click(screen.getByText('Submit'));

    await waitFor(() => expect(transport.recorder.runs).toHaveLength(1));
    const sentMessage = transport.recorder.runs[0].messages.at(-1);
    expect(sentMessage?.parts[0]).toMatchObject({ payload: { values: { name: 'Ada', plan: 'free', enriched: true } } });
  });

  it('renders read-only submitted values instead of inputs once the artifact status is submitted', () => {
    const transport = createFixtureTransport([]);
    const artifact = makeArtifact({ values: { name: 'Ada', plan: 'pro' } }, 'submitted');
    render(TestHarness, { config: { transport, threadId: 't1' }, artifact });

    expect(screen.getByTestId('form-value-name')).toHaveTextContent('Ada');
    expect(screen.queryByText('Submit')).not.toBeInTheDocument();
  });
});
```

- [x] **Step 13: Run and confirm failure**

```bash
npx pnpm@9.0.0 --filter @chatkit/plugin-forms exec vitest run src/FormRenderer.test.ts
```
Expected: FAIL — `Cannot find module './FormRenderer.svelte'`.

- [x] **Step 14: Write `packages/plugin-forms/src/FormRenderer.svelte`**

```svelte
<script lang="ts">
  import { getChatContext } from '@chatkit/svelte';
  import type { ArtifactRecord, ContentPart } from '@chatkit/core';
  import type { FormArtifactData } from './types';
  import { validateForm } from './validate';

  interface Props {
    artifact: ArtifactRecord;
    onBeforeSubmit?: (values: Record<string, unknown>) => Record<string, unknown> | Promise<Record<string, unknown>>;
  }

  let { artifact, onBeforeSubmit }: Props = $props();
  const store = getChatContext();

  const data = $derived(artifact.data as FormArtifactData);
  const properties = $derived((data.schema.properties as Record<string, Record<string, unknown>>) ?? {});
  const fieldOrder = $derived(data.uiSchema?.order ?? Object.keys(properties));
  const submitted = $derived(artifact.status === 'submitted');
  const submittedValues = $derived((data.values ?? {}) as Record<string, unknown>);

  let values: Record<string, unknown> = $state({ ...(data.initialValues ?? {}) });
  let errors: Record<string, string> = $state({});
  let touched: Record<string, boolean> = $state({});

  function widgetFor(field: string, fieldSchema: Record<string, unknown>): string {
    const override = data.uiSchema?.widgets?.[field];
    if (override) return override;
    if (fieldSchema.enum) return 'select';
    if (fieldSchema.type === 'boolean') return 'checkbox';
    if (fieldSchema.type === 'string' && fieldSchema.format === 'date') return 'date';
    return 'text';
  }

  function validateOne(field: string) {
    const fieldErrors = validateForm(data.schema, values);
    errors = { ...errors, [field]: fieldErrors[field] ?? '' };
  }

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    const fieldErrors = validateForm(data.schema, values);
    errors = fieldErrors;
    touched = Object.fromEntries(fieldOrder.map((f) => [f, true]));
    if (Object.keys(fieldErrors).length > 0) return;

    const finalValues = onBeforeSubmit ? await onBeforeSubmit(values) : values;

    store.dispatch({ type: 'CUSTOM', name: 'chatkit.form.result', payload: { artifactId: artifact.id, values: finalValues } });

    const attachments: ContentPart[] = [
      { type: 'custom', name: 'chatkit.form.result', payload: { artifactId: artifact.id, values: finalValues } },
    ];
    await store.sendMessage({ text: '', attachments });
  }
</script>

<form class="ck-form" onsubmit={handleSubmit}>
  {#each fieldOrder as field (field)}
    {@const fieldSchema = properties[field] ?? {}}
    {@const widget = widgetFor(field, fieldSchema)}
    <label class="ck-form__field">
      <span class="ck-form__label">{(fieldSchema.title as string) ?? field}</span>
      {#if submitted}
        <span class="ck-form__value" data-testid="form-value-{field}">{String(submittedValues[field] ?? '')}</span>
      {:else if widget === 'select'}
        <select bind:value={values[field]} onblur={() => validateOne(field)} aria-label={field}>
          {#each (fieldSchema.enum as unknown[]) ?? [] as option}
            <option value={option}>{String(option)}</option>
          {/each}
        </select>
      {:else if widget === 'checkbox'}
        <input type="checkbox" bind:checked={values[field]} aria-label={field} />
      {:else if widget === 'textarea'}
        <textarea bind:value={values[field]} onblur={() => validateOne(field)} aria-label={field}></textarea>
      {:else if widget === 'date'}
        <input type="date" bind:value={values[field]} onblur={() => validateOne(field)} aria-label={field} />
      {:else}
        <input type="text" bind:value={values[field]} onblur={() => validateOne(field)} aria-label={field} />
      {/if}
      {#if touched[field] && errors[field]}
        <span class="ck-form__error" data-testid="form-error-{field}">{errors[field]}</span>
      {/if}
    </label>
  {/each}
  {#if !submitted}
    <button type="submit">{data.submitLabel ?? 'Submit'}</button>
  {/if}
</form>

<style>
  .ck-form {
    display: flex;
    flex-direction: column;
    gap: var(--ck-space-3);
  }

  .ck-form__field {
    display: flex;
    flex-direction: column;
    gap: var(--ck-space-1);
  }

  .ck-form__label {
    font-size: var(--ck-font-size-sm);
    color: var(--ck-color-text-muted);
  }

  .ck-form input,
  .ck-form select,
  .ck-form textarea {
    border: 1px solid var(--ck-color-border);
    border-radius: var(--ck-radius-sm);
    padding: var(--ck-space-2);
    font-size: var(--ck-font-size-base);
    background: var(--ck-color-bg);
    color: var(--ck-color-text);
  }

  .ck-form__error {
    color: var(--ck-color-error);
    font-size: var(--ck-font-size-sm);
  }

  .ck-form button[type='submit'] {
    align-self: flex-start;
    background: var(--ck-color-accent);
    color: var(--ck-color-accent-contrast);
    border: none;
    border-radius: var(--ck-radius-sm);
    padding: var(--ck-space-2) var(--ck-space-4);
    cursor: pointer;
  }
</style>
```

Submit test note: because the `Submit` button's `type="submit"` inside a `<form onsubmit={...}>` triggers submission natively via `fireEvent.click`, no separate `fireEvent.submit` call is needed in the tests above.

- [x] **Step 15: Run and confirm pass**

```bash
npx pnpm@9.0.0 --filter @chatkit/plugin-forms exec vitest run
npx pnpm@9.0.0 --filter @chatkit/plugin-forms exec svelte-check --tsconfig ./tsconfig.json
```
Expected: PASS — 16 tests (5 validate + 6 artifact-reducer + 5 FormRenderer), 0 svelte-check errors/warnings.

- [x] **Step 16: Write `packages/plugin-forms/src/index.ts`**

```ts
import FormRenderer from './FormRenderer.svelte';
import { formArtifactReducer } from './artifact-reducer';
import type { ChatPlugin } from '@chatkit/core';

export interface FormsPluginOptions {
  /** Accepted, not yet wired — no built-in widget takes a format-keyed component override this milestone. See plan decision 7. */
  widgetOverrides?: Record<string, unknown>;
  onBeforeSubmit?(values: Record<string, unknown>): Record<string, unknown> | Promise<Record<string, unknown>>;
}

export function formsPlugin(options: FormsPluginOptions = {}): ChatPlugin {
  return {
    name: 'forms',
    version: '1.0.0',
    artifactReducers: [formArtifactReducer],
    artifactRenderers: {
      form: { component: FormRenderer, props: { onBeforeSubmit: options.onBeforeSubmit } },
    },
  };
}

export { default as FormRenderer } from './FormRenderer.svelte';
export { formArtifactReducer } from './artifact-reducer';
export { validateForm, validateField } from './validate';
export type { FormArtifactData, FormResultPayload, FormSnapshotPayload, UiSchemaHints, FormFieldWidget } from './types';
```

- [x] **Step 17: Run the full suite once more and build**

```bash
npx pnpm@9.0.0 --filter @chatkit/plugin-forms exec vitest run
npx pnpm@9.0.0 --filter @chatkit/plugin-forms build
```
Expected: 16 tests still pass; build succeeds.

---

### Task 4: `@chatkit/plugin-documents`

**Files:** (all new except `package.json`, which already has a scaffold)
- Modify: `packages/plugin-documents/package.json`
- Create: `packages/plugin-documents/tsconfig.json`, `vite.config.ts`, `vitest-setup.ts`
- Create: `packages/plugin-documents/src/types.ts`
- Create: `packages/plugin-documents/src/artifact-reducer.ts`, `artifact-reducer.test.ts`
- Create: `packages/plugin-documents/src/export.ts`, `export.test.ts`
- Create: `packages/plugin-documents/src/DocumentCanvas.svelte`, `DocumentCanvas.test.ts`, `TestHarness.svelte`
- Create: `packages/plugin-documents/src/index.ts`

- [x] **Step 1: Build config**

`package.json` (adds `@chatkit/svelte` and `@chatkit/plugin-markdown` — the latter reused for markdown preview rendering rather than reimplementing a renderer — plus the standard missing devDependencies):

```json
{
  "name": "@chatkit/plugin-documents",
  "version": "0.0.0",
  "description": "Agent-authored document/artifact canvas (chatkit.document.* CUSTOM events): markdown mode first, ProseMirror richtext mode second.",
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
    "@chatkit/core": "workspace:*",
    "@chatkit/svelte": "workspace:*",
    "@chatkit/plugin-markdown": "workspace:*"
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

`tsconfig.json` (same shape as `plugin-forms`'s), `vitest-setup.ts` (identical to `plugin-forms`'s).

`vite.config.ts` — externalizes `@chatkit/plugin-markdown` too:
```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import dts from 'vite-plugin-dts';

export default defineConfig({
  plugins: [svelte(), dts({ rollupTypes: true })],
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: 'index',
    },
    rollupOptions: {
      external: ['svelte', /^svelte\//, '@chatkit/core', '@chatkit/svelte', '@chatkit/plugin-markdown'],
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./vitest-setup.ts'],
  },
  resolve: {
    conditions: ['browser'],
  },
});
```

- [x] **Step 2: Install dependencies**

```bash
npx pnpm@9.0.0 install
```

- [x] **Step 3: Write `packages/plugin-documents/src/types.ts`**

```ts
import type { ArtifactRecord } from '@chatkit/core';

export type ExportFormat = 'md' | 'txt' | 'docx' | 'pdf';

export interface DocumentArtifactData {
  title: string;
  /** richtext is deferred — see plan decision 4/5; only 'markdown' is implemented this milestone. */
  format: 'markdown';
  content: string;
  editable: boolean;
  exportFormats?: ExportFormat[];
}

export interface DocumentSnapshotPayload {
  artifactId: string;
  createdByMessageId?: string;
  data: DocumentArtifactData;
}

export interface DocumentDeltaPayload {
  artifactId: string;
  append: string;
}

export type ExportHandler = (artifact: ArtifactRecord) => string | Promise<string> | Blob | Promise<Blob>;
export type ExportHandlers = Partial<Record<ExportFormat, ExportHandler>>;
```

- [x] **Step 4: Write the failing tests — `packages/plugin-documents/src/artifact-reducer.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest';
import { documentArtifactReducer } from './artifact-reducer';
import type { ChatEvent } from '@chatkit/core';

describe('documentArtifactReducer', () => {
  it('matches chatkit.document.snapshot and chatkit.document.delta CUSTOM events only', () => {
    expect(documentArtifactReducer.matches({ type: 'CUSTOM', name: 'chatkit.document.snapshot', payload: {} })).toBe(true);
    expect(documentArtifactReducer.matches({ type: 'CUSTOM', name: 'chatkit.document.delta', payload: {} })).toBe(true);
    expect(documentArtifactReducer.matches({ type: 'CUSTOM', name: 'chatkit.document.comment', payload: {} })).toBe(false);
    expect(documentArtifactReducer.matches({ type: 'CUSTOM', name: 'chatkit.form.snapshot', payload: {} })).toBe(false);
  });

  it('creates a final-status document artifact from a snapshot event', () => {
    const event: ChatEvent = {
      type: 'CUSTOM',
      name: 'chatkit.document.snapshot',
      payload: {
        artifactId: 'd1',
        createdByMessageId: 'm1',
        data: { title: 'Notes', format: 'markdown', content: '# Hello', editable: true },
      },
    };
    const artifacts = documentArtifactReducer.apply({}, event);
    expect(artifacts.d1).toMatchObject({ id: 'd1', kind: 'document', version: 1, status: 'final' });
    expect((artifacts.d1.data as { content: string }).content).toBe('# Hello');
  });

  it('appends content and sets status to streaming on a delta event', () => {
    const withSnapshot = documentArtifactReducer.apply({}, {
      type: 'CUSTOM',
      name: 'chatkit.document.snapshot',
      payload: { artifactId: 'd1', data: { title: 'Notes', format: 'markdown', content: 'Hello', editable: false } },
    });
    const withDelta = documentArtifactReducer.apply(withSnapshot, {
      type: 'CUSTOM',
      name: 'chatkit.document.delta',
      payload: { artifactId: 'd1', append: ', world' },
    });
    expect(withDelta.d1.status).toBe('streaming');
    expect((withDelta.d1.data as { content: string }).content).toBe('Hello, world');
    expect(withDelta.d1.version).toBe(2);
  });

  it('ignores a delta for an artifact id that does not exist', () => {
    const artifacts = documentArtifactReducer.apply({}, {
      type: 'CUSTOM',
      name: 'chatkit.document.delta',
      payload: { artifactId: 'missing', append: 'x' },
    });
    expect(artifacts).toEqual({});
  });

  it('drops a malformed snapshot payload with a warning instead of throwing', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const artifacts = documentArtifactReducer.apply({}, { type: 'CUSTOM', name: 'chatkit.document.snapshot', payload: null });
    expect(artifacts).toEqual({});
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
```

- [x] **Step 5: Run and confirm failure, then write `packages/plugin-documents/src/artifact-reducer.ts`**

```bash
npx pnpm@9.0.0 --filter @chatkit/plugin-documents exec vitest run src/artifact-reducer.test.ts
```
Expected: FAIL — module not found.

```ts
import type { ArtifactKind, ArtifactRecord, ChatEvent } from '@chatkit/core';
import type { DocumentArtifactData, DocumentDeltaPayload, DocumentSnapshotPayload } from './types';

function isDocumentSnapshotPayload(payload: unknown): payload is DocumentSnapshotPayload {
  if (typeof payload !== 'object' || payload === null) return false;
  const p = payload as Record<string, unknown>;
  return typeof p.artifactId === 'string' && typeof p.data === 'object' && p.data !== null;
}

function isDocumentDeltaPayload(payload: unknown): payload is DocumentDeltaPayload {
  if (typeof payload !== 'object' || payload === null) return false;
  const p = payload as Record<string, unknown>;
  return typeof p.artifactId === 'string' && typeof p.append === 'string';
}

export const documentArtifactReducer = {
  kind: 'document' as ArtifactKind,
  matches(event: ChatEvent): boolean {
    return event.type === 'CUSTOM' && (event.name === 'chatkit.document.snapshot' || event.name === 'chatkit.document.delta');
  },
  apply(artifacts: Record<string, ArtifactRecord>, event: ChatEvent): Record<string, ArtifactRecord> {
    if (event.type !== 'CUSTOM') return artifacts;

    if (event.name === 'chatkit.document.snapshot') {
      if (!isDocumentSnapshotPayload(event.payload)) {
        console.warn('[chatkit.plugin-documents] dropped malformed chatkit.document.snapshot payload', event.payload);
        return artifacts;
      }
      const existing = artifacts[event.payload.artifactId];
      const record: ArtifactRecord = {
        id: event.payload.artifactId,
        kind: 'document',
        version: (existing?.version ?? 0) + 1,
        createdByMessageId: event.payload.createdByMessageId ?? existing?.createdByMessageId ?? '',
        data: event.payload.data,
        status: 'final',
      };
      return { ...artifacts, [record.id]: record };
    }

    if (event.name === 'chatkit.document.delta') {
      if (!isDocumentDeltaPayload(event.payload)) {
        console.warn('[chatkit.plugin-documents] dropped malformed chatkit.document.delta payload', event.payload);
        return artifacts;
      }
      const existing = artifacts[event.payload.artifactId];
      if (!existing || existing.kind !== 'document') return artifacts;
      const data = existing.data as DocumentArtifactData;
      const record: ArtifactRecord = {
        ...existing,
        version: existing.version + 1,
        data: { ...data, content: data.content + event.payload.append },
        status: 'streaming',
      };
      return { ...artifacts, [record.id]: record };
    }

    return artifacts;
  },
};
```

- [x] **Step 6: Run and confirm pass**

```bash
npx pnpm@9.0.0 --filter @chatkit/plugin-documents exec vitest run src/artifact-reducer.test.ts
```
Expected: PASS — 5 tests.

- [x] **Step 7: Write the failing tests — `packages/plugin-documents/src/export.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { exportDocument } from './export';
import type { ArtifactRecord } from '@chatkit/core';

function makeArtifact(content: string): ArtifactRecord {
  return {
    id: 'd1',
    kind: 'document',
    version: 1,
    createdByMessageId: 'm1',
    status: 'final',
    data: { title: 'Notes', format: 'markdown', content, editable: false },
  };
}

describe('exportDocument', () => {
  it('returns the raw content directly for md and txt formats', async () => {
    const artifact = makeArtifact('# Hello');
    expect(await exportDocument(artifact, 'md')).toBe('# Hello');
    expect(await exportDocument(artifact, 'txt')).toBe('# Hello');
  });

  it('calls a registered handler for docx/pdf formats', async () => {
    const artifact = makeArtifact('# Hello');
    const handler = async () => new Blob(['fake docx bytes']);
    const result = await exportDocument(artifact, 'docx', { docx: handler });
    expect(result).toBeInstanceOf(Blob);
  });

  it('throws a clear error when no handler is registered for docx/pdf', async () => {
    const artifact = makeArtifact('# Hello');
    await expect(exportDocument(artifact, 'pdf')).rejects.toThrow(/register an export handler/i);
  });
});
```

- [x] **Step 8: Run and confirm failure, then write `packages/plugin-documents/src/export.ts`**

```bash
npx pnpm@9.0.0 --filter @chatkit/plugin-documents exec vitest run src/export.test.ts
```
Expected: FAIL — module not found.

```ts
import type { ArtifactRecord } from '@chatkit/core';
import type { DocumentArtifactData, ExportFormat, ExportHandlers } from './types';

export async function exportDocument(
  artifact: ArtifactRecord,
  format: ExportFormat,
  handlers: ExportHandlers = {}
): Promise<string | Blob> {
  const data = artifact.data as DocumentArtifactData;
  if (format === 'md' || format === 'txt') {
    return data.content;
  }
  const handler = handlers[format];
  if (!handler) {
    throw new Error(
      `[chatkit.plugin-documents] register an export handler for format "${format}" — pass documentsPlugin({ exportHandlers: { ${format}: ... } }).`
    );
  }
  return handler(artifact);
}
```

- [x] **Step 9: Run and confirm pass**

```bash
npx pnpm@9.0.0 --filter @chatkit/plugin-documents exec vitest run src/export.test.ts
```
Expected: PASS — 3 tests.

- [x] **Step 10: Write the test harness and failing tests for `DocumentCanvas.svelte`**

`packages/plugin-documents/src/TestHarness.svelte`:
```svelte
<script lang="ts">
  import { ChatProvider } from '@chatkit/svelte';
  import DocumentCanvas from './DocumentCanvas.svelte';
  import type { ChatConfig, ArtifactRecord } from '@chatkit/core';
  import type { ExportHandlers } from './types';

  interface Props {
    config: ChatConfig;
    artifact: ArtifactRecord;
    exportHandlers?: ExportHandlers;
  }

  let { config, artifact, exportHandlers }: Props = $props();
</script>

<ChatProvider {config}>
  {#snippet children()}
    <DocumentCanvas {artifact} {exportHandlers} />
  {/snippet}
</ChatProvider>
```

`packages/plugin-documents/src/DocumentCanvas.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import TestHarness from './TestHarness.svelte';
import { createFixtureTransport } from '@chatkit/core';
import type { ArtifactRecord } from '@chatkit/core';

function makeArtifact(content: string, editable: boolean, status: ArtifactRecord['status'] = 'final'): ArtifactRecord {
  return {
    id: 'd1',
    kind: 'document',
    version: 1,
    createdByMessageId: 'm1',
    status,
    data: { title: 'Trip Notes', format: 'markdown', content, editable, exportFormats: ['md', 'docx'] },
  };
}

describe('DocumentCanvas', () => {
  it('renders the title and streamed content read-only while status is streaming', () => {
    const transport = createFixtureTransport([]);
    const artifact = makeArtifact('Drafting', true, 'streaming');
    render(TestHarness, { config: { transport, threadId: 't1' }, artifact });

    expect(screen.getByText('Trip Notes')).toBeInTheDocument();
    expect(screen.getByTestId('document-content')).toHaveTextContent('Drafting');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('renders a preview by default and can toggle to an editable textarea when editable and final', async () => {
    const transport = createFixtureTransport([]);
    const artifact = makeArtifact('# Hello', true, 'final');
    render(TestHarness, { config: { transport, threadId: 't1' }, artifact });

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

    await fireEvent.click(screen.getByText('Edit'));

    expect(screen.getByRole('textbox')).toHaveValue('# Hello');
  });

  it('does not offer an edit toggle when the document is not editable', () => {
    const transport = createFixtureTransport([]);
    const artifact = makeArtifact('# Hello', false, 'final');
    render(TestHarness, { config: { transport, threadId: 't1' }, artifact });

    expect(screen.queryByText('Edit')).not.toBeInTheDocument();
  });

  it('exports md directly via a downloadable blob without requiring a handler', async () => {
    const transport = createFixtureTransport([]);
    const artifact = makeArtifact('# Hello', false, 'final');
    const createObjectURL = vi.fn(() => 'blob:fake');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });

    render(TestHarness, { config: { transport, threadId: 't1' }, artifact });
    await fireEvent.click(screen.getByText('Export md'));

    expect(createObjectURL).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('exports docx via a registered exportHandlers callback', async () => {
    const transport = createFixtureTransport([]);
    const artifact = makeArtifact('# Hello', false, 'final');
    const docxHandler = vi.fn(async () => new Blob(['fake']));
    const createObjectURL = vi.fn(() => 'blob:fake');
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL: vi.fn() });

    render(TestHarness, { config: { transport, threadId: 't1' }, artifact, exportHandlers: { docx: docxHandler } });
    await fireEvent.click(screen.getByText('Export docx'));

    await waitFor(() => expect(docxHandler).toHaveBeenCalledOnce());
    vi.unstubAllGlobals();
  });
});
```

- [x] **Step 11: Run and confirm failure**

```bash
npx pnpm@9.0.0 --filter @chatkit/plugin-documents exec vitest run src/DocumentCanvas.test.ts
```
Expected: FAIL — module not found.

- [x] **Step 12: Write `packages/plugin-documents/src/DocumentCanvas.svelte`**

```svelte
<script lang="ts">
  import { getChatContext } from '@chatkit/svelte';
  import { Markdown } from '@chatkit/plugin-markdown';
  import type { ArtifactRecord } from '@chatkit/core';
  import type { DocumentArtifactData, ExportHandlers, ExportFormat } from './types';
  import { exportDocument } from './export';

  interface Props {
    artifact: ArtifactRecord;
    exportHandlers?: ExportHandlers;
  }

  let { artifact, exportHandlers = {} }: Props = $props();
  const store = getChatContext();

  const data = $derived(artifact.data as DocumentArtifactData);
  const canEdit = $derived(data.editable && artifact.status === 'final');
  let editing = $state(false);
  let draftContent = $state('');

  function startEdit() {
    draftContent = data.content;
    editing = true;
  }

  function saveEdit() {
    store.dispatch({
      type: 'CUSTOM',
      name: 'chatkit.document.snapshot',
      payload: { artifactId: artifact.id, data: { ...data, content: draftContent } },
    });
    editing = false;
  }

  async function handleExport(format: ExportFormat) {
    const result = await exportDocument(artifact, format, exportHandlers);
    const blob = typeof result === 'string' ? new Blob([result], { type: 'text/plain' }) : result;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${data.title}.${format}`;
    link.click();
    URL.revokeObjectURL(url);
  }
</script>

<div class="ck-document-canvas">
  <div class="ck-document-canvas__header">
    <h3 class="ck-document-canvas__title">{data.title}</h3>
    <div class="ck-document-canvas__actions">
      {#if canEdit && !editing}
        <button type="button" onclick={startEdit}>Edit</button>
      {/if}
      {#each data.exportFormats ?? [] as format (format)}
        <button type="button" onclick={() => handleExport(format)}>Export {format}</button>
      {/each}
    </div>
  </div>

  {#if editing}
    <textarea class="ck-document-canvas__editor" bind:value={draftContent}></textarea>
    <div class="ck-document-canvas__actions">
      <button type="button" onclick={saveEdit}>Save</button>
      <button type="button" onclick={() => (editing = false)}>Cancel</button>
    </div>
  {:else}
    <div class="ck-document-canvas__content" data-testid="document-content">
      <Markdown part={{ type: 'text', text: data.content }} />
    </div>
  {/if}
</div>

<style>
  .ck-document-canvas {
    display: flex;
    flex-direction: column;
    gap: var(--ck-space-2);
  }

  .ck-document-canvas__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--ck-space-2);
  }

  .ck-document-canvas__title {
    margin: 0;
    font-size: var(--ck-font-size-lg);
  }

  .ck-document-canvas__actions {
    display: flex;
    gap: var(--ck-space-2);
  }

  .ck-document-canvas__actions button {
    border-radius: var(--ck-radius-sm);
    border: 1px solid var(--ck-color-border);
    padding: var(--ck-space-1) var(--ck-space-3);
    cursor: pointer;
    background: var(--ck-color-bg);
    color: var(--ck-color-text);
  }

  .ck-document-canvas__editor {
    width: 100%;
    min-height: 8rem;
    box-sizing: border-box;
    font-family: var(--ck-font-mono);
    border: 1px solid var(--ck-color-border);
    border-radius: var(--ck-radius-sm);
    padding: var(--ck-space-2);
    background: var(--ck-color-bg);
    color: var(--ck-color-text);
  }
</style>
```

`data-testid="document-content"` sits on the wrapper `<div>` (not inside `<Markdown>`, which is a separate component/package) so the streaming test can assert on it regardless of how `Markdown` renders its internals.

- [x] **Step 13: Run and confirm pass**

```bash
npx pnpm@9.0.0 --filter @chatkit/plugin-documents exec vitest run
npx pnpm@9.0.0 --filter @chatkit/plugin-documents exec svelte-check --tsconfig ./tsconfig.json
```
Expected: PASS — 13 tests (5 artifact-reducer + 3 export + 5 DocumentCanvas), 0 svelte-check errors/warnings.

- [x] **Step 14: Write `packages/plugin-documents/src/index.ts`**

```ts
import DocumentCanvas from './DocumentCanvas.svelte';
import { documentArtifactReducer } from './artifact-reducer';
import type { ChatPlugin } from '@chatkit/core';
import type { ExportHandlers } from './types';

export interface DocumentsPluginOptions {
  exportHandlers?: ExportHandlers;
  /** Accepted, not yet wired — no toolbar extension point exists this milestone. See plan decision 7's sibling note. */
  toolbarActions?: unknown[];
  /** Accepted, not yet wired — no version-diff history exists without the persistence layer (M6). */
  onVersionChange?(artifact: unknown, diff: unknown): void;
}

export function documentsPlugin(options: DocumentsPluginOptions = {}): ChatPlugin {
  return {
    name: 'documents',
    version: '1.0.0',
    artifactReducers: [documentArtifactReducer],
    artifactRenderers: {
      document: { component: DocumentCanvas, props: { exportHandlers: options.exportHandlers ?? {} } },
    },
  };
}

export { default as DocumentCanvas } from './DocumentCanvas.svelte';
export { documentArtifactReducer } from './artifact-reducer';
export { exportDocument } from './export';
export type { DocumentArtifactData, DocumentDeltaPayload, DocumentSnapshotPayload, ExportFormat, ExportHandler, ExportHandlers } from './types';
```

- [x] **Step 15: Run the full suite once more and build**

```bash
npx pnpm@9.0.0 --filter @chatkit/plugin-documents exec vitest run
npx pnpm@9.0.0 --filter @chatkit/plugin-documents build
```
Expected: 13 tests still pass; build succeeds.

---

### Task 5: Full rebuild, full regression suite, README

- [x] **Step 1: Rebuild all 9 packages in dependency order**

```bash
npx pnpm@9.0.0 --filter @chatkit/core build
npx pnpm@9.0.0 --filter @chatkit/transport-agui build
npx pnpm@9.0.0 --filter @chatkit/svelte build
npx pnpm@9.0.0 --filter @chatkit/ui build
npx pnpm@9.0.0 --filter @chatkit/plugin-tool-render build
npx pnpm@9.0.0 --filter @chatkit/plugin-markdown build
npx pnpm@9.0.0 --filter @chatkit/plugin-file-handling build
npx pnpm@9.0.0 --filter @chatkit/plugin-forms build
npx pnpm@9.0.0 --filter @chatkit/plugin-documents build
```
`plugin-documents` must build after `plugin-markdown` (real dependency, not just workspace ordering luck).

- [x] **Step 2: Full regression suite across all 9 packages**

```bash
npx pnpm@9.0.0 --filter @chatkit/core exec vitest run
npx pnpm@9.0.0 --filter @chatkit/transport-agui exec vitest run
npx pnpm@9.0.0 --filter @chatkit/svelte exec vitest run
npx pnpm@9.0.0 --filter @chatkit/ui exec vitest run
npx pnpm@9.0.0 --filter @chatkit/plugin-tool-render exec vitest run
npx pnpm@9.0.0 --filter @chatkit/plugin-markdown exec vitest run
npx pnpm@9.0.0 --filter @chatkit/plugin-file-handling exec vitest run
npx pnpm@9.0.0 --filter @chatkit/plugin-forms exec vitest run
npx pnpm@9.0.0 --filter @chatkit/plugin-documents exec vitest run
```
Expected: 38 / 44 / 22 / 19 / 4 / 21 / 5 / 16 / 13 = 182 tests passing.

- [x] **Step 3: Update the milestone checklist in the root README**

In [README.md](../../../README.md), change:
```markdown
- [ ] M5 — Forms & documents
```
to:
```markdown
- [x] M5 — Forms & documents
```

---

## Notes for the next plan (M6)

- Richtext document mode (ProseMirror) is still fully deferred — M5's `DocumentArtifactData.format` only ever accepts `'markdown'`. Adding richtext means a real `RichTextDoc` type, a ProseMirror editor integration, and RFC-6902-over-JSON-doc delta application — a substantial standalone unit, not a drop-in to `DocumentCanvas`.
- Form `mode: 'live'`, `widgetOverrides`, `plugin-documents`' `toolbarActions`/`onVersionChange` are all typed and accepted but inert — flagged in Task 3/4's index.ts doc comments. None of M6's stated scope (theming, persistence adapters, a11y/i18n, CLI scaffold) obviously requires them, but M7's Vercel AI SDK adapter or a future forms-focused pass should revisit `'live'` mode once there's a client→server incremental-state-push primitive to build it on.
- The document edit/save flow in `DocumentCanvas` is local-only (bumps the artifact's version via `store.dispatch`, never sends the edit or a diff back to the agent) — spec §14.3's "next run's `RunAgentInput.context` includes the diff" behavior explicitly depends on the persistence layer's version-history table (§11), which is M6 scope (`persistence adapters`). Wire that dependency then, not here.
- `<ArtifactPanel>`'s `{ component, props }` registration contract (Task 2, decision 3) is now the established pattern for any future artifact-kind plugin — reuse it rather than reinventing a different options-passing mechanism.

---

- [x] **Mark the milestone complete**

No git commit — per repo owner preference, commits are handled manually. This is the natural stopping point for M5; M6 (theming polish, persistence adapters, a11y/i18n, CLI scaffold) is a separate plan.
