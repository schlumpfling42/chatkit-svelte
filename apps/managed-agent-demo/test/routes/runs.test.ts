import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { RunAgentInput } from '@chatkit-svelte/core';

const mockStartRun = vi.fn();
vi.mock('../../src/lib/agent-sessions', () => ({
  startRun: mockStartRun,
}));

describe('POST /api/agent/runs', () => {
  beforeEach(() => vi.clearAllMocks());

  it('parses the body and starts a run', async () => {
    const { POST } = await import('../../src/routes/api/agent/runs/+server');
    const input: RunAgentInput = { threadId: 't1', runId: 'run1', messages: [], tools: [] };
    const request = new Request('http://localhost/api/agent/runs', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    const response = await POST({ request } as never);
    expect(response.status).toBe(202);
    expect(mockStartRun).toHaveBeenCalledWith('t1', input);
  });
});
