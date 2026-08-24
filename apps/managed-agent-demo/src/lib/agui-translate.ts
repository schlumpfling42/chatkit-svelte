import type { ChatEvent, ContentPart, Message, Role } from '@chatkit-svelte/core';

interface AguiToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export type AguiMessage =
  | { id: string; role: 'system'; content: string }
  | { id: string; role: 'user'; content: string }
  | { id: string; role: 'assistant'; content?: string; toolCalls?: AguiToolCall[] }
  | { id: string; role: 'tool'; content: string; toolCallId: string };

function textOf(parts: ContentPart[]): string {
  return parts
    .filter((p): p is Extract<ContentPart, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('');
}

function toolCallsOf(parts: ContentPart[]): AguiToolCall[] {
  return parts
    .filter((p): p is Extract<ContentPart, { type: 'tool_call' }> => p.type === 'tool_call')
    .map((p) => ({
      id: p.toolCallId,
      type: 'function' as const,
      function: { name: p.toolName, arguments: JSON.stringify(p.args ?? {}) },
    }));
}

/**
 * Translates chatkit's Message[] (content as ContentPart[]) into the shape
 * @ag-ui/client's RunAgentInput actually expects (content as a plain string,
 * tool calls as a separate array) — see Task 3b's design note for why this
 * translation is necessary rather than a pass-through cast.
 */
export function toAguiMessages(messages: Message[]): AguiMessage[] {
  return messages.map((message): AguiMessage => {
    if (message.role === 'system') {
      return { id: message.id, role: 'system', content: textOf(message.parts) };
    }
    if (message.role === 'user') {
      return { id: message.id, role: 'user', content: textOf(message.parts) };
    }
    if (message.role === 'tool') {
      const toolCallPart = message.parts.find(
        (p): p is Extract<ContentPart, { type: 'tool_call' }> => p.type === 'tool_call'
      );
      return {
        id: message.id,
        role: 'tool',
        toolCallId: toolCallPart?.toolCallId ?? message.id,
        content: toolCallPart ? JSON.stringify(toolCallPart.result ?? null) : textOf(message.parts),
      };
    }
    // assistant
    const content = textOf(message.parts);
    const toolCalls = toolCallsOf(message.parts);
    return {
      id: message.id,
      role: 'assistant',
      ...(content ? { content } : {}),
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    };
  });
}

const TEXT_MESSAGE_ROLE: Record<string, Role> = {
  developer: 'system',
  system: 'system',
  assistant: 'assistant',
  user: 'user',
};

/**
 * Translates a real AG-UI event (from @ag-ui/client) into chatkit's
 * ChatEvent union. NOT a blind pass-through — several same-named event types
 * have different field shapes between the two protocols (see Task 3b's
 * design note). `fallbackRunId` is used for events (e.g. RUN_ERROR) whose
 * real schema doesn't reliably carry a runId of its own — the caller already
 * knows which run this event belongs to from its own subscription context.
 * Anything not explicitly mapped below is preserved losslessly as a CUSTOM
 * event rather than dropped, since this demo has no dedicated UI for
 * reasoning/activity/thinking/chunk event types but shouldn't crash or lose
 * data if the agent emits them.
 */
export function fromAguiEvent(event: { type: string; [key: string]: unknown }, fallbackRunId: string): ChatEvent {
  switch (event.type) {
    case 'RUN_STARTED':
      return { type: 'RUN_STARTED', runId: event.runId as string, threadId: event.threadId as string };
    case 'RUN_FINISHED':
      return { type: 'RUN_FINISHED', runId: event.runId as string, result: event.result };
    case 'RUN_ERROR':
      return {
        type: 'RUN_ERROR',
        runId: (event.runId as string) ?? fallbackRunId,
        error: {
          code: (event.code as string) ?? 'agent_error',
          message: event.message as string,
          recoverable: false,
          raw: event,
        },
      };
    case 'STEP_STARTED':
      return { type: 'STEP_STARTED', stepId: event.stepName as string, name: event.stepName as string };
    case 'STEP_FINISHED':
      return { type: 'STEP_FINISHED', stepId: event.stepName as string };
    case 'TEXT_MESSAGE_START':
      return {
        type: 'TEXT_MESSAGE_START',
        messageId: event.messageId as string,
        role: TEXT_MESSAGE_ROLE[event.role as string] ?? 'assistant',
      };
    case 'TEXT_MESSAGE_CONTENT':
      return { type: 'TEXT_MESSAGE_CONTENT', messageId: event.messageId as string, delta: event.delta as string };
    case 'TEXT_MESSAGE_END':
      return { type: 'TEXT_MESSAGE_END', messageId: event.messageId as string };
    case 'TOOL_CALL_START':
      return {
        type: 'TOOL_CALL_START',
        toolCallId: event.toolCallId as string,
        toolName: event.toolCallName as string,
        parentMessageId: (event.parentMessageId as string) ?? '',
      };
    case 'TOOL_CALL_ARGS':
      return { type: 'TOOL_CALL_ARGS', toolCallId: event.toolCallId as string, delta: event.delta as string };
    case 'TOOL_CALL_END':
      return { type: 'TOOL_CALL_END', toolCallId: event.toolCallId as string };
    case 'TOOL_CALL_RESULT':
      return { type: 'TOOL_CALL_RESULT', toolCallId: event.toolCallId as string, result: event.content };
    case 'STATE_SNAPSHOT':
      return { type: 'STATE_SNAPSHOT', snapshot: event.snapshot };
    case 'STATE_DELTA':
      return { type: 'STATE_DELTA', patch: event.delta as ChatEvent extends { type: 'STATE_DELTA'; patch: infer P } ? P : never };
    default:
      return { type: 'CUSTOM', name: `agui:${event.type}`, payload: event };
  }
}
