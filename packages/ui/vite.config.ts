/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// No `build`/CSS-extraction config here anymore — the shipped package is
// built by `svelte-package` (see package.json's "build" script), which
// ships raw, preprocessed .svelte source (component <style> blocks travel
// with their component, compiled by the consumer) plus a verbatim copy of
// non-.svelte/.ts files like tokens.css. There's no longer a separate
// bundled style.css chunk to produce — see the SSR-readiness plan.
export default defineConfig({
  plugins: [svelte()],
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.ts'],
    setupFiles: ['./vitest-setup.ts'],
  },
  resolve: {
    conditions: ['browser'],
  },
});
