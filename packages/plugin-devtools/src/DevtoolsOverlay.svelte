<script lang="ts">
  import { getChatContext } from '@chatkit-svelte/svelte';
  import { exportFixture } from './export-fixture';
  import type { DevtoolsLog } from './log.svelte';

  interface Props {
    log: DevtoolsLog;
  }

  let { log }: Props = $props();
  const store = getChatContext();

  function handleExport() {
    const blob = new Blob([exportFixture(log.events)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'chatkit-fixture.json';
    link.click();
    URL.revokeObjectURL(url);
  }
</script>

<div class="ck-devtools">
  <div class="ck-devtools__header">
    <span class="ck-devtools__count">Devtools — {log.events.length} events</span>
    <button type="button" onclick={handleExport} data-testid="devtools-export">Export fixture</button>
    <button type="button" onclick={() => log.clear()}>Clear</button>
  </div>
  <div class="ck-devtools__body">
    <ul class="ck-devtools__list">
      {#each log.events as event, i (i)}
        <li class="ck-devtools__event" data-testid="devtools-event">
          <span class="ck-devtools__event-type">{event.type}</span>
          <pre class="ck-devtools__event-json">{JSON.stringify(event, null, 2)}</pre>
        </li>
      {/each}
    </ul>
    <pre class="ck-devtools__state" data-testid="devtools-state">{JSON.stringify(store.state, null, 2)}</pre>
  </div>
</div>

<style>
  .ck-devtools {
    display: flex;
    flex-direction: column;
    gap: var(--ck-space-2);
    font-family: var(--ck-font-mono);
    font-size: var(--ck-font-size-sm);
    border: 1px solid var(--ck-color-border);
    border-radius: var(--ck-radius-md);
    background: var(--ck-color-surface);
    color: var(--ck-color-text);
    padding: var(--ck-space-3);
  }

  .ck-devtools__header {
    display: flex;
    align-items: center;
    gap: var(--ck-space-2);
  }

  .ck-devtools__body {
    display: flex;
    gap: var(--ck-space-3);
    max-height: 20rem;
  }

  .ck-devtools__list,
  .ck-devtools__state {
    flex: 1;
    overflow: auto;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .ck-devtools__event {
    border-bottom: 1px solid var(--ck-color-border);
    padding: var(--ck-space-1) 0;
  }

  .ck-devtools__event-type {
    font-weight: 600;
  }
</style>
