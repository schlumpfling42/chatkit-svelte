<script lang="ts">
  import { getChatContext } from '@chatkit-svelte/svelte';
  import { onDestroy, onMount, tick } from 'svelte';
  import type { Snippet, Component } from 'svelte';
  import type { ContentPart, Message } from '@chatkit-svelte/core';
  import WorkingIndicator from './WorkingIndicator.svelte';
  import { createScrollFollower, type ScrollFollower } from './scroll-follow';

  interface Props {
    message?: Snippet<[Message]>;
    class?: string;
  }

  let { message, class: className }: Props = $props();
  const store = getChatContext();

  // The plugin registry stores renderer components as `unknown` in
  // @chatkit-svelte/core (deliberately — core has no Svelte dependency). This is
  // the trust boundary where that gets cast back to a concrete Svelte
  // Component type: plugin authors are responsible for matching the
  // { part } / { toolCall } prop shape a registration implies.
  function messageRendererFor(part: ContentPart): Component<{ part: ContentPart }> | undefined {
    const match = store.registry.messageRenderers.find((r) => r.partType === part.type);
    return match?.component as Component<{ part: ContentPart }> | undefined;
  }

  function toolRendererFor(toolName: string): Component<{ toolCall: ContentPart & { type: 'tool_call' } }> | undefined {
    return (store.registry.toolRenderers[toolName] ?? store.registry.toolRenderers['*']) as
      | Component<{ toolCall: ContentPart & { type: 'tool_call' } }>
      | undefined;
  }

  // Screen-reader announcements are deliberately decoupled from the visible
  // message text: the visible <p> updates on every streamed token (the
  // "watch it stream" UX), but announcing every token would spam a screen
  // reader. This hidden live region only picks up the latest assistant
  // text 600ms after the last delta, or immediately once the message
  // finishes streaming — see the M6 plan's decision 6.
  let announcedText = $state('');
  let announceTimer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    const last = store.messages.at(-1);
    if (!last || last.role !== 'assistant') return;
    const text = last.parts
      .filter((p): p is ContentPart & { type: 'text' } => p.type === 'text')
      .map((p) => p.text)
      .join('');
    clearTimeout(announceTimer);
    if (!last.streaming) {
      announcedText = text;
      return;
    }
    announceTimer = setTimeout(() => {
      announcedText = text;
    }, 600);
  });

  onDestroy(() => clearTimeout(announceTimer));

  // ---- scrolling ----
  // While an answer streams in, keep the newest output in view until the question being answered reaches the top of
  // the window; and let go the moment the reader scrolls. See scroll-follow.ts.
  let listEl = $state<HTMLElement>();
  let contentEl = $state<HTMLElement>();
  let follower: ScrollFollower | undefined;
  let opened = false;
  let lastQuestionId: string | undefined;

  function latestQuestionId(): string | undefined {
    for (let i = store.messages.length - 1; i >= 0; i--) {
      if (store.messages[i].role === 'user') return store.messages[i].id;
    }
    return undefined;
  }

  // The question being answered is the last message the user wrote. Only the default rendering knows which element
  // that is; an app that renders messages itself (the `message` snippet) gets "follow the bottom".
  function questionOffset(): number | null {
    if (!listEl) return null;
    const questions = listEl.querySelectorAll<HTMLElement>('.ck-message--user');
    const question = questions[questions.length - 1];
    if (!question) return null;
    const paddingTop = parseFloat(getComputedStyle(listEl).paddingTop) || 0;
    return question.getBoundingClientRect().top - listEl.getBoundingClientRect().top + listEl.scrollTop - paddingTop;
  }

  onMount(() => {
    if (!listEl || !contentEl) return;
    const active = createScrollFollower({ scroller: listEl, questionOffset });
    follower = active;

    // Content grows for many reasons (streamed text, a tool result opening, an image loading): watching the
    // content's size catches them all, where watching messages would catch only some.
    let frame = 0;
    const schedule = () => {
      if (typeof requestAnimationFrame !== 'function') return active.follow();
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        active.follow();
      });
    };
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : undefined;
    observer?.observe(contentEl);

    // A conversation that is already there when the list appears (a reload, a thread opened from a link) opens at
    // its end.
    if (store.messages.length > 0) {
      opened = true;
      lastQuestionId = latestQuestionId();
      active.jumpToBottom();
    }

    return () => {
      observer?.disconnect();
      if (frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
      active.destroy();
      follower = undefined;
    };
  });

  $effect(() => {
    const count = store.messages.length;
    const questionId = latestQuestionId();
    if (!follower) return;
    if (!opened) {
      if (count === 0) return;
      // The conversation arrived after the list did (restored from the server): show its end.
      opened = true;
      lastQuestionId = questionId;
      void tick().then(() => follower?.jumpToBottom());
      return;
    }
    if (questionId !== lastQuestionId) {
      // A new question always brings the reader back to what is being written, whatever they did before.
      lastQuestionId = questionId;
      void tick().then(() => follower?.newQuestion());
      return;
    }
    // Every streamed token lands here: follow it once the DOM has it. This is driven by the data rather than by
    // frames or resize notifications, which do not fire in a background tab.
    void tick().then(() => follower?.follow());
  });

  // Show that the assistant is working from the moment a run starts until words are actually appearing (or the
  // run parks on a tool, which is then the user's turn). Once assistant text is streaming, that text is the
  // sign of life and the indicator steps aside.
  const working = $derived.by(() => {
    if (store.state.runStatus !== 'running') return false;
    const last = store.messages.at(-1);
    if (last?.role !== 'assistant' || !last.streaming) return true;
    return !last.parts.some((p) => p.type === 'text' && p.text.trim() !== '');
  });
