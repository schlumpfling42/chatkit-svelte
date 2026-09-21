<script lang="ts">
  import type { ContentPart } from '@chatkit-svelte/core';
  import { drawTree, parseDrawn, parseListing } from './directory-tree';

  interface Props {
    toolCall: ContentPart & { type: 'tool_call' };
  }

  let { toolCall }: Props = $props();

  const text = $derived(typeof toolCall.result === 'string' ? toolCall.result : undefined);
  const parsed = $derived(text === undefined ? null : (parseDrawn(text) ?? parseListing(text)));
  const lines = $derived(parsed ? (parsed.drawn ?? drawTree(parsed.root)) : []);
</script>

<!-- A recursive listing, drawn as a tree. It is the content of the answer, so it carries no tool name or status;
     anything that is not a recursive listing draws nothing. -->
{#if parsed}
  <details class="dir-tree" open data-testid="directory-tree">
    <summary class="dir-tree__header">{parsed.header}</summary>
    <pre class="dir-tree__body">{lines.join('\n')}</pre>
    {#each parsed.notes as note}
      <p class="dir-tree__note">{note}</p>
    {/each}
  </details>
{/if}

<style>
  .dir-tree {
    border: 1px solid var(--ck-color-border);
    border-radius: var(--ck-radius-md);
    padding: var(--ck-space-2);
    font-size: var(--ck-font-size-sm);
  }

  .dir-tree__header {
    cursor: pointer;
    font-family: var(--ck-font-mono);
    color: var(--ck-color-text-muted);
  }

  .dir-tree__body {
    margin: var(--ck-space-2) 0 0;
    overflow-x: auto;
    max-height: 28rem;
    overflow-y: auto;
    font-family: var(--ck-font-mono);
    font-size: var(--ck-font-size-sm);
    line-height: 1.35;
  }

  .dir-tree__note {
    margin: var(--ck-space-2) 0 0;
    color: var(--ck-color-text-muted);
    font-size: var(--ck-font-size-sm);
  }
</style>
