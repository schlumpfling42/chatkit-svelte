# Changelog

All notable changes to this project are documented here. Versions are shared
across the whole `@chatkit-svelte/*` workspace (all packages release together).

## 0.1.0 — Initial release

The first complete implementation of the spec (`docs/spec.md`), covering
milestones M0 through M7 plus a follow-on SSR-readiness pass. Full rationale
for every non-obvious design decision lives in `docs/superpowers/plans/`, one
document per milestone.

### Core framework

- **`@chatkit-svelte/core`** — framework-agnostic types, a pure `reduceEvent` reducer
  for the full AG-UI event union (text streaming, tool calls, reasoning,
  state sync, activities, artifacts), an RFC 6902 JSON Patch implementation,
  a plugin host (renderer registries, hook composition, duplicate-registration
  guards), human-in-the-loop approval detection, i18n message translation,
  and a `PersistenceAdapter` contract with an in-memory implementation.
- **`@chatkit-svelte/transport-agui`** — the default AG-UI transport: SSE and
  WebSocket modes, exponential backoff with jitter and flap protection,
  automatic `STATE_DELTA` → `STATE_SNAPSHOT` recovery on a patch conflict,
  bounded event queue with backpressure coalescing.
- **`@chatkit-svelte/transport-vercel-ai`** — a second transport adapter for the
  Vercel AI SDK's data stream protocol, proving the transport abstraction
  holds for a fundamentally different wire shape (one-fetch-per-turn vs.
  AG-UI's persistent event stream).
- **`@chatkit-svelte/svelte`** — Svelte 5 (runes) bindings: `createChatStore`,
  `<ChatProvider>`, `getChatContext()`, debounced persistence (localStorage
  and IndexedDB adapters), i18n (`store.t()`/`store.dir`).

### UI

- **`@chatkit-svelte/ui`** — themed components (`<ChatWindow>`, `<MessageList>`,
  `<Composer>`, `<ApprovalBar>`, `<ArtifactPanel>`), a CSS-custom-property
  token theme (light/dark/density variants), an optional Tailwind preset, and
  an automated WCAG AA contrast audit against the shipped token values.
  Accessible by default: live-region announcements decoupled from the
  visibly-streaming message text, focus management around approval flows,
  keyboard-navigable composer.

### Plugins

- **`plugin-file-handling`** — attachment pipeline (validate/upload) and
  file/image message renderers.
- **`plugin-markdown`** — streaming-safe markdown rendering to a restricted
  AST via real Svelte elements (no `{@html}`).
- **`plugin-tool-render`** — generic collapsible fallback for any tool call
  without a custom renderer.
- **`plugin-forms`** — JSON-Schema-driven dynamic forms as chat artifacts,
  with client-side validation and a submit round-trip.
- **`plugin-documents`** — an agent-authored document canvas (markdown mode),
  with streaming, in-place editing, and export.
- **`plugin-devtools`** — a wire-event log and live state inspector, with an
  "export fixture" button that dumps the exact JSON shape the test fixture
  transport consumes.

### Tooling

- **`create-chatkit`** — a CLI that scaffolds a working Vite + Svelte app
  wired to a chosen transport (AG-UI or Vercel AI SDK) and plugin set,
  complete with a local echo dev server matching whichever wire protocol was
  chosen.
- **`apps/playground`** — a real SvelteKit app exercising every plugin
  against fixture data, with Playwright e2e coverage (one spec per baseline
  plugin, plus a kitchen-sink spec exercising forms, documents, file upload,
  and HITL approval in one flow).

### SSR readiness

All Svelte-component packages (`svelte`, `ui`, and the six `.svelte`-shipping
plugins) were switched from a pre-compiled `vite build` bundle to
`@sveltejs/package`, which ships raw, preprocessed `.svelte` source instead —
the only way a single published package can correctly support both
client-side and server-side rendering for its consumers. Verified with a full
SvelteKit production build including static prerendering, not just a
dev-server smoke test. See `docs/superpowers/plans/2026-08-23-ssr-readiness.md`.

### Known scope boundaries (documented, not oversights)

- Richtext documents (ProseMirror mode) — markdown mode only this release.
- Form `mode: 'live'` (streaming value updates) — accepted in config, not
  wired to a transport-level primitive yet.
- SvelteKit scaffolding in `create-chatkit` — bare Vite + Svelte only.
- Per-validation-rule form message i18n — only the `required` message is
  translated; minLength/pattern/min/max stay English.

Full list of everything named as deferred, and why, is in each milestone's
plan document under `docs/superpowers/plans/`.
