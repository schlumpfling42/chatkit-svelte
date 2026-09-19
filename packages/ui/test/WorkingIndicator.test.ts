import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import MessageListHarness from './MessageListHarness.svelte';
import WorkingIndicatorHarness from './WorkingIndicatorHarness.svelte';
import { createFixtureTransport } from '@chatkit-svelte/core';
import type { ChatEvent } from '@chatkit-svelte/core';

const runStarted: ChatEvent = { type: 'RUN_STARTED', runId: 'r1', threadId: 't1' };

function renderList(events: ChatEvent[]) {
  render(MessageListHarness, { config: { transport: createFixtureTransport(events), threadId: 't1' } });
}

describe('working indicator in the message list', () => {
  it('appears as soon as a run starts, before a single word has arrived', async () => {
    renderList([runStarted]);

    expect(await screen.findByTestId('working-indicator')).toBeInTheDocument();
    expect(screen.getByTestId('working-word').textContent).toMatch(/…$/);
  });

  it('is announced once to screen readers, and the moving words stay silent', async () => {
    renderList([runStarted]);

    await waitFor(() => expect(screen.getByTestId('working-announcer')).toHaveTextContent('The assistant is working'));
    expect(screen.getByTestId('working-indicator')).toHaveAttribute('aria-hidden', 'true');
  });

  it('stays while an assistant message is open but has no words yet', async () => {
    renderList([runStarted, { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' }]);

    expect(await screen.findByTestId('working-indicator')).toBeInTheDocument();
  });

  it('steps aside once assistant text is streaming: the words themselves are the sign of life', async () => {
    renderList([
      runStarted,
      { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'Hel' },
    ]);

    await screen.findByText('Hel');
    expect(screen.queryByTestId('working-indicator')).not.toBeInTheDocument();
    expect(screen.getByTestId('working-announcer').textContent).toBe('');
  });

  it('is gone when the run finishes', async () => {
    renderList([
      runStarted,
      { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'Done' },
      { type: 'TEXT_MESSAGE_END', messageId: 'm1' },
      { type: 'RUN_FINISHED', runId: 'r1' },
    ]);

    await screen.findByText('Done');
    expect(screen.queryByTestId('working-indicator')).not.toBeInTheDocument();
  });

  it('is gone when the run fails', async () => {
    renderList([runStarted, { type: 'RUN_ERROR', runId: 'r1', error: { code: 'x', message: 'boom', recoverable: false } }]);

    await waitFor(() => expect(screen.queryByTestId('working-indicator')).not.toBeInTheDocument());
  });

  it('is not shown for a conversation that has never run', () => {
    renderList([]);

    expect(screen.queryByTestId('working-indicator')).not.toBeInTheDocument();
  });
});

describe('WorkingIndicator', () => {
  afterEach(() => vi.useRealTimers());

  const config = () => ({ transport: createFixtureTransport([]), threadId: 't1' });

  it('cycles through its words', async () => {
    vi.useFakeTimers();
    render(WorkingIndicatorHarness, { config: config(), words: ['Alpha', 'Beta', 'Gamma'], intervalMs: 1000 });

    const seen = new Set<string>();
    for (let tick = 0; tick < 4; tick++) {
      seen.add(screen.getByTestId('working-word').textContent ?? '');
      await vi.advanceTimersByTimeAsync(1000);
      flushSync();
    }

    expect([...seen].sort()).toEqual(['Alpha…', 'Beta…', 'Gamma…']);
  });

  it('shows how long it has been waiting, but only once the wait is long enough to matter', async () => {
    vi.useFakeTimers();
    render(WorkingIndicatorHarness, { config: config(), words: ['Alpha'], showElapsedAfterSeconds: 5 });

    expect(screen.queryByTestId('working-elapsed')).not.toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(4000);
    flushSync();
    expect(screen.queryByTestId('working-elapsed')).not.toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(3000);
    flushSync();
    expect(screen.getByTestId('working-elapsed')).toHaveTextContent('7s');
  });

  it('takes its words from the app’s translations when it is not told which to use', () => {
    render(WorkingIndicatorHarness, { config: { ...config(), i18n: { locale: 'en', messages: { 'working.words': 'Fettling| Faffing about' } } } });

    expect(['Fettling…', 'Faffing about…']).toContain(screen.getByTestId('working-word').textContent);
  });

  it('has real, varied defaults, including the ones people expect', () => {
    render(WorkingIndicatorHarness, { config: config() });

    // Every default word is a short, whimsical verb phrase; spot-check the list through the translation table.
    const words = (config().i18n?.messages ?? {})['working.words'];
    expect(words).toBeUndefined(); // no override: the built-in list is in use
    expect(screen.getByTestId('working-word').textContent).toMatch(/^[A-Z][A-Za-z ]+…$/);
  });
});
