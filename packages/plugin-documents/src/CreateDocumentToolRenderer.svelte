<script lang="ts">
  import { getChatContext } from '@chatkit-svelte/svelte';
  import DocumentCanvas from './DocumentCanvas.svelte';
  import type { ArtifactRecord, ContentPart } from '@chatkit-svelte/core';
  import type { DocumentArtifactData } from './types';

  interface Props {
    toolCall: ContentPart & { type: 'tool_call' };
  }

  let { toolCall }: Props = $props();
  const store = getChatContext();

  interface CreateDocumentArgs {
    title?: string;
    content?: string;
  }

  // Deliberately local (never dispatched into store.state.artifacts): that
  // global registry is what <ArtifactPanel> renders unconditionally, and
  // this document is already shown inline via toolRenderers -- seeding it
  // there too produced a real duplicate, each copy with its own independent
  // edit state (DocumentCanvas's onSave override below is what keeps
  // editing here from ever reaching that registry).
  let title = $state('Untitled');
  let content = $state('');
  let seeded = $state(false);

  // Unlike show_form/request_file, presenting a document needs nothing back
  // from the user, so this resolves itself immediately instead of waiting
  // for a click: editAndRetry is called with the tool call's OWN args
  // unchanged (not a replacement), so the confirmation lives in the result
  // the onToolCall hook computes, independent of args -- the document's
  // content is never at risk of being overwritten by whatever the "result"
  // of showing it happens to be.
  $effect(() => {
    if (seeded || toolCall.status === 'streaming_args') return;
    seeded = true;
    const args = (toolCall.args ?? {}) as CreateDocumentArgs;
    title = args.title ?? 'Untitled';
    content = args.content ?? '';
    void store.editAndRetry(toolCall.toolCallId, toolCall.args);
  });

  const artifact = $derived.by(
    (): ArtifactRecord => ({
      id: toolCall.toolCallId,
      kind: 'document',
      version: 1,
      createdByMessageId: '',
      status: 'final',
      data: {
        title,
        format: 'markdown',
        content,
        editable: true,
        // 'md' and 'txt' both just return data.content directly (see
        // export.ts) -- no exportHandlers needed, which is also why this
        // component doesn't take an exportHandlers prop.
        exportFormats: ['md', 'txt'],
      } satisfies DocumentArtifactData,
    })
  );

  function handleSave(newContent: string) {
    content = newContent;
  }
</script>

{#if seeded}
  <DocumentCanvas {artifact} onSave={handleSave} />
{/if}
