import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { sseEchoServerSource } from './sse-echo-server-template';
import { vercelEchoServerSource } from './vercel-echo-server-template';

const __dirname = dirname(fileURLToPath(import.meta.url));

export type PluginChoice = 'file-handling' | 'markdown' | 'forms' | 'documents' | 'devtools';
export type ThemeChoice = 'light' | 'dark' | 'system';
export type TransportChoice = 'agui' | 'vercel-ai';

export interface GenerateProjectOptions {
  appName: string;
  plugins: PluginChoice[];
  theme: ThemeChoice;
  transport?: TransportChoice;
}

export interface GeneratedFile {
  path: string;
  content: string;
}

const PLUGIN_PACKAGES: Record<PluginChoice, { pkg: string; importName: string; factory: string }> = {
  'file-handling': {
    pkg: '@chatkit-svelte/plugin-file-handling',
    importName: 'fileHandlingPlugin',
    factory: 'fileHandlingPlugin({ upload: async (file) => ({ url: URL.createObjectURL(file) }) })',
  },
  markdown: { pkg: '@chatkit-svelte/plugin-markdown', importName: 'markdownPlugin', factory: 'markdownPlugin()' },
  forms: { pkg: '@chatkit-svelte/plugin-forms', importName: 'formsPlugin', factory: 'formsPlugin()' },
  documents: { pkg: '@chatkit-svelte/plugin-documents', importName: 'documentsPlugin', factory: 'documentsPlugin()' },
  devtools: { pkg: '@chatkit-svelte/plugin-devtools', importName: 'devtoolsPlugin', factory: 'devtoolsPlugin()' },
};

const TRANSPORT_PACKAGES: Record<TransportChoice, { pkg: string; importName: string; factory: string }> = {
  agui: {
    pkg: '@chatkit-svelte/transport-agui',
    importName: 'createAguiTransport',
    factory: "createAguiTransport({ endpoint: '/api/agent' })",
  },
  'vercel-ai': {
    pkg: '@chatkit-svelte/transport-vercel-ai',
    importName: 'createVercelAiTransport',
    factory: "createVercelAiTransport({ endpoint: '/api/agent' })",
  },
};

function tokensCss(): string {
  return readFileSync(join(__dirname, '..', 'templates', 'tokens.css'), 'utf-8');
}

export function generateProject(options: GenerateProjectOptions): GeneratedFile[] {
  const { appName, plugins, theme } = options;
  const pluginEntries = plugins.map((p) => PLUGIN_PACKAGES[p]);
  const transportChoice = TRANSPORT_PACKAGES[options.transport ?? 'agui'];

  const packageJson = {
    name: appName,
    version: '0.0.1',
    private: true,
    type: 'module',
    scripts: {
      dev: 'vite',
      build: 'vite build',
      'dev:server': 'node server/sse-echo-server.mjs',
    },
    dependencies: {
      svelte: '^5.0.0',
      '@chatkit-svelte/core': '^0.0.0',
      '@chatkit-svelte/svelte': '^0.0.0',
      '@chatkit-svelte/ui': '^0.0.0',
      [transportChoice.pkg]: '^0.0.0',
      ...Object.fromEntries(pluginEntries.map((e) => [e.pkg, '^0.0.0'])),
    },
    devDependencies: {
      '@sveltejs/vite-plugin-svelte': '^4.0.0',
      vite: '^5.4.0',
      typescript: '^5.5.0',
    },
  };

  const viteConfig = `import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  server: {
    proxy: { '/api': 'http://localhost:8787' },
  },
});
`;

  const indexHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>${appName}</title>
    <link rel="stylesheet" href="/src/tokens.css" />
  </head>
  <body>
    <div id="app" style="height: 100vh;"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
`;

  const mainTs = `import { mount } from 'svelte';
import App from './App.svelte';

mount(App, { target: document.getElementById('app')! });
`;

  const appSvelte =
    theme === 'system'
      ? `<script lang="ts">
  import { ChatProvider } from '@chatkit-svelte/svelte';
  import { ChatWindow } from '@chatkit-svelte/ui';
  import { ${transportChoice.importName} } from '${transportChoice.pkg}';
  import { plugins } from './chatkit.config';

  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

  const config = {
    threadId: 'default',
    transport: ${transportChoice.factory},
    plugins,
  };
</script>

<div style="height: 100%;" data-chatkit-theme={prefersDark ? 'dark' : 'light'}>
  <ChatProvider {config}>
    {#snippet children()}
      <ChatWindow />
    {/snippet}
  </ChatProvider>
</div>
`
      : `<script lang="ts">
  import { ChatProvider } from '@chatkit-svelte/svelte';
  import { ChatWindow } from '@chatkit-svelte/ui';
  import { ${transportChoice.importName} } from '${transportChoice.pkg}';
  import { plugins } from './chatkit.config';

  const config = {
    threadId: 'default',
    transport: ${transportChoice.factory},
    plugins,
  };
</script>

<div style="height: 100%;" data-chatkit-theme="${theme}">
  <ChatProvider {config}>
    {#snippet children()}
      <ChatWindow />
    {/snippet}
  </ChatProvider>
</div>
`;

  const chatkitConfig = `${pluginEntries.map((e) => `import { ${e.importName} } from '${e.pkg}';`).join('\n')}

export const plugins = [${pluginEntries.map((e) => e.factory).join(', ')}];
`;

  return [
    { path: 'package.json', content: JSON.stringify(packageJson, null, 2) },
    { path: 'vite.config.ts', content: viteConfig },
    { path: 'index.html', content: indexHtml },
    { path: 'src/main.ts', content: mainTs },
    { path: 'src/App.svelte', content: appSvelte },
    { path: 'src/chatkit.config.ts', content: chatkitConfig },
    { path: 'src/tokens.css', content: tokensCss() },
    {
      path: 'server/sse-echo-server.mjs',
      content: (options.transport ?? 'agui') === 'vercel-ai' ? vercelEchoServerSource : sseEchoServerSource,
    },
  ];
}
