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
});
