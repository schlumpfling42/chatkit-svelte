import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import TestHarness from './TestHarness.svelte';
import { createFixtureTransport } from '@chatkit-svelte/core';
import type { ChatEvent } from '@chatkit-svelte/core';

describe('ChatWindow (via ChatProvider)', () => {
  it('renders streamed assistant messages', async () => {
    const events: ChatEvent[] = [
      { type: 'RUN_STARTED', runId: 'r1', threadId: 't1' },
      { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'Hello' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: ', world!' },
      { type: 'TEXT_MESSAGE_END', messageId: 'm1' },
      { type: 'RUN_FINISHED', runId: 'r1' },
    ];
    const transport = createFixtureTransport(events);
    render(TestHarness, { config: { transport, threadId: 't1' } });

    await waitFor(() => {
      expect(screen.getByText('Hello, world!')).toBeInTheDocument();
    });
  });

  it('sends a message when the composer form is submitted and shows it in the list', async () => {
    const transport = createFixtureTransport([]);
    render(TestHarness, { config: { transport, threadId: 't1' } });

    const input = screen.getByLabelText('Message') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'hi there' } });
    await fireEvent.submit(input.closest('form')!);

    await waitFor(() => {
      expect(screen.getByText('hi there')).toBeInTheDocument();
    });
    expect(input.value).toBe('');
    expect(transport.recorder.runs).toHaveLength(1);
  });

  it('merges a passed class prop with the internal root class', () => {
    const transport = createFixtureTransport([]);
    render(TestHarness, { config: { transport, threadId: 't1' }, class: 'custom-window' });

    const root = document.querySelector('.ck-chat-window')!;
    expect(root.className).toContain('ck-chat-window');
    expect(root.className).toContain('custom-window');
  });

  it('sets dir="rtl" on the root element for an RTL locale', () => {
    const transport = createFixtureTransport([]);
    render(TestHarness, { config: { transport, threadId: 't1', i18n: { locale: 'ar', messages: {} } } });

    expect(document.querySelector('.ck-chat-window')).toHaveAttribute('dir', 'rtl');
  });
});
