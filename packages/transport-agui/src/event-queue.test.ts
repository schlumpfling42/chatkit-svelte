import { describe, expect, it } from 'vitest';
import { BoundedEventQueue } from './event-queue';
import type { ChatEvent } from '@chatkit/core';

describe('BoundedEventQueue', () => {
  it('enqueues events in order under capacity', () => {
    const queue = new BoundedEventQueue(10);
    queue.push({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' });
    queue.push({ type: 'RUN_FINISHED', runId: 'r1' });
    expect(queue.size).toBe(2);
    expect(queue.shift()).toEqual({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' });
    expect(queue.shift()).toEqual({ type: 'RUN_FINISHED', runId: 'r1' });
    expect(queue.shift()).toBeUndefined();
  });

  it('coalesces TEXT_MESSAGE_CONTENT deltas for the same messageId once at capacity', () => {
    const queue = new BoundedEventQueue(1);
    queue.push({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'Hello' });
    queue.push({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: ', world!' });
    expect(queue.size).toBe(1);
    expect(queue.shift()).toEqual({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'Hello, world!' });
  });

  it('coalesces TOOL_CALL_ARGS deltas for the same toolCallId once at capacity', () => {
    const queue = new BoundedEventQueue(1);
    queue.push({ type: 'TOOL_CALL_ARGS', toolCallId: 'tc1', delta: '{"a":' });
    queue.push({ type: 'TOOL_CALL_ARGS', toolCallId: 'tc1', delta: '1}' });
    expect(queue.size).toBe(1);
    expect(queue.shift()).toEqual({ type: 'TOOL_CALL_ARGS', toolCallId: 'tc1', delta: '{"a":1}' });
  });

  it('coalesces REASONING_CONTENT deltas, keeping the latest encrypted flag', () => {
    const queue = new BoundedEventQueue(1);
    queue.push({ type: 'REASONING_CONTENT', messageId: 'r1', delta: 'foo', encrypted: false });
    queue.push({ type: 'REASONING_CONTENT', messageId: 'r1', delta: 'bar', encrypted: true });
    expect(queue.shift()).toEqual({ type: 'REASONING_CONTENT', messageId: 'r1', delta: 'foobar', encrypted: true });
  });

  it('does not coalesce across different messageIds even at capacity', () => {
    const queue = new BoundedEventQueue(1);
    queue.push({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'Hello' });
    queue.push({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm2', delta: 'World' });
    expect(queue.size).toBe(2);
  });

  it('finds the correct coalescing target when multiple keys are interleaved in the queue', () => {
    const queue = new BoundedEventQueue(2);
    queue.push({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'A' });
    queue.push({ type: 'TOOL_CALL_ARGS', toolCallId: 'tc1', delta: '{' });
    queue.push({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'B' });
    expect(queue.size).toBe(2);
    expect(queue.shift()).toEqual({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'AB' });
    expect(queue.shift()).toEqual({ type: 'TOOL_CALL_ARGS', toolCallId: 'tc1', delta: '{' });
  });

  it('always enqueues non-coalescable (structural) events even at capacity', () => {
    const queue = new BoundedEventQueue(1);
    queue.push({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'A' });
    queue.push({ type: 'RUN_FINISHED', runId: 'r1' });
    expect(queue.size).toBe(2);
  });

  it('drain() empties the queue and returns everything in order', () => {
    const queue = new BoundedEventQueue(10);
    const events: ChatEvent[] = [
      { type: 'RUN_STARTED', runId: 'r1', threadId: 't1' },
      { type: 'RUN_FINISHED', runId: 'r1' },
    ];
    events.forEach((e) => queue.push(e));
    expect(queue.drain()).toEqual(events);
    expect(queue.size).toBe(0);
  });
});
