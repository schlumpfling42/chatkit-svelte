<script lang="ts">
  import type { ContentPart } from '@chatkit/core';

  interface Props {
    toolCall: ContentPart & { type: 'tool_call' };
  }

  let { toolCall }: Props = $props();
</script>

<details class="ck-tool-call">
  <summary class="ck-tool-call__summary">
    <span class="ck-tool-call__name">{toolCall.toolName}</span>
    <span class="ck-tool-call__status">{toolCall.status}</span>
  </summary>
  <pre class="ck-tool-call__args">{JSON.stringify(toolCall.args, null, 2)}</pre>
  {#if toolCall.result !== undefined}
    <pre class="ck-tool-call__result" data-testid="tool-call-result">{JSON.stringify(toolCall.result, null, 2)}</pre>
  {/if}
</details>

<style>
  .ck-tool-call {
    border: 1px solid var(--ck-color-border);
    border-radius: var(--ck-radius-md);
    padding: var(--ck-space-2);
    font-size: var(--ck-font-size-sm);
  }

  .ck-tool-call__summary {
    display: flex;
    gap: var(--ck-space-2);
    cursor: pointer;
    font-family: var(--ck-font-mono);
  }

  .ck-tool-call__status {
    color: var(--ck-color-text-muted);
  }

  .ck-tool-call__args,
  .ck-tool-call__result {
    margin-top: var(--ck-space-2);
    overflow-x: auto;
    font-family: var(--ck-font-mono);
    font-size: var(--ck-font-size-sm);
  }
</style>
