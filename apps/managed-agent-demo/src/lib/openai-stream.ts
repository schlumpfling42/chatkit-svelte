import { randomUUID } from 'node:crypto';

/**
 * Minimal client for any OpenAI-compatible `/chat/completions` endpoint
 * (FastFlowLM, Ollama, LM Studio, OpenAI, Azure OpenAI, ...). Plain fetch + a
 * small SSE parser rather than an SDK, so nothing sits between the server's
 * bytes and the parsing below. Tool-call deltas are accumulated here and
 * surfaced once, whole, at the end of the stream -- callers never see
 * argument fragments.
 */

export type StreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'reasoning'; delta: string }
  | { type: 'tool_calls'; calls: Array<{ id: string; name: string; arguments: string }> }
  | { type: 'finish'; reason: string | null };

export interface StreamOptions {
  baseUrl: string;
  apiKey?: string;
  body: Record<string, unknown>;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

export class LlmHttpError extends Error {
  constructor(
    readonly status: number,
    readonly responseBody: string
  ) {
    super(`LLM server responded ${status}: ${responseBody.slice(0, 500)}`);
    this.name = 'LlmHttpError';
  }
}

interface RawToolCallDelta {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface RawChoice {
  delta?: {
    content?: string | null;
    reasoning_content?: string | null;
    reasoning?: string | null;
    tool_calls?: RawToolCallDelta[];
  };
  message?: {
    content?: string | null;
    reasoning_content?: string | null;
    reasoning?: string | null;
    tool_calls?: RawToolCallDelta[];
  };
  finish_reason?: string | null;
}

interface Piece {
  kind: 'text' | 'reasoning';
  text: string;
}

const OPEN_TAG = '<think>';
const CLOSE_TAG = '</think>';

function partialTagSuffixLength(buffer: string, tag: string): number {
  const max = Math.min(buffer.length, tag.length - 1);
  for (let length = max; length > 0; length -= 1) {
    if (tag.startsWith(buffer.slice(buffer.length - length))) return length;
  }
  return 0;
}

/**
 * Some models (Qwen3 and friends) put their reasoning inline as
 * `<think>...</think>` in the content stream instead of a separate field.
 * This routes that to reasoning, tolerating tags split across chunks. A stray
 * `</think>` with no opener (some chat templates put the opener in the
 * prompt) is dropped rather than shown; text already streamed before it can't
 * be reclassified after the fact.
 */
export class ThinkTagFilter {
  private buffer = '';
  private inThink = false;

  push(chunk: string): Piece[] {
    this.buffer += chunk;
    const pieces: Piece[] = [];
    for (;;) {
      if (!this.inThink) {
        const open = this.buffer.indexOf(OPEN_TAG);
        const close = this.buffer.indexOf(CLOSE_TAG);
        if (close !== -1 && (open === -1 || close < open)) {
          if (close > 0) pieces.push({ kind: 'text', text: this.buffer.slice(0, close) });
          this.buffer = this.buffer.slice(close + CLOSE_TAG.length);
          continue;
        }
        if (open !== -1) {
          if (open > 0) pieces.push({ kind: 'text', text: this.buffer.slice(0, open) });
          this.buffer = this.buffer.slice(open + OPEN_TAG.length);
          this.inThink = true;
          continue;
        }
        const keep = Math.max(partialTagSuffixLength(this.buffer, OPEN_TAG), partialTagSuffixLength(this.buffer, CLOSE_TAG));
        const emit = this.buffer.slice(0, this.buffer.length - keep);
        if (emit) pieces.push({ kind: 'text', text: emit });
        this.buffer = this.buffer.slice(this.buffer.length - keep);
        return pieces;
      }
      const close = this.buffer.indexOf(CLOSE_TAG);
      if (close !== -1) {
        if (close > 0) pieces.push({ kind: 'reasoning', text: this.buffer.slice(0, close) });
        this.buffer = this.buffer.slice(close + CLOSE_TAG.length);
        this.inThink = false;
        continue;
      }
      const keep = partialTagSuffixLength(this.buffer, CLOSE_TAG);
      const emit = this.buffer.slice(0, this.buffer.length - keep);
      if (emit) pieces.push({ kind: 'reasoning', text: emit });
      this.buffer = this.buffer.slice(this.buffer.length - keep);
      return pieces;
    }
  }

