<script lang="ts">
  import { getChatContext } from '@chatkit/svelte';
  import { Markdown } from '@chatkit/plugin-markdown';
  import type { ArtifactRecord } from '@chatkit/core';
  import type { DocumentArtifactData, ExportHandlers, ExportFormat } from './types';
  import { exportDocument } from './export';

  interface Props {
    artifact: ArtifactRecord;
    exportHandlers?: ExportHandlers;
  }

  let { artifact, exportHandlers = {} }: Props = $props();
  const store = getChatContext();

  const data = $derived(artifact.data as DocumentArtifactData);
  const canEdit = $derived(data.editable && artifact.status === 'final');
  let editing = $state(false);
  let draftContent = $state('');

  function startEdit() {
    draftContent = data.content;
    editing = true;
  }

  function saveEdit() {
    store.dispatch({
      type: 'CUSTOM',
      name: 'chatkit.document.snapshot',
      payload: { artifactId: artifact.id, data: { ...data, content: draftContent } },
    });
    editing = false;
  }

  async function handleExport(format: ExportFormat) {
    const result = await exportDocument(artifact, format, exportHandlers);
    const blob = typeof result === 'string' ? new Blob([result], { type: 'text/plain' }) : result;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${data.title}.${format}`;
    link.click();
    URL.revokeObjectURL(url);
  }
</script>

<div class="ck-document-canvas">
  <div class="ck-document-canvas__header">
    <h3 class="ck-document-canvas__title">{data.title}</h3>
    <div class="ck-document-canvas__actions">
      {#if canEdit && !editing}
        <button type="button" onclick={startEdit}>{store.t('document.edit')}</button>
      {/if}
      {#each data.exportFormats ?? [] as format (format)}
        <button type="button" onclick={() => handleExport(format)}>{store.t('document.export', { format })}</button>
      {/each}
    </div>
  </div>

  {#if editing}
    <textarea class="ck-document-canvas__editor" bind:value={draftContent}></textarea>
    <div class="ck-document-canvas__actions">
      <button type="button" onclick={saveEdit}>{store.t('document.save')}</button>
      <button type="button" onclick={() => (editing = false)}>{store.t('document.cancel')}</button>
    </div>
  {:else}
    <div class="ck-document-canvas__content" data-testid="document-content">
      <Markdown part={{ type: 'text', text: data.content }} />
    </div>
  {/if}
</div>

<style>
  .ck-document-canvas {
    display: flex;
    flex-direction: column;
    gap: var(--ck-space-2);
  }

  .ck-document-canvas__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--ck-space-2);
  }

  .ck-document-canvas__title {
    margin: 0;
    font-size: var(--ck-font-size-lg);
  }

  .ck-document-canvas__actions {
    display: flex;
    gap: var(--ck-space-2);
  }

  .ck-document-canvas__actions button {
    border-radius: var(--ck-radius-sm);
    border: 1px solid var(--ck-color-border);
    padding: var(--ck-space-1) var(--ck-space-3);
    cursor: pointer;
    background: var(--ck-color-bg);
    color: var(--ck-color-text);
  }

  .ck-document-canvas__editor {
    width: 100%;
    min-height: 8rem;
    box-sizing: border-box;
    font-family: var(--ck-font-mono);
    border: 1px solid var(--ck-color-border);
    border-radius: var(--ck-radius-sm);
    padding: var(--ck-space-2);
    background: var(--ck-color-bg);
    color: var(--ck-color-text);
  }
</style>
