import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import TestHarness from './TestHarness.svelte';
import { createDevtoolsLog } from '../src/log.svelte';
import { createFixtureTransport } from '@chatkit-svelte/core';
import type { ChatEvent } from '@chatkit-svelte/core';

describe('DevtoolsOverlay', () => {
  it('renders one entry per logged event, in order', () => {
    const log = createDevtoolsLog();
    log.record({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' });
    log.record({ type: 'RUN_FINISHED', runId: 'r1' });
    const transport = createFixtureTransport([]);
    render(TestHarness, { config: { transport, threadId: 't1' }, log });

    const items = screen.getAllByTestId('devtools-event');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('RUN_STARTED');
    expect(items[1]).toHaveTextContent('RUN_FINISHED');
  });

  it('reflects events recorded after mount reactively', async () => {
    const log = createDevtoolsLog();
    const transport = createFixtureTransport([]);
    render(TestHarness, { config: { transport, threadId: 't1' }, log });

    expect(screen.queryAllByTestId('devtools-event')).toHaveLength(0);
    log.record({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' });

    await waitFor(() => {
      expect(screen.getAllByTestId('devtools-event')).toHaveLength(1);
    });
  });

  it('the Clear button empties the log', async () => {
    const log = createDevtoolsLog();
    log.record({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' });
    const transport = createFixtureTransport([]);
    render(TestHarness, { config: { transport, threadId: 't1' }, log });

    await fireEvent.click(screen.getByText('Clear'));

    expect(screen.queryAllByTestId('devtools-event')).toHaveLength(0);
  });

  it('the Export fixture button triggers a download of the current event log', async () => {
    const log = createDevtoolsLog();
    log.record({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' });
    const transport = createFixtureTransport([]);
    const createObjectURL = vi.fn(() => 'blob:fake');
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL: vi.fn() });

    render(TestHarness, { config: { transport, threadId: 't1' }, log });
    await fireEvent.click(screen.getByTestId('devtools-export'));

    expect(createObjectURL).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('shows the live current state from the store', async () => {
    const events: ChatEvent[] = [{ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' }];
    const transport = createFixtureTransport(events);
    const log = createDevtoolsLog();
    render(TestHarness, { config: { transport, threadId: 't1' }, log });

    await waitFor(() => {
      expect(screen.getByTestId('devtools-state')).toHaveTextContent('"running"');
    });
  });

  it('starts collapsed, and the toggle expands/collapses it without removing events from the DOM', async () => {
    const log = createDevtoolsLog();
    log.record({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' });
    const transport = createFixtureTransport([]);
    render(TestHarness, { config: { transport, threadId: 't1' }, log });

    const toggle = screen.getByTestId('devtools-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // Collapsed is a CSS state, not removal from the DOM -- existing
    // automation (this app's own live-verification scripts, the playground
    // e2e spec) queries devtools-event/devtools-state directly and must
    // keep working without needing to click expand first.
    expect(screen.getByTestId('devtools-event')).toBeInTheDocument();

    await fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('devtools-event')).toBeInTheDocument();

    await fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('truncates a very long string value (e.g. a base64 attachment) instead of dumping it in full', () => {
    const log = createDevtoolsLog();
    const hugeDataUri = `data:image/png;base64,${'A'.repeat(5000)}`;
    log.record({
      type: 'CUSTOM',
      name: 'chatkit.form.result',
      payload: { artifactId: 'a1', values: { photo: hugeDataUri } },
    });
    const transport = createFixtureTransport([]);
    render(TestHarness, { config: { transport, threadId: 't1' }, log });

    const eventText = screen.getByTestId('devtools-event').textContent ?? '';
    expect(eventText.length).toBeLessThan(hugeDataUri.length);
    expect(eventText).toContain('chars total');
    expect(eventText).not.toContain('A'.repeat(5000));
  });

  it('does not truncate ordinary short values', () => {
    const log = createDevtoolsLog();
    log.record({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' });
    const transport = createFixtureTransport([]);
    render(TestHarness, { config: { transport, threadId: 't1' }, log });

    expect(screen.getByTestId('devtools-event')).toHaveTextContent('"threadId": "t1"');
  });
});
