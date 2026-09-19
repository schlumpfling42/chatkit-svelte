import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ChatEvent, Message, RunAgentInput, ToolDefinition } from '@chatkit-svelte/core';
import type { StreamEvent, StreamOptions } from '../src/lib/openai-stream';

const mockStream = vi.fn<(options: StreamOptions) => AsyncGenerator<StreamEvent>>();
vi.mock('../src/lib/openai-stream', () => ({
  streamChatCompletion: (options: StreamOptions) => mockStream(options),
}));

const mockGetLlmConfig = vi.fn();
vi.mock('../src/lib/env', () => ({
  getLlmConfig: () => mockGetLlmConfig(),
}));

const showForm: ToolDefinition = {
  name: 'show_form',
  description: 'ask the user for structured info',
  parameters: { type: 'object' },
  executesOn: 'frontend',
};

const userMessage = (id: string, text: string): Message => ({ id, role: 'user', parts: [{ type: 'text', text }], createdAt: 0, streaming: false });

function input(overrides: Partial<RunAgentInput> & { runId: string }): RunAgentInput {
  return { threadId: 't1', messages: [userMessage('u1', 'hello')], tools: [showForm], ...overrides };
}

/** A scripted model response. */
function round(...events: StreamEvent[]): (options: StreamOptions) => AsyncGenerator<StreamEvent> {
  return async function* () {
    for (const event of events) yield event;
  };
}

const text = (delta: string): StreamEvent => ({ type: 'text', delta });
const finish = (reason: string | null = 'stop'): StreamEvent => ({ type: 'finish', reason });
const toolCalls = (...calls: Array<{ id: string; name: string; arguments: string }>): StreamEvent => ({ type: 'tool_calls', calls });

/** Streams `first`, then hangs until the request is aborted (like a slow model being cancelled). */
function hangingRound(...first: StreamEvent[]): (options: StreamOptions) => AsyncGenerator<StreamEvent> {
  return async function* (options) {
    for (const event of first) yield event;
    await new Promise<never>((_, reject) => {
      options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    });
  };
}

function script(...rounds: Array<(options: StreamOptions) => AsyncGenerator<StreamEvent>>): void {
  for (const r of rounds) mockStream.mockImplementationOnce(r);
}

