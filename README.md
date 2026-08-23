# chatkit-svelte

Svelte 5 (runes) agentic chat framework. AG-UI-compatible by default, transport-pluggable,
plugin-driven UI (file handling, markdown, tool-call rendering, forms, documents, devtools).

Full design spec: [docs/spec.md](docs/spec.md).

## Status

Milestone tracking (see spec §22):

- [x] M0 — Core skeleton (types, reducer, plugin host, in-memory transport + fixture playback)
- [x] M1 — AG-UI transport (SSE + WebSocket, reconnect/backoff, run lifecycle)
- [x] M2 — Svelte bindings + minimal UI
- [x] M3 — Plugin system + file handling
- [x] M4 — State sync + HITL
- [x] M5 — Forms & documents
- [x] M6 — Theming polish, persistence adapters, a11y/i18n, CLI scaffold
- [x] M7 — Second transport adapter (Vercel AI SDK), devtools fixture export

Implementation plans for each milestone live in `docs/superpowers/plans/`, one plan
per milestone/subsystem (see that directory for the currently active plan).

## Package layout

```
packages/
  core/                  # framework-agnostic: transport contracts, reducer, plugin host, types, JSON Patch
  svelte/                # svelte 5 bindings: runes stores wrapping core, context provider, headless primitives
  ui/                     # themed component library (CSS-variable theme + optional Tailwind preset)
  transport-agui/        # AG-UI protocol client
  transport-vercel-ai/   # optional adapter for Vercel AI SDK data stream protocol
  plugin-file-handling/
  plugin-markdown/
  plugin-tool-render/
  plugin-forms/          # agent-driven dynamic forms
  plugin-documents/      # agent-authored documents / artifact canvas
  plugin-devtools/       # event log / inspector overlay
  cli/                   # `create-chatkit` scaffolding tool
apps/
  playground/            # SvelteKit demo app used for e2e + visual testing, exercises every plugin
docs/
  spec.md                # full design spec
  fixtures/              # recorded AG-UI event-stream JSON fixtures used by unit + conformance tests
  superpowers/plans/     # per-milestone implementation plans
```

`core` has no Svelte dependency, no DOM dependency — pure functions run in Node
under Vitest with no jsdom.

## Getting started (once M0 lands)

```bash
pnpm install
pnpm build
pnpm test
```
