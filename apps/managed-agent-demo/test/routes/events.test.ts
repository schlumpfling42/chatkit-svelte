import { describe, expect, it, vi } from 'vitest';
import type { ChatEvent } from '@chatkit-svelte/core';

vi.mock('../../src/lib/agent-sessions', () => ({
  subscribeFromIndex: async function* (threadId: string, fromIndex: number) {
    const events: ChatEvent[] = [
      { type: 'RUN_STARTED', runId: 'run1', threadId },
      { type: 'RUN_FINISHED', runId: 'run1' },
    ];
    for (let i = fromIndex; i < events.length; i += 1) {
      yield { index: i, event: events[i] };
    }
  },
}));

describe('GET /api/agent/threads/[id]/events', () => {
  it('streams SSE frames with id and data fields', async () => {
    const { GET } = await import('../../src/routes/api/agent/threads/[id]/events/+server');
    const url = new URL('http://localhost/api/agent/threads/t1/events');
    const response = await GET({ params: { id: 't1' }, url } as never);

    expect(response.headers.get('Content-Type')).toBe('text/event-stream');

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    for (let i = 0; i < 2; i += 1) {
      const { value } = await reader.read();
      text += decoder.decode(value);
    }
    expect(text).toContain('id: 0\ndata: {"type":"RUN_STARTED","runId":"run1","threadId":"t1"}\n\n');
    expect(text).toContain('id: 1\ndata: {"type":"RUN_FINISHED","runId":"run1"}\n\n');
  });

  it('resumes from resumeToken + 1', async () => {
    const { GET } = await import('../../src/routes/api/agent/threads/[id]/events/+server');
    const url = new URL('http://localhost/api/agent/threads/t1/events?resumeToken=0');
    const response = await GET({ params: { id: 't1' }, url } as never);

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const { value } = await reader.read();
    const text = decoder.decode(value);
    expect(text).toBe('id: 1\ndata: {"type":"RUN_FINISHED","runId":"run1"}\n\n');
  });
});
