import { describe, expect, it } from 'vitest';
import { deriveTitle, memoryPersistence } from './persistence';
import { initialState } from './reducer';
import type { ChatState, Message } from './types';

function userMessage(text: string): Message {
  return { id: 'm1', role: 'user', parts: [{ type: 'text', text }], createdAt: 0, streaming: false };
}

describe('deriveTitle', () => {
  it('returns "New thread" when there is no user message yet', () => {
    expect(deriveTitle(initialState())).toBe('New thread');
  });

  it('uses the first user message text as the title', () => {
    const state: ChatState = { ...initialState(), messages: [userMessage('Book me a flight to Tokyo')] };
    expect(deriveTitle(state)).toBe('Book me a flight to Tokyo');
  });

  it('truncates a long first message to 60 characters with an ellipsis', () => {
    const long = 'x'.repeat(80);
    const state: ChatState = { ...initialState(), messages: [userMessage(long)] };
    expect(deriveTitle(state)).toBe(`${'x'.repeat(60)}…`);
  });
});

describe('memoryPersistence', () => {
  it('round-trips a saved thread through loadThread', async () => {
    const adapter = memoryPersistence();
    const state: ChatState = { ...initialState(), messages: [userMessage('hi')] };
    await adapter.saveThread('t1', state);
    expect(await adapter.loadThread('t1')).toEqual(state);
  });

  it('returns null for a thread that was never saved', async () => {
    const adapter = memoryPersistence();
    expect(await adapter.loadThread('missing')).toBeNull();
  });

  it('listThreads reflects saved threads with a derived title', async () => {
    const adapter = memoryPersistence();
    await adapter.saveThread('t1', { ...initialState(), messages: [userMessage('Plan my trip')] });
    const threads = await adapter.listThreads();
    expect(threads).toEqual([expect.objectContaining({ id: 't1', title: 'Plan my trip' })]);
  });

  it('deleteThread removes a thread from both loadThread and listThreads', async () => {
    const adapter = memoryPersistence();
    await adapter.saveThread('t1', initialState());
    await adapter.deleteThread('t1');
    expect(await adapter.loadThread('t1')).toBeNull();
    expect(await adapter.listThreads()).toEqual([]);
  });
});
