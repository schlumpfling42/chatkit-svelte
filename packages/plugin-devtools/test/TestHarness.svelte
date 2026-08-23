<script lang="ts">
  import { ChatProvider } from '@chatkit-svelte/svelte';
  import DevtoolsOverlay from '../src/DevtoolsOverlay.svelte';
  import type { ChatConfig } from '@chatkit-svelte/core';
  import type { DevtoolsLog } from '../src/log.svelte';

  interface Props {
    config: ChatConfig;
    log: DevtoolsLog;
  }

  let { config, log }: Props = $props();
</script>

<ChatProvider {config}>
  {#snippet children()}
    <DevtoolsOverlay {log} />
  {/snippet}
</ChatProvider>
