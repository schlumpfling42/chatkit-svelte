<script lang="ts">
  import { ChatProvider } from '@chatkit-svelte/svelte';
  import DocumentCanvas from '../src/DocumentCanvas.svelte';
  import type { ChatConfig, ArtifactRecord } from '@chatkit-svelte/core';
  import type { ExportHandlers } from '../src/types';

  interface Props {
    config: ChatConfig;
    artifact: ArtifactRecord;
    exportHandlers?: ExportHandlers;
  }

  let { config, artifact, exportHandlers }: Props = $props();
</script>

<ChatProvider {config}>
  {#snippet children()}
    <DocumentCanvas {artifact} {exportHandlers} />
  {/snippet}
</ChatProvider>
