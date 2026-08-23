# M3 — Plugin System + File Handling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Git note:** commit steps are intentionally omitted — the repo owner handles git operations manually. Do not run `git add`/`git commit` while executing this plan unless explicitly asked to in the moment.

**Goal:** Build the three baseline plugins from spec §13 — `plugin-tool-render`, `plugin-markdown`, `plugin-file-handling` — and make `@chatkit-svelte/ui`'s `<MessageList>`/`<Composer>` genuinely **plugin-aware**: consulting `store.registry.messageRenderers`/`toolRenderers`/`attachmentHandlers` (all already built in M0's `createPluginHost`) instead of hardcoding behavior, so these three plugins (and any future one) just *register* into a mechanism that already exists rather than requiring bespoke UI wiring per plugin.

**Architecture:** M2's "Notes for M3" called this out directly: `<MessageList>`'s hardcoded `text`-only branch becomes a *fallback* that only fires when no plugin has registered a `messageRenderer` for a given content-part type; a new fallback for `tool_call` parts (currently not rendered *at all*) does the same against `toolRenderers`. Both lookups use `{@const}` + a dynamically-referenced component (`<Comp {...props} />`, Svelte 5's supported pattern for rendering a runtime-selected component — verified against a real registry map, not assumed) rather than `<svelte:component>`. `<Composer>` gains a generic attachment mechanism gated on `store.registry.attachmentHandlers.length > 0` — it has no plugin-specific code, it just offers a file picker, matches the picked file's MIME type against whichever handlers are registered, and calls the matching one.

Every module and every test in this plan has already been written and verified — `svelte-check` clean, all tests passing (real `@testing-library/svelte` rendering, real registry wiring through actual `createChatStore`/`createPluginHost`, not mocks) — in a scratch sandbox. The two genuinely novel mechanisms this milestone introduces (dynamic component rendering from a plugin registry; AST-based markdown rendering with zero `{@html}`) were each validated in isolation first, then validated together in the full `<MessageList>` refactor, before being written into this plan. Follow it as written.

**Tech Stack:** Same as M2 (Svelte 5 runes, `@sveltejs/vite-plugin-svelte`, `vite-plugin-dts`, Vitest + `jsdom` + `@testing-library/svelte`, `svelte-check`) — no new tooling.

**Scope decisions made during planning, stated up front:**
- **No Shiki / syntax highlighting.** Spec §13.2 mentions "code block syntax highlighting (Shiki, lazy-loaded)" as part of `plugin-markdown`. This plan's markdown renderer produces real `<pre><code>` blocks (with the fenced language available as a `data-lang` attribute) but does **not** tokenize/highlight them — wiring in a real syntax highlighter is a meaningfully separate chunk of work (lazy-loading, per-language grammars, matching highlighted-token markup back through the "no `{@html}`" constraint) that doesn't change the plugin's architecture, so it's deferred rather than half-built here. `plugin-markdown`'s scaffolded `package.json` already lists `shiki` as a dependency from initial repo setup — this plan removes it, since an unused dependency is worse than a documented gap.
- **No drag-drop / paste-as-file input transforms.** Spec §13.1 also mentions `inputTransforms: [dragDropTransform(), pasteFileTransform()]`. This plan implements the `attachmentHandlers` pipeline (the part that actually produces a `ContentPart` from a file) and a click-to-attach button in `<Composer>`, but not drag-drop/paste triggers — those are additional *entry points* into the same pipeline, not a different pipeline, and are a reasonable fast-follow once the core mechanism (this plan) exists.
- **Markdown subset, not full CommonMark.** Paragraphs, fenced code blocks, bold, italic, inline code, links. No headings, lists, blockquotes, tables, nested emphasis edge cases. Enough to prove the AST-rendering architecture is sound and streaming-safe; broadening the grammar later doesn't change the architecture.
- **A pre-existing small gap in `chat-store.svelte.ts` gets fixed as part of this milestone** (Task 5, Step 1): `sendMessage` currently always includes a `{ type: 'text', text: '' }` part even when the user sends an attachment with no text. This wasn't a problem until this milestone made attachment-only sends possible, so it's fixed here rather than shipped as a new, avoidable defect.

---

## File Structure

```
packages/plugin-tool-render/
  package.json (modify), tsconfig.json, vite.config.ts, vitest-setup.ts
  src/
    ToolCallCard.svelte, ToolCallCard.test.ts
    index.ts
packages/plugin-markdown/
  package.json (modify), tsconfig.json, vite.config.ts, vitest-setup.ts
  src/
    markdown-parser.ts, markdown-parser.test.ts
    InlineNode.svelte
    Markdown.svelte, Markdown.test.ts
    index.ts
packages/plugin-file-handling/
  package.json (modify), tsconfig.json, vite.config.ts, vitest-setup.ts
  src/
    FileRenderer.svelte
    ImageRenderer.svelte
    file-handling-plugin.ts, file-handling-plugin.test.ts
    index.ts
packages/ui/src/
  MessageList.svelte (rewrite), MessageList.test.ts (extended)
packages/svelte/src/
  chat-store.svelte.ts (small fix), chat-store.test.ts (extended)
packages/ui/src/
  Composer.svelte (rewrite), Composer.test.ts (new)
```

---

### Task 1: `plugin-tool-render`

Generic fallback tool-call visualization — a collapsible `<details>`/`<summary>` showing the tool name, status, formatted args, and result (once available). Registered as the `'*'` wildcard `toolRenderer`, so it applies to any tool call that doesn't have a more specific renderer registered.

**Files:**
- Modify: `packages/plugin-tool-render/package.json`
- Create: `packages/plugin-tool-render/tsconfig.json`
- Create: `packages/plugin-tool-render/vite.config.ts`
- Create: `packages/plugin-tool-render/vitest-setup.ts`
- Create: `packages/plugin-tool-render/src/ToolCallCard.svelte`
- Create: `packages/plugin-tool-render/src/ToolCallCard.test.ts`
- Create: `packages/plugin-tool-render/src/index.ts`

- [ ] **Step 1: Update `packages/plugin-tool-render/package.json`**

The file already exists (initial scaffolding) with a `svelte`/`typescript`/`vite`/`vitest` devDependency set and `@chatkit-svelte/core` as a dependency, but no `svelte-check`, `@sveltejs/vite-plugin-svelte`, `vite-plugin-dts`, or testing-library packages — add them, matching the pattern already established in `packages/svelte` and `packages/ui`:

```json
{
  "name": "@chatkit-svelte/plugin-tool-render",
  "version": "0.0.0",
  "description": "Generic fallback tool-call visualization (collapsible args/result JSON view) for any tool without a custom toolRenderer registered.",
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
    "@chatkit-svelte/core": "workspace:*"
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

- [ ] **Step 2: Write `packages/plugin-tool-render/tsconfig.json`**

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

- [ ] **Step 3: Write `packages/plugin-tool-render/vite.config.ts`**

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
      external: ['svelte', /^svelte\//],
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

- [ ] **Step 4: Write `packages/plugin-tool-render/vitest-setup.ts`**

```ts
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/svelte';

afterEach(() => {
  cleanup();
});
```

- [ ] **Step 5: Install dependencies**

```bash
npx pnpm@9.0.0 install
```

- [ ] **Step 6: Write the failing tests — `packages/plugin-tool-render/src/ToolCallCard.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import ToolCallCard from './ToolCallCard.svelte';
import type { ContentPart } from '@chatkit-svelte/core';

function toolCall(overrides: Partial<ContentPart & { type: 'tool_call' }> = {}): ContentPart & { type: 'tool_call' } {
  return {
    type: 'tool_call',
    toolCallId: 'tc1',
    toolName: 'search',
    args: { query: 'svelte' },
    status: 'pending_execution',
    ...overrides,
  };
}

describe('ToolCallCard', () => {
  it('shows the tool name and status', () => {
    render(ToolCallCard, { toolCall: toolCall() });
    expect(screen.getByText('search')).toBeInTheDocument();
    expect(screen.getByText('pending_execution')).toBeInTheDocument();
  });

  it('shows formatted args', () => {
    render(ToolCallCard, { toolCall: toolCall() });
    expect(screen.getByText(/"query": "svelte"/)).toBeInTheDocument();
  });

  it('shows the result once present', () => {
    render(ToolCallCard, { toolCall: toolCall({ status: 'complete', result: { hits: 3 } }) });
    expect(screen.getByText(/"hits": 3/)).toBeInTheDocument();
  });

  it('does not render a result block when there is no result yet', () => {
    render(ToolCallCard, { toolCall: toolCall() });
    expect(screen.queryByTestId('tool-call-result')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 7: Run the tests and confirm they fail**

```bash
npx pnpm@9.0.0 --filter @chatkit-svelte/plugin-tool-render exec vitest run src/ToolCallCard.test.ts
```
Expected: FAIL — `Cannot find module './ToolCallCard.svelte'`.

- [ ] **Step 8: Write `packages/plugin-tool-render/src/ToolCallCard.svelte`**

```svelte
<script lang="ts">
  import type { ContentPart } from '@chatkit-svelte/core';

  interface Props {
    toolCall: ContentPart & { type: 'tool_call' };
  }

  let { toolCall }: Props = $props();
</script>

<details class="ck-tool-call">
  <summary class="ck-tool-call__summary">
    <span class="ck-tool-call__name">{toolCall.toolName}</span>
    <span class="ck-tool-call__status">{toolCall.status}</span>
  </summary>
  <pre class="ck-tool-call__args">{JSON.stringify(toolCall.args, null, 2)}</pre>
  {#if toolCall.result !== undefined}
    <pre class="ck-tool-call__result" data-testid="tool-call-result">{JSON.stringify(toolCall.result, null, 2)}</pre>
  {/if}
</details>

<style>
  .ck-tool-call {
    border: 1px solid var(--ck-color-border);
    border-radius: var(--ck-radius-md);
    padding: var(--ck-space-2);
    font-size: var(--ck-font-size-sm);
  }

  .ck-tool-call__summary {
    display: flex;
    gap: var(--ck-space-2);
    cursor: pointer;
    font-family: var(--ck-font-mono);
  }

  .ck-tool-call__status {
    color: var(--ck-color-text-muted);
  }

  .ck-tool-call__args,
  .ck-tool-call__result {
    margin-top: var(--ck-space-2);
    overflow-x: auto;
    font-family: var(--ck-font-mono);
    font-size: var(--ck-font-size-sm);
  }
</style>
```

- [ ] **Step 9: Run the tests and confirm they pass**

```bash
npx pnpm@9.0.0 --filter @chatkit-svelte/plugin-tool-render exec vitest run src/ToolCallCard.test.ts
```
Expected: PASS — 4 tests.

- [ ] **Step 10: Write `packages/plugin-tool-render/src/index.ts`**

```ts
import ToolCallCard from './ToolCallCard.svelte';
import type { ChatPlugin } from '@chatkit-svelte/core';

/**
 * Registers ToolCallCard as the '*' wildcard toolRenderer — applies to any
 * tool call that doesn't have a more specific renderer registered by another
 * plugin, ensuring no tool call ever falls back to raw JSON in the chat.
 */
export function toolRenderPlugin(): ChatPlugin {
  return {
    name: 'tool-render',
    version: '1.0.0',
    toolRenderers: { '*': ToolCallCard },
  };
}

export { default as ToolCallCard } from './ToolCallCard.svelte';
```

- [ ] **Step 11: Typecheck and confirm no errors**

```bash
npx pnpm@9.0.0 --filter @chatkit-svelte/plugin-tool-render exec svelte-check --tsconfig ./tsconfig.json
```
Expected: `0 ERRORS 0 WARNINGS`.

---

### Task 2: `plugin-markdown`

A streaming-safe markdown renderer: parses to a restricted AST and renders through real Svelte elements — **no `{@html}` anywhere in this package**, satisfying spec §12's security requirement directly rather than via a sanitizer bolted on afterward. "Streaming-safe" means an unterminated construct (`**bold` with no closing `**`, an unclosed code fence) never crashes or half-renders broken markup — it just displays as literal text (or, for an unclosed code fence, as a code block containing everything seen so far) until the closing marker arrives on a later render.

**Files:**
- Modify: `packages/plugin-markdown/package.json`
- Create: `packages/plugin-markdown/tsconfig.json`
- Create: `packages/plugin-markdown/vite.config.ts`
- Create: `packages/plugin-markdown/vitest-setup.ts`
- Create: `packages/plugin-markdown/src/markdown-parser.ts`
- Create: `packages/plugin-markdown/src/markdown-parser.test.ts`
- Create: `packages/plugin-markdown/src/InlineNode.svelte`
- Create: `packages/plugin-markdown/src/Markdown.svelte`
- Create: `packages/plugin-markdown/src/Markdown.test.ts`
- Create: `packages/plugin-markdown/src/index.ts`

- [ ] **Step 1: Update `packages/plugin-markdown/package.json`**

The file already exists with `shiki` listed as a dependency from initial scaffolding — remove it (this plan doesn't wire up syntax highlighting; an unused dependency is worse than a documented gap — see this plan's header). Add the same devDependency set used in Task 1:

```json
{
  "name": "@chatkit-svelte/plugin-markdown",
  "version": "0.0.0",
  "description": "Streaming-safe markdown renderer: parses to a restricted AST and renders via real Svelte elements, no {@html}. Syntax highlighting is not yet wired up (see plan notes).",
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
    "@chatkit-svelte/core": "workspace:*"
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

- [ ] **Step 2: Write `packages/plugin-markdown/tsconfig.json`** (identical to Task 1's Step 2, `plugin-markdown` in place of `plugin-tool-render`)

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

- [ ] **Step 3: Write `packages/plugin-markdown/vite.config.ts`** (identical structure to Task 1's Step 3)

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
      external: ['svelte', /^svelte\//],
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

- [ ] **Step 4: Write `packages/plugin-markdown/vitest-setup.ts`** (identical to Task 1's Step 4)

```ts
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/svelte';

afterEach(() => {
  cleanup();
});
```

- [ ] **Step 5: Install dependencies**

```bash
npx pnpm@9.0.0 install
```

- [ ] **Step 6: Write the failing tests — `packages/plugin-markdown/src/markdown-parser.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { parseBlocks, parseInline } from './markdown-parser';

describe('parseInline', () => {
  it('parses plain text with no markup', () => {
    expect(parseInline('hello world')).toEqual([{ type: 'text', text: 'hello world' }]);
  });

  it('parses bold', () => {
    expect(parseInline('**bold**')).toEqual([{ type: 'bold', children: [{ type: 'text', text: 'bold' }] }]);
  });

  it('parses italic', () => {
    expect(parseInline('*italic*')).toEqual([{ type: 'italic', children: [{ type: 'text', text: 'italic' }] }]);
  });

  it('parses inline code', () => {
    expect(parseInline('`code`')).toEqual([{ type: 'code', text: 'code' }]);
  });

  it('parses a link', () => {
    expect(parseInline('[text](https://example.com)')).toEqual([
      { type: 'link', href: 'https://example.com', children: [{ type: 'text', text: 'text' }] },
    ]);
  });

  it('parses mixed text and markup', () => {
    expect(parseInline('a **b** c')).toEqual([
      { type: 'text', text: 'a ' },
      { type: 'bold', children: [{ type: 'text', text: 'b' }] },
      { type: 'text', text: ' c' },
    ]);
  });

  it('leaves an unterminated bold marker as literal text (streaming safety)', () => {
    expect(parseInline('hello **wor')).toEqual([{ type: 'text', text: 'hello **wor' }]);
  });

  it('leaves an unterminated code marker as literal text (streaming safety)', () => {
    expect(parseInline('call `foo(')).toEqual([{ type: 'text', text: 'call `foo(' }]);
  });
});

describe('parseBlocks', () => {
  it('parses a single paragraph', () => {
    expect(parseBlocks('hello world')).toEqual([{ type: 'paragraph', children: [{ type: 'text', text: 'hello world' }] }]);
  });

  it('splits paragraphs on blank lines', () => {
    expect(parseBlocks('first\n\nsecond')).toEqual([
      { type: 'paragraph', children: [{ type: 'text', text: 'first' }] },
      { type: 'paragraph', children: [{ type: 'text', text: 'second' }] },
    ]);
  });

  it('parses a fenced code block with a language', () => {
    expect(parseBlocks('```js\nconst x = 1;\n```')).toEqual([{ type: 'code', lang: 'js', text: 'const x = 1;' }]);
  });

  it('parses a fenced code block with no language', () => {
    expect(parseBlocks('```\nplain\n```')).toEqual([{ type: 'code', lang: undefined, text: 'plain' }]);
  });

  it('handles an unterminated code fence gracefully (streaming safety) by treating the rest as code so far', () => {
    expect(parseBlocks('```js\nconst x = 1;')).toEqual([{ type: 'code', lang: 'js', text: 'const x = 1;' }]);
  });

  it('parses a paragraph followed by a code block', () => {
    expect(parseBlocks('intro\n\n```\ncode\n```')).toEqual([
      { type: 'paragraph', children: [{ type: 'text', text: 'intro' }] },
      { type: 'code', lang: undefined, text: 'code' },
    ]);
  });
});
```

- [ ] **Step 7: Run the tests and confirm they fail**

```bash
npx pnpm@9.0.0 --filter @chatkit-svelte/plugin-markdown exec vitest run src/markdown-parser.test.ts
```
Expected: FAIL — `Cannot find module './markdown-parser'`.

- [ ] **Step 8: Write `packages/plugin-markdown/src/markdown-parser.ts`**

```ts
export type InlineNode =
  | { type: 'text'; text: string }
  | { type: 'bold'; children: InlineNode[] }
  | { type: 'italic'; children: InlineNode[] }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string; children: InlineNode[] };

export type BlockNode = { type: 'paragraph'; children: InlineNode[] } | { type: 'code'; lang?: string; text: string };

const INLINE_PATTERN = /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(`(.+?)`)|(\[(.+?)\]\((.+?)\))/;

export function parseInline(text: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    const match = INLINE_PATTERN.exec(remaining);
    if (!match) {
      nodes.push({ type: 'text', text: remaining });
      break;
    }
    if (match.index > 0) {
      nodes.push({ type: 'text', text: remaining.slice(0, match.index) });
    }
    if (match[2] !== undefined) {
      nodes.push({ type: 'bold', children: parseInline(match[2]) });
    } else if (match[4] !== undefined) {
      nodes.push({ type: 'italic', children: parseInline(match[4]) });
    } else if (match[6] !== undefined) {
      nodes.push({ type: 'code', text: match[6] });
    } else if (match[8] !== undefined && match[9] !== undefined) {
      nodes.push({ type: 'link', href: match[9], children: parseInline(match[8]) });
    }
    remaining = remaining.slice(match.index + match[0].length);
  }
  return nodes;
}

export function parseBlocks(source: string): BlockNode[] {
  const blocks: BlockNode[] = [];
  const lines = source.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fenceMatch = /^```(\w*)\s*$/.exec(line);
    if (fenceMatch) {
      const lang = fenceMatch[1] || undefined;
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1; // consume closing fence if present; if streaming and unterminated, we just stop at EOF
      blocks.push({ type: 'code', lang, text: codeLines.join('\n') });
      continue;
    }
    if (line.trim() === '') {
      i += 1;
      continue;
    }
    const paraLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' && !/^```(\w*)\s*$/.test(lines[i])) {
      paraLines.push(lines[i]);
      i += 1;
    }
    blocks.push({ type: 'paragraph', children: parseInline(paraLines.join('\n')) });
  }
  return blocks;
}
```

- [ ] **Step 9: Run the tests and confirm they pass**

```bash
npx pnpm@9.0.0 --filter @chatkit-svelte/plugin-markdown exec vitest run src/markdown-parser.test.ts
```
Expected: PASS — 14 tests.

- [ ] **Step 9a: Fix a real infinite loop found by review, and add regression tests**

A code-quality review of the parser found a genuine, reproducible hang: `parseBlocks`'s fence-open detection (`/^```(\w*)\s*$/`, used just above) is strict, but the paragraph-collection loop's stop condition — the line shown in Step 8 as `!/^```/.test(lines[i])` — is loose. A line like `` ```js title="app.js" `` (a fence-open with trailing info-string content, a realistic pattern for annotated code blocks) fails the strict fence test and falls into the paragraph branch; once there, the loose test immediately stops the inner loop without ever executing its body — the only place that advances the line index in that branch — so `i` never changes and the outer `while (i < lines.length)` loop repeats on the same line forever. Since `Markdown.svelte` calls `parseBlocks` synchronously inside a `$derived`, this would freeze the render on any streamed text containing such a line.

The fix: use the identical strict regex in both places, so every line is exhaustively partitioned into "matches, handled by the fence branch" or "doesn't match, absorbed into the paragraph text" — no line can fall into a gap between two different conditions. In `packages/plugin-markdown/src/markdown-parser.ts`, change the paragraph loop's condition from:
```ts
    while (i < lines.length && lines[i].trim() !== '' && !/^```/.test(lines[i])) {
```
to:
```ts
    while (i < lines.length && lines[i].trim() !== '' && !/^```(\w*)\s*$/.test(lines[i])) {
```
(This is the version already shown in Step 8 above — Step 8's code block has this fix folded in directly, so if you're implementing fresh from this plan you already have it. This step exists to explain why that line looks the way it does, and to add the regression tests below, which the original 14-test file has no coverage for.)

Add these two tests to `packages/plugin-markdown/src/markdown-parser.test.ts`, inside the existing `describe('parseBlocks', ...)` block:

```ts
  it('does not hang on a fence-opening line with trailing info-string content it cannot parse as a language', () => {
    const result = parseBlocks('```js title="app.js"\nconst x = 1;');
    expect(result).toBeDefined();
  });

  it('treats a malformed fence-opening line (extra content after the language word) as ordinary paragraph text rather than a fence', () => {
    const result = parseBlocks('```js title="app.js"\nmore text');
    // The absorbed line still goes through parseInline, which independently
    // matches the first and third backtick of the leading ``` as an
    // inline-code pair (capturing the middle backtick) — this is correct,
    // pre-existing parseInline behavior, not a special case for this input.
    expect(result).toEqual([
      {
        type: 'paragraph',
        children: [
          { type: 'code', text: '`' },
          { type: 'text', text: 'js title="app.js"\nmore text' },
        ],
      },
    ]);
  });
