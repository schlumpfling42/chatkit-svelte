/// <reference types="vitest/config" />
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// Same pnpm-symlink dep-duplication issue documented in apps/playground's
// vite.config.ts — excluded here for the same reason.
const CHATKIT_PACKAGES = [
  '@chatkit-svelte/core',
  '@chatkit-svelte/svelte',
  '@chatkit-svelte/ui',
  '@chatkit-svelte/transport-agui',
  '@chatkit-svelte/plugin-tool-render',
];

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    port: 5181,
  },
  optimizeDeps: {
    exclude: CHATKIT_PACKAGES,
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
