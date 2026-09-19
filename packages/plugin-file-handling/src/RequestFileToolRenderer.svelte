<script lang="ts">
  import { getChatContext } from '@chatkit-svelte/svelte';
  import { formatBytes, inferMimeType, matchesAccept } from '@chatkit-svelte/core';
  import type { ContentPart } from '@chatkit-svelte/core';

  interface Props {
    toolCall: ContentPart & { type: 'tool_call' };
  }

  let { toolCall }: Props = $props();
  const store = getChatContext();

  interface RequestFileArgs {
    prompt?: string;
    /** Optional MIME type patterns narrowing what's accepted for this specific request, on top of whatever fileHandlingPlugin itself is configured to accept. */
    accept?: string[];
  }

  const args = $derived((toolCall.args ?? {}) as RequestFileArgs);
  const done = $derived(toolCall.status === 'complete' || toolCall.status === 'error');
  // Set only once submitted (see handleFileChange -> editAndRetry below) --
  // toolCall.result becomes whatever ContentPart the matched attachmentHandler
  // produced, since the onToolCall hook registered by fileHandlingPlugin
  // just echoes the (by-then-updated) args back as the result.
  const submittedPart = $derived(done ? (toolCall.result as ContentPart | undefined) : undefined);

  let error = $state('');

  async function handleFileChange(event: Event) {
    error = '';
    const input = event.currentTarget as HTMLInputElement;
    const picked = input.files?.[0];
    input.value = '';
    if (!picked) return;

    // Same as the composer: the OS's idea of a file's type is often empty or wrong, so go by the extension then.
    const type = inferMimeType(picked);
    const file = type === picked.type ? picked : new File([picked], picked.name, { type, lastModified: picked.lastModified });

    if (args.accept && !matchesAccept(file.type, args.accept)) {
      error = store.t('fileRequest.unsupportedType');
      return;
    }
    const handler = store.registry.attachmentHandlers.find((h) => matchesAccept(file.type, h.accept));
    if (!handler) {
      error = store.t('fileRequest.unsupportedType');
      return;
    }
    if (handler.maxSizeBytes && file.size > handler.maxSizeBytes) {
      error = `${store.t('fileRequest.tooLarge')} (${formatBytes(handler.maxSizeBytes)})`;
      return;
    }

    try {
      const part = await handler.process(file, {});
      // Same mechanism ShowFormToolRenderer uses: update this tool call's args
      // to the real answer (here, the uploaded file's ContentPart) and let the
      // onToolCall hook echo it back as the tool's result, resuming the
      // paused run with a reference to the file the agent asked for.
      await store.editAndRetry(toolCall.toolCallId, part);
    } catch {
      error = store.t('fileRequest.failed');
    }
  }
</script>

{#if toolCall.status === 'streaming_args'}
  <p class="ck-request-file__pending">{store.t('fileRequest.pending')}</p>
{:else if done}
  <div class="ck-request-file__done" data-testid="request-file-done">
    {#if submittedPart?.type === 'image'}
      <img src={submittedPart.url} alt="" class="ck-request-file__thumb" />
    {:else if submittedPart?.type === 'file'}
      <span data-testid="request-file-name">{submittedPart.name}</span>
    {/if}
  </div>
{:else}
  <div class="ck-request-file">
    {#if args.prompt}<p class="ck-request-file__prompt">{args.prompt}</p>{/if}
    <input type="file" onchange={handleFileChange} aria-label={store.t('fileRequest.attach')} />
    {#if error}<span class="ck-request-file__error" data-testid="request-file-error">{error}</span>{/if}
  </div>
{/if}

<style>
  .ck-request-file,
  .ck-request-file__done {
    display: flex;
    flex-direction: column;
    gap: var(--ck-space-2);
  }

  .ck-request-file__pending,
  .ck-request-file__prompt {
    font-size: var(--ck-font-size-sm);
    color: var(--ck-color-text-muted);
  }

  .ck-request-file__error {
    color: var(--ck-color-error);
    font-size: var(--ck-font-size-sm);
  }

  .ck-request-file__thumb {
    max-width: 12rem;
    max-height: 12rem;
    border-radius: var(--ck-radius-sm);
  }
</style>
