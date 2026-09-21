<script lang="ts">
  import type { ContentPart } from '@chatkit-svelte/core';
  import { ToolCallCard } from '@chatkit-svelte/plugin-tool-render';
  import DirectoryTreeRenderer from './DirectoryTreeRenderer.svelte';
  import ToolOutputCard from './ToolOutputCard.svelte';
  import ToolProgressCard from './ToolProgressCard.svelte';
  import { OUTPUT_TOOLS, isFinished } from './tool-status';

  interface Props {
    toolCall: ContentPart & { type: 'tool_call' };
  }

  let { toolCall }: Props = $props();
</script>

<!-- A tool call is shown while it runs and removed when it is done. What stays is what the user asked to see: a
     recursive listing drawn as a tree, and the output of the tools that fetch content (a file, search results, an
     evaluate job), because the model cannot retype it in useful time and should not have to. -->
{#if !isFinished(toolCall.status) && toolCall.toolName === 'evaluate'}
  <ToolProgressCard {toolCall} />
{:else if !isFinished(toolCall.status)}
  <ToolCallCard {toolCall} />
{:else if toolCall.toolName === 'list_directory'}
  <DirectoryTreeRenderer {toolCall} />
{:else if OUTPUT_TOOLS.has(toolCall.toolName)}
  <ToolOutputCard {toolCall} />
{/if}
