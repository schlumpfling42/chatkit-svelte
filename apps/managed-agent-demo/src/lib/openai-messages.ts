import type { ContentPart, Message, ToolDefinition } from '@chatkit-svelte/core';

export type OpenAiContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

export interface OpenAiToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export type OpenAiMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | OpenAiContentPart[] }
  | { role: 'assistant'; content: string | null; tool_calls?: OpenAiToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface OpenAiTool {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export function toOpenAiTools(tools: ToolDefinition[]): OpenAiTool[] {
  return tools.map((tool) => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }));
}

export function toolResultContent(result: unknown): string {
  return typeof result === 'string' ? result : JSON.stringify(result ?? null);
}

const MAX_INLINED_FILE_CHARS = 100_000;

const TEXT_LIKE_MIME_TYPES = new Set([
  'application/json',
  'application/xml',
  'application/x-yaml',
  'application/yaml',
  'application/javascript',
  'application/x-sh',
  'application/csv',
]);

function isTextLike(mimeType: string): boolean {
  return mimeType.startsWith('text/') || TEXT_LIKE_MIME_TYPES.has(mimeType) || mimeType.endsWith('+json') || mimeType.endsWith('+xml');
}

const DATA_URI = /^data:([^;,]*)((?:;[^;,]*)*),(.*)$/s;

function decodeDataUri(uri: string): string | undefined {
  const match = DATA_URI.exec(uri);
  if (!match) return undefined;
  const [, , params, payload] = match;
  try {
    return params.includes(';base64') ? Buffer.from(payload, 'base64').toString('utf8') : decodeURIComponent(payload);
  } catch {
    return undefined;
  }
}

function describeFile(part: Extract<ContentPart, { type: 'file' }>): string {
  if (isTextLike(part.mimeType)) {
    const decoded = decodeDataUri(part.url);
    if (decoded !== undefined) {
      const truncated = decoded.length > MAX_INLINED_FILE_CHARS;
      const body = truncated ? `${decoded.slice(0, MAX_INLINED_FILE_CHARS)}\n… (truncated, ${decoded.length} characters total)` : decoded;
      return `[Attached file: ${part.name}]\n${body}\n[End of ${part.name}]`;
    }
  }
  // This backend has no way to read binary documents (PDFs, Office files, ...):
  // say so plainly, so the model tells the user instead of pretending it read it.
  return `[Attached file: ${part.name} (${part.mimeType}) -- its contents could not be read by this assistant; tell the user if you needed it.]`;
}

function describeCustomPart(part: Extract<ContentPart, { type: 'custom' }>): string {
  return `[${part.name}] ${JSON.stringify(part.payload)}`;
}

/** A user message with its attachments, in the shape the model can actually take. */
export function userMessageToOpenAi(message: Message): OpenAiMessage {
  const texts: string[] = [];
  const images: OpenAiContentPart[] = [];

  for (const part of message.parts) {
    if (part.type === 'text') {
      if (part.text) texts.push(part.text);
    } else if (part.type === 'image') {
      images.push({ type: 'image_url', image_url: { url: part.url } });
    } else if (part.type === 'file') {
      texts.push(describeFile(part));
    } else if (part.type === 'custom') {
      texts.push(describeCustomPart(part));
    }
  }

  const text = texts.join('\n\n');
  if (images.length === 0) return { role: 'user', content: text };
  return { role: 'user', content: [{ type: 'text', text: text || 'See the attached image.' }, ...images] };
}

/**
 * Rebuilds model-facing history from the client's message list -- only used
 * when the server has none for a thread (a dev-server restart while the
 * browser tab kept its conversation). A tool call with no result yet can't be
 * replayed (the API requires every tool call be answered), so it's dropped.
 */
export function historyFromMessages(messages: Message[]): OpenAiMessage[] {
  const history: OpenAiMessage[] = [];
  for (const message of messages) {
    if (message.role === 'user') {
      history.push(userMessageToOpenAi(message));
    } else if (message.role === 'system') {
      const text = message.parts.filter((p): p is Extract<ContentPart, { type: 'text' }> => p.type === 'text').map((p) => p.text).join('');
      if (text) history.push({ role: 'system', content: text });
    } else if (message.role === 'assistant') {
      const text = message.parts
        .filter((p): p is Extract<ContentPart, { type: 'text' }> => p.type === 'text')
        .map((p) => p.text)
        .join('');
      const answered = message.parts.filter(
        (p): p is Extract<ContentPart, { type: 'tool_call' }> => p.type === 'tool_call' && p.result !== undefined
      );
      if (!text && answered.length === 0) continue;
      history.push({
        role: 'assistant',
        content: text || null,
        ...(answered.length > 0
          ? {
              tool_calls: answered.map((call) => ({
                id: call.toolCallId,
                type: 'function' as const,
                function: { name: call.toolName, arguments: JSON.stringify(call.args ?? {}) },
              })),
            }
          : {}),
      });
      for (const call of answered) {
        history.push({ role: 'tool', tool_call_id: call.toolCallId, content: toolResultContent(call.result) });
      }
    }
  }
  return history;
}
