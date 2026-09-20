import { afterEach, describe, expect, it, vi } from 'vitest';
import { deleteThread, forgetLastThread, lastThread, listThreads, newThreadId, rememberThread, threadPath } from '../src/lib/threads';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function stubStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  });
  return data;
}

describe('listThreads', () => {
  it('returns what the gateway lists', async () => {
    const fetchMock = stubFetch(200, { threads: [{ id: 'a', title: 'first', updatedAt: 2, messageCount: 4 }] });

    const result = await listThreads();

    expect(fetchMock).toHaveBeenCalledWith('/api/agent/threads');
    expect(result).toEqual({ available: true, threads: [{ id: 'a', title: 'first', updatedAt: 2, messageCount: 4 }] });
  });

  it('says the list is unavailable when the server has no such endpoint (the demo running its own engine)', async () => {
    stubFetch(404, '<html>not found</html>');

    expect(await listThreads()).toEqual({ available: false, threads: [] });
  });

  it('says the list is unavailable, not that it is empty, when the gateway cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('network down'))));

    expect(await listThreads()).toEqual({ available: false, threads: [] });
  });

  it('ignores rows that are not conversations', async () => {
    stubFetch(200, { threads: [{ id: 'a', title: 'ok', updatedAt: 1, messageCount: 2 }, { nope: true }, null, { id: 5 }] });

    const { threads } = await listThreads();

    expect(threads.map((t) => t.id)).toEqual(['a']);
  });
});

describe('deleteThread', () => {
  it('asks the gateway to forget the conversation', async () => {
    const fetchMock = stubFetch(200, { ok: true });

    expect(await deleteThread('a b/c')).toBe(true);

    expect(fetchMock).toHaveBeenCalledWith('/api/agent/threads/a%20b%2Fc', { method: 'DELETE' });
  });

  it('reports a refusal', async () => {
    stubFetch(404, { error: { code: 'unknown_thread' } });

    expect(await deleteThread('nope')).toBe(false);
  });
});

describe('remembering the last conversation', () => {
  it('opens the conversation that was open last', () => {
    stubStorage();
    rememberThread('abc');

    expect(lastThread()).toBe('abc');
  });

  it('forgets it when that conversation is deleted', () => {
    stubStorage();
    rememberThread('abc');

    forgetLastThread('other');
    expect(lastThread()).toBe('abc');
    forgetLastThread('abc');
    expect(lastThread()).toBeNull();
  });

  it('works without storage (private windows, blocked site data)', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    });

    expect(() => rememberThread('abc')).not.toThrow();
    expect(lastThread()).toBeNull();
    expect(() => forgetLastThread('abc')).not.toThrow();
  });
});

describe('ids and links', () => {
  it('makes an id nobody else has, and one that is safe to put in a path', () => {
    const a = newThreadId();
    const b = newThreadId();

    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('puts the id in the address, escaped', () => {
    expect(threadPath('abc')).toBe('/c/abc');
    expect(threadPath('a b/c')).toBe('/c/a%20b%2Fc');
  });
});
