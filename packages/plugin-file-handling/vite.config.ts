/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// No `build` config here — the shipped package is built by `svelte-package`
// (see package.json's "build" script), not `vite build`. This config now
// exists purely so vitest (which is itself Vite-powered) can run tests;
// svelte-package ships raw, preprocessed .svelte source rather than a
// pre-compiled bundle, which is what makes the package safe for a
// consumer's own SSR build to compile correctly.
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
