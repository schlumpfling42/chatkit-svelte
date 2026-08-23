<script lang="ts">
  import { createChatStore, setChatContext } from '@chatkit/svelte';
  import MessageList from '../src/MessageList.svelte';
  import type { ChatConfig } from '@chatkit/core';
  import { untrack } from 'svelte';

  interface Props {
    config: ChatConfig;
    class?: string;
  }

  let { config, class: className }: Props = $props();
  const store = untrack(() => createChatStore(config));
  setChatContext(store);
</script>

<MessageList class={className} />
