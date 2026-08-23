<script lang="ts">
  import type { ContentPart } from '@chatkit-svelte/core';

  interface Props {
    part: ContentPart & { type: 'file' };
  }

  let { part }: Props = $props();
</script>

<a class="ck-attachment-file" href={part.url} download={part.name} target="_blank" rel="noopener noreferrer">
  📎 {part.name}
</a>

<style>
  .ck-attachment-file {
    display: inline-block;
    color: inherit;
    text-decoration: none;
    border: 1px solid var(--ck-color-border);
    border-radius: var(--ck-radius-sm);
    padding: var(--ck-space-2) var(--ck-space-3);
  }
</style>
