<script lang="ts">
  import { getChatContext } from '@chatkit-svelte/svelte';
  import { pendingQuestions } from './tool-status';

  const store = getChatContext();
  const questions = $derived(pendingQuestions(store.activities));

  let sending = $state<string | null>(null);
  let failed = $state('');

  async function answer(id: string, decision: 'allow' | 'always' | 'deny') {
    sending = id;
    failed = '';
    try {
      const response = await fetch(`/api/agent/permissions/${encodeURIComponent(id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        failed = body?.error?.message ?? `The gateway said HTTP ${response.status}.`;
      }
    } catch (err) {
      failed = `Could not reach the gateway: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      sending = null;
    }
  }
</script>

<!-- The assistant may list files anywhere, but reading what is inside a file, or writing, outside the folders you trust
     needs your yes. The run waits here until you answer. -->
{#each questions as question (question.id)}
  <div class="permission" role="alertdialog" aria-label="Permission needed" data-testid="permission-question">
    <div class="permission__text">
      The assistant wants to <strong>{question.operation}</strong> <code>{question.path}</code>
      {#if question.tool}<span class="permission__tool">(using {question.tool})</span>{/if}
    </div>
    <div class="permission__hint">
      This is outside your trusted folders. Allowing covers everything in <code>{question.scope}</code>.
    </div>
    <div class="permission__buttons">
      <button type="button" disabled={sending === question.id} onclick={() => answer(question.id, 'allow')}>Allow for this conversation</button>
      {#if question.canAlwaysTrust}
        <button type="button" disabled={sending === question.id} onclick={() => answer(question.id, 'always')}>Always trust this folder</button>
      {/if}
      <button type="button" class="permission__deny" disabled={sending === question.id} onclick={() => answer(question.id, 'deny')}>Deny</button>
    </div>
  </div>
{/each}
{#if failed}
  <div class="permission permission--error" role="alert">{failed}</div>
{/if}

<style>
  .permission {
    border: 1px solid var(--ck-color-border);
    border-left: 4px solid var(--ck-color-accent, #4f46e5);
    background: var(--ck-color-surface, #f7f7f8);
    color: var(--ck-color-text, #16161a);
    border-radius: var(--ck-radius-md);
    padding: var(--ck-space-3);
    margin: var(--ck-space-2) 0;
    display: grid;
    gap: var(--ck-space-2);
    font-size: var(--ck-font-size-sm);
  }

  .permission code {
    font-family: var(--ck-font-mono);
    overflow-wrap: anywhere;
  }

  .permission__tool,
  .permission__hint {
    color: var(--ck-color-text-muted);
  }

  .permission__buttons {
    display: flex;
    flex-wrap: wrap;
    gap: var(--ck-space-2);
  }

  .permission--error {
    border-left-color: var(--ck-color-error, #d7263d);
  }
</style>
