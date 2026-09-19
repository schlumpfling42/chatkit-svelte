<script lang="ts">
  import { getChatContext } from '@chatkit-svelte/svelte';
  import { onMount } from 'svelte';

  interface Props {
    /** Words to cycle through. Default: the `working.words` message (pipe-separated), so apps can translate or replace them. */
    words?: string[];
    /** How long each word stays, in milliseconds. */
    intervalMs?: number;
    /** After this many seconds of waiting, show the elapsed time; a long silent wait reads as "stuck" without it. */
    showElapsedAfterSeconds?: number;
    class?: string;
  }

  let { words, intervalMs = 2200, showElapsedAfterSeconds = 5, class: className }: Props = $props();
  const store = getChatContext();

  const list = $derived(
    (words ?? store.t('working.words').split('|'))
      .map((w) => w.trim())
      .filter(Boolean)
  );

  // Start somewhere different each time, so the first word people see is not always the same one.
  let index = $state(Math.floor(Math.random() * 1000));
  let elapsedSeconds = $state(0);
  const word = $derived(list.length > 0 ? list[index % list.length] : '');

  // The component is mounted only while the assistant is working, so "mounted" is the clock.
  onMount(() => {
    const started = Date.now();
    const wordTimer = setInterval(() => (index += 1), intervalMs);
    const clock = setInterval(() => (elapsedSeconds = Math.floor((Date.now() - started) / 1000)), 1000);
    return () => {
      clearInterval(wordTimer);
      clearInterval(clock);
    };
  });
</script>

<!-- Purely visual: screen readers get one calm announcement from MessageList, not a new word every couple of seconds. -->
<div class="ck-working {className ?? ''}" aria-hidden="true" data-testid="working-indicator">
  <span class="ck-working__dots"><i></i><i></i><i></i></span>
  {#if word}
    {#key word}
      <span class="ck-working__word" data-testid="working-word">{word}…</span>
    {/key}
  {/if}
  {#if elapsedSeconds >= showElapsedAfterSeconds}
    <span class="ck-working__elapsed" data-testid="working-elapsed">{elapsedSeconds}s</span>
  {/if}
</div>

<style>
  .ck-working {
    display: flex;
    align-items: center;
    gap: var(--ck-space-2);
    align-self: flex-start;
    padding: var(--ck-space-2) var(--ck-space-3);
    font-size: var(--ck-font-size-sm);
    color: var(--ck-color-text-muted);
    user-select: none;
  }

  .ck-working__dots {
    display: inline-flex;
    gap: 4px;
  }

  .ck-working__dots i {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--ck-color-accent);
    animation: ck-working-bounce 1.1s ease-in-out infinite;
  }

  .ck-working__dots i:nth-child(2) {
    animation-delay: 0.15s;
  }

  .ck-working__dots i:nth-child(3) {
    animation-delay: 0.3s;
  }

  /* A soft light sweeping across the word, so the text itself looks alive. */
  .ck-working__word {
    background: linear-gradient(90deg, var(--ck-color-text-muted) 35%, var(--ck-color-text) 50%, var(--ck-color-text-muted) 65%);
    background-size: 250% 100%;
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    animation:
      ck-working-shimmer 2.2s linear infinite,
      ck-working-in var(--ck-transition-base) both;
  }

  .ck-working__elapsed {
    font-variant-numeric: tabular-nums;
    opacity: 0.7;
  }

  @keyframes ck-working-bounce {
    0%,
    70%,
    100% {
      transform: translateY(0);
      opacity: 0.45;
    }
    35% {
      transform: translateY(-4px);
      opacity: 1;
    }
  }

  @keyframes ck-working-shimmer {
    from {
      background-position: 100% 0;
    }
    to {
      background-position: -100% 0;
    }
  }

  @keyframes ck-working-in {
    from {
      opacity: 0;
      transform: translateY(3px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .ck-working__dots i {
      animation: none;
      opacity: 0.8;
    }

    .ck-working__word {
      animation: none;
      background: none;
      color: var(--ck-color-text-muted);
    }
  }
</style>
