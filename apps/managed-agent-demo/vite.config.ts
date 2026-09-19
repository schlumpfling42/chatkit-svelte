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
  // not raw process.env — but src/lib/env.ts reads process.env directly, so
  // .env's OPENAI_* values would otherwise be silently ignored by both
  // `vite dev` and `vite build`/`node build`.
  //
  // Vite re-runs this config inside the same Node process when a .env file changes, and loadEnv() lets values
  // already in process.env win over the files. So remember which keys we injected ourselves and clear them
  // first; otherwise an edited .env.local would be ignored until the whole dev server is restarted.
  const injectedKeys = Symbol.for('chatkit.managed-agent-demo.injectedEnv');
  const globals = globalThis as unknown as Record<symbol, Set<string> | undefined>;
  for (const key of globals[injectedKeys] ?? []) delete process.env[key];
  const injected = new Set<string>();
  for (const [key, value] of Object.entries(loadEnv(mode, process.cwd(), ''))) {
    if (!(key in process.env)) {
      process.env[key] = value;
      injected.add(key);
    }
  }
  globals[injectedKeys] = injected;

  // When GATEWAY_URL is set, `vite dev` forwards /api/agent/* to the chatkit gateway (the Java server layer)
  // instead of answering from this app's own SvelteKit routes. The browser still talks to one origin, so there
  // is no CORS to configure and the gateway itself can stay on loopback (reach it through an SSH tunnel).
  const gatewayUrl = process.env.GATEWAY_URL?.trim();

  return {
    plugins: [sveltekit()],
    server: {
      port: 5181,
      proxy: gatewayUrl ? { '/api/agent': { target: gatewayUrl, changeOrigin: true } } : undefined,
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
