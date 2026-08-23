<script lang="ts">
  import { createChatStore, setChatContext } from '@chatkit-svelte/svelte';
  import ApprovalBar from '../src/ApprovalBar.svelte';
  import type { ChatConfig } from '@chatkit-svelte/core';
  import { untrack } from 'svelte';

  interface Props {
    config: ChatConfig;
    class?: string;
  }

  let { config, class: className }: Props = $props();
  const store = untrack(() => createChatStore(config));
  setChatContext(store);
</script>

<ApprovalBar class={className} />
