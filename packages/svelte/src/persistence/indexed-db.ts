import { deriveTitle } from '@chatkit-svelte/core';
import type { ChatState, PersistenceAdapter, ThreadSummary } from '@chatkit-svelte/core';

export interface IndexedDbPersistenceOptions {
  indexedDB?: IDBFactory;
  dbName?: string;
  storeName?: string;
}

interface ThreadRecord extends ThreadSummary {
  state: ChatState;
}

function openDb(idb: IDBFactory, dbName: string, storeName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = idb.open(dbName, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(storeName, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function indexedDbPersistence(options: IndexedDbPersistenceOptions = {}): PersistenceAdapter {
  const idb = options.indexedDB ?? window.indexedDB;
  const dbName = options.dbName ?? 'chatkit';
  const storeName = options.storeName ?? 'threads';
  const dbPromise = openDb(idb, dbName, storeName);

  async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await dbPromise;
    const tx = db.transaction(storeName, mode);
    return requestToPromise(fn(tx.objectStore(storeName)));
  }

  return {
    async loadThread(threadId) {
      const record = await withStore<ThreadRecord | undefined>('readonly', (store) => store.get(threadId));
      return record?.state ?? null;
    },
    async saveThread(threadId, state) {
      const record: ThreadRecord = { id: threadId, title: deriveTitle(state), updatedAt: Date.now(), state };
      await withStore('readwrite', (store) => store.put(record));
    },
    async listThreads() {
      const records = await withStore<ThreadRecord[]>('readonly', (store) => store.getAll());
      return records
        .map(({ id, title, updatedAt }) => ({ id, title, updatedAt }))
        .sort((a, b) => b.updatedAt - a.updatedAt);
    },
    async deleteThread(threadId) {
      await withStore('readwrite', (store) => store.delete(threadId));
    },
  };
}
