import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// Workspace @chatkit/* packages are pnpm symlinks. Left to Vite's default
// esbuild dep pre-bundling, a package imported both directly (e.g.
// @chatkit/svelte from +page.svelte) and transitively (via @chatkit/ui's
// own import of it) can end up pre-bundled as two separate module
// instances — reproducing the exact `Symbol('chatkit') !== Symbol('chatkit')`
// context-duplication bug the M3 plan fixed at build time, this time in
// the dev server instead. Excluding them from optimizeDeps makes every
// import resolve to the same real (symlinked) module every time.
const CHATKIT_PACKAGES = [
  '@chatkit/core',
  '@chatkit/svelte',
  '@chatkit/ui',
  '@chatkit/plugin-file-handling',
  '@chatkit/plugin-markdown',
  '@chatkit/plugin-tool-render',
  '@chatkit/plugin-forms',
  '@chatkit/plugin-documents',
  '@chatkit/plugin-devtools',
];

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    port: 5180,
  },
  optimizeDeps: {
    exclude: CHATKIT_PACKAGES,
  },
});
