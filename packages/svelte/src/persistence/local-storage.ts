import { deriveTitle } from '@chatkit/core';
import type { ChatState, PersistenceAdapter, ThreadSummary } from '@chatkit/core';

export interface LocalStoragePersistenceOptions {
  storage?: Storage;
  keyPrefix?: string;
  /** Warn (console.warn) when a single thread's serialized size exceeds this many bytes. Default ~4MB. */
  warnAboveBytes?: number;
}

type IndexEntry = ThreadSummary;

export function localStoragePersistence(options: LocalStoragePersistenceOptions = {}): PersistenceAdapter {
  const storage = options.storage ?? window.localStorage;
  const prefix = options.keyPrefix ?? 'chatkit:thread:';
  const indexKey = `${prefix}__index`;
  const warnAboveBytes = options.warnAboveBytes ?? 4 * 1024 * 1024;

  function readIndex(): IndexEntry[] {
    const raw = storage.getItem(indexKey);
    if (!raw) return [];
    try {
      return JSON.parse(raw) as IndexEntry[];
    } catch {
      return [];
    }
  }

  function writeIndex(entries: IndexEntry[]): void {
    storage.setItem(indexKey, JSON.stringify(entries));
  }

  return {
    async loadThread(threadId) {
      const raw = storage.getItem(prefix + threadId);
      if (!raw) return null;
      return JSON.parse(raw) as ChatState;
    },
    async saveThread(threadId, state) {
      const serialized = JSON.stringify(state);
      if (serialized.length > warnAboveBytes) {
        console.warn(
          `[chatkit] thread "${threadId}" is ${serialized.length} bytes serialized, above the ${warnAboveBytes}-byte localStorage warning threshold — consider indexedDbPersistence() for large threads.`
        );
      }
      storage.setItem(prefix + threadId, serialized);
      const entries = readIndex().filter((e) => e.id !== threadId);
      entries.push({ id: threadId, title: deriveTitle(state), updatedAt: Date.now() });
      writeIndex(entries);
    },
    async listThreads() {
      return readIndex().sort((a, b) => b.updatedAt - a.updatedAt);
    },
    async deleteThread(threadId) {
      storage.removeItem(prefix + threadId);
      writeIndex(readIndex().filter((e) => e.id !== threadId));
    },
  };
}
