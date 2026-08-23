<script lang="ts">
  import { ChatProvider } from '@chatkit/svelte';
  import ChatWindow from '../src/ChatWindow.svelte';
  import type { ChatConfig } from '@chatkit/core';

  interface Props {
    config: ChatConfig;
    class?: string;
  }

  let { config, class: className }: Props = $props();
</script>

<ChatProvider {config}>
  {#snippet children()}
    <ChatWindow class={className} />
  {/snippet}
</ChatProvider>
