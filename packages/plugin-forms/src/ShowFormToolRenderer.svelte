<script lang="ts">
  import { getChatContext } from '@chatkit-svelte/svelte';
  import type { ArtifactRecord, ContentPart } from '@chatkit-svelte/core';
  import FormRenderer from './FormRenderer.svelte';
  import type { FormArtifactData } from './types';

  interface Props {
    toolCall: ContentPart & { type: 'tool_call' };
  }

  let { toolCall }: Props = $props();
  const store = getChatContext();

  // The agent calls a tool (e.g. "show_form") whose arguments ARE a
  // FormArtifactData-shaped payload (schema, or html, plus the optional
  // extras) instead of asking for structured input in prose. Wrapping that
  // in a synthetic ArtifactRecord lets this reuse FormRenderer's entire
  // rendering/validation/widget-harvesting implementation unchanged; the
  // only thing that differs from the artifact-driven path is where the
  // filled-in values go once submitted.
  const artifact = $derived.by((): ArtifactRecord => {
    const args = (toolCall.args ?? {}) as Partial<FormArtifactData>;
    const done = toolCall.status === 'complete' || toolCall.status === 'error';
    return {
      id: toolCall.toolCallId,
      kind: 'form',
      version: 1,
      createdByMessageId: '',
      status: done ? 'submitted' : 'draft',
      data: {
        ...args,
        mode: 'single-submit',
        values: done ? ((toolCall.result ?? {}) as Record<string, unknown>) : undefined,
      },
    };
  });

  // store.editAndRetry updates this tool call's stored args to the filled-in
  // values and runs the onToolCall plugin hook (registered by formsPlugin()
  // below) to compute the result it sends back via
  // transport.sendFrontendToolResult -- the same "let the user edit a
  // pending tool call's args and resubmit" path human-in-the-loop approval
  // already uses, just with this form as the editing UI instead of the
  // default approval bar.
  async function handleSubmitOverride(values: Record<string, unknown>) {
    await store.editAndRetry(toolCall.toolCallId, values);
  }
</script>

{#if toolCall.status === 'streaming_args'}
  <p class="ck-show-form__pending">{store.t('form.submit')}…</p>
{:else}
  <FormRenderer {artifact} onSubmitOverride={handleSubmitOverride} />
{/if}

<style>
  .ck-show-form__pending {
    font-size: var(--ck-font-size-sm);
    color: var(--ck-color-text-muted);
  }
</style>
