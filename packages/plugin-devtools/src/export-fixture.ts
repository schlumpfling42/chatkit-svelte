import type { ChatEvent } from '@chatkit/core';

// Matches createFixtureTransport(events)'s expected input shape exactly —
// paste this file's output straight into a test as
// `createFixtureTransport(JSON.parse(fixtureJson))` (spec §13.4's "closes
// the loop between a bug seen in the playground and a regression test").
export function exportFixture(events: ChatEvent[]): string {
  return JSON.stringify(events, null, 2);
}
