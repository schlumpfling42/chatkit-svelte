import { describe, expect, it } from 'vitest';
import { toVercelMessages } from './to-vercel-messages';
import type { Message } from '@chatkit-svelte/core';

describe('toVercelMessages', () => {
  it('concatenates text parts into a single content string per message', () => {
    const messages: Message[] = [
      {
        id: 'm1',
        role: 'user',
        parts: [{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'world' }],
        createdAt: 0,
        streaming: false,
      },
    ];
    expect(toVercelMessages(messages)).toEqual([{ role: 'user', content: 'Hello world' }]);
  });

  it('drops non-text parts and still includes the message with just its text content', () => {
    const messages: Message[] = [
      {
        id: 'm1',
        role: 'user',
        parts: [{ type: 'text', text: 'see attached' }, { type: 'file', url: 'x', name: 'y', mimeType: 'text/plain' }],
        createdAt: 0,
        streaming: false,
      },
    ];
    expect(toVercelMessages(messages)).toEqual([{ role: 'user', content: 'see attached' }]);
  });

  it('maps an empty-text message to an empty content string rather than omitting it', () => {
    const messages: Message[] = [
      { id: 'm1', role: 'user', parts: [{ type: 'file', url: 'x', name: 'y', mimeType: 'text/plain' }], createdAt: 0, streaming: false },
    ];
    expect(toVercelMessages(messages)).toEqual([{ role: 'user', content: '' }]);
  });
});