```

Run:
```bash
npx pnpm@9.0.0 --filter @chatkit-svelte/plugin-markdown exec vitest run src/markdown-parser.test.ts
```
Expected: PASS — 16 tests (14 original + these 2). Should complete in a couple of seconds — if it hangs, the fix didn't take.

- [ ] **Step 10: Write `packages/plugin-markdown/src/InlineNode.svelte`**

A recursive component — self-importing is a supported, verified pattern for recursive Svelte rendering (each inline node with children renders itself again for each child).

```svelte
<script lang="ts">
  import type { InlineNode } from './markdown-parser';
  import Self from './InlineNode.svelte';

  interface Props {
    node: InlineNode;
  }

  let { node }: Props = $props();
</script>

{#if node.type === 'text'}
  {node.text}
{:else if node.type === 'bold'}
  <strong>{#each node.children as child}<Self node={child} />{/each}</strong>
{:else if node.type === 'italic'}
  <em>{#each node.children as child}<Self node={child} />{/each}</em>
{:else if node.type === 'code'}
  <code>{node.text}</code>
{:else if node.type === 'link'}
  <a href={node.href} rel="noopener noreferrer" target="_blank"
    >{#each node.children as child}<Self node={child} />{/each}</a
  >
{/if}
```

- [ ] **Step 11: Write the failing tests — `packages/plugin-markdown/src/Markdown.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import Markdown from './Markdown.svelte';

describe('Markdown', () => {
  it('renders bold/italic/code/link inline formatting as real elements, not innerHTML', () => {
    render(Markdown, { part: { type: 'text', text: 'a **bold** and *italic* and `code` and [a link](https://example.com)' } });

    const strong = screen.getByText('bold');
    expect(strong.tagName).toBe('STRONG');
    const em = screen.getByText('italic');
    expect(em.tagName).toBe('EM');
    const code = screen.getByText('code');
    expect(code.tagName).toBe('CODE');
    const link = screen.getByText('a link');
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', 'https://example.com');
  });

  it('renders a fenced code block with its language as a data attribute', () => {
    render(Markdown, { part: { type: 'text', text: '```js\nconst x = 1;\n```' } });
    const code = screen.getByText('const x = 1;');
    expect(code.tagName).toBe('CODE');
    expect(code).toHaveAttribute('data-lang', 'js');
  });

  it('renders multiple paragraphs as separate <p> elements', () => {
    render(Markdown, { part: { type: 'text', text: 'first\n\nsecond' } });
    expect(screen.getByText('first').tagName).toBe('P');
    expect(screen.getByText('second').tagName).toBe('P');
  });

  it('renders an unterminated bold marker as literal text while streaming, without crashing', () => {
    render(Markdown, { part: { type: 'text', text: 'thinking **abo' } });
    expect(screen.getByText('thinking **abo')).toBeInTheDocument();
  });

  it('re-renders reactively as the part prop grows (streaming)', async () => {
    const { rerender } = render(Markdown, { part: { type: 'text', text: 'Hello' } });
    expect(screen.getByText('Hello')).toBeInTheDocument();
    await rerender({ part: { type: 'text', text: 'Hello, **world**!' } });
    expect(screen.getByText('world').tagName).toBe('STRONG');
  });
});
```

- [ ] **Step 12: Run the tests and confirm they fail**

```bash
npx pnpm@9.0.0 --filter @chatkit-svelte/plugin-markdown exec vitest run src/Markdown.test.ts
```
Expected: FAIL — `Cannot find module './Markdown.svelte'`.

- [ ] **Step 13: Write `packages/plugin-markdown/src/Markdown.svelte`**

The prop is `part: ContentPart` (matching `MessageRendererRegistration`'s calling convention — see Task 4) rather than a bare string, so this component's signature is what a `messageRenderer` component is expected to look like: it receives the whole content part, narrows to the `text` variant, and reads `.text`.

```svelte
<script lang="ts">
  import { parseBlocks } from './markdown-parser';
  import InlineNode from './InlineNode.svelte';
  import type { ContentPart } from '@chatkit-svelte/core';

  interface Props {
    part: ContentPart & { type: 'text' };
  }

  let { part }: Props = $props();
  let blocks = $derived(parseBlocks(part.text));
</script>

<div class="ck-markdown">
  {#each blocks as block}
    {#if block.type === 'paragraph'}
      <p>{#each block.children as node}<InlineNode {node} />{/each}</p>
    {:else if block.type === 'code'}
      <pre><code data-lang={block.lang}>{block.text}</code></pre>
    {/if}
  {/each}
</div>

<style>
  .ck-markdown :global(p) {
    margin: 0 0 var(--ck-space-2) 0;
  }

  .ck-markdown :global(p:last-child) {
    margin-bottom: 0;
  }

  .ck-markdown :global(pre) {
    background: var(--ck-color-surface);
    border-radius: var(--ck-radius-sm);
    padding: var(--ck-space-2);
    overflow-x: auto;
    font-family: var(--ck-font-mono);
    font-size: var(--ck-font-size-sm);
  }

  .ck-markdown :global(code) {
    font-family: var(--ck-font-mono);
  }
</style>
```

Note: the Task 11 test passes `part` (matching this signature), not `source` — this differs from the scratch-validated prototype's prop name (which was `source: string`) precisely because the real component must match `MessageRendererRegistration`'s `{ part: ContentPart }` calling convention (Task 4) — the prototype was validated as a standalone component before that integration contract was finalized; this is the corrected, final signature.

- [ ] **Step 14: Run the tests and confirm they pass**

```bash
npx pnpm@9.0.0 --filter @chatkit-svelte/plugin-markdown exec vitest run src/Markdown.test.ts
```
Expected: PASS — 5 tests.

- [ ] **Step 15: Write `packages/plugin-markdown/src/index.ts`**

```ts
import Markdown from './Markdown.svelte';
import type { ChatPlugin } from '@chatkit-svelte/core';

/**
 * Registers Markdown as the messageRenderer for 'text' content parts, taking
 * priority over MessageList's built-in plain-<p> fallback (Task 4).
 */
export function markdownPlugin(): ChatPlugin {
  return {
    name: 'markdown',
    version: '1.0.0',
    messageRenderers: [{ partType: 'text', component: Markdown, priority: 10 }],
  };
}

export { default as Markdown } from './Markdown.svelte';
export { parseBlocks, parseInline } from './markdown-parser';
export type { BlockNode, InlineNode } from './markdown-parser';
```

- [ ] **Step 16: Typecheck and confirm no errors**

```bash
npx pnpm@9.0.0 --filter @chatkit-svelte/plugin-markdown exec svelte-check --tsconfig ./tsconfig.json
```
Expected: `0 ERRORS 0 WARNINGS`.

---

### Task 3: `plugin-file-handling`

The attachment pipeline: validates a picked file, calls a consumer-supplied `upload` function, and produces a `file` or `image` `ContentPart`. Also registers `messageRenderers` for those two part types (currently unrendered — `<MessageList>` silently skips any part type it has no case for).

**Files:**
- Modify: `packages/plugin-file-handling/package.json`
- Create: `packages/plugin-file-handling/tsconfig.json`
- Create: `packages/plugin-file-handling/vite.config.ts`
- Create: `packages/plugin-file-handling/vitest-setup.ts`
- Create: `packages/plugin-file-handling/src/FileRenderer.svelte`
- Create: `packages/plugin-file-handling/src/ImageRenderer.svelte`
- Create: `packages/plugin-file-handling/src/file-handling-plugin.ts`
- Create: `packages/plugin-file-handling/src/file-handling-plugin.test.ts`
- Create: `packages/plugin-file-handling/src/index.ts`

- [ ] **Step 1: Update `packages/plugin-file-handling/package.json`**

```json
{
  "name": "@chatkit-svelte/plugin-file-handling",
  "version": "0.0.0",
  "description": "Attachment pipeline (validate/upload) and file & image message renderers. Drag-drop/paste input transforms are a documented fast-follow, not included in this milestone.",
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
    "@chatkit-svelte/core": "workspace:*"
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

- [ ] **Step 2: Write `packages/plugin-file-handling/tsconfig.json`** (identical structure to Task 1's Step 2)

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

- [ ] **Step 3: Write `packages/plugin-file-handling/vite.config.ts`** (identical structure to Task 1's Step 3)

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
      external: ['svelte', /^svelte\//],
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

- [ ] **Step 4: Write `packages/plugin-file-handling/vitest-setup.ts`** (identical to Task 1's Step 4)

```ts
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/svelte';

afterEach(() => {
  cleanup();
});
```

- [ ] **Step 5: Install dependencies**

```bash
npx pnpm@9.0.0 install
```

- [ ] **Step 6: Write `packages/plugin-file-handling/src/FileRenderer.svelte`**

No TDD cycle for this trivial rendering component alone — it's exercised via Step 9's plugin-level test and Task 4's `<MessageList>` integration.

```svelte
<script lang="ts">
  import type { ContentPart } from '@chatkit-svelte/core';

  interface Props {
    part: ContentPart & { type: 'file' };
  }

  let { part }: Props = $props();
</script>

<a class="ck-attachment-file" href={part.url} download={part.name} target="_blank" rel="noopener noreferrer">
  📎 {part.name}
</a>

<style>
  .ck-attachment-file {
    display: inline-block;
    color: inherit;
    text-decoration: none;
    border: 1px solid var(--ck-color-border);
    border-radius: var(--ck-radius-sm);
    padding: var(--ck-space-2) var(--ck-space-3);
  }
</style>
```

- [ ] **Step 7: Write `packages/plugin-file-handling/src/ImageRenderer.svelte`**

```svelte
<script lang="ts">
  import type { ContentPart } from '@chatkit-svelte/core';

  interface Props {
    part: ContentPart & { type: 'image' };
  }

  let { part }: Props = $props();
</script>

<img class="ck-attachment-image" src={part.url} alt={part.alt ?? ''} />

<style>
  .ck-attachment-image {
    max-width: 100%;
    border-radius: var(--ck-radius-sm);
    display: block;
  }
</style>
```

- [ ] **Step 8: Write the failing tests — `packages/plugin-file-handling/src/file-handling-plugin.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest';
import { fileHandlingPlugin } from './file-handling-plugin';

function makeFile(name: string, type: string, sizeBytes: number): File {
  return new File([new Uint8Array(sizeBytes)], name, { type });
}

describe('fileHandlingPlugin', () => {
  it('registers an attachmentHandler accepting images/pdf/text by default', () => {
    const upload = vi.fn(async () => ({ url: 'https://example.com/f' }));
    const plugin = fileHandlingPlugin({ upload });
    expect(plugin.attachmentHandlers).toHaveLength(1);
    expect(plugin.attachmentHandlers?.[0].accept).toEqual(['image/*', 'application/pdf', 'text/*']);
  });

  it('produces an image ContentPart for an image file', async () => {
    const upload = vi.fn(async () => ({ url: 'https://example.com/pic.png' }));
    const plugin = fileHandlingPlugin({ upload });
    const file = makeFile('pic.png', 'image/png', 100);

    const part = await plugin.attachmentHandlers![0].process(file, {});

    expect(part).toEqual({ type: 'image', url: 'https://example.com/pic.png', mimeType: 'image/png' });
    expect(upload).toHaveBeenCalledWith(file, undefined);
  });

  it('produces a file ContentPart for a non-image file', async () => {
    const upload = vi.fn(async () => ({ url: 'https://example.com/doc.pdf' }));
    const plugin = fileHandlingPlugin({ upload });
    const file = makeFile('doc.pdf', 'application/pdf', 2048);

    const part = await plugin.attachmentHandlers![0].process(file, {});

    expect(part).toEqual({
      type: 'file',
      url: 'https://example.com/doc.pdf',
      name: 'doc.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 2048,
    });
  });

  it('registers messageRenderers for both file and image content-part types', () => {
    const plugin = fileHandlingPlugin({ upload: vi.fn() });
    const partTypes = plugin.messageRenderers?.map((r) => r.partType);
    expect(partTypes).toEqual(expect.arrayContaining(['file', 'image']));
  });

  it('allows overriding accept and maxSizeBytes', () => {
    const plugin = fileHandlingPlugin({ upload: vi.fn(), accept: ['application/pdf'], maxSizeBytes: 1000 });
    expect(plugin.attachmentHandlers?.[0].accept).toEqual(['application/pdf']);
    expect(plugin.attachmentHandlers?.[0].maxSizeBytes).toBe(1000);
  });
});
```

- [ ] **Step 9: Run the tests and confirm they fail**

```bash
npx pnpm@9.0.0 --filter @chatkit-svelte/plugin-file-handling exec vitest run src/file-handling-plugin.test.ts
```
Expected: FAIL — `Cannot find module './file-handling-plugin'`.

- [ ] **Step 10: Write `packages/plugin-file-handling/src/file-handling-plugin.ts`**

```ts
import FileRenderer from './FileRenderer.svelte';
import ImageRenderer from './ImageRenderer.svelte';
import type { ChatPlugin, ContentPart } from '@chatkit-svelte/core';

export interface FileHandlingOptions {
  /** MIME type patterns accepted, e.g. 'image/*' or 'application/pdf'. Default: images, PDFs, text files. */
  accept?: string[];
  /** Max file size in bytes. Default 25MB. */
  maxSizeBytes?: number;
  /** Uploads the file to wherever attachments are hosted and returns its accessible URL. */
  upload: (file: File, abortSignal?: AbortSignal) => Promise<{ url: string }>;
}

export function fileHandlingPlugin(opts: FileHandlingOptions): ChatPlugin {
  return {
    name: 'file-handling',
    version: '1.0.0',
    attachmentHandlers: [
      {
        accept: opts.accept ?? ['image/*', 'application/pdf', 'text/*'],
        maxSizeBytes: opts.maxSizeBytes ?? 25 * 1024 * 1024,
        async process(file, ctx): Promise<ContentPart> {
          // AttachmentHandler.process's `file` parameter is typed structurally
          // ({ name, type, size }) by @chatkit-svelte/core so the plugin-host contract
          // stays DOM-independent; at runtime it's always the real browser
          // File object Composer.svelte passes through (Task 5), which
          // `opts.upload` needs directly (to read its bytes) — hence the cast.
          const uploaded = await opts.upload(file as File, ctx.abortSignal);
          if (file.type.startsWith('image/')) {
            return { type: 'image', url: uploaded.url, mimeType: file.type };
          }
          return { type: 'file', url: uploaded.url, name: file.name, mimeType: file.type, sizeBytes: file.size };
        },
      },
    ],
    messageRenderers: [
      { partType: 'file', component: FileRenderer, priority: 10 },
      { partType: 'image', component: ImageRenderer, priority: 10 },
    ],
  };
}
```

- [ ] **Step 11: Run the tests and confirm they pass**

```bash
npx pnpm@9.0.0 --filter @chatkit-svelte/plugin-file-handling exec vitest run src/file-handling-plugin.test.ts
```
Expected: PASS — 5 tests.

- [ ] **Step 12: Write `packages/plugin-file-handling/src/index.ts`**

```ts
export { fileHandlingPlugin } from './file-handling-plugin';
export type { FileHandlingOptions } from './file-handling-plugin';
export { default as FileRenderer } from './FileRenderer.svelte';
export { default as ImageRenderer } from './ImageRenderer.svelte';
```

- [ ] **Step 13: Typecheck and confirm no errors**

```bash
npx pnpm@9.0.0 --filter @chatkit-svelte/plugin-file-handling exec svelte-check --tsconfig ./tsconfig.json
```
Expected: `0 ERRORS 0 WARNINGS`.

---

### Task 4: `<MessageList>` registry-aware refactor

Replaces the hardcoded `text`-only branch with registry lookups: `messageRenderers` (by content-part type, already priority-sorted by `createPluginHost`) for everything except `tool_call`, and `toolRenderers` (by tool name, falling back to the `'*'` wildcard) for `tool_call` parts specifically — `tool_call` isn't a `messageRenderers` concern because it's registered per-tool-name, a different registry shape (spec §6.1's extension-point table lists these as two separate mechanisms). Built-in fallbacks preserve exact current behavior when no plugin is active: plain `<p>{text}</p>` for text, a minimal name/status line for tool calls (not raw JSON — matches spec §12's "tool-call args and results are data, not code" framing, this fallback never executes anything, it just displays two strings), and silent skipping for any other part type with no matching renderer.

This is the highest-risk piece of this milestone — verified end-to-end with a real `createChatStore` + `createPluginHost` (not mocked), covering all five paths (built-in text, plugin-overridden text, built-in tool-call fallback, plugin-overridden tool-call, silent skip).

**Files:**
- Modify: `packages/ui/src/MessageList.svelte`
- Modify: `packages/ui/src/MessageList.test.ts` (extend `ChatWindow.test.ts` indirectly is not sufficient — this task adds a dedicated `MessageList.test.ts` file testing the registry behavior directly, since `ChatWindow.test.ts` only exercises the plugin-free default path)

Svelte context (`setChatContext`/`getChatContext`) only works within a component tree, so testing `MessageList` directly (not through `<ChatProvider>`) needs a small test-only harness component that constructs the store and sets context itself — same pattern as `ChatProvider.test.ts`/`ChatWindow.test.ts` in M2.

- [ ] **Step 1: Write the test-only harness — `packages/ui/src/MessageListHarness.svelte`**

```svelte
<script lang="ts">
  import { createChatStore, setChatContext } from '@chatkit-svelte/svelte';
  import MessageList from './MessageList.svelte';
  import type { ChatConfig } from '@chatkit-svelte/core';
  import { untrack } from 'svelte';

  interface Props {
    config: ChatConfig;
  }

  let { config }: Props = $props();
  const store = untrack(() => createChatStore(config));
  setChatContext(store);
</script>

<MessageList />
```

- [ ] **Step 2: Write the two tiny test-fixture components the test file imports**

`packages/ui/src/test-fixtures/CustomTextRenderer.svelte`:
```svelte
<script lang="ts">
  import type { ContentPart } from '@chatkit-svelte/core';
  interface Props {
    part: ContentPart & { type: 'text' };
  }
  let { part }: Props = $props();
</script>

<p data-testid="custom-text">CUSTOM: {part.text}</p>
```

`packages/ui/src/test-fixtures/CustomToolRenderer.svelte`:
```svelte
<script lang="ts">
  import type { ContentPart } from '@chatkit-svelte/core';
  interface Props {
    toolCall: ContentPart & { type: 'tool_call' };
  }
  let { toolCall }: Props = $props();
</script>

<div data-testid="custom-tool">CUSTOM TOOL: {toolCall.toolName}</div>
```

- [ ] **Step 3: Write the failing tests — `packages/ui/src/MessageList.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import MessageListHarness from './MessageListHarness.svelte';
import CustomTextRenderer from './test-fixtures/CustomTextRenderer.svelte';
import CustomToolRenderer from './test-fixtures/CustomToolRenderer.svelte';
import { createFixtureTransport } from '@chatkit-svelte/core';
import type { ChatEvent, ChatPlugin } from '@chatkit-svelte/core';

describe('MessageList — registry-aware rendering', () => {
  it('renders text via the built-in <p> when no plugin registers a text renderer', async () => {
    const events: ChatEvent[] = [
      { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'hello' },
      { type: 'TEXT_MESSAGE_END', messageId: 'm1' },
    ];
    const transport = createFixtureTransport(events);
    render(MessageListHarness, { config: { transport, threadId: 't1' } });

    await waitFor(() => {
      const p = screen.getByText('hello');
      expect(p.tagName).toBe('P');
    });
  });

  it('prefers a registered messageRenderer over the built-in text fallback', async () => {
    const events: ChatEvent[] = [
      { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'hello' },
      { type: 'TEXT_MESSAGE_END', messageId: 'm1' },
    ];
    const transport = createFixtureTransport(events);
    const plugin: ChatPlugin = {
      name: 'custom-text',
      version: '1.0.0',
      messageRenderers: [{ partType: 'text', component: CustomTextRenderer, priority: 10 }],
    };
    render(MessageListHarness, { config: { transport, threadId: 't1', plugins: [plugin] } });

    await waitFor(() => {
      expect(screen.getByTestId('custom-text')).toHaveTextContent('CUSTOM: hello');
    });
  });

  it('renders a minimal built-in fallback for tool calls when no toolRenderer is registered', async () => {
    const events: ChatEvent[] = [
      { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' },
      { type: 'TOOL_CALL_START', toolCallId: 'tc1', toolName: 'search', parentMessageId: 'm1' },
      { type: 'TOOL_CALL_END', toolCallId: 'tc1' },
    ];
    const transport = createFixtureTransport(events);
    render(MessageListHarness, { config: { transport, threadId: 't1' } });

    await waitFor(() => {
      expect(screen.getByTestId('tool-fallback')).toHaveTextContent('Tool call: search (pending_execution)');
    });
  });

  it('prefers a registered wildcard toolRenderer over the built-in fallback', async () => {
    const events: ChatEvent[] = [
      { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' },
      { type: 'TOOL_CALL_START', toolCallId: 'tc1', toolName: 'search', parentMessageId: 'm1' },
      { type: 'TOOL_CALL_END', toolCallId: 'tc1' },
    ];
    const transport = createFixtureTransport(events);
    const plugin: ChatPlugin = {
      name: 'custom-tool',
      version: '1.0.0',
      toolRenderers: { '*': CustomToolRenderer },
    };
    render(MessageListHarness, { config: { transport, threadId: 't1', plugins: [plugin] } });

    await waitFor(() => {
      expect(screen.getByTestId('custom-tool')).toHaveTextContent('CUSTOM TOOL: search');
    });
  });

  it('silently skips a content-part type with no built-in case and no registered renderer', async () => {
    const events: ChatEvent[] = [
      {
        type: 'MESSAGES_SNAPSHOT',
        messages: [
          {
            id: 'm1',
            role: 'assistant',
            createdAt: 0,
            streaming: false,
            parts: [{ type: 'custom', name: 'x', payload: {} }],
          },
        ],
      },
    ];
    const transport = createFixtureTransport(events);
    render(MessageListHarness, { config: { transport, threadId: 't1' } });

    await waitFor(() => {
      expect(screen.getByTestId('message')).toBeInTheDocument();
    });
    // Svelte leaves internal comment-node block markers even when nothing
    // visible renders, so check for absent text content rather than using
    // toBeEmptyDOMElement() (which doesn't ignore comment nodes).
    expect(screen.getByTestId('message').textContent).toBe('');
  });
});
```

- [ ] **Step 4: Run the tests and confirm they fail**

```bash
npx pnpm@9.0.0 --filter @chatkit-svelte/ui exec vitest run src/MessageList.test.ts
```
Expected: FAIL — the current `MessageList.svelte` has no tool-call handling at all (so the tool-call tests fail with "Unable to find element"), and no registry consultation for `text` (so the custom-renderer tests fail the same way).

- [ ] **Step 5: Rewrite `packages/ui/src/MessageList.svelte`**

Full file content (replace the entire file with this):

```svelte
<script lang="ts">
  import { getChatContext } from '@chatkit-svelte/svelte';
  import type { Snippet, Component } from 'svelte';
  import type { ContentPart, Message } from '@chatkit-svelte/core';

  interface Props {
    message?: Snippet<[Message]>;
  }

  let { message }: Props = $props();
  const store = getChatContext();

  // The plugin registry stores renderer components as `unknown` in
  // @chatkit-svelte/core (deliberately — core has no Svelte dependency, see spec
  // §2). This is the trust boundary where that gets cast back to a concrete
  // Svelte Component type: plugin authors are responsible for matching the
  // { part } / { toolCall } prop shape a registration implies.
  function messageRendererFor(part: ContentPart): Component<{ part: ContentPart }> | undefined {
    const match = store.registry.messageRenderers.find((r) => r.partType === part.type);
    return match?.component as Component<{ part: ContentPart }> | undefined;
  }

  function toolRendererFor(toolName: string): Component<{ toolCall: ContentPart & { type: 'tool_call' } }> | undefined {
    return (store.registry.toolRenderers[toolName] ?? store.registry.toolRenderers['*']) as
      | Component<{ toolCall: ContentPart & { type: 'tool_call' } }>
      | undefined;
  }
</script>

<div class="ck-message-list" role="log" aria-live="polite">
  {#each store.messages as msg (msg.id)}
    {#if message}
      {@render message(msg)}
    {:else}
      <div class="ck-message ck-message--{msg.role}" data-testid="message">
        {#each msg.parts as part}
          {#if part.type === 'tool_call'}
            {@const ToolRenderer = toolRendererFor(part.toolName)}
            {#if ToolRenderer}
              <ToolRenderer toolCall={part} />
            {:else}
              <div class="ck-tool-call-fallback" data-testid="tool-fallback">Tool call: {part.toolName} ({part.status})</div>
            {/if}
          {:else}
            {@const Renderer = messageRendererFor(part)}
            {#if Renderer}
              <Renderer {part} />
            {:else if part.type === 'text'}
              <p>{part.text}</p>
            {/if}
          {/if}
        {/each}
      </div>
    {/if}
  {/each}
</div>

<style>
  .ck-message-list {
    flex-grow: 1;
    overflow-y: auto;
    padding: var(--ck-space-4);
    display: flex;
    flex-direction: column;
    gap: var(--ck-space-3);
  }

  .ck-message {
    border-radius: var(--ck-radius-md);
    padding: var(--ck-space-3);
  }

  .ck-message--user {
    background: var(--ck-color-user-bubble);
    color: var(--ck-color-user-bubble-text);
    margin-left: auto;
    max-width: 80%;
  }

  .ck-message--assistant {
    background: var(--ck-color-assistant-bubble);
    color: var(--ck-color-assistant-bubble-text);
    margin-right: auto;
    max-width: 80%;
  }

  .ck-tool-call-fallback {
    font-size: var(--ck-font-size-sm);
    color: var(--ck-color-text-muted);
    font-family: var(--ck-font-mono);
  }
</style>
```

- [ ] **Step 6: Run the tests and confirm they pass**

```bash
npx pnpm@9.0.0 --filter @chatkit-svelte/ui exec vitest run src/MessageList.test.ts
```
Expected: PASS — 5 tests.

- [ ] **Step 7: Re-run `ChatWindow.test.ts` to confirm the refactor didn't regress the plugin-free path**

```bash
npx pnpm@9.0.0 --filter @chatkit-svelte/ui exec vitest run src/ChatWindow.test.ts
```
Expected: PASS — still 2 tests (unchanged from M2).

---

### Task 5: `<Composer>` attachment support

A generic mechanism, not file-handling-specific: `<Composer>` shows an attach button only when `store.registry.attachmentHandlers.length > 0`, matches the picked file's MIME type against whichever handlers are registered (first match wins), and calls that handler's `process()`. This works for `plugin-file-handling` (Task 3) or any future plugin that registers an `attachmentHandler`, without `<Composer>` knowing anything plugin-specific.

**Files:**
- Modify: `packages/svelte/src/chat-store.svelte.ts`
- Modify: `packages/svelte/src/chat-store.test.ts`
- Modify: `packages/ui/src/Composer.svelte`
- Create: `packages/ui/src/Composer.test.ts`
- Create: `packages/ui/src/ComposerHarness.svelte` (test-only)

- [ ] **Step 1: Fix `chat-store.svelte.ts` — don't emit an empty text part on an attachment-only send**

This bug wasn't reachable before this milestone (there was no way to send a message with attachments and no text), so it's fixed now rather than shipped as a new, avoidable defect. In `packages/svelte/src/chat-store.svelte.ts`, find `sendMessage`:

```ts
  async function sendMessage(input: UserInput): Promise<void> {
    const processed = (await pluginHost.runHook('beforeSend', input, ctx)) as UserInput;
    const message: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      parts: [{ type: 'text', text: processed.text }, ...(processed.attachments ?? [])],
      createdAt: Date.now(),
      streaming: false,
    };
    state = { ...state, messages: [...state.messages, message] };
    await startRun({});
  }
```

Change the `parts` line so an empty/whitespace-only `text` doesn't produce a part at all:

```ts
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
```

Add this test to `packages/svelte/src/chat-store.test.ts`, inside the existing `describe('createChatStore', ...)` block:

```ts
  it('sendMessage omits the text part entirely when only attachments are sent', async () => {
    const transport = createFixtureTransport([]);
    const store = createChatStore({ transport, threadId: 't1' });

    await store.sendMessage({ text: '', attachments: [{ type: 'file', url: 'https://x/y', name: 'y', mimeType: 'text/plain' }] });

    expect(store.messages[0].parts).toEqual([{ type: 'file', url: 'https://x/y', name: 'y', mimeType: 'text/plain' }]);

    store.dispose();
  });
```

Run:
```bash
npx pnpm@9.0.0 --filter @chatkit-svelte/svelte exec vitest run src/chat-store.test.ts
```
Expected: PASS — 7 tests (6 previous + this one). The pre-existing `'sendMessage appends a user message and calls transport.sendRun'` test (which sends non-empty text) is unaffected by this change — confirm it still passes too.

- [ ] **Step 2: Write the test-only harness — `packages/ui/src/ComposerHarness.svelte`**

```svelte
<script lang="ts">
  import { createChatStore, setChatContext } from '@chatkit-svelte/svelte';
  import Composer from './Composer.svelte';
  import type { ChatConfig } from '@chatkit-svelte/core';
  import { untrack } from 'svelte';

  interface Props {
    config: ChatConfig;
  }

  let { config }: Props = $props();
  const store = untrack(() => createChatStore(config));
  setChatContext(store);
</script>

<Composer />
```

- [ ] **Step 3: Write the failing tests — `packages/ui/src/Composer.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import ComposerHarness from './ComposerHarness.svelte';
import { createFixtureTransport } from '@chatkit-svelte/core';
import type { ChatPlugin } from '@chatkit-svelte/core';

describe('Composer — attachments', () => {
  it('does not show an attach button when no attachmentHandlers are registered', () => {
    const transport = createFixtureTransport([]);
    render(ComposerHarness, { config: { transport, threadId: 't1' } });

    expect(screen.queryByLabelText('Attach')).not.toBeInTheDocument();
  });

  it('shows an attach button when a plugin registers an attachmentHandler', () => {
    const transport = createFixtureTransport([]);
    const plugin: ChatPlugin = {
      name: 'attach-test',
      version: '1.0.0',
      attachmentHandlers: [{ accept: ['text/plain'], process: vi.fn() }],
    };
    render(ComposerHarness, { config: { transport, threadId: 't1', plugins: [plugin] } });

    expect(screen.getByLabelText('Attach')).toBeInTheDocument();
  });

  it('picking a matching file calls the handler and includes the resulting part in the next sendMessage', async () => {
    const transport = createFixtureTransport([]);
    const process = vi.fn(async () => ({ type: 'file' as const, url: 'https://x/y', name: 'y.txt', mimeType: 'text/plain' }));
    const plugin: ChatPlugin = {
      name: 'attach-test',
      version: '1.0.0',
      attachmentHandlers: [{ accept: ['text/plain'], process }],
    };
    render(ComposerHarness, { config: { transport, threadId: 't1', plugins: [plugin] } });

    const fileInput = screen.getByLabelText('Attach file', { selector: 'input' }) as HTMLInputElement;
    const file = new File(['hello'], 'y.txt', { type: 'text/plain' });
    await fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(process).toHaveBeenCalledWith(file, {});
    });

    await fireEvent.submit(fileInput.closest('form')!);

    await waitFor(() => {
      expect(transport.recorder.runs).toHaveLength(1);
    });
    expect(transport.recorder.runs[0].messages[0].parts).toEqual([
      { type: 'file', url: 'https://x/y', name: 'y.txt', mimeType: 'text/plain' },
    ]);
  });

  it('a file with no matching handler is silently ignored', async () => {
    const transport = createFixtureTransport([]);
    const process = vi.fn();
    const plugin: ChatPlugin = {
      name: 'attach-test',
      version: '1.0.0',
      attachmentHandlers: [{ accept: ['image/*'], process }],
    };
    render(ComposerHarness, { config: { transport, threadId: 't1', plugins: [plugin] } });

    const fileInput = screen.getByLabelText('Attach file', { selector: 'input' }) as HTMLInputElement;
    const file = new File(['hello'], 'y.txt', { type: 'text/plain' });
    await fireEvent.change(fileInput, { target: { files: [file] } });

    expect(process).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Run the tests and confirm they fail**

```bash
npx pnpm@9.0.0 --filter @chatkit-svelte/ui exec vitest run src/Composer.test.ts
```
Expected: FAIL — the current `Composer.svelte` has no attachment button or file input at all.

- [ ] **Step 5: Rewrite `packages/ui/src/Composer.svelte`**

Full file content (replace the entire file with this):

```svelte
<script lang="ts">
  import { getChatContext } from '@chatkit-svelte/svelte';
  import type { ContentPart } from '@chatkit-svelte/core';

  const store = getChatContext();
  let text = $state('');
  let pendingAttachments: ContentPart[] = $state([]);
  let fileInput: HTMLInputElement | undefined = $state();

  const hasAttachmentHandlers = $derived(store.registry.attachmentHandlers.length > 0);

  function matchesAccept(mimeType: string, patterns: string[]): boolean {
    return patterns.some((pattern) => (pattern.endsWith('/*') ? mimeType.startsWith(pattern.slice(0, -1)) : mimeType === pattern));
  }

  async function handleFileChange(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const handler = store.registry.attachmentHandlers.find((h) => matchesAccept(file.type, h.accept));
    if (!handler) return;
    if (handler.maxSizeBytes && file.size > handler.maxSizeBytes) return;
    const part = await handler.process(file, {});
    pendingAttachments = [...pendingAttachments, part];
  }

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    const value = text.trim();
    if (!value && pendingAttachments.length === 0) return;
    const attachments = pendingAttachments;
    text = '';
    pendingAttachments = [];
    await store.sendMessage({ text: value, attachments });
  }
</script>

<form class="ck-composer" onsubmit={handleSubmit}>
  {#if hasAttachmentHandlers}
    <input
      type="file"
      bind:this={fileInput}
      onchange={handleFileChange}
      class="ck-composer__file-input"
      aria-label="Attach file"
    />
    <button type="button" class="ck-composer__attach" onclick={() => fileInput?.click()} aria-label="Attach">📎</button>
  {/if}
  <input class="ck-composer__input" bind:value={text} placeholder="Type a message…" aria-label="Message" />
  <button class="ck-composer__send" type="submit">Send</button>
</form>

<style>
  .ck-composer {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: var(--ck-space-2);
    padding: var(--ck-space-3);
    border-top: 1px solid var(--ck-color-border);
  }

  .ck-composer__file-input {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
  }

  .ck-composer__attach {
    background: none;
    border: 1px solid var(--ck-color-border);
    border-radius: var(--ck-radius-sm);
    padding: var(--ck-space-2);
    cursor: pointer;
    line-height: 1;
  }

  .ck-composer__input {
    flex-grow: 1;
    border: 1px solid var(--ck-color-border);
    border-radius: var(--ck-radius-sm);
    font-size: var(--ck-font-size-base);
  }

  .ck-composer__send {
    background: var(--ck-color-accent);
    color: var(--ck-color-accent-contrast);
    border-radius: var(--ck-radius-sm);
    border: none;
    padding: var(--ck-space-2) var(--ck-space-3);
    cursor: pointer;
  }
</style>
```

The file input is visually hidden (clip-based, not `display: none`) rather than removed from the accessibility tree, and the visible 📎 button triggers it via `fileInput?.click()` — this keeps the control keyboard-and-screen-reader reachable (tabbing to the hidden input still works) while presenting a normal button as the actual click target, matching common "custom file picker" accessibility practice.

- [ ] **Step 6: Run the tests and confirm they pass**

```bash
npx pnpm@9.0.0 --filter @chatkit-svelte/ui exec vitest run src/Composer.test.ts
```
Expected: PASS — 4 tests.

- [ ] **Step 7: Re-run `ChatWindow.test.ts` to confirm the refactor didn't regress the no-attachments path**

```bash
npx pnpm@9.0.0 --filter @chatkit-svelte/ui exec vitest run src/ChatWindow.test.ts
```
Expected: PASS — still 2 tests.

---

### Task 6: Full monorepo verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite for every package**

```bash
npx pnpm@9.0.0 --filter @chatkit-svelte/plugin-tool-render exec vitest run
npx pnpm@9.0.0 --filter @chatkit-svelte/plugin-markdown exec vitest run
npx pnpm@9.0.0 --filter @chatkit-svelte/plugin-file-handling exec vitest run
npx pnpm@9.0.0 --filter @chatkit-svelte/ui exec vitest run
npx pnpm@9.0.0 --filter @chatkit-svelte/svelte exec vitest run
npx pnpm@9.0.0 --filter @chatkit-svelte/core exec vitest run
npx pnpm@9.0.0 --filter @chatkit-svelte/transport-agui exec vitest run
```
Expected: PASS — `plugin-tool-render` 4 tests, `plugin-markdown` 21 tests (16 parser — 14 original plus 2 from Task 2 Step 9a's infinite-loop fix — + 5 component), `plugin-file-handling` 5 tests, `@chatkit-svelte/ui` 11 tests (2 ChatWindow + 5 MessageList + 4 Composer), `@chatkit-svelte/svelte` 10 tests (7 chat-store — 6 from M2 plus this plan's attachment-only-send test — + 3 ChatProvider), `@chatkit-svelte/core` 33 tests, `@chatkit-svelte/transport-agui` 44 tests.

- [ ] **Step 2: Typecheck every package touched or created in this plan**

```bash
npx pnpm@9.0.0 --filter @chatkit-svelte/plugin-tool-render exec svelte-check --tsconfig ./tsconfig.json
npx pnpm@9.0.0 --filter @chatkit-svelte/plugin-markdown exec svelte-check --tsconfig ./tsconfig.json
npx pnpm@9.0.0 --filter @chatkit-svelte/plugin-file-handling exec svelte-check --tsconfig ./tsconfig.json
npx pnpm@9.0.0 --filter @chatkit-svelte/ui exec svelte-check --tsconfig ./tsconfig.json
npx pnpm@9.0.0 --filter @chatkit-svelte/svelte exec svelte-check --tsconfig ./tsconfig.json
```
Expected: `0 ERRORS 0 WARNINGS` for all five.

- [ ] **Step 3: Build every new/touched package**

```bash
npx pnpm@9.0.0 --filter @chatkit-svelte/plugin-tool-render build
npx pnpm@9.0.0 --filter @chatkit-svelte/plugin-markdown build
npx pnpm@9.0.0 --filter @chatkit-svelte/plugin-file-handling build
npx pnpm@9.0.0 --filter @chatkit-svelte/ui build
npx pnpm@9.0.0 --filter @chatkit-svelte/svelte build
```
Expected: all succeed. For `@chatkit-svelte/ui`, confirm `dist/tokens.css` and `dist/style.css` both still exist after the build (the `closeBundle` copy plugin from M2 should still be firing).

- [ ] **Step 4: Fix a critical, pre-existing packaging bug found by the final review — every package needs to externalize its `@chatkit-svelte/*` workspace dependencies, not just `svelte`**

Every package's `vite.config.ts` already externalizes `svelte`/`svelte/*` in `rollupOptions.external` (so the peer dependency isn't duplicated into every bundle) — but none of them externalized the workspace's own `@chatkit-svelte/*` packages they depend on. This has been true since `@chatkit-svelte/svelte`/`@chatkit-svelte/ui`/`@chatkit-svelte/transport-agui` first started depending on `@chatkit-svelte/core` (M1/M2), but was invisible until this milestone's final review built the first real cross-package integration check at the `dist/` level (every prior test only exercised one package's own build in isolation).

**The actual bug this caused**: building `@chatkit-svelte/ui` without externalizing `@chatkit-svelte/svelte` means Vite bundles (inlines) `@chatkit-svelte/svelte`'s full source into `packages/ui/dist/index.js` — including `context.ts`'s `const CHATKIT_CONTEXT_KEY = Symbol('chatkit');`. Since `Symbol('chatkit') !== Symbol('chatkit')` (every `Symbol(...)` call is a distinct value, string description notwithstanding), a real consumer importing `<ChatProvider>` from the actual `@chatkit-svelte/svelte` package and `<MessageList>`/`getChatContext` from `@chatkit-svelte/ui` ends up with two non-matching context-key symbols — one from `@chatkit-svelte/svelte`'s own dist, a second baked separately into `@chatkit-svelte/ui`'s dist. `getChatContext()` throws `"must be called within a <ChatProvider>"` even when the tree is correctly wrapped. This is a hard crash for every real consumer of this library, using it exactly the way it's meant to be used — confirmed and reproduced directly (reverting the fix reproduces the exact error; re-applying it resolves it) rather than assumed.

Add `@chatkit-svelte/core`/`@chatkit-svelte/svelte` (whichever a given package actually depends on — check its `package.json`'s `dependencies`, don't assume) to `rollupOptions.external` in six files, alongside the existing `svelte` entries:

- `packages/transport-agui/vite.config.ts` → `external: ['@chatkit-svelte/core']` (this package has no `svelte` external entry today since it's UI-free — add `@chatkit-svelte/core` standalone).
- `packages/svelte/vite.config.ts` → `external: ['svelte', /^svelte\//, '@chatkit-svelte/core']`.
- `packages/ui/vite.config.ts` → `external: ['svelte', /^svelte\//, '@chatkit-svelte/core', '@chatkit-svelte/svelte']` — **this is the package where the bug is user-visible today**; merge into the existing `rollupOptions` object, which also has `output: { assetFileNames: 'style.css' }` from an earlier fix — keep both.
- `packages/plugin-tool-render/vite.config.ts`, `packages/plugin-markdown/vite.config.ts`, `packages/plugin-file-handling/vite.config.ts` → each `external: ['svelte', /^svelte\//, '@chatkit-svelte/core']`. These three currently only import TYPES from `@chatkit-svelte/core` (fully erased at compile time), so they aren't runtime-broken today — fixed anyway for consistency and to prevent this exact bug class if any of them later imports a runtime value from `@chatkit-svelte/core`.

Then rebuild every package in dependency order (each depends on the previous one's `dist/` being current):
```bash
npx pnpm@9.0.0 --filter @chatkit-svelte/core build
npx pnpm@9.0.0 --filter @chatkit-svelte/transport-agui build
npx pnpm@9.0.0 --filter @chatkit-svelte/svelte build
npx pnpm@9.0.0 --filter @chatkit-svelte/ui build
npx pnpm@9.0.0 --filter @chatkit-svelte/plugin-tool-render build
npx pnpm@9.0.0 --filter @chatkit-svelte/plugin-markdown build
npx pnpm@9.0.0 --filter @chatkit-svelte/plugin-file-handling build
```

Verify the fix actually resolves the bug, not just that the config "looks right": confirm `packages/ui/dist/index.js` no longer contains an inlined `Symbol("chatkit")` — it should instead have a real `import { getChatContext } from "@chatkit-svelte/svelte"` (or equivalent) statement. Then build a real dist-level integration check: a throwaway workspace package with `@chatkit-svelte/svelte`/`@chatkit-svelte/ui` as genuine dependencies (resolved via pnpm symlinks to each package's `dist/`, not source), rendering `<ChatProvider>` (from `@chatkit-svelte/svelte`) around `<ChatWindow>` (from `@chatkit-svelte/ui`) and confirming it renders with no context error. To prove this check is meaningful and not a false positive, temporarily revert the `external` fix, rebuild, and confirm the check now fails with exactly `[chatkit] getChatContext() must be called within a <ChatProvider>` — then restore the fix, rebuild, and confirm it passes again. Delete the throwaway package completely afterward and run `npx pnpm@9.0.0 install` to restore a clean lockfile — leave no trace of it in the repo.

Finally, re-run the full regression suite for all 7 packages (same test counts as Step 1) and `svelte-check` for the 5 Svelte packages (still `0 ERRORS 0 WARNINGS`) to confirm this packaging-only fix didn't change any source-level behavior.

- [ ] **Step 5: Update the milestone checklist in the root README**

In [README.md](../../../README.md), change:
```markdown
- [ ] M3 — Plugin system + file handling
```
to:
```markdown
- [x] M3 — Plugin system + file handling
```

- [ ] **Mark the milestone complete**

No git commit — per repo owner preference, commits are handled manually. This is the natural stopping point for M3; M4 (state sync + HITL) is a separate plan.

---

## Notes for the next plan (M4)

- M4 adds `STATE_SNAPSHOT`/`STATE_DELTA` UI surfacing and the HITL approval flow (`<ApprovalBar>`, `approveToolCall`/`rejectToolCall`/`editAndRetry`) — `chat-store.svelte.ts` already exposes `runStatus` including `'awaiting_approval'` (from M0's reducer) but nothing in `@chatkit-svelte/svelte`/`@chatkit-svelte/ui` reads it yet; `createChatStore`'s M2-scoped omission of `pendingApprovals`/`approveToolCall`/etc. is exactly what M4 fills in.
- Drag-drop and paste-as-file input transforms (deferred from this plan's Task 3) plug into the same `attachmentHandlers` pipeline `<Composer>` now consults generically (Task 5) — no `<Composer>` changes should be needed, just a new `inputTransforms`-consulting entry point (or, more simply, drag/paste event listeners on the composer form that call the same `handleFileChange`-shaped logic already written).
- Syntax highlighting for `plugin-markdown`'s code blocks (deferred from Task 2) can be added without changing the plugin's registration shape — `Markdown.svelte`'s `<pre><code data-lang={block.lang}>` already carries the language, a highlighter just needs to tokenize `block.text` into more granular AST-like spans before rendering, which fits the existing "parse to AST, render via elements, no `{@html}`" architecture without restructuring it.
- **Workspace build-staleness gotcha, discovered during Task 5**: `@chatkit-svelte/ui` (and any other package) consumes `@chatkit-svelte/svelte` via its BUILT `dist/index.js` — `packages/svelte/package.json`'s `exports` map has no source/dev condition, and pnpm's workspace symlink resolves through that same map. This means a source-only edit to anything in `packages/svelte/src` is invisible to `@chatkit-svelte/ui`'s tests until `@chatkit-svelte/svelte` is rebuilt (`npx pnpm@9.0.0 --filter @chatkit-svelte/svelte build`) — with no error signal if you forget; tests just silently exercise stale compiled behavior. This bit Task 5 directly (a `chat-store.svelte.ts` fix needed a manual rebuild before `Composer.test.ts` would see it) and will bite again any time a future milestone edits `@chatkit-svelte/core`/`@chatkit-svelte/svelte` and then immediately tests a dependent package in the same task. **Any M4+ task that modifies a file in one package and tests another package that depends on it must explicitly rebuild the modified package first** (or add this as an explicit plan step, the way M0/M1's final-verification tasks already do at the END of a milestone — the gap is specifically mid-milestone, cross-task edits). Consider, as a real fix rather than a per-task reminder: a `pretest` script in `@chatkit-svelte/ui`/`@chatkit-svelte/plugin-*` packages that rebuilds their `workspace:*` dependencies first, or Vite aliases pointing `@chatkit-svelte/core`/`@chatkit-svelte/svelte` at `src/` during local dev/test.
