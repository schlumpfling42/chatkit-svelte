<script lang="ts">
  import type { ContentPart } from '@chatkit-svelte/core';
  import { getChatContext } from '@chatkit-svelte/svelte';
  import { callLabel, progressOf } from './tool-status';

  interface Props {
    toolCall: ContentPart & { type: 'tool_call' };
  }

  let { toolCall }: Props = $props();

  const store = getChatContext();
  const progress = $derived(progressOf(store.activities, toolCall.toolCallId));
  const label = $derived(callLabel(toolCall.toolName, toolCall.args));
</script>

<!-- One chip for a whole job: what it is doing, how far it has got, and for how long. It goes away when the job ends. -->
<div class="job" role="status" data-testid="job-progress">
  <div class="job__title">{label}</div>
  {#if progress}
    <progress class="job__bar" value={progress.done} max={progress.total}></progress>
    <div class="job__detail">{progress.done} of {progress.total} · {progress.elapsedSeconds} s{progress.label ? ` · ${progress.label}` : ''}</div>
  {:else}
    <div class="job__detail">Working…</div>
  {/if}
</div>

<style>
  .job {
    border: 1px solid var(--ck-color-border);
    border-radius: var(--ck-radius-md);
    padding: var(--ck-space-2);
    font-size: var(--ck-font-size-sm);
    display: grid;
    gap: var(--ck-space-1, 4px);
  }

  .job__title {
    font-family: var(--ck-font-mono);
  }

  .job__bar {
    width: 100%;
  }

  .job__detail {
    color: var(--ck-color-text-muted);
    font-family: var(--ck-font-mono);
    overflow-wrap: anywhere;
  }
</style>
