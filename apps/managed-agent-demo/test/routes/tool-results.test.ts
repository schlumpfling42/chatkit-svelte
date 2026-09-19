import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ToolResult } from '@chatkit-svelte/core';

const mockFindSessionByToolCallId = vi.fn();
const mockSendToolResult = vi.fn();
vi.mock('../../src/lib/agent-sessions', () => ({
  findSessionByToolCallId: mockFindSessionByToolCallId,
  sendToolResult: mockSendToolResult,
}));

describe('POST /api/agent/tool-results', () => {
  beforeEach(() => vi.clearAllMocks());

  it('recovers the owning thread from the tool call id and sends the result', async () => {
    mockFindSessionByToolCallId.mockReturnValue({ threadId: 't1', session: {} });
    const { POST } = await import('../../src/routes/api/agent/tool-results/+server');
    const toolResult: ToolResult = { toolCallId: 'tc1', result: { feedback: 'great' } };
    const request = new Request('http://localhost/api/agent/tool-results', {
      method: 'POST',
      body: JSON.stringify(toolResult),
    });

    const response = await POST({ request } as never);

    expect(response.status).toBe(202);
    expect(mockFindSessionByToolCallId).toHaveBeenCalledWith('tc1');
    expect(mockSendToolResult).toHaveBeenCalledWith('t1', 'tc1', { feedback: 'great' });
  });

  it('404s when no thread owns the given tool call id', async () => {
    mockFindSessionByToolCallId.mockReturnValue(undefined);
    const { POST } = await import('../../src/routes/api/agent/tool-results/+server');
    const toolResult: ToolResult = { toolCallId: 'unknown', result: {} };
    const request = new Request('http://localhost/api/agent/tool-results', {
      method: 'POST',
      body: JSON.stringify(toolResult),
    });

    await expect(POST({ request } as never)).rejects.toMatchObject({ status: 404 });
    expect(mockSendToolResult).not.toHaveBeenCalled();
  });
});
