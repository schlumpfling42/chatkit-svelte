<script lang="ts">
  import { parseBlocks } from './markdown-parser';
  import InlineNode from './InlineNode.svelte';
  import type { ContentPart } from '@chatkit-svelte/core';

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
    {:else if block.type === 'rule'}
      <hr />
    {:else if block.type === 'quote'}
      <blockquote>{#each block.children as node}<InlineNode {node} />{/each}</blockquote>
    {:else if block.type === 'code'}
      <pre><code data-lang={block.lang}>{block.text}</code></pre>
    {:else if block.type === 'heading'}
      <svelte:element this={`h${block.level}`}>{#each block.children as node}<InlineNode {node} />{/each}</svelte:element>
    {:else if block.type === 'list'}
      <svelte:element this={block.ordered ? 'ol' : 'ul'}>
        {#each block.items as item}
          <li>{#each item as node}<InlineNode {node} />{/each}</li>
        {/each}
      </svelte:element>
    {:else if block.type === 'table'}
      <div class="ck-markdown__table-wrap">
        <table>
          <thead>
            <tr>
              {#each block.header as cell, index}
                <th style={block.align[index] ? `text-align: ${block.align[index]}` : undefined}
                  >{#each cell as node}<InlineNode {node} />{/each}</th
                >
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each block.rows as row}
              <tr>
                {#each row as cell, index}
                  <td style={block.align[index] ? `text-align: ${block.align[index]}` : undefined}
                    >{#each cell as node}<InlineNode {node} />{/each}</td
                  >
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
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

  .ck-markdown :global(h1),
  .ck-markdown :global(h2),
  .ck-markdown :global(h3),
  .ck-markdown :global(h4),
  .ck-markdown :global(h5),
  .ck-markdown :global(h6) {
    margin: var(--ck-space-3) 0 var(--ck-space-2) 0;
    line-height: 1.25;
  }

  .ck-markdown :global(h1:first-child),
  .ck-markdown :global(h2:first-child),
  .ck-markdown :global(h3:first-child),
  .ck-markdown :global(h4:first-child),
  .ck-markdown :global(h5:first-child),
  .ck-markdown :global(h6:first-child) {
    margin-top: 0;
  }

  .ck-markdown :global(ul),
  .ck-markdown :global(ol) {
    margin: 0 0 var(--ck-space-2) 0;
    padding-inline-start: var(--ck-space-4);
  }

  .ck-markdown :global(ul:last-child),
  .ck-markdown :global(ol:last-child) {
    margin-bottom: 0;
  }

  .ck-markdown :global(hr) {
    border: 0;
    border-top: 1px solid var(--ck-color-border);
    margin: var(--ck-space-3) 0;
  }

  .ck-markdown :global(blockquote) {
    margin: 0 0 var(--ck-space-2) 0;
    padding-inline-start: var(--ck-space-3);
    border-inline-start: 3px solid var(--ck-color-border);
    color: var(--ck-color-text-muted);
  }

  .ck-markdown__table-wrap {
    overflow-x: auto;
    margin: 0 0 var(--ck-space-2) 0;
  }

  .ck-markdown :global(table) {
    border-collapse: collapse;
    font-size: var(--ck-font-size-sm);
  }

  .ck-markdown :global(th),
  .ck-markdown :global(td) {
    border: 1px solid var(--ck-color-border);
    padding: var(--ck-space-1) var(--ck-space-2);
    text-align: left;
  }

  .ck-markdown :global(th) {
    background: var(--ck-color-surface);
    font-weight: 600;
  }
</style>
