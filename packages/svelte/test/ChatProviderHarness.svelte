<script lang="ts">
  import ChatProvider from '../src/ChatProvider.svelte';
  import ProbeChild from './ProbeChild.svelte';
  import type { ChatConfig } from '@chatkit/core';

  interface Props {
    config: ChatConfig;
  }

  let { config }: Props = $props();
</script>

<ChatProvider {config}>
  {#snippet children()}
    <ProbeChild />
  {/snippet}
</ChatProvider>
