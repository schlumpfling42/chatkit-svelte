<script lang="ts">
  import type { ContentPart } from '@chatkit-svelte/core';
  interface Props {
    toolCall: ContentPart & { type: 'tool_call' };
  }
  let { toolCall }: Props = $props();
</script>

<div data-testid="custom-tool">CUSTOM TOOL: {toolCall.toolName}</div>
