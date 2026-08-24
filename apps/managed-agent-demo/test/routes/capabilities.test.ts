import { describe, expect, it } from 'vitest';

describe('GET /api/agent/capabilities', () => {
  it('returns the static capabilities payload', async () => {
    const { GET } = await import('../../src/routes/api/agent/capabilities/+server');
    const response = await GET!({} as never);
    expect(await response.json()).toEqual({
      transports: ['sse'],
      tools: [],
      multimodal: false,
      reasoning: true,
      humanInTheLoop: false,
      sharedStateWritable: false,
    });
  });
});
