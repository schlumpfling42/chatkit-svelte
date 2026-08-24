import { describe, expect, it } from 'vitest';

describe('POST /api/agent/tool-results', () => {
  it('returns 200 ok', async () => {
    const { POST } = await import('../../src/routes/api/agent/tool-results/+server');
    const response = await POST!({} as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});