  flush(): Piece[] {
    const rest = this.buffer;
    this.buffer = '';
    return rest ? [{ kind: this.inThink ? 'reasoning' : 'text', text: rest }] : [];
  }
}

interface AccumulatedCall {
  id?: string;
  name: string;
  arguments: string;
}

function finalizeCalls(accumulated: Map<number, AccumulatedCall>): Array<{ id: string; name: string; arguments: string }> {
  return [...accumulated.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, call]) => ({ id: call.id ?? `call_${randomUUID()}`, name: call.name, arguments: call.arguments }))
    .filter((call) => call.name !== '');
}

function accumulate(accumulated: Map<number, AccumulatedCall>, deltas: RawToolCallDelta[], replace: boolean): void {
  deltas.forEach((delta, position) => {
    const index = delta.index ?? position;
    const existing = accumulated.get(index) ?? { name: '', arguments: '' };
    if (delta.id) existing.id = delta.id;
    if (delta.function?.name) existing.name = replace ? delta.function.name : existing.name + delta.function.name;
    if (delta.function?.arguments) existing.arguments = replace ? delta.function.arguments : existing.arguments + delta.function.arguments;
    accumulated.set(index, existing);
  });
}

function reasoningOf(part: { reasoning_content?: string | null; reasoning?: string | null } | undefined): string {
  return part?.reasoning_content ?? part?.reasoning ?? '';
}

export async function* streamChatCompletion(options: StreamOptions): AsyncGenerator<StreamEvent> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = `${options.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
    },
    body: JSON.stringify(options.body),
    signal: options.signal,
  });

  if (!response.ok) {
    throw new LlmHttpError(response.status, await response.text().catch(() => ''));
  }

  const filter = new ThinkTagFilter();
  const accumulated = new Map<number, AccumulatedCall>();
  let finishReason: string | null = null;

  function* handleContent(content: string | null | undefined): Generator<StreamEvent> {
    if (!content) return;
    for (const piece of filter.push(content)) {
      yield piece.kind === 'text' ? { type: 'text', delta: piece.text } : { type: 'reasoning', delta: piece.text };
    }
  }

  function* handleChoice(choice: RawChoice, whole: boolean): Generator<StreamEvent> {
    const part = whole ? choice.message : choice.delta;
    const reasoning = reasoningOf(part);
    if (reasoning) yield { type: 'reasoning', delta: reasoning };
    yield* handleContent(part?.content);
    if (part?.tool_calls?.length) accumulate(accumulated, part.tool_calls, whole);
    if (choice.finish_reason) finishReason = choice.finish_reason;
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    // Server ignored stream:true and answered in one piece.
    const json = (await response.json()) as { choices?: RawChoice[]; error?: { message?: string } };
    if (json.error) throw new Error(json.error.message ?? 'LLM server returned an error');
    if (json.choices?.[0]) yield* handleChoice(json.choices[0], true);
  } else {
    if (!response.body) throw new Error('LLM server returned no response body');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let done = false;

    function* handleEvent(rawEvent: string): Generator<StreamEvent> {
      const data = rawEvent
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).replace(/^ /, ''))
        .join('\n');
      if (data === '') return;
      if (data.trim() === '[DONE]') {
        done = true;
        return;
      }
      let parsed: { choices?: RawChoice[]; error?: { message?: string } };
      try {
        parsed = JSON.parse(data);
      } catch {
        return; // keep-alive noise or a partial frame from a sloppy server
      }
      if (parsed.error) throw new Error(parsed.error.message ?? 'LLM server returned an error');
      if (parsed.choices?.[0]) yield* handleChoice(parsed.choices[0], false);
    }

    try {
      while (!done) {
        const { value, done: streamDone } = await reader.read();
        if (streamDone) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = frames.pop() ?? '';
        for (const frame of frames) {
          yield* handleEvent(frame);
          if (done) break;
        }
      }
      buffer += decoder.decode();
      if (!done && buffer.trim() !== '') yield* handleEvent(buffer);
    } finally {
      reader.cancel().catch(() => {});
    }
  }

  for (const piece of filter.flush()) {
    yield piece.kind === 'text' ? { type: 'text', delta: piece.text } : { type: 'reasoning', delta: piece.text };
  }
  const calls = finalizeCalls(accumulated);
  if (calls.length > 0) yield { type: 'tool_calls', calls };
  yield { type: 'finish', reason: finishReason };
}
