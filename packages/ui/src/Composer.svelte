<script lang="ts">
  import { getChatContext } from '@chatkit-svelte/svelte';
  import type { ContentPart } from '@chatkit-svelte/core';

  interface Props {
    class?: string;
  }

  let { class: className }: Props = $props();
  const store = getChatContext();
  let text = $state('');
  let pendingAttachments: ContentPart[] = $state([]);
  let fileInput: HTMLInputElement | undefined = $state();
  let inputEl: HTMLInputElement | undefined = $state();

  const hasAttachmentHandlers = $derived(store.registry.attachmentHandlers.length > 0);
  // A run already in flight must finish (or error) before another can start
  // — sending a second message into that window doesn't queue, it races the
  // transport/backend's own single-run-per-thread bookkeeping and can come
  // back as a hard error there instead of a friendly local no-op.
  const isRunning = $derived(store.state.runStatus === 'running');

  function matchesAccept(mimeType: string, patterns: string[]): boolean {
    return patterns.some((pattern) => (pattern.endsWith('/*') ? mimeType.startsWith(pattern.slice(0, -1)) : mimeType === pattern));
  }

  async function handleFileChange(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const handler = store.registry.attachmentHandlers.find((h) => matchesAccept(file.type, h.accept));
    if (!handler) return;
    if (handler.maxSizeBytes && file.size > handler.maxSizeBytes) return;
    const part = await handler.process(file, {});
    pendingAttachments = [...pendingAttachments, part];
  }

  function removeAttachment(index: number) {
    pendingAttachments = pendingAttachments.filter((_, i) => i !== index);
  }

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    if (isRunning) return;
    const value = text.trim();
    if (!value && pendingAttachments.length === 0) return;
    const attachments = pendingAttachments;
    text = '';
    pendingAttachments = [];
    await store.sendMessage({ text: value, attachments });
    inputEl?.focus();
  }
</script>

<form class="ck-composer {className ?? ''}" onsubmit={handleSubmit}>
  {#if pendingAttachments.length > 0}
    <ul class="ck-composer__attachments" aria-live="polite">
      {#each pendingAttachments as attachment, index (index)}
        <li class="ck-composer__attachment-chip">
          {#if attachment.type === 'image'}
            <img src={attachment.url} alt={attachment.alt ?? ''} class="ck-composer__attachment-thumb" />
          {:else}
            <span class="ck-composer__attachment-icon" aria-hidden="true">📄</span>
          {/if}
          <span class="ck-composer__attachment-name">
            {attachment.type === 'file' ? attachment.name : store.t('composer.attachmentImage')}
          </span>
          <button
            type="button"
            class="ck-composer__attachment-remove"
            onclick={() => removeAttachment(index)}
            aria-label={store.t('composer.removeAttachment')}
          >
            ×
          </button>
        </li>
      {/each}
    </ul>
  {/if}
  <div class="ck-composer__row">
    {#if hasAttachmentHandlers}
      <input
        type="file"
        bind:this={fileInput}
        onchange={handleFileChange}
        class="ck-composer__file-input"
        aria-label="Attach file"
      />
      <button type="button" class="ck-composer__attach" onclick={() => fileInput?.click()} aria-label={store.t('composer.attach')}>📎</button>
    {/if}
    <input
      id="ck-composer-input"
      bind:this={inputEl}
      class="ck-composer__input"
      bind:value={text}
      placeholder={store.t('composer.placeholder')}
      aria-label={store.t('composer.inputLabel')}
    />
    <button class="ck-composer__send" type="submit" disabled={isRunning}>{store.t('composer.send')}</button>
  </div>
</form>

<style>
  .ck-composer {
    display: flex;
    flex-direction: column;
    gap: var(--ck-space-2);
    padding: var(--ck-space-3);
    border-top: 1px solid var(--ck-color-border);
  }

  .ck-composer__row {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: var(--ck-space-2);
  }

  .ck-composer__attachments {
    display: flex;
    flex-wrap: wrap;
    gap: var(--ck-space-2);
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .ck-composer__attachment-chip {
    display: flex;
    align-items: center;
    gap: var(--ck-space-1);
    max-width: 12rem;
    padding: var(--ck-space-1) var(--ck-space-2);
    border: 1px solid var(--ck-color-border);
    border-radius: var(--ck-radius-sm);
    background: var(--ck-color-surface);
    font-size: var(--ck-font-size-sm);
  }

  .ck-composer__attachment-thumb {
    width: 1.25rem;
    height: 1.25rem;
    object-fit: cover;
    border-radius: var(--ck-radius-sm);
    flex-shrink: 0;
  }

  .ck-composer__attachment-icon {
    flex-shrink: 0;
  }

  .ck-composer__attachment-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ck-composer__attachment-remove {
    flex-shrink: 0;
    background: none;
    border: none;
    cursor: pointer;
    line-height: 1;
    padding: 0 0 0 var(--ck-space-1);
    color: var(--ck-color-text-muted);
    font-size: 1rem;
  }

  .ck-composer__file-input {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
  }

  .ck-composer__attach {
    background: none;
    border: 1px solid var(--ck-color-border);
    border-radius: var(--ck-radius-sm);
    padding: var(--ck-space-2);
    cursor: pointer;
    line-height: 1;
  }

  .ck-composer__input {
    flex-grow: 1;
    border: 1px solid var(--ck-color-border);
    border-radius: var(--ck-radius-sm);
    font-size: var(--ck-font-size-base);
  }

  .ck-composer__send {
    background: var(--ck-color-accent);
    color: var(--ck-color-accent-contrast);
    border-radius: var(--ck-radius-sm);
    border: none;
    padding: var(--ck-space-2) var(--ck-space-3);
    cursor: pointer;
  }

  .ck-composer__send:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
