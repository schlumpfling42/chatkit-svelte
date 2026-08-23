import type { ChatEvent } from '@chatkit-svelte/core';

export interface DevtoolsLog {
  readonly events: ChatEvent[];
  record(event: ChatEvent): void;
  clear(): void;
}

export function createDevtoolsLog(): DevtoolsLog {
  let events: ChatEvent[] = $state([]);

  return {
    get events() {
      return events;
    },
    record(event: ChatEvent) {
      events = [...events, event];
    },
    clear() {
      events = [];
    },
  };
}
