import type { ChatState } from './types';

export interface ThreadSummary {
  id: string;
  title: string;
  updatedAt: number;
}

export interface PersistenceAdapter {
  loadThread(threadId: string): Promise<ChatState | null>;
  saveThread(threadId: string, state: ChatState): Promise<void>;
  listThreads(): Promise<ThreadSummary[]>;
  deleteThread(threadId: string): Promise<void>;
}

export function deriveTitle(state: ChatState): string {
  const firstUserMessage = state.messages.find((m) => m.role === 'user');
  const text = firstUserMessage?.parts.find((p) => p.type === 'text')?.text;
  if (!text) return 'New thread';
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
}

export function memoryPersistence(): PersistenceAdapter {
  const store = new Map<string, ChatState>();

  return {
    async loadThread(threadId) {
      return store.get(threadId) ?? null;
    },
    async saveThread(threadId, state) {
      store.set(threadId, state);
    },
    async listThreads() {
      return [...store.entries()]
        .map(([id, state]) => ({ id, title: deriveTitle(state), updatedAt: Date.now() }))
        .sort((a, b) => b.updatedAt - a.updatedAt);
    },
    async deleteThread(threadId) {
      store.delete(threadId);
    },
  };
}
