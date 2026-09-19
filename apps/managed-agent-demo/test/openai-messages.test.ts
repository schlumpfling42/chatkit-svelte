import { describe, expect, it } from 'vitest';
import type { Message, ToolDefinition } from '@chatkit-svelte/core';
import { historyFromMessages, toOpenAiTools, toolResultContent, userMessageToOpenAi } from '../src/lib/openai-messages';

const message = (role: Message['role'], parts: Message['parts'], id = 'm'): Message => ({ id, role, parts, createdAt: 0, streaming: false });
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

describe('toOpenAiTools', () => {
  it('maps chatkit tool definitions to OpenAI function tools', () => {
    const tool: ToolDefinition = { name: 'show_form', description: 'd', parameters: { type: 'object' }, executesOn: 'frontend' };
    expect(toOpenAiTools([tool])).toEqual([{ type: 'function', function: { name: 'show_form', description: 'd', parameters: { type: 'object' } } }]);
  });
});

describe('userMessageToOpenAi', () => {
  it('is a plain string for a text-only message', () => {
    expect(userMessageToOpenAi(message('user', [{ type: 'text', text: 'hi' }]))).toEqual({ role: 'user', content: 'hi' });
  });

  it('sends images as image_url parts alongside the text', () => {
    const result = userMessageToOpenAi(
      message('user', [
        { type: 'text', text: 'what is this?' },
        { type: 'image', url: 'data:image/png;base64,AAAA', mimeType: 'image/png' },
      ])
    );
    expect(result).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'what is this?' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
      ],
    });
  });

  it('supplies placeholder text for an image with no accompanying text', () => {
    const result = userMessageToOpenAi(message('user', [{ type: 'image', url: 'data:image/png;base64,AAAA', mimeType: 'image/png' }]));
    expect(result.content).toEqual([{ type: 'text', text: 'See the attached image.' }, expect.anything()]);
  });

  it('inlines a text-like file (base64 data URI) into the prompt', () => {
    const result = userMessageToOpenAi(
      message('user', [
        { type: 'text', text: 'summarize' },
        { type: 'file', url: `data:text/plain;base64,${b64('Section 1: hello')}`, name: 'notes.txt', mimeType: 'text/plain' },
      ])
    );
    expect(result.content).toContain('summarize');
    expect(result.content).toContain('[Attached file: notes.txt]');
    expect(result.content).toContain('Section 1: hello');
  });

  it('decodes utf-8 in inlined files and percent-encoded (non-base64) data URIs', () => {
    const utf8 = userMessageToOpenAi(message('user', [{ type: 'file', url: `data:text/markdown;base64,${b64('café ☕')}`, name: 'a.md', mimeType: 'text/markdown' }]));
    expect(utf8.content).toContain('café ☕');
    const pct = userMessageToOpenAi(message('user', [{ type: 'file', url: 'data:application/json,%7B%22a%22%3A1%7D', name: 'a.json', mimeType: 'application/json' }]));
    expect(pct.content).toContain('{"a":1}');
  });

  it('truncates a very large inlined file, saying so', () => {
    const result = userMessageToOpenAi(message('user', [{ type: 'file', url: `data:text/plain;base64,${b64('x'.repeat(150_000))}`, name: 'big.txt', mimeType: 'text/plain' }]));
    expect(String(result.content)).toContain('truncated, 150000 characters total');
    expect(String(result.content).length).toBeLessThan(110_000);
  });

  it('tells the model plainly when a binary file (PDF) cannot be read, instead of pretending', () => {
    const result = userMessageToOpenAi(message('user', [{ type: 'file', url: 'data:application/pdf;base64,JVBERi0=', name: 'ticket.pdf', mimeType: 'application/pdf' }]));
    expect(result.content).toContain('ticket.pdf');
    expect(result.content).toContain('could not be read');
  });

  it('carries custom parts (e.g. a submitted form result) as text', () => {
    const result = userMessageToOpenAi(message('user', [{ type: 'custom', name: 'chatkit.form.result', payload: { values: { a: 1 } } }]));
    expect(result.content).toBe('[chatkit.form.result] {"values":{"a":1}}');
  });
});

describe('toolResultContent', () => {
  it('passes strings through and JSON-encodes everything else', () => {
    expect(toolResultContent('done')).toBe('done');
    expect(toolResultContent({ created: true })).toBe('{"created":true}');
    expect(toolResultContent(undefined)).toBe('null');
  });
});

describe('historyFromMessages', () => {
  it('rebuilds user/assistant turns, including answered tool calls and their results', () => {
    const history = historyFromMessages([
      message('user', [{ type: 'text', text: 'ask me' }], 'u1'),
      message(
        'assistant',
        [
          { type: 'text', text: 'Sure.' },
          { type: 'tool_call', toolCallId: 'tc1', toolName: 'show_form', args: { a: 1 }, status: 'complete', result: { a: 1 } },
        ],
        'a1'
      ),
      message('assistant', [{ type: 'text', text: 'Thanks!' }], 'a2'),
    ]);
    expect(history).toEqual([
      { role: 'user', content: 'ask me' },
      { role: 'assistant', content: 'Sure.', tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'show_form', arguments: '{"a":1}' } }] },
      { role: 'tool', tool_call_id: 'tc1', content: '{"a":1}' },
      { role: 'assistant', content: 'Thanks!' },
    ]);
  });

  it('drops a tool call that never got a result (the API requires every call be answered) and empty assistant shells', () => {
    const history = historyFromMessages([
      message('user', [{ type: 'text', text: 'hi' }], 'u1'),
      message('assistant', [{ type: 'tool_call', toolCallId: 'tc1', toolName: 'show_form', args: {}, status: 'pending_execution' }], 'a1'),
      message('assistant', [{ type: 'text', text: '' }], 'a2'),
    ]);
    expect(history).toEqual([{ role: 'user', content: 'hi' }]);
  });
});
