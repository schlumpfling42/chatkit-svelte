<script lang="ts">
  import { getChatContext } from '@chatkit-svelte/svelte';
  import { exportFixture } from './export-fixture';
  import type { DevtoolsLog } from './log.svelte';

  interface Props {
    log: DevtoolsLog;
  }

  let { log }: Props = $props();
  const store = getChatContext();

  // Collapsed by default: a debug panel that's always fully expanded ends up
  // dominating the screen the moment a real event carries anything sizable
  // (a base64-encoded attachment, a long document) -- the point of a devtools
  // panel is to be there when you need it, not to compete with the actual
  // app output for space. Content stays in the DOM either way (just visually
  // collapsed via CSS) rather than being removed on toggle, so existing
  // automation/tests that query it don't need to expand it first.
  let expanded = $state(false);

  const MAX_STRING_LENGTH = 300;

  // Recursively caps any string value's rendered length -- primarily for
  // base64 data: URIs (file/image attachments, generated documents), which
  // can run to hundreds of KB and would otherwise make a single event's
  // <pre> block dwarf everything else on the page.
  function truncateLongStrings(value: unknown): unknown {
    if (typeof value === 'string') {
      return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}… (${value.length} chars total)` : value;
    }
    if (Array.isArray(value)) return value.map(truncateLongStrings);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, truncateLongStrings(v)]));
    }
    return value;
  }

  function formatForDisplay(value: unknown): string {
    return JSON.stringify(truncateLongStrings(value), null, 2);
  }

  function handleExport() {
    // The exported fixture keeps full, untruncated event data (truncation
    // above is a display-only concern) -- fixtures need to be replayable.
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
    <button
      type="button"
      class="ck-devtools__toggle"
      onclick={() => (expanded = !expanded)}
      aria-expanded={expanded}
      data-testid="devtools-toggle"
    >
      <span class="ck-devtools__chevron" class:ck-devtools__chevron--expanded={expanded}>▸</span>
      <span class="ck-devtools__count">Devtools — {log.events.length} events</span>
    </button>
    <button type="button" onclick={handleExport} data-testid="devtools-export">Export fixture</button>
    <button type="button" onclick={() => log.clear()}>Clear</button>
  </div>
  <div class="ck-devtools__body" class:ck-devtools__body--expanded={expanded}>
    <ul class="ck-devtools__list">
      {#each log.events as event, i (i)}
        <li class="ck-devtools__event" data-testid="devtools-event">
          <span class="ck-devtools__event-type">{event.type}</span>
          <pre class="ck-devtools__event-json">{formatForDisplay(event)}</pre>
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

  .ck-devtools__toggle {
    display: flex;
    align-items: center;
    gap: var(--ck-space-1);
    background: none;
    border: none;
    padding: 0;
    margin-right: auto;
    font: inherit;
    color: inherit;
    cursor: pointer;
  }

  .ck-devtools__chevron {
    display: inline-block;
    transition: transform 0.1s ease;
  }

  .ck-devtools__chevron--expanded {
    transform: rotate(90deg);
  }

  .ck-devtools__body {
    display: flex;
    gap: var(--ck-space-3);
    max-height: 0;
    overflow: hidden;
  }

  .ck-devtools__body--expanded {
    max-height: 20rem;
    overflow: auto;
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
