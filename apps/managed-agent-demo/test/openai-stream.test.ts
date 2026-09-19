import { describe, expect, it, vi } from 'vitest';
import { streamChatCompletion, ThinkTagFilter, LlmHttpError } from '../src/lib/openai-stream';
import type { StreamEvent } from '../src/lib/openai-stream';

function sseResponse(frames: string[], chunkSize?: number): Response {
  const encoder = new TextEncoder();
  const payload = frames.join('');
  const bytes = encoder.encode(payload);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Optionally split the wire bytes arbitrarily, like a real socket does.
      const size = chunkSize ?? bytes.length;
      for (let i = 0; i < bytes.length; i += size) controller.enqueue(bytes.slice(i, i + size));
      controller.close();
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
}

const data = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`;
const delta = (d: Record<string, unknown>, finish: string | null = null) => data({ choices: [{ delta: d, finish_reason: finish }] });

async function collect(fetchImpl: typeof fetch, body: Record<string, unknown> = {}): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of streamChatCompletion({ baseUrl: 'http://x/v1/', body, fetchImpl })) events.push(event);
  return events;
}

const textOf = (events: StreamEvent[]) => events.flatMap((e) => (e.type === 'text' ? [e.delta] : [])).join('');

describe('streamChatCompletion', () => {
  it('posts to {baseUrl}/chat/completions with the body, and only sends auth when a key is set', async () => {
    const fetchImpl = vi.fn(async () => sseResponse(['data: [DONE]\n\n'])) as unknown as typeof fetch;
    await collect(fetchImpl, { model: 'm', stream: true });
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://x/v1/chat/completions');
    expect(JSON.parse(init.body as string)).toEqual({ model: 'm', stream: true });
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();

    const withKey = vi.fn(async () => sseResponse(['data: [DONE]\n\n'])) as unknown as typeof fetch;
    for await (const _ of streamChatCompletion({ baseUrl: 'http://x/v1', apiKey: 'k', body: {}, fetchImpl: withKey })) void _;
    expect(((withKey as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer k' });
  });

  it('streams text deltas in order and reports the finish reason', async () => {
    const events = await collect((async () =>
      sseResponse([delta({ role: 'assistant', content: '' }), delta({ content: 'Hel' }), delta({ content: 'lo' }), delta({}, 'stop'), 'data: [DONE]\n\n'])) as unknown as typeof fetch);
    expect(events.filter((e) => e.type === 'text')).toEqual([
      { type: 'text', delta: 'Hel' },
      { type: 'text', delta: 'lo' },
    ]);
    expect(events.at(-1)).toEqual({ type: 'finish', reason: 'stop' });
  });

  it('survives frames split at arbitrary byte boundaries (and CRLF framing)', async () => {
    const frames = [delta({ content: 'héllo ' }), delta({ content: 'wörld' }), 'data: [DONE]\n\n'].map((f) => f.replace(/\n/g, '\r\n'));
    for (const chunkSize of [1, 3, 7, 64]) {
      const events = await collect((async () => sseResponse(frames, chunkSize)) as unknown as typeof fetch);
      expect(textOf(events)).toBe('héllo wörld');
    }
  });

  it('accumulates tool-call argument fragments and surfaces the call once, whole', async () => {
    const events = await collect((async () =>
      sseResponse([
        delta({ tool_calls: [{ index: 0, id: 'call_1', function: { name: 'show_form', arguments: '' } }] }),
        delta({ tool_calls: [{ index: 0, function: { arguments: '{"schema":' } }] }),
        delta({ tool_calls: [{ index: 0, function: { arguments: '{"type":"object"}}' } }] }),
        delta({}, 'tool_calls'),
        'data: [DONE]\n\n',
      ])) as unknown as typeof fetch);
    const toolEvents = events.filter((e) => e.type === 'tool_calls');
    expect(toolEvents).toEqual([{ type: 'tool_calls', calls: [{ id: 'call_1', name: 'show_form', arguments: '{"schema":{"type":"object"}}' }] }]);
    expect(events.at(-1)).toEqual({ type: 'finish', reason: 'tool_calls' });
  });

  it('keeps parallel tool calls apart by index, in order, and invents an id when the server sends none', async () => {
    const events = await collect((async () =>
      sseResponse([
        delta({ tool_calls: [{ index: 1, id: 'b', function: { name: 'second', arguments: '{}' } }] }),
        delta({ tool_calls: [{ index: 0, function: { name: 'first', arguments: '{"x":1}' } }] }),
        'data: [DONE]\n\n',
      ])) as unknown as typeof fetch);
    const call = events.find((e) => e.type === 'tool_calls');
    expect(call && call.type === 'tool_calls' && call.calls.map((c) => c.name)).toEqual(['first', 'second']);
    expect(call && call.type === 'tool_calls' && call.calls[0].id).toMatch(/^call_/);
  });

  it('handles a server that sends the whole tool call in one delta with no index', async () => {
    const events = await collect((async () =>
      sseResponse([delta({ tool_calls: [{ id: 'c', function: { name: 'f', arguments: '{"a":1}' } }] }), 'data: [DONE]\n\n'])) as unknown as typeof fetch);
    expect(events.find((e) => e.type === 'tool_calls')).toEqual({ type: 'tool_calls', calls: [{ id: 'c', name: 'f', arguments: '{"a":1}' }] });
  });

  it('routes reasoning_content / reasoning fields to reasoning events', async () => {
    const events = await collect((async () =>
      sseResponse([delta({ reasoning_content: 'hmm ' }), delta({ reasoning: 'ok' }), delta({ content: 'Answer' }), 'data: [DONE]\n\n'])) as unknown as typeof fetch);
    expect(events.filter((e) => e.type === 'reasoning')).toEqual([
      { type: 'reasoning', delta: 'hmm ' },
      { type: 'reasoning', delta: 'ok' },
    ]);
    expect(textOf(events)).toBe('Answer');
  });

  it('routes inline <think> blocks to reasoning even when the tags are split across chunks', async () => {
    const events = await collect((async () =>
      sseResponse([delta({ content: '<thi' }), delta({ content: 'nk>plan it</th' }), delta({ content: 'ink>Done.' }), 'data: [DONE]\n\n'])) as unknown as typeof fetch);
    expect(events.filter((e) => e.type === 'reasoning').map((e) => (e as { delta: string }).delta).join('')).toBe('plan it');
    expect(textOf(events)).toBe('Done.');
  });

  it('answers a non-streaming JSON response (server ignored stream:true) the same way', async () => {
    const events = await collect((async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'Hi', tool_calls: [{ id: 't', function: { name: 'f', arguments: '{}' } }] }, finish_reason: 'tool_calls' }],
        }),
        { headers: { 'Content-Type': 'application/json' } }
      )) as unknown as typeof fetch);
    expect(textOf(events)).toBe('Hi');
    expect(events.find((e) => e.type === 'tool_calls')).toEqual({ type: 'tool_calls', calls: [{ id: 't', name: 'f', arguments: '{}' }] });
  });

  it('ignores malformed frames and keep-alive comments', async () => {
    const events = await collect((async () =>
      sseResponse([': keep-alive\n\n', 'data: {not json\n\n', delta({ content: 'ok' }), 'data: [DONE]\n\n'])) as unknown as typeof fetch);
    expect(textOf(events)).toBe('ok');
  });

  it('throws LlmHttpError with status and body on a non-2xx response', async () => {
    const promise = collect((async () => new Response('model not loaded', { status: 503 })) as unknown as typeof fetch);
    await expect(promise).rejects.toBeInstanceOf(LlmHttpError);
    await expect(promise).rejects.toMatchObject({ status: 503, responseBody: 'model not loaded' });
  });

  it('throws when the stream carries an error object', async () => {
    const promise = collect((async () => sseResponse([data({ error: { message: 'context length exceeded' } })])) as unknown as typeof fetch);
    await expect(promise).rejects.toThrow('context length exceeded');
  });
});

describe('ThinkTagFilter', () => {
  it('passes plain text straight through', () => {
    const filter = new ThinkTagFilter();
    expect([...filter.push('hello '), ...filter.push('there'), ...filter.flush()].map((p) => p.text).join('')).toBe('hello there');
  });

  it('drops a stray closing tag with no opener rather than showing it', () => {
    const filter = new ThinkTagFilter();
    const pieces = [...filter.push('reasoning</think>answer'), ...filter.flush()];
    expect(pieces.map((p) => p.text).join('')).toBe('reasoninganswer');
  });

  it('does not swallow a lone "<" that turns out not to be a tag', () => {
    const filter = new ThinkTagFilter();
    const out = [...filter.push('a < b'), ...filter.push(' and <b>bold</b>'), ...filter.flush()].map((p) => p.text).join('');
    expect(out).toBe('a < b and <b>bold</b>');
  });
});
