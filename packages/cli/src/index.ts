#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { generateProject, type PluginChoice, type ThemeChoice, type TransportChoice } from './generate-project';
import { askChoice, askMultiChoice, askText, createPromptIO } from './prompts';

async function main() {
  const targetArg = process.argv[2];
  const io = createPromptIO();

  const appName = targetArg ?? (await askText(io, 'App name', 'my-chat-app'));
  const pluginChoices: PluginChoice[] = ['file-handling', 'markdown', 'forms', 'documents', 'devtools'];
  const defaultPlugins: PluginChoice[] = ['file-handling', 'markdown', 'forms', 'documents'];
  const plugins = await askMultiChoice(io, 'Plugins to include', pluginChoices, defaultPlugins);
  const transport = await askChoice<TransportChoice>(io, 'Transport', ['agui', 'vercel-ai'], 'agui');
  const theme = await askChoice<ThemeChoice>(io, 'Theme', ['light', 'dark', 'system'], 'system');
  io.close();

  const files = generateProject({ appName, plugins, theme, transport });
  const root = join(process.cwd(), appName);
  for (const file of files) {
    const fullPath = join(root, file.path);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, file.content, 'utf-8');
  }

  console.log(`\nCreated ${appName} — next steps:\n`);
  console.log(`  cd ${appName}`);
  console.log('  npm install');
  console.log('  npm run dev:server   # in one terminal — the local SSE echo backend');
  console.log('  npm run dev          # in another — the Vite dev server\n');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
