<script lang="ts">
  import { getChatContext } from '@chatkit-svelte/svelte';
  import RequestFileToolRenderer from '../src/RequestFileToolRenderer.svelte';

  interface Props {
    toolCallId: string;
  }

  let { toolCallId }: Props = $props();
  const store = getChatContext();
  const toolCall = $derived(
    store.messages.flatMap((m) => m.parts).find((p) => p.type === 'tool_call' && p.toolCallId === toolCallId)
  );
</script>

{#if toolCall}
  <RequestFileToolRenderer {toolCall} />
{/if}
