<script lang="ts">
  import { ChatProvider } from '@chatkit-svelte/svelte';
  import { ChatWindow } from '@chatkit-svelte/ui';
  import { createAguiTransport } from '@chatkit-svelte/transport-agui';
  import { toolRenderPlugin } from '@chatkit-svelte/plugin-tool-render';
  import { markdownPlugin } from '@chatkit-svelte/plugin-markdown';
  import { fileHandlingPlugin } from '@chatkit-svelte/plugin-file-handling';
  import { formsPlugin } from '@chatkit-svelte/plugin-forms';
  import { documentsPlugin } from '@chatkit-svelte/plugin-documents';
  import { devtoolsPlugin, DevtoolsOverlay } from '@chatkit-svelte/plugin-devtools';
  import type { ChatConfig } from '@chatkit-svelte/core';

  const devtools = devtoolsPlugin();

  const config: ChatConfig = {
    threadId: crypto.randomUUID(),
    transport: createAguiTransport({ endpoint: '/api/agent' }),
    plugins: [
      toolRenderPlugin(),
      markdownPlugin(),
      fileHandlingPlugin({ upload: async (file) => ({ url: URL.createObjectURL(file) }) }),
      formsPlugin(),
      documentsPlugin(),
      devtools,
    ],
  };
</script>

<svelte:head>
  <title>chatkit — Claude Managed Agent demo</title>
</svelte:head>

<div class="demo" data-chatkit-theme>
  <ChatProvider {config}>
    {#snippet children()}
      <div class="demo__window">
        <ChatWindow />
      </div>
      <div class="demo__devtools">
        <DevtoolsOverlay log={devtools.log} />
      </div>
    {/snippet}
  </ChatProvider>
</div>

<style>
  .demo {
    display: flex;
    flex-direction: column;
    height: 100vh;
    font-family: system-ui, sans-serif;
  }

  .demo__window {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .demo__devtools {
    max-height: 16rem;
    overflow: auto;
    border-top: 1px solid #e5e5e7;
  }
</style>
