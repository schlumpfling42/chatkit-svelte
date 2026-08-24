import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockFindSessionByRunId = vi.fn();
const mockAbortRun = vi.fn();
vi.mock('../../src/lib/agent-sessions', () => ({
  findSessionByRunId: mockFindSessionByRunId,
  abortRun: mockAbortRun,
}));

describe('DELETE /api/agent/runs/[runId]', () => {
  beforeEach(() => vi.clearAllMocks());

  it('aborts the run when the runId is known', async () => {
    mockFindSessionByRunId.mockReturnValue({ threadId: 't1', session: {} });
    const { DELETE } = await import('../../src/routes/api/agent/runs/[runId]/+server');
    const response = await DELETE({ params: { runId: 'run1' } } as never);
    expect(response.status).toBe(200);
    expect(mockAbortRun).toHaveBeenCalledWith('t1');
  });

  it('404s when the runId is unknown', async () => {
    mockFindSessionByRunId.mockReturnValue(undefined);
    const { DELETE } = await import('../../src/routes/api/agent/runs/[runId]/+server');
    await expect(DELETE({ params: { runId: 'missing' } } as never)).rejects.toMatchObject({
      status: 404,
    });
  });
});
