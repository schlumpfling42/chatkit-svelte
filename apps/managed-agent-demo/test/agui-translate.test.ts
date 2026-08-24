import { describe, expect, it } from 'vitest';
import type { Message } from '@chatkit-svelte/core';
import { toAguiMessages, fromAguiEvent } from '../src/lib/agui-translate';

describe('toAguiMessages', () => {
  it('translates a user text message', () => {
    const messages: Message[] = [
      { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hello' }], createdAt: 0, streaming: false },
    ];
    expect(toAguiMessages(messages)).toEqual([{ id: 'm1', role: 'user', content: 'hello' }]);
  });

  it('translates an assistant message with a tool call into content + toolCalls', () => {
    const messages: Message[] = [
      {
        id: 'm2',
        role: 'assistant',
        parts: [
          { type: 'text', text: 'checking...' },
          {
            type: 'tool_call',
            toolCallId: 'tc1',
            toolName: 'get_weather',
            args: { city: 'Boston' },
            status: 'complete',
          },
        ],
        createdAt: 0,
        streaming: false,
      },
    ];
    expect(toAguiMessages(messages)).toEqual([
      {
        id: 'm2',
        role: 'assistant',
        content: 'checking...',
        toolCalls: [{ id: 'tc1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Boston"}' } }],
      },
    ]);
  });

  it('translates a tool result message', () => {
    const messages: Message[] = [
      {
        id: 'm3',
        role: 'tool',
        parts: [
          {
            type: 'tool_call',
            toolCallId: 'tc1',
            toolName: 'get_weather',
            args: {},
            status: 'complete',
            result: { tempF: 52 },
          },
        ],
        createdAt: 0,
        streaming: false,
      },
    ];
    expect(toAguiMessages(messages)).toEqual([
      { id: 'm3', role: 'tool', toolCallId: 'tc1', content: '{"tempF":52}' },
    ]);
  });
});

describe('fromAguiEvent', () => {
  it('passes through RUN_STARTED', () => {
    expect(fromAguiEvent({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' }, 'r1')).toEqual({
      type: 'RUN_STARTED',
      runId: 'r1',
      threadId: 't1',
    });
  });

  it('maps STEP_STARTED (stepName only) into chatkit shape (stepId + name)', () => {
    expect(fromAguiEvent({ type: 'STEP_STARTED', stepName: 'thinking' }, 'r1')).toEqual({
      type: 'STEP_STARTED',
      stepId: 'thinking',
      name: 'thinking',
    });
  });

  it('maps TOOL_CALL_START field name toolCallName -> toolName', () => {
    expect(
      fromAguiEvent(
        { type: 'TOOL_CALL_START', toolCallId: 'tc1', toolCallName: 'get_weather', parentMessageId: 'm1' },
        'r1'
      )
    ).toEqual({ type: 'TOOL_CALL_START', toolCallId: 'tc1', toolName: 'get_weather', parentMessageId: 'm1' });
  });

  it('maps TOOL_CALL_RESULT content -> result', () => {
    expect(
      fromAguiEvent({ type: 'TOOL_CALL_RESULT', toolCallId: 'tc1', messageId: 'm1', content: '{"tempF":52}' }, 'r1')
    ).toEqual({ type: 'TOOL_CALL_RESULT', toolCallId: 'tc1', result: '{"tempF":52}' });
  });

  it('maps STATE_DELTA field name delta -> patch', () => {
    const patch = [{ op: 'replace', path: '/count', value: 2 }];
    expect(fromAguiEvent({ type: 'STATE_DELTA', delta: patch }, 'r1')).toEqual({ type: 'STATE_DELTA', patch });
  });

  it('maps RUN_ERROR (message/code) into chatkit ChatError shape, using the fallback runId', () => {
    expect(fromAguiEvent({ type: 'RUN_ERROR', message: 'boom', code: 'timeout' }, 'r1')).toEqual({
      type: 'RUN_ERROR',
      runId: 'r1',
      error: { code: 'timeout', message: 'boom', recoverable: false, raw: { type: 'RUN_ERROR', message: 'boom', code: 'timeout' } },
    });
  });

  it('preserves an unmapped event type losslessly as CUSTOM instead of dropping it', () => {
    const event = { type: 'THINKING_START', foo: 'bar' };
    expect(fromAguiEvent(event, 'r1')).toEqual({ type: 'CUSTOM', name: 'agui:THINKING_START', payload: event });
  });
});
