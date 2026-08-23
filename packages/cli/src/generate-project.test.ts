import { describe, expect, it } from 'vitest';
import { generateProject } from './generate-project';

describe('generateProject', () => {
  it('always includes package.json, vite config, index.html, main.ts, App.svelte, chatkit.config.ts, tokens.css, and the SSE echo server', () => {
    const files = generateProject({ appName: 'my-chat-app', plugins: [], theme: 'light' });
    const paths = files.map((f) => f.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        'package.json',
        'vite.config.ts',
        'index.html',
        'src/main.ts',
        'src/App.svelte',
        'src/chatkit.config.ts',
        'src/tokens.css',
        'server/sse-echo-server.mjs',
      ])
    );
  });

  it('names the generated package after appName', () => {
    const files = generateProject({ appName: 'trip-planner', plugins: [], theme: 'light' });
    const pkg = JSON.parse(files.find((f) => f.path === 'package.json')!.content);
    expect(pkg.name).toBe('trip-planner');
  });

  it('adds a dependency and an import for each selected plugin', () => {
    const files = generateProject({ appName: 'app', plugins: ['markdown', 'forms'], theme: 'light' });
    const pkg = JSON.parse(files.find((f) => f.path === 'package.json')!.content);
    expect(pkg.dependencies['@chatkit-svelte/plugin-markdown']).toBeDefined();
    expect(pkg.dependencies['@chatkit-svelte/plugin-forms']).toBeDefined();
    expect(pkg.dependencies['@chatkit-svelte/plugin-documents']).toBeUndefined();

    const configFile = files.find((f) => f.path === 'src/chatkit.config.ts')!.content;
    expect(configFile).toContain("import { markdownPlugin } from '@chatkit-svelte/plugin-markdown'");
    expect(configFile).toContain("import { formsPlugin } from '@chatkit-svelte/plugin-forms'");
    expect(configFile).not.toContain('plugin-documents');
  });

  it('sets data-chatkit-theme according to the chosen theme, including "system"', () => {
    const dark = generateProject({ appName: 'app', plugins: [], theme: 'dark' });
    expect(dark.find((f) => f.path === 'src/App.svelte')!.content).toContain('data-chatkit-theme="dark"');

    const system = generateProject({ appName: 'app', plugins: [], theme: 'system' });
    expect(system.find((f) => f.path === 'src/App.svelte')!.content).toContain('prefers-color-scheme');
  });

  it('points the generated transport at /api/agent by default', () => {
    const files = generateProject({ appName: 'app', plugins: [], theme: 'light' });
    const app = files.find((f) => f.path === 'src/App.svelte')!.content;
    expect(app).toContain("endpoint: '/api/agent'");
  });

  it('defaults to the AG-UI transport when no transport option is given', () => {
    const files = generateProject({ appName: 'app', plugins: [], theme: 'light' });
    const app = files.find((f) => f.path === 'src/App.svelte')!.content;
    expect(app).toContain('@chatkit-svelte/transport-agui');
  });

  it('generates a Vercel AI SDK transport wiring when transport: "vercel-ai" is chosen', () => {
    const files = generateProject({ appName: 'app', plugins: [], theme: 'light', transport: 'vercel-ai' });
    const pkg = JSON.parse(files.find((f) => f.path === 'package.json')!.content);
    expect(pkg.dependencies['@chatkit-svelte/transport-vercel-ai']).toBeDefined();
    expect(pkg.dependencies['@chatkit-svelte/transport-agui']).toBeUndefined();

    const app = files.find((f) => f.path === 'src/App.svelte')!.content;
    expect(app).toContain("import { createVercelAiTransport } from '@chatkit-svelte/transport-vercel-ai'");
    expect(app).toContain('createVercelAiTransport(');
  });

  it('offers devtools as a selectable plugin again', () => {
    const files = generateProject({ appName: 'app', plugins: ['devtools'], theme: 'light' });
    const pkg = JSON.parse(files.find((f) => f.path === 'package.json')!.content);
    expect(pkg.dependencies['@chatkit-svelte/plugin-devtools']).toBeDefined();
  });

  it('generates a dev server matching the chosen transport\'s wire format', () => {
    const agui = generateProject({ appName: 'app', plugins: [], theme: 'light', transport: 'agui' });
    expect(agui.find((f) => f.path === 'server/sse-echo-server.mjs')!.content).toContain('text/event-stream');

    const vercel = generateProject({ appName: 'app', plugins: [], theme: 'light', transport: 'vercel-ai' });
    const vercelServer = vercel.find((f) => f.path === 'server/sse-echo-server.mjs')!.content;
    expect(vercelServer).not.toContain('text/event-stream');
    expect(vercelServer).toContain('data stream protocol');
  });
});