async function waitFor(condition: () => boolean, message = 'condition'): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${message}`);
}

const requestBody = (callIndex: number) => mockStream.mock.calls[callIndex][0].body as { model: string; messages: Array<Record<string, unknown>>; stream: boolean; tools?: unknown[] };
const types = (events: ChatEvent[]) => events.map((e) => e.type);

async function load() {
  const mod = await import('../src/lib/agent-sessions');
  return mod;
}

describe('agent-sessions (OpenAI-compatible backend)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockStream.mockReset();
    mockGetLlmConfig.mockReturnValue({ baseUrl: 'http://llm/v1', model: 'test-model', systemPrompt: 'SYS' });
    (await load()).__resetSessionsForTest();
  });

  describe('a plain text turn', () => {
    it('streams RUN_STARTED, the message, and RUN_FINISHED, and asks the model with system prompt + tools', async () => {
      script(round(text('Hel'), text('lo!'), finish()));
      const { startRun, getOrCreateSession } = await load();
      startRun('t1', input({ runId: 'r1' }));
      const session = getOrCreateSession('t1');
      await waitFor(() => session.events.some((e) => e.type === 'RUN_FINISHED'));

      expect(types(session.events)).toEqual(['RUN_STARTED', 'TEXT_MESSAGE_START', 'TEXT_MESSAGE_CONTENT', 'TEXT_MESSAGE_CONTENT', 'TEXT_MESSAGE_END', 'RUN_FINISHED']);
      const start = session.events[1] as Extract<ChatEvent, { type: 'TEXT_MESSAGE_START' }>;
      const content = session.events.filter((e): e is Extract<ChatEvent, { type: 'TEXT_MESSAGE_CONTENT' }> => e.type === 'TEXT_MESSAGE_CONTENT');
      expect(content.map((c) => c.delta).join('')).toBe('Hello!');
      expect(content.every((c) => c.messageId === start.messageId)).toBe(true);

      const body = requestBody(0);
      expect(body.model).toBe('test-model');
      expect(body.stream).toBe(true);
      expect(body.messages).toEqual([
        { role: 'system', content: 'SYS' },
        { role: 'user', content: 'hello' },
      ]);
      expect(body.tools).toEqual([{ type: 'function', function: { name: 'show_form', description: showForm.description, parameters: { type: 'object' } } }]);
    });

    it('omits the tools field entirely when the client offered none', async () => {
      script(round(text('ok'), finish()));
      const { startRun, getOrCreateSession } = await load();
      startRun('t1', input({ runId: 'r1', tools: [] }));
      await waitFor(() => getOrCreateSession('t1').events.some((e) => e.type === 'RUN_FINISHED'));
      expect('tools' in requestBody(0)).toBe(false);
    });

    it('sends reasoning as REASONING_* events, closed before the answer text starts', async () => {
      script(round({ type: 'reasoning', delta: 'let me think' }, text('42'), finish()));
      const { startRun, getOrCreateSession } = await load();
      startRun('t1', input({ runId: 'r1' }));
      await waitFor(() => getOrCreateSession('t1').events.some((e) => e.type === 'RUN_FINISHED'));
      expect(types(getOrCreateSession('t1').events)).toEqual([
        'RUN_STARTED',
        'REASONING_START',
        'REASONING_CONTENT',
        'REASONING_END',
        'TEXT_MESSAGE_START',
        'TEXT_MESSAGE_CONTENT',
        'TEXT_MESSAGE_END',
        'RUN_FINISHED',
      ]);
    });

    it('does not open a message bubble for leading whitespace that is never followed by text', async () => {
      script(round(text('\n'), finish()));
      const { startRun, getOrCreateSession } = await load();
      startRun('t1', input({ runId: 'r1' }));
      await waitFor(() => getOrCreateSession('t1').events.some((e) => e.type === 'RUN_FINISHED'));
      expect(types(getOrCreateSession('t1').events)).toEqual(['RUN_STARTED', 'RUN_FINISHED']);
    });

    it('keeps leading whitespace that IS followed by text', async () => {
      script(round(text('\n'), text('Hi'), finish()));
      const { startRun, getOrCreateSession } = await load();
      startRun('t1', input({ runId: 'r1' }));
      await waitFor(() => getOrCreateSession('t1').events.some((e) => e.type === 'RUN_FINISHED'));
      const content = getOrCreateSession('t1').events.find((e) => e.type === 'TEXT_MESSAGE_CONTENT') as { delta: string };
      expect(content.delta).toBe('\nHi');
    });
  });

  describe('history', () => {
    it('sends only NEW user messages on later runs, and includes the assistant reply it produced', async () => {
      script(round(text('first answer'), finish()), round(text('second answer'), finish()));
      const { startRun, getOrCreateSession } = await load();
      startRun('t1', input({ runId: 'r1' }));
      await waitFor(() => getOrCreateSession('t1').events.filter((e) => e.type === 'RUN_FINISHED').length === 1);

      // The client resends its whole list, now with the assistant reply and a new user message.
      const assistant: Message = { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'first answer' }], createdAt: 0, streaming: false };
      startRun('t1', input({ runId: 'r2', messages: [userMessage('u1', 'hello'), assistant, userMessage('u2', 'and again')] }));
      await waitFor(() => getOrCreateSession('t1').events.filter((e) => e.type === 'RUN_FINISHED').length === 2);

      expect(requestBody(1).messages).toEqual([
        { role: 'system', content: 'SYS' },
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'first answer' },
        { role: 'user', content: 'and again' },
      ]);
    });

    it('rebuilds history from the client when the server has none (dev-server restart mid-conversation)', async () => {
      script(round(text('ok'), finish()));
      const { startRun, getOrCreateSession } = await load();
      const assistant: Message = { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'earlier reply' }], createdAt: 0, streaming: false };
      startRun('t1', input({ runId: 'r1', messages: [userMessage('u1', 'earlier'), assistant, userMessage('u2', 'now')] }));
      await waitFor(() => getOrCreateSession('t1').events.some((e) => e.type === 'RUN_FINISHED'));
      expect(requestBody(0).messages.slice(1)).toEqual([
        { role: 'user', content: 'earlier' },
        { role: 'assistant', content: 'earlier reply' },
        { role: 'user', content: 'now' },
      ]);
    });
  });

  describe('client tool calls', () => {
    const formArgs = '{"schema":{"type":"object","properties":{"name":{"type":"string"}}}}';

    it('emits a whole tool call attached to the text message, then parks with RUN_FINISHED', async () => {
      script(round(text('Let me ask.'), toolCalls({ id: 'tc1', name: 'show_form', arguments: formArgs }), finish('tool_calls')));
      const { startRun, getOrCreateSession, findSessionByToolCallId } = await load();
      startRun('t1', input({ runId: 'r1' }));
      const session = getOrCreateSession('t1');
      await waitFor(() => session.events.some((e) => e.type === 'RUN_FINISHED'));

      const textStart = session.events.find((e) => e.type === 'TEXT_MESSAGE_START') as { messageId: string };
      const callStart = session.events.find((e) => e.type === 'TOOL_CALL_START');
      expect(callStart).toEqual({ type: 'TOOL_CALL_START', toolCallId: 'tc1', toolName: 'show_form', parentMessageId: textStart.messageId });
      expect(session.events.filter((e) => e.type === 'TOOL_CALL_ARGS')).toEqual([{ type: 'TOOL_CALL_ARGS', toolCallId: 'tc1', delta: formArgs }]);
      expect(types(session.events).slice(-3)).toEqual(['TOOL_CALL_ARGS', 'TOOL_CALL_END', 'RUN_FINISHED']);
      expect(findSessionByToolCallId('tc1')?.threadId).toBe('t1');
    });

    it('synthesizes an empty message to hold a tool call the model made with no text at all', async () => {
      script(round(toolCalls({ id: 'tc1', name: 'show_form', arguments: '{}' }), finish('tool_calls')));
      const { startRun, getOrCreateSession } = await load();
      startRun('t1', input({ runId: 'r1' }));
      const session = getOrCreateSession('t1');
      await waitFor(() => session.events.some((e) => e.type === 'RUN_FINISHED'));

      const start = session.events.find((e) => e.type === 'TEXT_MESSAGE_START') as { messageId: string };
      const call = session.events.find((e) => e.type === 'TOOL_CALL_START') as { parentMessageId: string };
      expect(call.parentMessageId).toBe(start.messageId);
      expect(session.events.some((e) => e.type === 'TEXT_MESSAGE_CONTENT')).toBe(false);
    });

    it('resumes with the tool result: the next request carries the assistant tool call and the tool message', async () => {
      script(
        round(text('Let me ask.'), toolCalls({ id: 'tc1', name: 'show_form', arguments: formArgs }), finish('tool_calls')),
        round(text('Thanks, Ada!'), finish())
      );
      const { startRun, getOrCreateSession, sendToolResult } = await load();
      startRun('t1', input({ runId: 'r1' }));
      const session = getOrCreateSession('t1');
      await waitFor(() => session.events.some((e) => e.type === 'RUN_FINISHED'));

      sendToolResult('t1', 'tc1', { name: 'Ada' });
      await waitFor(() => session.events.filter((e) => e.type === 'RUN_FINISHED').length === 2);

      expect(session.events.filter((e) => e.type === 'RUN_STARTED')).toHaveLength(2);
      expect(requestBody(1).messages.slice(1)).toEqual([
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'Let me ask.', tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'show_form', arguments: formArgs } }] },
        { role: 'tool', tool_call_id: 'tc1', content: '{"name":"Ada"}' },
      ]);
      // The resumed request still offers the tools.
      expect(requestBody(1).tools).toBeDefined();
      const finalText = session.events.filter((e) => e.type === 'TEXT_MESSAGE_CONTENT').map((e) => (e as { delta: string }).delta);
      expect(finalText.at(-1)).toBe('Thanks, Ada!');
    });

    it('waits for every tool call from one response to be answered before resuming', async () => {
      script(
        round(
          toolCalls({ id: 'a', name: 'show_form', arguments: '{}' }, { id: 'b', name: 'show_form', arguments: '{}' }),
          finish('tool_calls')
        ),
        round(text('both answered'), finish())
      );
      const { startRun, getOrCreateSession, sendToolResult } = await load();
      startRun('t1', input({ runId: 'r1' }));
      const session = getOrCreateSession('t1');
      await waitFor(() => session.events.some((e) => e.type === 'RUN_FINISHED'));

      sendToolResult('t1', 'a', 'first');
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(mockStream).toHaveBeenCalledTimes(1);

      sendToolResult('t1', 'b', 'second');
      await waitFor(() => session.events.filter((e) => e.type === 'RUN_FINISHED').length === 2);
      const messages = requestBody(1).messages;
      expect(messages.filter((m) => m.role === 'tool')).toEqual([
        { role: 'tool', tool_call_id: 'a', content: 'first' },
        { role: 'tool', tool_call_id: 'b', content: 'second' },
      ]);
    });

    it('ignores a tool result for a call that is not pending (late, duplicate, or from before a restart)', async () => {
      script(round(toolCalls({ id: 'tc1', name: 'show_form', arguments: '{}' }), finish('tool_calls')), round(text('x'), finish()));
      const { startRun, getOrCreateSession, sendToolResult } = await load();
      startRun('t1', input({ runId: 'r1' }));
      await waitFor(() => getOrCreateSession('t1').events.some((e) => e.type === 'RUN_FINISHED'));

      sendToolResult('t1', 'unknown', 'nope');
      sendToolResult('nope-thread', 'tc1', 'nope');
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(mockStream).toHaveBeenCalledTimes(1);
    });

    it('closes a pending tool call as unanswered when the user types instead, and ignores its late result', async () => {
      script(round(toolCalls({ id: 'tc1', name: 'show_form', arguments: '{}' }), finish('tool_calls')), round(text('ok, moving on'), finish()));
      const { startRun, getOrCreateSession, sendToolResult } = await load();
      startRun('t1', input({ runId: 'r1' }));
      const session = getOrCreateSession('t1');
      await waitFor(() => session.events.some((e) => e.type === 'RUN_FINISHED'));

      startRun('t1', input({ runId: 'r2', messages: [userMessage('u1', 'hello'), userMessage('u2', 'never mind')] }));
      await waitFor(() => session.events.filter((e) => e.type === 'RUN_FINISHED').length === 2);

      expect(requestBody(1).messages.slice(-2)).toEqual([
        { role: 'tool', tool_call_id: 'tc1', content: 'The user did not respond to this request.' },
        { role: 'user', content: 'never mind' },
      ]);
      sendToolResult('t1', 'tc1', { late: true });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(mockStream).toHaveBeenCalledTimes(2);
    });
  });

  describe('tool-call arguments the model got wrong', () => {
    it('repairs near-JSON (raw newline in a string), emits the canonical form, and records that it did', async () => {
      const broken = '{"title":"Notes","content":"line one\nline two"}';
      script(round(toolCalls({ id: 'tc1', name: 'show_form', arguments: broken }), finish('tool_calls')), round(text('done'), finish()));
      const { startRun, getOrCreateSession, sendToolResult } = await load();
      startRun('t1', input({ runId: 'r1' }));
      const session = getOrCreateSession('t1');
      await waitFor(() => session.events.some((e) => e.type === 'RUN_FINISHED'));

      const canonical = JSON.stringify({ title: 'Notes', content: 'line one\nline two' });
      expect(session.events.find((e) => e.type === 'TOOL_CALL_ARGS')).toEqual({ type: 'TOOL_CALL_ARGS', toolCallId: 'tc1', delta: canonical });
      expect(session.events.find((e) => e.type === 'CUSTOM' && e.name === 'llm.tool_arguments_repaired')).toMatchObject({
        payload: { toolCallId: 'tc1', toolName: 'show_form', raw: broken },
      });

      // The repaired form -- not the broken original -- is what later requests replay.
      sendToolResult('t1', 'tc1', 'ok');
      await waitFor(() => session.events.filter((e) => e.type === 'RUN_FINISHED').length === 2);
      const assistant = requestBody(1).messages.find((m) => m.role === 'assistant') as { tool_calls: Array<{ function: { arguments: string } }> };
      expect(assistant.tool_calls[0].function.arguments).toBe(canonical);
    });

    it('never shows an unparseable tool call: the model gets an error result and another go', async () => {
      script(
        round(toolCalls({ id: 'bad', name: 'show_form', arguments: 'totally not json' }), finish('tool_calls')),
        round(toolCalls({ id: 'good', name: 'show_form', arguments: '{"schema":{}}' }), finish('tool_calls'))
      );
      const { startRun, getOrCreateSession } = await load();
      startRun('t1', input({ runId: 'r1' }));
      const session = getOrCreateSession('t1');
      await waitFor(() => session.events.some((e) => e.type === 'RUN_FINISHED'));

      const started = session.events.filter((e) => e.type === 'TOOL_CALL_START') as Array<{ toolCallId: string }>;
      expect(started.map((s) => s.toolCallId)).toEqual(['good']);
      expect(session.events.filter((e) => e.type === 'RUN_STARTED')).toHaveLength(1);
      expect(session.events.find((e) => e.type === 'CUSTOM' && e.name === 'llm.tool_call_rejected')).toBeDefined();

      const retry = requestBody(1).messages;
      const toolMessage = retry.find((m) => m.role === 'tool') as { tool_call_id: string; content: string };
      expect(toolMessage.tool_call_id).toBe('bad');
      expect(toolMessage.content).toContain('valid JSON');
    });

    it('answers every call in a response when one is invalid, so no tool call is left dangling', async () => {
      script(
        round(toolCalls({ id: 'ok1', name: 'show_form', arguments: '{}' }, { id: 'bad1', name: 'show_form', arguments: '~~' }), finish('tool_calls')),
        round(text('fine'), finish())
      );
      const { startRun, getOrCreateSession } = await load();
      startRun('t1', input({ runId: 'r1' }));
      await waitFor(() => getOrCreateSession('t1').events.some((e) => e.type === 'RUN_FINISHED'));
      const toolMessages = requestBody(1).messages.filter((m) => m.role === 'tool') as Array<{ tool_call_id: string; content: string }>;
      expect(toolMessages.map((m) => m.tool_call_id)).toEqual(['ok1', 'bad1']);
      expect(getOrCreateSession('t1').events.some((e) => e.type === 'TOOL_CALL_START')).toBe(false);
    });

    it('gives up with a recoverable RUN_ERROR after too many invalid attempts', async () => {
      for (let i = 0; i < 6; i += 1) script(round(toolCalls({ id: `bad${i}`, name: 'show_form', arguments: '???' }), finish('tool_calls')));
      const { startRun, getOrCreateSession } = await load();
      startRun('t1', input({ runId: 'r1' }));
      const session = getOrCreateSession('t1');
      await waitFor(() => session.events.some((e) => e.type === 'RUN_ERROR'));
      expect(session.events.find((e) => e.type === 'RUN_ERROR')).toMatchObject({ error: { code: 'tool_arguments_invalid', recoverable: true } });
      expect(mockStream).toHaveBeenCalledTimes(4);
    });

    it('rejects a call to a tool the client never offered, telling the model what exists', async () => {
      script(round(toolCalls({ id: 'x', name: 'launch_missiles', arguments: '{}' }), finish('tool_calls')), round(text('sorry'), finish()));
      const { startRun, getOrCreateSession } = await load();
      startRun('t1', input({ runId: 'r1' }));
      await waitFor(() => getOrCreateSession('t1').events.some((e) => e.type === 'RUN_FINISHED'));
      const toolMessage = requestBody(1).messages.find((m) => m.role === 'tool') as { content: string };
      expect(toolMessage.content).toContain('Unknown tool "launch_missiles"');
      expect(toolMessage.content).toContain('show_form');
      expect(getOrCreateSession('t1').events.some((e) => e.type === 'TOOL_CALL_START')).toBe(false);
    });

    it('does not trust a tool call from a response that hit the token limit, even if it happens to parse', async () => {
      script(round(toolCalls({ id: 'cut', name: 'show_form', arguments: '{"schema":{}}' }), finish('length')), round(text('shorter'), finish()));
      const { startRun, getOrCreateSession } = await load();
      startRun('t1', input({ runId: 'r1' }));
      await waitFor(() => getOrCreateSession('t1').events.some((e) => e.type === 'RUN_FINISHED'));
      expect(getOrCreateSession('t1').events.some((e) => e.type === 'TOOL_CALL_START')).toBe(false);
      expect((requestBody(1).messages.find((m) => m.role === 'tool') as { content: string }).content).toContain('cut off');
    });
  });

  describe('errors', () => {
    it('reports missing configuration as a RUN_ERROR in the chat, not a crash', async () => {
      mockGetLlmConfig.mockImplementation(() => {
        throw new Error('Missing required environment variable: OPENAI_MODEL');
      });
      const { startRun, getOrCreateSession } = await load();
      startRun('t1', input({ runId: 'r1' }));
      const session = getOrCreateSession('t1');
      await waitFor(() => session.events.some((e) => e.type === 'RUN_ERROR'));
      expect(session.events.find((e) => e.type === 'RUN_ERROR')).toMatchObject({
        runId: 'r1',
        error: { code: 'llm_not_configured', message: expect.stringContaining('OPENAI_MODEL') },
      });
      expect(mockStream).not.toHaveBeenCalled();
    });

    it('reports a failed model request as a RUN_ERROR and leaves the thread usable', async () => {
      mockStream.mockImplementationOnce(() => {
        // eslint-disable-next-line require-yield
        return (async function* () {
          throw new Error('LLM server responded 503: model not loaded');
        })();
      });
      script(round(text('back up'), finish()));
      const { startRun, getOrCreateSession } = await load();
      startRun('t1', input({ runId: 'r1' }));
      const session = getOrCreateSession('t1');
      await waitFor(() => session.events.some((e) => e.type === 'RUN_ERROR'));
      expect(session.events.find((e) => e.type === 'RUN_ERROR')).toMatchObject({ error: { code: 'llm_request_failed', message: expect.stringContaining('503') } });

      startRun('t1', input({ runId: 'r2', messages: [userMessage('u1', 'hello'), userMessage('u2', 'retry')] }));
      await waitFor(() => session.events.filter((e) => e.type === 'RUN_FINISHED').length === 1);
      expect(session.activeRunId).toBeNull();
    });
  });

  describe('abort and supersede', () => {
    it('abortRun stops the stream quietly (no RUN_ERROR), closes the open message, and keeps what was said in history', async () => {
      script(hangingRound(text('partial answ')), round(text('next'), finish()));
      const { startRun, getOrCreateSession, abortRun, findSessionByRunId } = await load();
      startRun('t1', input({ runId: 'r1' }));
      const session = getOrCreateSession('t1');
      await waitFor(() => session.events.some((e) => e.type === 'TEXT_MESSAGE_CONTENT'));
      expect(findSessionByRunId('r1')?.threadId).toBe('t1');

      abortRun('t1');
      await waitFor(() => session.activeRunId === null);
      expect(session.events.some((e) => e.type === 'RUN_ERROR')).toBe(false);
      expect(types(session.events).at(-1)).toBe('TEXT_MESSAGE_END');
      expect(findSessionByRunId('r1')).toBeUndefined();

      startRun('t1', input({ runId: 'r2', messages: [userMessage('u1', 'hello'), userMessage('u2', 'continue')] }));
      await waitFor(() => session.events.some((e) => e.type === 'RUN_FINISHED'));
      expect(requestBody(1).messages.slice(1)).toEqual([
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'partial answ' },
        { role: 'user', content: 'continue' },
      ]);
    });

    it('a new run supersedes the one in flight, and only starts once the old one has fully unwound', async () => {
      const order: string[] = [];
      mockStream.mockImplementationOnce((options) => {
        order.push('first:start');
        return (async function* () {
          yield text('slow ');
          await new Promise<never>((_, reject) =>
            options.signal?.addEventListener('abort', () => {
              // Teardown takes a moment, like a real socket closing.
              setTimeout(() => {
                order.push('first:unwound');
                reject(new DOMException('Aborted', 'AbortError'));
              }, 15);
            })
          );
        })();
      });
      mockStream.mockImplementationOnce(() => {
        order.push('second:start');
        return round(text('fast'), finish())({} as StreamOptions);
      });
      const { startRun, getOrCreateSession } = await load();
      startRun('t1', input({ runId: 'r1' }));
      const session = getOrCreateSession('t1');
      await waitFor(() => session.events.some((e) => e.type === 'TEXT_MESSAGE_CONTENT'));

      startRun('t1', input({ runId: 'r2', messages: [userMessage('u1', 'hello'), userMessage('u2', 'actually this')] }));
      await waitFor(() => session.events.some((e) => e.type === 'RUN_FINISHED'));
      expect(order).toEqual(['first:start', 'first:unwound', 'second:start']);
      expect(session.events.filter((e) => e.type === 'RUN_STARTED').map((e) => (e as { runId: string }).runId)).toEqual(['r1', 'r2']);
    });
  });

  describe('event log access', () => {
    it('subscribeFromIndex replays buffered events then yields new ones', async () => {
      script(round(text('hi'), finish()));
      const { startRun, getOrCreateSession, subscribeFromIndex } = await load();
      startRun('t1', input({ runId: 'r1' }));
      await waitFor(() => getOrCreateSession('t1').events.some((e) => e.type === 'RUN_FINISHED'));

      const seen: ChatEvent[] = [];
      const generator = subscribeFromIndex('t1', 0);
      for (let i = 0; i < 5; i += 1) seen.push((await generator.next()).value.event);
      expect(types(seen)).toEqual(['RUN_STARTED', 'TEXT_MESSAGE_START', 'TEXT_MESSAGE_CONTENT', 'TEXT_MESSAGE_END', 'RUN_FINISHED']);
    });

    it('subscribeFromIndex parks until an event arrives, then resolves it', async () => {
      script(round(text('hi'), finish()));
      const { startRun, subscribeFromIndex } = await load();
      const generator = subscribeFromIndex('t1', 0);
      const pending = generator.next();
      startRun('t1', input({ runId: 'r1' }));
      const result = await pending;
      expect(result.value).toEqual({ index: 0, event: { type: 'RUN_STARTED', runId: 'r1', threadId: 't1' } });
    });

    it('reuses one session per thread and keeps threads isolated', async () => {
      const { getOrCreateSession } = await load();
      expect(getOrCreateSession('a')).toBe(getOrCreateSession('a'));
      expect(getOrCreateSession('a')).not.toBe(getOrCreateSession('b'));
    });
  });
});
