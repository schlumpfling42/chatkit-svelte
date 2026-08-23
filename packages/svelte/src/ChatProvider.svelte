<script lang="ts">
  import { createChatStore } from './chat-store.svelte';
  import { setChatContext } from './context';
  import type { ChatConfig } from '@chatkit/core';
  import { onDestroy, untrack, type Snippet } from 'svelte';

  interface Props {
    config: ChatConfig;
    children: Snippet;
  }

  let { config, children }: Props = $props();

  // config bootstraps the store once at mount — it's intentionally not meant
  // to be reactively re-applied if the caller's config object identity
  // changes later, so untrack() here silences Svelte's (accurate, but not
  // applicable to this design) "only captures the initial value" warning.
  const store = untrack(() => createChatStore(config));
  setChatContext(store);
  onDestroy(() => store.dispose());
</script>

{@render children()}
