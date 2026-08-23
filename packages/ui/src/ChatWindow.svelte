<script lang="ts">
  import MessageList from './MessageList.svelte';
  import Composer from './Composer.svelte';
  import ApprovalBar from './ApprovalBar.svelte';
  import ArtifactPanel from './ArtifactPanel.svelte';
  import { getChatContext } from '@chatkit/svelte';
  import type { Snippet } from 'svelte';
  import type { Message } from '@chatkit/core';

  interface Props {
    message?: Snippet<[Message]>;
    class?: string;
  }

  let { message, class: className }: Props = $props();
  const store = getChatContext();
</script>

<div class="ck-chat-window {className ?? ''}" data-chatkit-theme dir={store.dir}>
  <ArtifactPanel />
  <MessageList {message} />
  <ApprovalBar />
  <Composer />
</div>

<style>
  .ck-chat-window {
    display: flex;
    flex-direction: column;
    height: 100%;
    /* Without this, a tall stack of artifacts + approval bar + composer can
       exceed the window's own height and visually spill out below it
       instead of being contained — MessageList's own overflow-y: auto
       handles scrolling the message area once it's properly squeezed. Only
       reproduces with real layout (a real browser), not jsdom, which is
       why this went uncaught through every component test this framework
       shipped with. */
    overflow: hidden;
    background: var(--ck-color-bg);
    color: var(--ck-color-text);
    font-family: var(--ck-font-sans);
    border: 1px solid var(--ck-color-border);
    border-radius: var(--ck-radius-lg);
  }
</style>
