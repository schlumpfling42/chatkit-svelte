<script lang="ts">
  import type { ArtifactRecord } from '@chatkit/core';

  interface Props {
    artifact: ArtifactRecord;
    label?: string;
  }

  let { artifact, label }: Props = $props();
  const value = $derived((artifact.data as { value: string }).value);
</script>

<div data-testid="custom-artifact">{label ? `${label}: ${value}` : value}</div>
