<script lang="ts">
  import { ChatProvider } from '@chatkit-svelte/svelte';
  import { ChatWindow } from '@chatkit-svelte/ui';
  import { createAguiTransport } from '@chatkit-svelte/transport-agui';
  import { toolRenderPlugin } from '@chatkit-svelte/plugin-tool-render';
  import type { ChatConfig } from '@chatkit-svelte/core';

  const config: ChatConfig = {
    threadId: crypto.randomUUID(),
    transport: createAguiTransport({ endpoint: '/api/agent' }),
    plugins: [toolRenderPlugin()],
  };
</script>

<svelte:head>
  <title>chatkit — Claude Managed Agent demo</title>
</svelte:head>

<div class="demo" data-chatkit-theme>
  <ChatProvider {config}>
    {#snippet children()}
      <ChatWindow />
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
</style>
