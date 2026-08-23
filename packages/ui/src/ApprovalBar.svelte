<script lang="ts">
  import { getChatContext } from '@chatkit/svelte';

  interface Props {
    class?: string;
  }

  let { class: className }: Props = $props();
  const store = getChatContext();
  let editingId: string | null = $state(null);
  let editText: string = $state('');
  let barEl: HTMLDivElement | undefined = $state();
  let previousCount = 0;

  // Spec §16 focus management: a new approval request moves focus to the
  // bar's first action; resolving the last one returns focus to the
  // composer. Coordinated via the composer's stable DOM id rather than a
  // formal ref-passing API — see the M6 plan's decision 7.
  $effect(() => {
    const count = store.pendingApprovals.length;
    if (count > 0 && previousCount === 0) {
      barEl?.querySelector<HTMLButtonElement>('button')?.focus();
    } else if (count === 0 && previousCount > 0) {
      document.getElementById('ck-composer-input')?.focus();
    }
    previousCount = count;
  });

  function startEdit(toolCallId: string, currentArgs: unknown) {
    editingId = toolCallId;
    editText = JSON.stringify(currentArgs, null, 2);
  }

  function cancelEdit() {
    editingId = null;
    editText = '';
  }

  async function submitEdit(toolCallId: string) {
    try {
      const parsed = JSON.parse(editText);
      editingId = null;
      await store.editAndRetry(toolCallId, parsed);
    } catch {
      // invalid JSON — leave the editor open so the user can fix it
    }
  }
</script>

{#if store.pendingApprovals.length > 0}
  <div class="ck-approval-bar {className ?? ''}" role="region" aria-label="Pending tool approvals" bind:this={barEl}>
    {#each store.pendingApprovals as call (call.toolCallId)}
      <div class="ck-approval" data-testid="approval">
        <div class="ck-approval__tool">{call.toolName}</div>
        {#if editingId === call.toolCallId}
          <textarea class="ck-approval__edit" bind:value={editText} aria-label="Edit arguments"></textarea>
          <div class="ck-approval__actions">
            <button type="button" onclick={() => submitEdit(call.toolCallId)}>{store.t('approvalBar.retry')}</button>
            <button type="button" onclick={cancelEdit}>{store.t('approvalBar.cancel')}</button>
          </div>
        {:else}
          <pre class="ck-approval__args">{JSON.stringify(call.args, null, 2)}</pre>
          <div class="ck-approval__actions">
            <button type="button" onclick={() => store.approveToolCall(call.toolCallId)}>{store.t('approvalBar.approve')}</button>
            <button type="button" onclick={() => store.rejectToolCall(call.toolCallId)}>{store.t('approvalBar.reject')}</button>
            <button type="button" onclick={() => startEdit(call.toolCallId, call.args)}>{store.t('approvalBar.edit')}</button>
          </div>
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .ck-approval-bar {
    display: flex;
    flex-direction: column;
    gap: var(--ck-space-2);
    padding: var(--ck-space-3);
    border-top: 1px solid var(--ck-color-border);
    background: var(--ck-color-surface);
  }

  .ck-approval {
    border: 1px solid var(--ck-color-border);
    border-radius: var(--ck-radius-md);
    padding: var(--ck-space-3);
  }

  .ck-approval__tool {
    font-weight: 600;
    margin-bottom: var(--ck-space-1);
    color: var(--ck-color-text);
  }

  .ck-approval__args,
  .ck-approval__edit {
    font-family: var(--ck-font-mono);
    font-size: var(--ck-font-size-sm);
    background: var(--ck-color-bg);
    color: var(--ck-color-text);
    border: 1px solid var(--ck-color-border);
    border-radius: var(--ck-radius-sm);
    padding: var(--ck-space-2);
    width: 100%;
    box-sizing: border-box;
  }

  .ck-approval__actions {
    display: flex;
    gap: var(--ck-space-2);
    margin-top: var(--ck-space-2);
  }

  .ck-approval__actions button {
    border-radius: var(--ck-radius-sm);
    border: 1px solid var(--ck-color-border);
    padding: var(--ck-space-1) var(--ck-space-3);
    cursor: pointer;
    background: var(--ck-color-bg);
    color: var(--ck-color-text);
  }
</style>
