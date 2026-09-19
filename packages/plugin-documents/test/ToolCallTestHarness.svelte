<script lang="ts">
  import { ChatProvider } from '@chatkit-svelte/svelte';
  import ToolCallHost from './ToolCallHost.svelte';
  import type { ChatConfig } from '@chatkit-svelte/core';

  interface Props {
    config: ChatConfig;
    toolCallId: string;
  }

  let { config, toolCallId }: Props = $props();
</script>

<ChatProvider {config}>
  {#snippet children()}
    <ToolCallHost {toolCallId} />
  {/snippet}
</ChatProvider>
