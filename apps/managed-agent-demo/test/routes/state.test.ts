import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/agent-sessions', () => ({
  getCurrentState: (threadId: string) => ({ threadId, count: 3 }),
}));

describe('GET /api/agent/threads/[id]/state', () => {
  it('returns the current state snapshot for the thread', async () => {
    const { GET } = await import('../../src/routes/api/agent/threads/[id]/state/+server');
    const response = await GET({ params: { id: 't1' } } as never);
    expect(await response.json()).toEqual({ threadId: 't1', count: 3 });
  });
});