</script>

<div class="ck-message-list {className ?? ''}" role="log" bind:this={listEl}>
  <div class="ck-message-list__content" bind:this={contentEl}>
  {#each store.messages as msg (msg.id)}
    {#if message}
      {@render message(msg)}
    {:else}
      <div class="ck-message ck-message--{msg.role}" data-testid="message">
        {#each msg.parts as part}
          {#if part.type === 'tool_call'}
            {@const ToolRenderer = toolRendererFor(part.toolName)}
            {#if ToolRenderer}
              <ToolRenderer toolCall={part} />
            {:else}
              <div class="ck-tool-call-fallback" data-testid="tool-fallback">Tool call: {part.toolName} ({part.status})</div>
            {/if}
          {:else}
            {@const Renderer = messageRendererFor(part)}
            {#if Renderer}
              <Renderer {part} />
            {:else if part.type === 'text'}
              <p>{part.text}</p>
            {/if}
          {/if}
        {/each}
      </div>
    {/if}
  {/each}
  {#if working}
    <WorkingIndicator />
  {/if}
  </div>
</div>
<div class="ck-sr-only" role="status" aria-live="polite" data-testid="live-announcer">{announcedText}</div>
<div class="ck-sr-only" role="status" aria-live="polite" data-testid="working-announcer">{working ? store.t('working.label') : ''}</div>

<style>
  .ck-message-list {
    flex-grow: 1;
    overflow-y: auto;
    padding: var(--ck-space-4);
  }

  /* The messages live one level in so their total height can be observed (the scroller's own box does not change
     as its content grows). */
  .ck-message-list__content {
    display: flex;
    flex-direction: column;
    gap: var(--ck-space-3);
  }

  .ck-message {
    border-radius: var(--ck-radius-md);
    padding: var(--ck-space-3);
  }

  .ck-message--user {
    background: var(--ck-color-user-bubble);
    color: var(--ck-color-user-bubble-text);
    margin-left: auto;
    max-width: 80%;
  }

  .ck-message--assistant {
    background: var(--ck-color-assistant-bubble);
    color: var(--ck-color-assistant-bubble-text);
    margin-right: auto;
    max-width: 80%;
  }

  .ck-tool-call-fallback {
    font-size: var(--ck-font-size-sm);
    color: var(--ck-color-text-muted);
    font-family: var(--ck-font-mono);
  }

  .ck-sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
  }
</style>
