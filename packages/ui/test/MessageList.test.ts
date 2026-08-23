import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import MessageListHarness from './MessageListHarness.svelte';
import CustomTextRenderer from './test-fixtures/CustomTextRenderer.svelte';
import CustomToolRenderer from './test-fixtures/CustomToolRenderer.svelte';
import { createFixtureTransport } from '@chatkit-svelte/core';
import type { ChatEvent, ChatPlugin } from '@chatkit-svelte/core';

describe('MessageList — registry-aware rendering', () => {
  it('renders text via the built-in <p> when no plugin registers a text renderer', async () => {
    const events: ChatEvent[] = [
      { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'hello' },
      { type: 'TEXT_MESSAGE_END', messageId: 'm1' },
    ];
    const transport = createFixtureTransport(events);
    render(MessageListHarness, { config: { transport, threadId: 't1' } });

    await waitFor(() => {
      const p = screen.getByText('hello');
      expect(p.tagName).toBe('P');
    });
  });

  it('prefers a registered messageRenderer over the built-in text fallback', async () => {
    const events: ChatEvent[] = [
      { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'hello' },
      { type: 'TEXT_MESSAGE_END', messageId: 'm1' },
    ];
    const transport = createFixtureTransport(events);
    const plugin: ChatPlugin = {
      name: 'custom-text',
      version: '1.0.0',
      messageRenderers: [{ partType: 'text', component: CustomTextRenderer, priority: 10 }],
    };
    render(MessageListHarness, { config: { transport, threadId: 't1', plugins: [plugin] } });

    await waitFor(() => {
      expect(screen.getByTestId('custom-text')).toHaveTextContent('CUSTOM: hello');
    });
  });

  it('renders a minimal built-in fallback for tool calls when no toolRenderer is registered', async () => {
    const events: ChatEvent[] = [
      { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' },
      { type: 'TOOL_CALL_START', toolCallId: 'tc1', toolName: 'search', parentMessageId: 'm1' },
      { type: 'TOOL_CALL_END', toolCallId: 'tc1' },
    ];
    const transport = createFixtureTransport(events);
    render(MessageListHarness, { config: { transport, threadId: 't1' } });

    await waitFor(() => {
      expect(screen.getByTestId('tool-fallback')).toHaveTextContent('Tool call: search (pending_execution)');
    });
  });

  it('prefers a registered wildcard toolRenderer over the built-in fallback', async () => {
    const events: ChatEvent[] = [
      { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' },
      { type: 'TOOL_CALL_START', toolCallId: 'tc1', toolName: 'search', parentMessageId: 'm1' },
      { type: 'TOOL_CALL_END', toolCallId: 'tc1' },
    ];
    const transport = createFixtureTransport(events);
    const plugin: ChatPlugin = {
      name: 'custom-tool',
      version: '1.0.0',
      toolRenderers: { '*': CustomToolRenderer },
    };
    render(MessageListHarness, { config: { transport, threadId: 't1', plugins: [plugin] } });

    await waitFor(() => {
      expect(screen.getByTestId('custom-tool')).toHaveTextContent('CUSTOM TOOL: search');
    });
  });

  it('silently skips a content-part type with no built-in case and no registered renderer', async () => {
    const events: ChatEvent[] = [
      {
        type: 'MESSAGES_SNAPSHOT',
        messages: [
          {
            id: 'm1',
            role: 'assistant',
            createdAt: 0,
            streaming: false,
            parts: [{ type: 'custom', name: 'x', payload: {} }],
          },
        ],
      },
    ];
    const transport = createFixtureTransport(events);
    render(MessageListHarness, { config: { transport, threadId: 't1' } });

    await waitFor(() => {
      expect(screen.getByTestId('message')).toBeInTheDocument();
    });
    // Svelte leaves internal comment-node block markers even when nothing
    // visible renders, so check for absent text content rather than using
    // toBeEmptyDOMElement() (which doesn't ignore comment nodes).
    expect(screen.getByTestId('message').textContent).toBe('');
  });

  it('merges a passed class prop with the internal root class', async () => {
    const transport = createFixtureTransport([]);
    render(MessageListHarness, { config: { transport, threadId: 't1' }, class: 'custom-list' });

    const root = document.querySelector('.ck-message-list')!;
    expect(root.className).toContain('ck-message-list');
    expect(root.className).toContain('custom-list');
  });

  it('does not update the live announcer until 600ms after the last streamed delta', async () => {
    vi.useFakeTimers();
    const events: ChatEvent[] = [
      { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'Hello' },
    ];
    const transport = createFixtureTransport(events, { delayMs: 0 });
    render(MessageListHarness, { config: { transport, threadId: 't1' } });

    await vi.advanceTimersByTimeAsync(50);
    expect(screen.getByTestId('live-announcer')).toHaveTextContent('');

    await vi.advanceTimersByTimeAsync(600);
    expect(screen.getByTestId('live-announcer')).toHaveTextContent('Hello');

    vi.useRealTimers();
  });

  it('announces immediately on TEXT_MESSAGE_END without waiting for the debounce', async () => {
    const events: ChatEvent[] = [
      { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'Done' },
      { type: 'TEXT_MESSAGE_END', messageId: 'm1' },
    ];
    const transport = createFixtureTransport(events);
    render(MessageListHarness, { config: { transport, threadId: 't1' } });

    await waitFor(() => {
      expect(screen.getByTestId('live-announcer')).toHaveTextContent('Done');
    });
  });
});
