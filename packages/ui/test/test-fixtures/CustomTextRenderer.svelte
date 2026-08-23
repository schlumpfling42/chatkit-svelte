<script lang="ts">
  import type { ContentPart } from '@chatkit/core';
  interface Props {
    part: ContentPart & { type: 'text' };
  }
  let { part }: Props = $props();
</script>

<p data-testid="custom-text">CUSTOM: {part.text}</p>
