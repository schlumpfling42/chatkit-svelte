import { describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { indexedDbPersistence } from '../../src/persistence/indexed-db';
import { initialState } from '@chatkit/core';
import type { ChatState, Message } from '@chatkit/core';

function userMessage(text: string): Message {
  return { id: 'm1', role: 'user', parts: [{ type: 'text', text }], createdAt: 0, streaming: false };
}

describe('indexedDbPersistence', () => {
  it('round-trips a saved thread', async () => {
    const adapter = indexedDbPersistence({ dbName: `test-${Math.random()}` });
    const state: ChatState = { ...initialState(), messages: [userMessage('hi')] };
    await adapter.saveThread('t1', state);
    expect(await adapter.loadThread('t1')).toEqual(state);
  });

  it('returns null for a thread never saved', async () => {
    const adapter = indexedDbPersistence({ dbName: `test-${Math.random()}` });
    expect(await adapter.loadThread('missing')).toBeNull();
  });

  it('tracks saved threads in listThreads with derived titles', async () => {
    const adapter = indexedDbPersistence({ dbName: `test-${Math.random()}` });
    await adapter.saveThread('t1', { ...initialState(), messages: [userMessage('first thread')] });
    const threads = await adapter.listThreads();
    expect(threads).toEqual([expect.objectContaining({ id: 't1', title: 'first thread' })]);
  });

  it('deleteThread removes the thread', async () => {
    const adapter = indexedDbPersistence({ dbName: `test-${Math.random()}` });
    await adapter.saveThread('t1', initialState());
    await adapter.deleteThread('t1');
    expect(await adapter.loadThread('t1')).toBeNull();
  });
});
