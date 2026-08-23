<script lang="ts">
  import { getChatContext } from '@chatkit/svelte';
  import { onDestroy } from 'svelte';
  import type { Snippet, Component } from 'svelte';
  import type { ContentPart, Message } from '@chatkit/core';

  interface Props {
    message?: Snippet<[Message]>;
    class?: string;
  }

  let { message, class: className }: Props = $props();
  const store = getChatContext();

  // The plugin registry stores renderer components as `unknown` in
  // @chatkit/core (deliberately — core has no Svelte dependency). This is
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
</script>

<div class="ck-message-list {className ?? ''}" role="log">
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
</div>
<div class="ck-sr-only" role="status" aria-live="polite" data-testid="live-announcer">{announcedText}</div>

<style>
  .ck-message-list {
    flex-grow: 1;
    overflow-y: auto;
    padding: var(--ck-space-4);
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
