# SSR Readiness — Switching 8 Packages to `@sveltejs/package`

> Not part of the M0–M7 milestone sequence (spec §22 never mentions SSR) — this is follow-on work triggered by building `apps/playground` as a real SvelteKit app and discovering it couldn't SSR at all.

## The problem

`@chatkit-svelte/svelte`, `@chatkit-svelte/ui`, and six plugin packages (`plugin-file-handling`, `plugin-markdown`, `plugin-tool-render`, `plugin-forms`, `plugin-documents`, `plugin-devtools`) were built with `vite build --mode lib` + `@sveltejs/vite-plugin-svelte`, compiling every `.svelte` file **once**, targeting the client-only Svelte runtime. That compiled output calls browser DOM APIs (`document.createComment`, etc.) at module-evaluation time. The first time a real SvelteKit consumer (`apps/playground`) tried to SSR a page using these components, it crashed immediately: `ReferenceError: document is not defined`.

This is structural, not a config oversight: a single compiled Svelte output cannot be simultaneously valid for client hydration (real DOM mutation) and SSR (string-concatenation render functions) — the compiler produces fundamentally different code for each target. Pre-compiling in the library fixes the target at library-build-time, which cannot serve both consumption contexts from one build artifact.

**Original decision (M2 plan, revisited):** M2's build-tooling note explicitly considered `@sveltejs/package` — the ecosystem-standard tool for exactly this — and rejected it: *"Since chatkit-svelte is an internal monorepo... the consumer-optimizes-against-raw-source benefit doesn't apply here."* That reasoning held until a real SSR consumer existed. It no longer does.

## The fix

Switched all 8 Svelte-component packages to `@sveltejs/package` (`svelte-package`), which ships **raw, preprocessed `.svelte` source** instead of a pre-compiled bundle — the consumer's own Vite/SvelteKit `svelte()` plugin compiles it, correctly targeting client or server as appropriate for whatever it's building. This is the same mechanism that makes any npm-distributed Svelte component library (that isn't pre-compiled) work at all.

### Per-package changes (all 8: `svelte`, `ui`, `plugin-file-handling`, `plugin-markdown`, `plugin-tool-render`, `plugin-forms`, `plugin-documents`, `plugin-devtools`)

1. **Test files and test-only helper `.svelte` components moved out of `src/` into a sibling `test/` directory**, with relative imports adjusted (`./X.svelte` → `../src/X.svelte` for anything referencing real source; imports between two files that stayed siblings in `test/` needed no change). `svelte-package` copies its entire input directory verbatim — anything left in `src/` ships in the published package, so co-located `*.test.ts`/`TestHarness.svelte`/etc. files had to move. Confirmed empirically: built `dist/` output contains zero test artifacts across all 8 packages.
2. **`vite.config.ts`** stripped down to just `plugins: [svelte()]` + `test: {...}` (pointing at `test/**/*.test.ts`) — it now exists purely so Vitest (itself Vite-powered) can run tests. No `build`/`rollupOptions` section; `svelte-package` does the actual package build, invoked directly, not through `vite build`.
3. **`package.json`**: `"build"` script changed from `"vite build --mode lib"` to `"svelte-package -i src -o dist"`; `vite-plugin-dts` dropped (svelte-package emits its own `.d.ts`/`.svelte.d.ts` declarations); `@sveltejs/package` added as a devDependency. `exports` map shape is unchanged (`dist/index.js` still exists — svelte-package compiles `index.ts` too, type-stripped, re-exporting the now-raw `.svelte` files). Added the legacy top-level `"svelte"` field some tooling still checks as a resolution fallback.
4. **`@chatkit-svelte/ui` specifically**: dropped the `closeBundle` tokens.css-copy plugin and the `assetFileNames: 'style.css'` bundled-CSS-chunk trick — both were `vite build`-era necessities. `svelte-package` copies `tokens.css` through verbatim automatically, and component `<style>` blocks now travel embedded in their own raw `.svelte` files (compiled by the consumer), so there's no separate bundled `style.css` chunk to produce anymore. The `"./style.css"` export was removed from `package.json` (nothing shipped at that path now); `apps/playground/src/routes/+layout.svelte`'s `import '@chatkit-svelte/ui/style.css'` was removed accordingly. `"./tailwind-preset"` and `"./tokens.css"` export paths are unchanged and still work — `tailwind-preset.ts` is a plain TS module, compiled the same way `index.ts` is.

### `apps/playground` changes

- Removed `src/routes/+layout.ts` entirely (was `export const ssr = false; export const prerender = false;` — the SPA-mode workaround). Pages now SSR normally.
- Removed the `@chatkit-svelte/ui/style.css` import from `+layout.svelte` (decision 4 above).
- `svelte.config.js` keeps `adapter-static` with `fallback: 'index.html'` — harmless now that SSR works; not required for local dev, kept since it was already there and a static/prerendered demo app is a reasonable default with no other deployment target specified.

## Verification

- **Every package's own test suite** re-run after the file moves, at identical counts to before the switch — zero behavior change from the consumer's perspective: `svelte` 37, `ui` 40, `plugin-file-handling` 5, `plugin-markdown` 21, `plugin-tool-render` 4, `plugin-forms` 16, `plugin-documents` 13, `plugin-devtools` 9.
- **`svelte-check`** clean (0 errors/warnings) on all 8 after the switch.
- **`dist/` output inspected directly** for all 8 — confirmed raw `.svelte` files present (not compiled JS), zero test files leaked, `tokens.css` copied through for `ui`.
- **Full 12-package regression suite**: 264 tests, all passing, after a full rebuild in dependency order.
- **Real SSR proof, not just "no crash in dev mode"**: `curl`'d the raw SSR HTML response (no client JS executed) and confirmed a fully server-rendered page — nav, `<ChatWindow>`'s scoped styles (with a *freshly-generated* scope hash, proving the playground's own Vite pipeline recompiled the raw `.svelte` source rather than reusing any pre-built asset), composer, devtools panel, `tokens.css` inlined. Zero `document is not defined`.
- **Client-side hydration still correct**: loaded the page in a real browser (fresh tab, clean console — zero errors), confirmed fixture events stream in post-hydration exactly as before (`text-streaming` fixture: message renders, devtools logs all 7 events; `kitchen-sink` fixture: form + document artifact + HITL approval bar all render).
- **Full production build + static prerender** (`vite build`, `@sveltejs/adapter-static`): succeeded end-to-end — `"Wrote site to build"` — which specifically requires the SSR pass to complete cleanly, since prerendering literally is server-rendering the page to produce static HTML. This is the strongest verification available short of a real production deployment.
- **Full Playwright e2e suite** (all 5 specs, including the kitchen-sink flow) re-run against the dev server with real SSR enabled (no `ssr=false`) — all passing.

## Known follow-on, not done here

- `apps/playground`'s `vite.config.ts` still has the `optimizeDeps.exclude` list for `@chatkit-svelte/*` packages, added earlier to work around a *different* dev-server duplicate-module-instance issue. Left in place — still correct and still relevant under the new build model (workspace packages are still pnpm symlinks either way).
- No changes were needed to `@chatkit-svelte/core`, `@chatkit-svelte/transport-agui`, `@chatkit-svelte/transport-vercel-ai`, or `create-chatkit` (the CLI) — none of them contain `.svelte` files, so none of them were ever subject to this problem.
