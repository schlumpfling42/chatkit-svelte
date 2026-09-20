// The conversation list and the "which conversation is open" bookkeeping for the demo. The gateway is the source of
// truth for conversations; the browser only remembers which one it had open, so `/` can go back to it.

const ENDPOINT = '/api/agent/threads';
const LAST_THREAD_KEY = 'chatkit.demo.lastThread';

export interface ThreadSummary {
  id: string;
  title: string;
  updatedAt: number;
  messageCount: number;
}

export interface ThreadListing {
  /** False when there is no list to show: the server has no such endpoint (the demo's own engine) or is unreachable. */
  available: boolean;
  threads: ThreadSummary[];
}

function isSummary(value: unknown): value is ThreadSummary {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === 'string' && typeof row.title === 'string' && typeof row.updatedAt === 'number' && typeof row.messageCount === 'number';
}

export async function listThreads(): Promise<ThreadListing> {
  try {
    const response = await fetch(ENDPOINT);
    if (!response.ok) return { available: false, threads: [] };
    const body = (await response.json()) as { threads?: unknown };
    return { available: true, threads: Array.isArray(body.threads) ? body.threads.filter(isSummary) : [] };
  } catch {
    return { available: false, threads: [] };
  }
}

export async function deleteThread(threadId: string): Promise<boolean> {
  try {
    const response = await fetch(`${ENDPOINT}/${encodeURIComponent(threadId)}`, { method: 'DELETE' });
    return response.ok;
  } catch {
    return false;
  }
}

/** A fresh id. UUIDs are unguessable enough to serve as the only "key" to a conversation in a demo. */
export function newThreadId(): string {
  return crypto.randomUUID();
}

/** Where a conversation lives in the address bar. */
export function threadPath(threadId: string): string {
  return `/c/${encodeURIComponent(threadId)}`;
}

// localStorage can be missing, blocked or throw (private windows, cleared site data): remembering is a convenience.

export function rememberThread(threadId: string): void {
  try {
    localStorage.setItem(LAST_THREAD_KEY, threadId);
  } catch {
    // nothing to do
  }
}

export function lastThread(): string | null {
  try {
    return localStorage.getItem(LAST_THREAD_KEY);
  } catch {
    return null;
  }
}

/** Call when a conversation is deleted, so `/` does not reopen it. */
export function forgetLastThread(threadId: string): void {
  try {
    if (localStorage.getItem(LAST_THREAD_KEY) === threadId) localStorage.removeItem(LAST_THREAD_KEY);
  } catch {
    // nothing to do
  }
}
