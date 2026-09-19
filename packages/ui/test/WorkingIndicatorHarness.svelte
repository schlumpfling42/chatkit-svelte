<script lang="ts">
  import { createChatStore, setChatContext } from '@chatkit-svelte/svelte';
  import WorkingIndicator from '../src/WorkingIndicator.svelte';
  import type { ChatConfig } from '@chatkit-svelte/core';
  import { untrack } from 'svelte';

  interface Props {
    config: ChatConfig;
    words?: string[];
    intervalMs?: number;
    showElapsedAfterSeconds?: number;
  }

  let { config, words, intervalMs, showElapsedAfterSeconds }: Props = $props();
  const store = untrack(() => createChatStore(config));
  setChatContext(store);
</script>

<WorkingIndicator {words} {intervalMs} {showElapsedAfterSeconds} />
