<script lang="ts">
  import { parseBlocks } from './markdown-parser';
  import InlineNode from './InlineNode.svelte';
  import type { ContentPart } from '@chatkit/core';

  interface Props {
    part: ContentPart & { type: 'text' };
  }

  let { part }: Props = $props();
  let blocks = $derived(parseBlocks(part.text));
</script>

<div class="ck-markdown">
  {#each blocks as block}
    {#if block.type === 'paragraph'}
      <p>{#each block.children as node}<InlineNode {node} />{/each}</p>
    {:else if block.type === 'code'}
      <pre><code data-lang={block.lang}>{block.text}</code></pre>
    {/if}
  {/each}
</div>

<style>
  .ck-markdown :global(p) {
    margin: 0 0 var(--ck-space-2) 0;
  }

  .ck-markdown :global(p:last-child) {
    margin-bottom: 0;
  }

  .ck-markdown :global(pre) {
    background: var(--ck-color-surface);
    border-radius: var(--ck-radius-sm);
    padding: var(--ck-space-2);
    overflow-x: auto;
    font-family: var(--ck-font-mono);
    font-size: var(--ck-font-size-sm);
  }

  .ck-markdown :global(code) {
    font-family: var(--ck-font-mono);
  }
</style>
