<script lang="ts">
  import { ChatProvider } from '@chatkit-svelte/svelte';
  import FormRenderer from '../src/FormRenderer.svelte';
  import type { ChatConfig, ArtifactRecord } from '@chatkit-svelte/core';

  interface Props {
    config: ChatConfig;
    artifact: ArtifactRecord;
    onBeforeSubmit?: (values: Record<string, unknown>) => Record<string, unknown> | Promise<Record<string, unknown>>;
  }

  let { config, artifact, onBeforeSubmit }: Props = $props();
</script>

<ChatProvider {config}>
  {#snippet children()}
    <FormRenderer {artifact} {onBeforeSubmit} />
  {/snippet}
</ChatProvider>
