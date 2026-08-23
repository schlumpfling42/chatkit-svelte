<script lang="ts">
  import '@chatkit-svelte/ui/tokens.css';
  import type { Snippet } from 'svelte';

  interface Props {
    children: Snippet;
  }

  let { children }: Props = $props();
</script>

{@render children()}
