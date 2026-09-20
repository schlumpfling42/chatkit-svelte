<script lang="ts">
  import { goto } from '$app/navigation';
  import { deleteThread, forgetLastThread, listThreads, newThreadId, threadPath, type ThreadSummary } from './threads';

  interface Props {
    /** The conversation that is open. */
    currentId: string;
  }
  let { currentId }: Props = $props();

  let threads = $state<ThreadSummary[]>([]);
  let available = $state(true);

  async function refresh() {
    const listing = await listThreads();
    available = listing.available;
    threads = listing.threads;
  }

  // The gateway is the source of truth, so the list is asked for again when the open conversation changes and every
  // few seconds (a reply that just finished is what moves a conversation to the top and gives a new one its title).
  $effect(() => {
    void currentId;
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  });

  const isNew = $derived(!threads.some((t) => t.id === currentId));

  function newChat() {
    void goto(threadPath(newThreadId()));
  }

  async function remove(thread: ThreadSummary) {
    if (!confirm(`Delete “${thread.title || 'this conversation'}”? This cannot be undone.`)) return;
    if (!(await deleteThread(thread.id))) return;
    forgetLastThread(thread.id);
    threads = threads.filter((t) => t.id !== thread.id);
    if (thread.id === currentId) newChat();
  }

  function when(millis: number): string {
    const date = new Date(millis);
    const today = new Date();
    return date.toDateString() === today.toDateString()
      ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
</script>

<aside class="threads" aria-label="Conversations">
  <button type="button" class="threads__new" onclick={newChat}>+ New chat</button>

  {#if !available}
    <p class="threads__note">Conversations are only listed when the demo runs against the gateway (set GATEWAY_URL).</p>
  {:else}
    <ul class="threads__list">
      {#if isNew}
        <li class="threads__item threads__item--current" aria-current="page">
          <span class="threads__title threads__title--empty">New chat</span>
        </li>
      {/if}
      {#each threads as thread (thread.id)}
        <li class="threads__item" class:threads__item--current={thread.id === currentId}>
          <a class="threads__link" href={threadPath(thread.id)} aria-current={thread.id === currentId ? 'page' : undefined}>
            <span class="threads__title">{thread.title || 'Untitled'}</span>
            <span class="threads__when">{when(thread.updatedAt)}</span>
          </a>
          <button type="button" class="threads__delete" aria-label="Delete conversation" title="Delete" onclick={() => remove(thread)}>×</button>
        </li>
      {/each}
    </ul>
  {/if}
</aside>

<style>
  .threads {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    width: 15rem;
    flex-shrink: 0;
    height: 100vh;
    box-sizing: border-box;
    padding: 0.6rem;
    overflow-y: auto;
    font: 0.85rem system-ui, sans-serif;
    background: #f6f6f8;
    border-right: 1px solid #e5e5e7;
  }

  .threads__new {
    font: inherit;
    font-weight: 600;
    padding: 0.45rem 0.6rem;
    border: 1px solid #c8c8cc;
    border-radius: 6px;
    background: #fff;
    cursor: pointer;
    text-align: left;
  }

  .threads__new:hover {
    background: #f0f0f3;
  }

  .threads__note {
    margin: 0.25rem 0.1rem;
    color: #666;
    font-size: 0.78rem;
    line-height: 1.4;
  }

  .threads__list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .threads__item {
    display: flex;
    align-items: center;
    border-radius: 6px;
  }

  .threads__item:hover {
    background: #ececf0;
  }

  .threads__item--current {
    background: #e2e0fb;
  }

  .threads__link {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 0.4rem 0.5rem;
    color: inherit;
    text-decoration: none;
  }

  .threads__title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .threads__title--empty {
    padding: 0.4rem 0.5rem;
    color: #666;
    font-style: italic;
  }

  .threads__when {
    font-size: 0.7rem;
    color: #777;
  }

  .threads__delete {
    flex-shrink: 0;
    width: 1.6rem;
    height: 1.6rem;
    margin-right: 0.2rem;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: #888;
    font-size: 1.1rem;
    line-height: 1;
    cursor: pointer;
    opacity: 0;
  }

  .threads__item:hover .threads__delete,
  .threads__delete:focus-visible {
    opacity: 1;
  }

  .threads__delete:hover {
    background: #d9d9de;
    color: #a00;
  }
</style>
