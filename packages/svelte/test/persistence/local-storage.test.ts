import { describe, expect, it, vi, beforeEach } from 'vitest';
import { localStoragePersistence } from '../../src/persistence/local-storage';
import { initialState } from '@chatkit-svelte/core';
import type { ChatState, Message } from '@chatkit-svelte/core';

function userMessage(text: string): Message {
  return { id: 'm1', role: 'user', parts: [{ type: 'text', text }], createdAt: 0, streaming: false };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('localStoragePersistence', () => {
  it('round-trips a saved thread', async () => {
    const adapter = localStoragePersistence();
    const state: ChatState = { ...initialState(), messages: [userMessage('hi')] };
    await adapter.saveThread('t1', state);
    expect(await adapter.loadThread('t1')).toEqual(state);
  });

  it('returns null for a thread never saved', async () => {
    const adapter = localStoragePersistence();
    expect(await adapter.loadThread('missing')).toBeNull();
  });

  it('tracks saved threads in listThreads with derived titles, newest first', async () => {
    const adapter = localStoragePersistence();
    await adapter.saveThread('t1', { ...initialState(), messages: [userMessage('first')] });
    await new Promise((r) => setTimeout(r, 5));
    await adapter.saveThread('t2', { ...initialState(), messages: [userMessage('second')] });
    const threads = await adapter.listThreads();
    expect(threads.map((t) => t.id)).toEqual(['t2', 't1']);
  });

  it('deleteThread removes the thread and its index entry', async () => {
    const adapter = localStoragePersistence();
    await adapter.saveThread('t1', initialState());
    await adapter.deleteThread('t1');
    expect(await adapter.loadThread('t1')).toBeNull();
    expect(await adapter.listThreads()).toEqual([]);
  });

  it('warns when a thread exceeds the configured byte threshold', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const adapter = localStoragePersistence({ warnAboveBytes: 10 });
    await adapter.saveThread('t1', { ...initialState(), messages: [userMessage('this is definitely over ten bytes')] });
    expect(warnSpy).toHaveBeenCalledOnce();
    warnSpy.mockRestore();
  });
});
