<script lang="ts">
  import type { ContentPart } from '@chatkit-svelte/core';

  interface Props {
    part: ContentPart & { type: 'image' };
  }

  let { part }: Props = $props();
</script>

<img class="ck-attachment-image" src={part.url} alt={part.alt ?? ''} />

<style>
  .ck-attachment-image {
    max-width: 100%;
    border-radius: var(--ck-radius-sm);
    display: block;
  }
</style>
