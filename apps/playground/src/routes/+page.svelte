<script lang="ts">
  import { page } from '$app/stores';
  import { ChatProvider } from '@chatkit-svelte/svelte';
  import { ChatWindow } from '@chatkit-svelte/ui';
  import { createFixtureTransport } from '@chatkit-svelte/core';
  import { fileHandlingPlugin } from '@chatkit-svelte/plugin-file-handling';
  import { markdownPlugin } from '@chatkit-svelte/plugin-markdown';
  import { toolRenderPlugin } from '@chatkit-svelte/plugin-tool-render';
  import { formsPlugin } from '@chatkit-svelte/plugin-forms';
  import { documentsPlugin } from '@chatkit-svelte/plugin-documents';
  import { devtoolsPlugin, DevtoolsOverlay } from '@chatkit-svelte/plugin-devtools';
  import { fixtures, FIXTURE_NAMES, type FixtureName } from '$lib/fixtures';
  import type { ChatConfig } from '@chatkit-svelte/core';

  const fixtureName = $derived(
    (($page.url.searchParams.get('fixture') as FixtureName | null) ?? 'text-streaming') satisfies FixtureName
  );

  const devtools = devtoolsPlugin();

  const config = $derived<ChatConfig>({
    threadId: fixtureName,
    transport: createFixtureTransport(fixtures[fixtureName] ?? fixtures['text-streaming']),
    humanInTheLoop: { requireApprovalFor: ['delete_file'] },
    plugins: [
      fileHandlingPlugin({ upload: async (file) => ({ url: URL.createObjectURL(file) }) }),
      markdownPlugin(),
      toolRenderPlugin(),
      formsPlugin(),
      documentsPlugin(),
      devtools,
    ],
  });
</script>

<svelte:head>
  <title>chatkit playground — {fixtureName}</title>
</svelte:head>

<div class="playground">
  <nav class="playground__nav" data-testid="fixture-nav">
    {#each FIXTURE_NAMES as name (name)}
      <a href="/?fixture={name}" class:active={name === fixtureName} data-testid="fixture-link-{name}">{name}</a>
    {/each}
  </nav>

  {#key fixtureName}
    <ChatProvider {config}>
      {#snippet children()}
        <div class="playground__window" data-chatkit-theme>
          <ChatWindow />
        </div>
        <div class="playground__devtools">
          <DevtoolsOverlay log={devtools.log} />
        </div>
      {/snippet}
    </ChatProvider>
  {/key}
</div>

<style>
  .playground {
    display: flex;
    flex-direction: column;
    height: 100%;
    font-family: system-ui, sans-serif;
  }

  .playground__nav {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    border-bottom: 1px solid #e5e5e7;
  }

  .playground__nav a {
    padding: 0.25rem 0.5rem;
    border-radius: 6px;
    text-decoration: none;
    color: inherit;
  }

  .playground__nav a.active {
    background: #4f46e5;
    color: #ffffff;
  }

  .playground__window {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .playground__devtools {
    max-height: 16rem;
    overflow: auto;
    border-top: 1px solid #e5e5e7;
  }
</style>
