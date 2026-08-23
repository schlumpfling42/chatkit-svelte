import { describe, expect, it } from 'vitest';
import { exportFixture } from '../src/export-fixture';
import type { ChatEvent } from '@chatkit/core';

describe('exportFixture', () => {
  it("serializes the event log as pretty-printed JSON matching createFixtureTransport's expected input shape", () => {
    const events: ChatEvent[] = [
      { type: 'RUN_STARTED', runId: 'r1', threadId: 't1' },
      { type: 'RUN_FINISHED', runId: 'r1' },
    ];
    const json = exportFixture(events);
    expect(JSON.parse(json)).toEqual(events);
    expect(json).toContain('\n'); // pretty-printed, not minified
  });
});
