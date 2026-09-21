<script lang="ts">
  import type { ContentPart } from '@chatkit-svelte/core';
  import { callLabel } from './tool-status';

  interface Props {
    toolCall: ContentPart & { type: 'tool_call' };
  }

  let { toolCall }: Props = $props();

  const text = $derived(typeof toolCall.result === 'string' ? toolCall.result : '');
  const label = $derived(callLabel(toolCall.toolName, toolCall.args));
</script>

<!-- What a tool returned, shown as it is: the content the user asked for, not a tool-call chip. -->
{#if text}
  <details class="tool-output" open data-testid="tool-output">
    <summary class="tool-output__label">{label}</summary>
    <pre class="tool-output__body">{text}</pre>
  </details>
{/if}

<style>
  .tool-output {
    border: 1px solid var(--ck-color-border);
    border-radius: var(--ck-radius-md);
    padding: var(--ck-space-2);
    font-size: var(--ck-font-size-sm);
  }

  .tool-output__label {
    cursor: pointer;
    font-family: var(--ck-font-mono);
    color: var(--ck-color-text-muted);
  }

  .tool-output__body {
    margin: var(--ck-space-2) 0 0;
    overflow: auto;
    max-height: 28rem;
    font-family: var(--ck-font-mono);
    font-size: var(--ck-font-size-sm);
    line-height: 1.35;
    white-space: pre-wrap;
    word-break: break-word;
  }
</style>
