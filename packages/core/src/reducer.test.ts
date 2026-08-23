import { describe, expect, it } from 'vitest';
import { initialState, reduceEvent } from './reducer';
import type { ChatEvent } from './types';

function run(events: ChatEvent[]) {
  return events.reduce(reduceEvent, initialState());
}

describe('reduceEvent — lifecycle', () => {
  it('tracks run status through started/finished', () => {
    const state = run([
      { type: 'RUN_STARTED', runId: 'r1', threadId: 't1' },
      { type: 'RUN_FINISHED', runId: 'r1' },
    ]);
    expect(state.runStatus).toBe('idle');
  });

  it('records a run error and status', () => {
    const state = run([
      { type: 'RUN_STARTED', runId: 'r1', threadId: 't1' },
      { type: 'RUN_ERROR', runId: 'r1', error: { code: 'BOOM', message: 'boom', recoverable: false } },
    ]);
    expect(state.runStatus).toBe('error');
    expect(state.error?.code).toBe('BOOM');
  });

  it('tracks step lifecycle', () => {
    const state = run([
      { type: 'STEP_STARTED', stepId: 's1', name: 'plan' },
      { type: 'STEP_FINISHED', stepId: 's1' },
    ]);
    expect(state.steps).toEqual([{ id: 's1', name: 'plan', status: 'finished', parentStepId: undefined }]);
  });
});

describe('reduceEvent — text messages', () => {
  it('streams text content into a single message', () => {
    const state = run([
      { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'Hello' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: ', world!' },
      { type: 'TEXT_MESSAGE_END', messageId: 'm1' },
    ]);
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].parts).toEqual([{ type: 'text', text: 'Hello, world!' }]);
    expect(state.messages[0].streaming).toBe(false);
  });
});

describe('reduceEvent — tool calls', () => {
  it('accumulates streamed arg fragments and parses them on end', () => {
    const state = run([
      { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' },
      { type: 'TOOL_CALL_START', toolCallId: 'tc1', toolName: 'search', parentMessageId: 'm1' },
      { type: 'TOOL_CALL_ARGS', toolCallId: 'tc1', delta: '{"query":' },
      { type: 'TOOL_CALL_ARGS', toolCallId: 'tc1', delta: '"svelte"}' },
      { type: 'TOOL_CALL_END', toolCallId: 'tc1' },
      { type: 'TOOL_CALL_RESULT', toolCallId: 'tc1', result: { hits: 3 } },
    ]);
    const toolCall = state.messages[0].parts.find((p) => p.type === 'tool_call');
    expect(toolCall).toMatchObject({
      toolCallId: 'tc1',
      args: { query: 'svelte' },
      status: 'complete',
      result: { hits: 3 },
    });
  });

  it('leaves unparseable args as the raw string', () => {
    const state = run([
      { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' },
      { type: 'TOOL_CALL_START', toolCallId: 'tc1', toolName: 'search', parentMessageId: 'm1' },
      { type: 'TOOL_CALL_ARGS', toolCallId: 'tc1', delta: 'not json' },
      { type: 'TOOL_CALL_END', toolCallId: 'tc1' },
    ]);
    const toolCall = state.messages[0].parts.find((p) => p.type === 'tool_call');
    expect(toolCall).toMatchObject({ args: 'not json', status: 'pending_execution' });
  });
});

describe('reduceEvent — reasoning', () => {
  it('streams reasoning text into its own message', () => {
    const state = run([
      { type: 'REASONING_START', messageId: 'r1' },
      { type: 'REASONING_CONTENT', messageId: 'r1', delta: 'thinking...' },
      { type: 'REASONING_END', messageId: 'r1' },
    ]);
    expect(state.messages[0].parts).toEqual([{ type: 'reasoning', text: 'thinking...', encrypted: undefined }]);
    expect(state.messages[0].streaming).toBe(false);
  });
});

describe('reduceEvent — shared state sync', () => {
  it('applies STATE_SNAPSHOT as a full replace', () => {
    const state = run([{ type: 'STATE_SNAPSHOT', snapshot: { count: 1 } }]);
    expect(state.sharedState).toEqual({ count: 1 });
  });

  it('applies a STATE_DELTA on top of the snapshot', () => {
    const state = run([
      { type: 'STATE_SNAPSHOT', snapshot: { count: 1 } },
      { type: 'STATE_DELTA', patch: [{ op: 'replace', path: '/count', value: 2 }] },
    ]);
    expect(state.sharedState).toEqual({ count: 2 });
  });

  it('surfaces a recoverable error and keeps last-known-good state when a delta fails to apply', () => {
    const state = run([
      { type: 'STATE_SNAPSHOT', snapshot: { count: 1 } },
      { type: 'STATE_DELTA', patch: [{ op: 'replace', path: '/missing', value: 2 }] },
    ]);
    expect(state.sharedState).toEqual({ count: 1 });
    expect(state.error).toEqual({ code: 'STATE_PATCH_CONFLICT', message: 'Failed to apply state patch', recoverable: true });
  });

  it('replaces the full message list on MESSAGES_SNAPSHOT', () => {
    const snapshotMessages = [{ id: 'm9', role: 'user' as const, parts: [], createdAt: 0, streaming: false }];
    const state = run([
      { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' },
      { type: 'MESSAGES_SNAPSHOT', messages: snapshotMessages },
    ]);
    expect(state.messages).toEqual(snapshotMessages);
  });
});

describe('reduceEvent — activities', () => {
  it('creates an activity on snapshot and updates it on delta', () => {
    const state = run([
      { type: 'ACTIVITY_SNAPSHOT', messageId: 'm1', data: { progress: 0 } },
      { type: 'ACTIVITY_DELTA', messageId: 'm1', patch: [{ op: 'replace', path: '/progress', value: 50 }] },
    ]);
    expect(state.activities).toEqual([{ id: 'm1', messageId: 'm1', kind: 'generic', data: { progress: 50 } }]);
  });
});

describe('reduceEvent — escape hatches', () => {
  it('treats CUSTOM and RAW events as no-ops in core', () => {
    const before = initialState();
    const afterCustom = reduceEvent(before, { type: 'CUSTOM', name: 'chatkit.form.snapshot', payload: {} });
    const afterRaw = reduceEvent(before, { type: 'RAW', payload: {} });
    expect(afterCustom).toBe(before);
    expect(afterRaw).toBe(before);
  });
});
