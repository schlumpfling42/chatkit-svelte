import type { AgentCapabilities, ChatEvent, ChatTransport, RunAgentInput, ToolResult } from '@chatkit/core';
import { createDataStreamParser, type DataStreamPart } from './data-stream-parser';
import { createBridge } from './bridge';
import { toVercelMessages } from './to-vercel-messages';

export interface VercelAiTransportOptions {
  endpoint: string;
  fetchImpl?: typeof fetch;
  headers?: Record<string, string> | (() => Record<string, string>);
}

export function createVercelAiTransport(options: VercelAiTransportOptions): ChatTransport {
  const fetchImpl = options.fetchImpl ?? fetch;
  const bridge = createBridge<ChatEvent>();
  let disposed = false;
  let activeAbortController: AbortController | null = null;

  function resolveHeaders(): Record<string, string> {
    const configured = typeof options.headers === 'function' ? options.headers() : (options.headers ?? {});
    return { 'Content-Type': 'application/json', ...configured };
  }

  function connect(): AsyncIterable<ChatEvent> {
    return bridge.iterate();
  }

  function mapPart(part: DataStreamPart, ctx: { messageId: string; textOpen: boolean }): { events: ChatEvent[]; textOpen: boolean } {
    switch (part.prefix) {
      case '0': {
        const events: ChatEvent[] = [];
        if (!ctx.textOpen) events.push({ type: 'TEXT_MESSAGE_START', messageId: ctx.messageId, role: 'assistant' });
        events.push({ type: 'TEXT_MESSAGE_CONTENT', messageId: ctx.messageId, delta: part.value });
        return { events, textOpen: true };
      }
      case '3':
        return { events: [], textOpen: ctx.textOpen };
      case '9':
        return {
          events: [
            { type: 'TOOL_CALL_START', toolCallId: part.value.toolCallId, toolName: part.value.toolName, parentMessageId: ctx.messageId },
            { type: 'TOOL_CALL_ARGS', toolCallId: part.value.toolCallId, delta: JSON.stringify(part.value.args) },
            { type: 'TOOL_CALL_END', toolCallId: part.value.toolCallId },
          ],
          textOpen: ctx.textOpen,
        };
      case 'b':
        return {
          events: [{ type: 'TOOL_CALL_START', toolCallId: part.value.toolCallId, toolName: part.value.toolName, parentMessageId: ctx.messageId }],
          textOpen: ctx.textOpen,
        };
      case 'c':
        return { events: [{ type: 'TOOL_CALL_ARGS', toolCallId: part.value.toolCallId, delta: part.value.argsTextDelta }], textOpen: ctx.textOpen };
      case 'a':
        return { events: [{ type: 'TOOL_CALL_RESULT', toolCallId: part.value.toolCallId, result: part.value.result }], textOpen: ctx.textOpen };
      case 'd':
        return { events: ctx.textOpen ? [{ type: 'TEXT_MESSAGE_END', messageId: ctx.messageId }] : [], textOpen: false };
      default:
        return { events: [], textOpen: ctx.textOpen };
    }
  }

  async function sendRun(input: RunAgentInput): Promise<void> {
    activeAbortController = new AbortController();
    const messageId = crypto.randomUUID();
    let textOpen = false;
    let sawError: string | undefined;

    bridge.push({ type: 'RUN_STARTED', runId: input.runId, threadId: input.threadId });

    try {
      const response = await fetchImpl(options.endpoint, {
        method: 'POST',
        headers: resolveHeaders(),
        body: JSON.stringify({ messages: toVercelMessages(input.messages) }),
        signal: activeAbortController.signal,
      });
      if (!response.body) throw new Error('Vercel AI SDK response has no body');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const parser = createDataStreamParser();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const part of parser.push(chunk)) {
          if (part.prefix === '3') sawError = part.value;
          const { events, textOpen: nextTextOpen } = mapPart(part, { messageId, textOpen });
          textOpen = nextTextOpen;
          for (const event of events) bridge.push(event);
        }
      }

      if (sawError) {
        bridge.push({
          type: 'RUN_ERROR',
          runId: input.runId,
          error: { code: 'VERCEL_STREAM_ERROR', message: sawError, recoverable: false },
        });
        return;
      }
      bridge.push({ type: 'RUN_FINISHED', runId: input.runId });
    } catch (error) {
      if (disposed) return;
      bridge.push({
        type: 'RUN_ERROR',
        runId: input.runId,
        error: {
          code: 'VERCEL_STREAM_ERROR',
          message: error instanceof Error ? error.message : String(error),
          recoverable: false,
        },
      });
    }
  }

  // See plan decision 5: Vercel AI SDK backends conventionally receive a
  // tool's result as part of the *next* full-history POST, not a separate
  // channel — and toVercelMessages() (decision 4) doesn't carry tool-call
  // content outbound yet either, so there's nothing for this to deliver to.
  async function sendFrontendToolResult(_result: ToolResult): Promise<void> {}

  async function abortRun(_runId: string): Promise<void> {
    activeAbortController?.abort();
  }

  async function getCapabilities(): Promise<AgentCapabilities> {
    return { transports: ['http-polling'], tools: [], multimodal: false, reasoning: false, humanInTheLoop: false, sharedStateWritable: false };
  }

  function dispose(): void {
    disposed = true;
    activeAbortController?.abort();
    bridge.close();
  }

  return { connect, sendRun, sendFrontendToolResult, abortRun, getCapabilities, dispose };
}
