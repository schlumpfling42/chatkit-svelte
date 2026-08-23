import { describe, expect, it } from 'vitest';
import { createDevtoolsLog } from '../src/log.svelte';
import type { ChatEvent } from '@chatkit-svelte/core';

describe('createDevtoolsLog', () => {
  it('starts empty', () => {
    const log = createDevtoolsLog();
    expect(log.events).toEqual([]);
  });

  it('record() appends events in order', () => {
    const log = createDevtoolsLog();
    const a: ChatEvent = { type: 'RUN_STARTED', runId: 'r1', threadId: 't1' };
    const b: ChatEvent = { type: 'RUN_FINISHED', runId: 'r1' };
    log.record(a);
    log.record(b);
    expect(log.events).toEqual([a, b]);
  });

  it('clear() empties the log', () => {
    const log = createDevtoolsLog();
    log.record({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' });
    log.clear();
    expect(log.events).toEqual([]);
  });
});
