import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import ChatProviderHarness from './ChatProviderHarness.svelte';
import OrphanProbe from './OrphanProbe.svelte';
import { createFixtureTransport } from '@chatkit/core';
import type { ChatEvent } from '@chatkit/core';

describe('ChatProvider', () => {
  it('makes the chat store available to descendants via context', async () => {
    const events: ChatEvent[] = [
      { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'hi' },
      { type: 'TEXT_MESSAGE_END', messageId: 'm1' },
    ];
    const transport = createFixtureTransport(events);
    render(ChatProviderHarness, { config: { transport, threadId: 't1' } });

    await waitFor(() => {
      expect(screen.getByTestId('message-count')).toHaveTextContent('1');
    });
  });

  it('disposes the store when the provider unmounts', async () => {
    const transport = createFixtureTransport([]);
    const disposeSpy = vi.spyOn(transport, 'dispose');
    const { unmount } = render(ChatProviderHarness, { config: { transport, threadId: 't1' } });

    unmount();

    expect(disposeSpy).toHaveBeenCalledOnce();
  });
});

describe('getChatContext', () => {
  it('throws when called outside a ChatProvider', () => {
    expect(() => render(OrphanProbe)).toThrow('[chatkit] getChatContext() must be called within a <ChatProvider>');
  });
});
