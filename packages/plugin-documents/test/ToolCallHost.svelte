<script lang="ts">
  import { getChatContext } from '@chatkit-svelte/svelte';
  import CreateDocumentToolRenderer from '../src/CreateDocumentToolRenderer.svelte';

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
  <CreateDocumentToolRenderer {toolCall} />
{/if}
<!-- Test-only observability into whether anything leaked into the global
     artifact registry (see the "does not seed the global artifact registry"
     regression test) -- not something a real app would render. -->
<span data-testid="global-artifact-count">{Object.keys(store.state.artifacts).length}</span>
