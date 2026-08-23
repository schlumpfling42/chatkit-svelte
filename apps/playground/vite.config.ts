import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// Workspace @chatkit-svelte/* packages are pnpm symlinks. Left to Vite's default
// esbuild dep pre-bundling, a package imported both directly (e.g.
// @chatkit-svelte/svelte from +page.svelte) and transitively (via @chatkit-svelte/ui's
// own import of it) can end up pre-bundled as two separate module
// instances — reproducing the exact `Symbol('chatkit') !== Symbol('chatkit')`
// context-duplication bug the M3 plan fixed at build time, this time in
// the dev server instead. Excluding them from optimizeDeps makes every
// import resolve to the same real (symlinked) module every time.
const CHATKIT_PACKAGES = [
  '@chatkit-svelte/core',
  '@chatkit-svelte/svelte',
  '@chatkit-svelte/ui',
  '@chatkit-svelte/plugin-file-handling',
  '@chatkit-svelte/plugin-markdown',
  '@chatkit-svelte/plugin-tool-render',
  '@chatkit-svelte/plugin-forms',
  '@chatkit-svelte/plugin-documents',
  '@chatkit-svelte/plugin-devtools',
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
