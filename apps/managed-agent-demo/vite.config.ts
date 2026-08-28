/// <reference types="vitest/config" />
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';

// Same pnpm-symlink dep-duplication issue documented in apps/playground's
// vite.config.ts — excluded here for the same reason.
const CHATKIT_PACKAGES = [
  '@chatkit-svelte/core',
  '@chatkit-svelte/svelte',
  '@chatkit-svelte/ui',
  '@chatkit-svelte/transport-agui',
  '@chatkit-svelte/plugin-tool-render',
  '@chatkit-svelte/plugin-markdown',
  '@chatkit-svelte/plugin-file-handling',
  '@chatkit-svelte/plugin-forms',
  '@chatkit-svelte/plugin-documents',
  '@chatkit-svelte/plugin-devtools',
];

export default defineConfig(({ mode }) => {
  // Vite's own .env loading only populates import.meta.env / $env/dynamic/private,
  // not raw process.env — but src/lib/env.ts (and the ManagedAgentsAgent SDK it
  // feeds) reads process.env directly, so .env's ANTHROPIC_* values would
  // otherwise be silently ignored by both `vite dev` and `vite build`/`node build`.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''));

  return {
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
  };
});
