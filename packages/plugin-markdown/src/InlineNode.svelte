<script lang="ts">
  import { isSafeHref } from './markdown-parser';
  import type { InlineNode } from './markdown-parser';
  import Self from './InlineNode.svelte';

  interface Props {
    node: InlineNode;
  }

  let { node }: Props = $props();
</script>

{#if node.type === 'text'}
  {node.text}
{:else if node.type === 'bold'}
  <strong>{#each node.children as child}<Self node={child} />{/each}</strong>
{:else if node.type === 'italic'}
  <em>{#each node.children as child}<Self node={child} />{/each}</em>
{:else if node.type === 'strike'}
  <del>{#each node.children as child}<Self node={child} />{/each}</del>
{:else if node.type === 'break'}
  <br />
{:else if node.type === 'code'}
  <code>{node.text}</code>
{:else if node.type === 'link'}
  {#if isSafeHref(node.href)}
    <a href={node.href} rel="noopener noreferrer" target="_blank"
      >{#each node.children as child}<Self node={child} />{/each}</a
    >
  {:else}
    <!-- An unsafe scheme (javascript:, data:, ...) is never made clickable; the label still shows as plain text. -->
    {#each node.children as child}<Self node={child} />{/each}
  {/if}
{/if}
