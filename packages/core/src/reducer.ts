import { applyPatch } from './json-patch';
import type { ActivityItem, ChatEvent, ChatState, ContentPart, Message } from './types';

export const initialState = (initial?: unknown): ChatState => ({
  messages: [],
  runStatus: 'idle',
  sharedState: initial ?? null,
  activities: [],
  steps: [],
  artifacts: {},
  error: null,
});

function mapMessage(messages: Message[], messageId: string, fn: (m: Message) => Message): Message[] {
  return messages.map((m) => (m.id === messageId ? fn(m) : m));
}

function appendText(message: Message, delta: string): Message {
  const parts = [...message.parts];
  const lastTextIndex = [...parts].reverse().findIndex((p) => p.type === 'text');
  if (lastTextIndex === -1) {
    parts.push({ type: 'text', text: delta });
  } else {
    const index = parts.length - 1 - lastTextIndex;
    const existing = parts[index] as ContentPart & { type: 'text' };
    parts[index] = { ...existing, text: existing.text + delta };
  }
  return { ...message, parts };
}

function findToolCallMessage(messages: Message[], toolCallId: string): Message | undefined {
  return messages.find((m) => m.parts.some((p) => p.type === 'tool_call' && p.toolCallId === toolCallId));
}

function mapToolCall(
  messages: Message[],
  toolCallId: string,
  fn: (tc: ContentPart & { type: 'tool_call' }) => ContentPart & { type: 'tool_call' }
): Message[] {
  const owner = findToolCallMessage(messages, toolCallId);
  if (!owner) return messages;
  return mapMessage(messages, owner.id, (m) => ({
    ...m,
    parts: m.parts.map((p) => (p.type === 'tool_call' && p.toolCallId === toolCallId ? fn(p) : p)),
  }));
}

// TOOL_CALL_START seeds args as {} (a placeholder object, not a string). The
// first TOOL_CALL_ARGS delta must start a fresh string accumulation rather
// than concatenating onto "[object Object]", so any non-string current value
// is treated as an empty accumulator.
function appendJsonFragment(current: unknown, delta: string): unknown {
  const currentStr = typeof current === 'string' ? current : '';
  return currentStr + delta;
}

function parseToolCallArgs(args: unknown): unknown {
  if (typeof args !== 'string') return args;
  try {
    return JSON.parse(args);
  } catch {
    return args;
  }
}

function upsertActivity(activities: ActivityItem[], messageId: string, data: unknown): ActivityItem[] {
  const index = activities.findIndex((a) => a.messageId === messageId);
  if (index === -1) {
    // ACTIVITY_SNAPSHOT/DELTA carry no `kind` on the wire; default to
    // 'generic' for a newly created activity and preserve it on updates.
    return [...activities, { id: messageId, messageId, kind: 'generic', data }];
  }
  const next = [...activities];
  next[index] = { ...next[index], data };
  return next;
}

export function reduceEvent(state: ChatState, event: ChatEvent): ChatState {
  switch (event.type) {
    case 'RUN_STARTED':
      return { ...state, runStatus: 'running', error: null };
    case 'RUN_FINISHED':
      return { ...state, runStatus: 'idle' };
    case 'RUN_ERROR':
      return { ...state, runStatus: 'error', error: event.error };
    case 'STEP_STARTED':
      return {
        ...state,
        steps: [...state.steps, { id: event.stepId, name: event.name, status: 'started', parentStepId: event.parentStepId }],
      };
    case 'STEP_FINISHED':
      return { ...state, steps: state.steps.map((s) => (s.id === event.stepId ? { ...s, status: 'finished' } : s)) };
    case 'TEXT_MESSAGE_START':
      return {
        ...state,
        messages: [
          ...state.messages,
          { id: event.messageId, role: event.role, parts: [{ type: 'text', text: '' }], createdAt: Date.now(), streaming: true },
        ],
      };
    case 'TEXT_MESSAGE_CONTENT':
      return { ...state, messages: mapMessage(state.messages, event.messageId, (m) => appendText(m, event.delta)) };
    case 'TEXT_MESSAGE_END':
      return { ...state, messages: mapMessage(state.messages, event.messageId, (m) => ({ ...m, streaming: false })) };
    case 'TOOL_CALL_START':
      return {
        ...state,
        messages: mapMessage(state.messages, event.parentMessageId, (m) => ({
          ...m,
          parts: [
            ...m.parts,
            { type: 'tool_call', toolCallId: event.toolCallId, toolName: event.toolName, args: {}, status: 'streaming_args' },
          ],
        })),
      };
    case 'TOOL_CALL_ARGS':
      return {
        ...state,
        messages: mapToolCall(state.messages, event.toolCallId, (tc) => ({ ...tc, args: appendJsonFragment(tc.args, event.delta) })),
      };
    case 'TOOL_CALL_END':
      return {
        ...state,
        messages: mapToolCall(state.messages, event.toolCallId, (tc) => ({
          ...tc,
          args: parseToolCallArgs(tc.args),
          status: 'pending_execution',
        })),
      };
    case 'TOOL_CALL_RESULT':
      return {
        ...state,
        messages: mapToolCall(state.messages, event.toolCallId, (tc) => ({
          ...tc,
          status: event.isError ? 'error' : 'complete',
          result: event.result,
        })),
      };
    case 'REASONING_START':
      return {
        ...state,
        messages: [
          ...state.messages,
          { id: event.messageId, role: 'assistant', parts: [{ type: 'reasoning', text: '' }], createdAt: Date.now(), streaming: true },
        ],
      };
    case 'REASONING_CONTENT':
      return {
        ...state,
        messages: mapMessage(state.messages, event.messageId, (m) => ({
          ...m,
          parts: m.parts.map((p) => (p.type === 'reasoning' ? { ...p, text: p.text + event.delta, encrypted: event.encrypted } : p)),
        })),
      };
    case 'REASONING_END':
      return { ...state, messages: mapMessage(state.messages, event.messageId, (m) => ({ ...m, streaming: false })) };
    case 'STATE_SNAPSHOT':
      return { ...state, sharedState: event.snapshot };
    case 'STATE_DELTA': {
      const { result, ok } = applyPatch(state.sharedState, event.patch);
      // Conflict → caller (transport layer, later milestone) is responsible for
      // requesting a fresh STATE_SNAPSHOT; the reducer just surfaces a
      // recoverable error and keeps last-known-good state.
      return ok
        ? { ...state, sharedState: result }
        : { ...state, error: { code: 'STATE_PATCH_CONFLICT', message: 'Failed to apply state patch', recoverable: true } };
    }
    case 'MESSAGES_SNAPSHOT':
      return { ...state, messages: event.messages };
    case 'ACTIVITY_SNAPSHOT':
      return { ...state, activities: upsertActivity(state.activities, event.messageId, event.data) };
    case 'ACTIVITY_DELTA': {
      const existing = state.activities.find((a) => a.messageId === event.messageId);
      const { result, ok } = applyPatch(existing?.data ?? {}, event.patch);
      // Unlike STATE_DELTA, a failed activity patch fails silently: activities
      // are frontend-only cosmetic status (progress bars, etc.), not
      // authoritative agent state, so there's nothing worth surfacing an error for.
      return ok ? { ...state, activities: upsertActivity(state.activities, event.messageId, result) } : state;
    }
    case 'CUSTOM':
      // Forms/documents/generic artifacts are routed through registered
      // ArtifactReducers by the plugin host (a later milestone); core has no
      // built-in knowledge of artifact shapes.
      return state;
    case 'RAW':
      return state;
    default:
      return state;
  }
}
