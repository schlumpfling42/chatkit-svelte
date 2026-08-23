<script lang="ts">
  import { getChatContext } from '@chatkit/svelte';
  import type { ContentPart } from '@chatkit/core';

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

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
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
  <button class="ck-composer__send" type="submit">{store.t('composer.send')}</button>
</form>

<style>
  .ck-composer {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: var(--ck-space-2);
    padding: var(--ck-space-3);
    border-top: 1px solid var(--ck-color-border);
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
</style>
