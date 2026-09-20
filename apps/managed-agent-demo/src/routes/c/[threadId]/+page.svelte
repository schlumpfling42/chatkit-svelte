<script lang="ts">
  import { page } from '$app/state';
  import Conversation from '$lib/Conversation.svelte';
  import ThreadList from '$lib/ThreadList.svelte';

  // The conversation is named by the address: reloading, sharing the link or coming back later opens the same one.
  const threadId = $derived(page.params.threadId ?? '');
</script>

<svelte:head>
  <title>chatkit — local model demo</title>
</svelte:head>

<div class="app">
  <ThreadList currentId={threadId} />
  <main class="app__main">
    <!-- Keyed: another conversation gets a fresh store and event stream, never a reused one. -->
    {#key threadId}
      <Conversation {threadId} />
    {/key}
  </main>
</div>

<style>
  .app {
    display: flex;
    height: 100vh;
    overflow: hidden;
  }

  .app__main {
    flex: 1;
    min-width: 0;
  }
</style>
