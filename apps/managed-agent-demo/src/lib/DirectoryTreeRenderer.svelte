<script lang="ts">
  import type { ContentPart } from '@chatkit-svelte/core';
  import { ToolCallCard } from '@chatkit-svelte/plugin-tool-render';
  import { drawTree, parseDrawn, parseListing } from './directory-tree';

  interface Props {
    toolCall: ContentPart & { type: 'tool_call' };
  }

  let { toolCall }: Props = $props();

  const text = $derived(typeof toolCall.result === 'string' ? toolCall.result : undefined);
  const parsed = $derived(text === undefined ? null : (parseDrawn(text) ?? parseListing(text)));
  const lines = $derived(parsed ? (parsed.drawn ?? drawTree(parsed.root)) : []);
</script>

<!-- A recursive listing is drawn as a tree; anything else (an ordinary listing, an error, a later page) keeps the plain card. -->
{#if parsed}
  <details class="dir-tree" open data-testid="directory-tree">
    <summary class="dir-tree__summary">
      <span class="dir-tree__name">{toolCall.toolName}</span>
      <span class="dir-tree__header">{parsed.header}</span>
    </summary>
    <pre class="dir-tree__body">{lines.join('\n')}</pre>
    {#each parsed.notes as note}
      <p class="dir-tree__note">{note}</p>
    {/each}
  </details>
{:else}
  <ToolCallCard {toolCall} />
{/if}

<style>
  .dir-tree {
    border: 1px solid var(--ck-color-border);
    border-radius: var(--ck-radius-md);
    padding: var(--ck-space-2);
    font-size: var(--ck-font-size-sm);
  }

  .dir-tree__summary {
    display: flex;
    gap: var(--ck-space-2);
    cursor: pointer;
    font-family: var(--ck-font-mono);
  }

  .dir-tree__header {
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
