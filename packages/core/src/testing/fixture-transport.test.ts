import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createFixtureTransport } from './fixture-transport';
import { initialState, reduceEvent } from '../reducer';
import type { ChatEvent } from '../types';

const events: ChatEvent[] = [
  { type: 'RUN_STARTED', runId: 'run-1', threadId: 'thread-1' },
  { type: 'TEXT_MESSAGE_START', messageId: 'msg-1', role: 'assistant' },
  { type: 'TEXT_MESSAGE_CONTENT', messageId: 'msg-1', delta: 'Hello' },
  { type: 'TEXT_MESSAGE_CONTENT', messageId: 'msg-1', delta: ', world!' },
  { type: 'TEXT_MESSAGE_END', messageId: 'msg-1' },
  { type: 'RUN_FINISHED', runId: 'run-1' },
];

describe('createFixtureTransport', () => {
  it('replays the given events in order through connect()', async () => {
    const transport = createFixtureTransport(events);
    const received: ChatEvent[] = [];
    for await (const event of transport.connect({ threadId: 'thread-1' })) {
      received.push(event);
    }
    expect(received).toEqual(events);
  });

  it('drives the reducer to the expected final state', async () => {
    const transport = createFixtureTransport(events);
    let state = initialState();
    for await (const event of transport.connect({ threadId: 'thread-1' })) {
      state = reduceEvent(state, event);
    }
    expect(state.runStatus).toBe('idle');
    expect(state.messages[0].parts).toEqual([{ type: 'text', text: 'Hello, world!' }]);
  });

  it('records sendRun, sendFrontendToolResult, and abortRun calls', async () => {
    const transport = createFixtureTransport([]);
    await transport.sendRun({ threadId: 't1', runId: 'r1', messages: [], tools: [] });
    await transport.sendFrontendToolResult({ toolCallId: 'tc1', result: 'ok' });
    await transport.abortRun('r1');
    expect(transport.recorder.runs).toHaveLength(1);
    expect(transport.recorder.toolResults).toHaveLength(1);
    expect(transport.recorder.abortedRunIds).toEqual(['r1']);
  });
});

describe('docs/fixtures/text-streaming-basic.json', () => {
  it('is a valid ChatEvent[] that drives the reducer to the expected state', async () => {
    const fixturePath = fileURLToPath(new URL('../../../../docs/fixtures/text-streaming-basic.json', import.meta.url));
    const fixtureEvents = JSON.parse(readFileSync(fixturePath, 'utf-8')) as ChatEvent[];
    const transport = createFixtureTransport(fixtureEvents);

    let state = initialState();
    for await (const event of transport.connect({ threadId: 'thread-1' })) {
      state = reduceEvent(state, event);
    }

    expect(state.messages[0].parts).toEqual([{ type: 'text', text: 'Hello, world!' }]);
  });
});
