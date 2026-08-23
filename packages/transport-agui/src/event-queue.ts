import type { ChatEvent } from '@chatkit/core';

function coalesceKey(event: ChatEvent): string | undefined {
  switch (event.type) {
    case 'TEXT_MESSAGE_CONTENT':
      return `TEXT_MESSAGE_CONTENT:${event.messageId}`;
    case 'REASONING_CONTENT':
      return `REASONING_CONTENT:${event.messageId}`;
    case 'TOOL_CALL_ARGS':
      return `TOOL_CALL_ARGS:${event.toolCallId}`;
    default:
      return undefined;
  }
}

function mergeCoalescable(existing: ChatEvent, incoming: ChatEvent): ChatEvent {
  if (existing.type === 'TEXT_MESSAGE_CONTENT' && incoming.type === 'TEXT_MESSAGE_CONTENT') {
    return { ...existing, delta: existing.delta + incoming.delta };
  }
  if (existing.type === 'REASONING_CONTENT' && incoming.type === 'REASONING_CONTENT') {
    return { ...existing, delta: existing.delta + incoming.delta, encrypted: incoming.encrypted };
  }
  if (existing.type === 'TOOL_CALL_ARGS' && incoming.type === 'TOOL_CALL_ARGS') {
    return { ...existing, delta: existing.delta + incoming.delta };
  }
  return incoming;
}

/**
 * A FIFO queue of ChatEvents with a soft capacity: once at capacity, a new
 * *coalescable* event (TEXT_MESSAGE_CONTENT / REASONING_CONTENT /
 * TOOL_CALL_ARGS) that shares a key (messageId/toolCallId) with an
 * already-queued event of the same type is merged into that entry instead of
 * growing the queue. Non-coalescable events (lifecycle, START/END/RESULT,
 * or a coalescable type with no existing match) always enqueue normally —
 * capacity bounds runaway delta streams, it does not drop structurally
 * necessary events.
 */
export class BoundedEventQueue {
  private items: ChatEvent[] = [];

  constructor(private readonly capacity: number = 500) {}

  get size(): number {
    return this.items.length;
  }

  push(event: ChatEvent): void {
    const key = coalesceKey(event);
    if (this.items.length >= this.capacity && key !== undefined) {
      for (let i = this.items.length - 1; i >= 0; i--) {
        if (coalesceKey(this.items[i]) === key) {
          this.items[i] = mergeCoalescable(this.items[i], event);
          return;
        }
      }
    }
    this.items.push(event);
  }

  shift(): ChatEvent | undefined {
    return this.items.shift();
  }

  drain(): ChatEvent[] {
    const drained = this.items;
    this.items = [];
    return drained;
  }
}
