<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { lastThread, newThreadId, threadPath } from '$lib/threads';

  // The address names the conversation, so "/" only decides which one to open: the last one used in this browser,
  // or a new one.
  onMount(() => {
    void goto(threadPath(lastThread() ?? newThreadId()), { replaceState: true });
  });
</script>

<svelte:head>
  <title>chatkit — local model demo</title>
</svelte:head>

<p style="font-family: system-ui, sans-serif; margin: 1rem;">Opening your conversation…</p>
