import { createDevtoolsLog, type DevtoolsLog } from './log.svelte';
import type { ChatPlugin } from '@chatkit-svelte/core';

export interface DevtoolsPlugin extends ChatPlugin {
  log: DevtoolsLog;
}

// Not auto-wired into <ChatWindow> — devtools is a developer tool a
// consumer mounts deliberately (e.g. behind a debug flag), unlike
// ApprovalBar/ArtifactPanel which are part of the end-user chat surface.
// See the M7 plan's decision 6.
export function devtoolsPlugin(): DevtoolsPlugin {
  const log = createDevtoolsLog();
  return {
    name: 'devtools',
    version: '1.0.0',
    hooks: {
      onEvent: (event) => log.record(event),
    },
    log,
  };
}

export { default as DevtoolsOverlay } from './DevtoolsOverlay.svelte';
export { createDevtoolsLog } from './log.svelte';
export type { DevtoolsLog } from './log.svelte';
export { exportFixture } from './export-fixture';
