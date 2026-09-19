import { randomUUID } from 'node:crypto';
import { applyPatch } from '@chatkit-svelte/core';
import type { ChatEvent, RunAgentInput, ToolDefinition } from '@chatkit-svelte/core';
import { getLlmConfig } from './env';
import type { LlmConfig } from './env';
import { streamChatCompletion } from './openai-stream';
import { historyFromMessages, toOpenAiTools, toolResultContent, userMessageToOpenAi } from './openai-messages';
import type { OpenAiMessage, OpenAiToolCall } from './openai-messages';
import { parseToolArguments } from './tool-args';

/**
 * This module is the only place that knows which AI backend is behind the
 * app: any OpenAI-compatible `/chat/completions` server (FastFlowLM by
 * default -- see env.ts). Everything upstream of it (the /api/agent routes,
 * transport-agui, every plugin) only ever sees chatkit ChatEvents, which is
 * what keeps the backend swappable.
 *
 * The server owns each thread's model-facing history. The client's message
 * list is only used for what's new (the latest user message) and to rebuild
 * history after a dev-server restart.
 */

const MAX_TOOL_ARGUMENT_RETRIES = 3;

interface ThreadSession {
  events: ChatEvent[];
  currentState: unknown;
  activeRunId: string | null;
  abort: AbortController | null;
  waiters: Array<() => void>;
  /** Model-facing conversation, excluding the system prompt (added per request). */
  history: OpenAiMessage[];
  seenUserMessageIds: Set<string>;
  /** Client tools the frontend offered on its latest run. */
  tools: Map<string, ToolDefinition>;
  /** Tool calls emitted to the client that haven't been answered yet. */
  pendingToolCalls: Set<string>;
  /** Whichever turn is in flight (or most recently was); a new turn waits on it. */
  pendingTurn: Promise<void> | null;
}

const sessions = new Map<string, ThreadSession>();

function notifyWaiters(session: ThreadSession): void {
  const waiters = session.waiters;
  session.waiters = [];
  for (const resolve of waiters) resolve();
}

function appendEvent(session: ThreadSession, event: ChatEvent): void {
  session.events.push(event);
  if (event.type === 'STATE_SNAPSHOT') {
    session.currentState = event.snapshot;
  } else if (event.type === 'STATE_DELTA') {
    const { result, ok } = applyPatch(session.currentState, event.patch);
    if (ok) session.currentState = result;
  }
  notifyWaiters(session);
}

function appendRunError(session: ThreadSession, runId: string, code: string, err: unknown, recoverable = false): void {
  appendEvent(session, {
    type: 'RUN_ERROR',
    runId,
    error: { code, message: err instanceof Error ? err.message : String(err), recoverable, raw: err },
  });
}

export function getOrCreateSession(threadId: string): ThreadSession {
  let session = sessions.get(threadId);
  if (!session) {
    session = {
      events: [],
      currentState: undefined,
      activeRunId: null,
      abort: null,
      waiters: [],
      history: [],
      seenUserMessageIds: new Set(),
      tools: new Map(),
      pendingToolCalls: new Set(),
      pendingTurn: null,
    };
    sessions.set(threadId, session);
  }
  return session;
}

function answerPendingToolCallsAsUnanswered(session: ThreadSession): void {
  // The user moved on (typed a message) instead of answering. The API
  // requires every tool call be followed by a result, so close them out.
  for (const toolCallId of session.pendingToolCalls) {
    session.history.push({ role: 'tool', tool_call_id: toolCallId, content: 'The user did not respond to this request.' });
  }
  session.pendingToolCalls.clear();
}

function syncHistory(session: ThreadSession, input: RunAgentInput): void {
  session.tools = new Map(input.tools.map((tool) => [tool.name, tool]));
  answerPendingToolCallsAsUnanswered(session);
  if (session.history.length === 0) {
    session.history = historyFromMessages(input.messages);
    for (const message of input.messages) if (message.role === 'user') session.seenUserMessageIds.add(message.id);
    return;
  }
  for (const message of input.messages) {
    if (message.role !== 'user' || session.seenUserMessageIds.has(message.id)) continue;
    session.seenUserMessageIds.add(message.id);
    session.history.push(userMessageToOpenAi(message));
  }
}

type ToolCallOutcome =
  | { call: { id: string; name: string; arguments: string }; index: number; error: string }
  | { call: { id: string; name: string; arguments: string }; index: number; error?: undefined; value: Record<string, unknown>; repaired: boolean };

interface RoundState {
  messageId: string | null;
  text: string;
  toolCalls: Array<{ id: string; name: string; arguments: string }>;
  finishReason: string | null;
}

/** One model request, streamed straight through as chat events. Fills `round` as it goes so an abort still leaves what was said. */
async function streamRound(session: ThreadSession, config: LlmConfig, round: RoundState, signal: AbortSignal): Promise<void> {
  const tools = toOpenAiTools([...session.tools.values()]);
  const body: Record<string, unknown> = {
    model: config.model,
    messages: [{ role: 'system', content: config.systemPrompt }, ...session.history],
    stream: true,
    ...(tools.length > 0 ? { tools } : {}),
  };

  let reasoningId: string | null = null;
  let leadingWhitespace = '';

  const endReasoning = () => {
    if (reasoningId) {
      appendEvent(session, { type: 'REASONING_END', messageId: reasoningId });
      reasoningId = null;
    }
  };

  for await (const event of streamChatCompletion({ baseUrl: config.baseUrl, apiKey: config.apiKey, body, signal })) {
    if (event.type === 'reasoning') {
      if (!reasoningId) {
        reasoningId = randomUUID();
        appendEvent(session, { type: 'REASONING_START', messageId: reasoningId });
      }
      appendEvent(session, { type: 'REASONING_CONTENT', messageId: reasoningId, delta: event.delta });
    } else if (event.type === 'text') {
      // Hold back leading whitespace until real text shows up: a model that
      // emits "\n" before a tool call shouldn't leave an empty message bubble.
      if (!round.messageId && event.delta.trim() === '') {
        leadingWhitespace += event.delta;
        continue;
      }
      endReasoning();
      let delta = event.delta;
      if (!round.messageId) {
        round.messageId = randomUUID();
        appendEvent(session, { type: 'TEXT_MESSAGE_START', messageId: round.messageId, role: 'assistant' });
        delta = leadingWhitespace + delta;
        leadingWhitespace = '';
      }
      round.text += delta;
      appendEvent(session, { type: 'TEXT_MESSAGE_CONTENT', messageId: round.messageId, delta });
    } else if (event.type === 'tool_calls') {
      round.toolCalls = event.calls;
    } else {
      round.finishReason = event.reason;
    }
  }
  endReasoning();
  if (round.messageId) appendEvent(session, { type: 'TEXT_MESSAGE_END', messageId: round.messageId });
}

function closeOpenMessageOnAbort(session: ThreadSession, round: RoundState): void {
  if (round.messageId) appendEvent(session, { type: 'TEXT_MESSAGE_END', messageId: round.messageId });
  if (round.text) session.history.push({ role: 'assistant', content: round.text });
}

async function executeRun(session: ThreadSession, threadId: string, runId: string, signal: AbortSignal): Promise<void> {
  appendEvent(session, { type: 'RUN_STARTED', runId, threadId });
  let config: LlmConfig;
  try {
    config = getLlmConfig();
  } catch (err) {
    appendRunError(session, runId, 'llm_not_configured', err);
    return;
  }

  let argumentRetries = 0;
  for (;;) {
    const round: RoundState = { messageId: null, text: '', toolCalls: [], finishReason: null };
    try {
      await streamRound(session, config, round, signal);
    } catch (err) {
      if (signal.aborted) {
        closeOpenMessageOnAbort(session, round);
        return;
      }
      appendRunError(session, runId, 'llm_request_failed', err);
      return;
    }
    if (signal.aborted) {
      closeOpenMessageOnAbort(session, round);
      return;
    }

    if (round.toolCalls.length === 0) {
      if (round.text) session.history.push({ role: 'assistant', content: round.text });
      appendEvent(session, { type: 'RUN_FINISHED', runId });
      return;
    }

    const assistantToolCalls: OpenAiToolCall[] = round.toolCalls.map((call) => ({
      id: call.id,
      type: 'function',
      function: { name: call.name, arguments: call.arguments },
    }));
    session.history.push({ role: 'assistant', content: round.text || null, tool_calls: assistantToolCalls });

    const truncated = round.finishReason === 'length';
    const outcomes: ToolCallOutcome[] = round.toolCalls.map((call, index): ToolCallOutcome => {
      if (!session.tools.has(call.name)) {
        return { call, index, error: `Unknown tool "${call.name}". Available tools: ${[...session.tools.keys()].join(', ') || 'none'}.` };
      }
      if (truncated) return { call, index, error: 'Your output was cut off before the tool call finished. Call it again with shorter arguments.' };
      const parsed = parseToolArguments(call.arguments);
      if (!parsed.ok) return { call, index, error: `${parsed.error} Call it again with valid JSON arguments (escape quotes and newlines inside strings).` };
      return { call, index, value: parsed.value, repaired: parsed.repaired };
    });

    if (outcomes.some((o) => o.error !== undefined)) {
      // Nothing broken reaches the UI. Every call still needs an answer, so
      // each gets a tool result and the model gets another try.
      for (const outcome of outcomes) {
        session.history.push({
          role: 'tool',
          tool_call_id: outcome.call.id,
          content: outcome.error ?? 'Not run: another tool call in the same response was invalid. Call it again.',
        });
      }
      appendEvent(session, {
        type: 'CUSTOM',
        name: 'llm.tool_call_rejected',
        payload: { calls: outcomes.map((o) => ({ name: o.call.name, arguments: o.call.arguments, error: o.error })) },
      });
      argumentRetries += 1;
      if (argumentRetries > MAX_TOOL_ARGUMENT_RETRIES) {
        appendRunError(session, runId, 'tool_arguments_invalid', new Error('The model kept producing invalid tool-call arguments.'), true);
        return;
      }
      continue;
    }

    // All valid: canonicalize the stored arguments (so repaired JSON never
    // poisons later requests) and hand the calls to the client.
    let parentMessageId = round.messageId;
    if (!parentMessageId) {
      // A tool call as the model's first action has no message to hang on.
      parentMessageId = randomUUID();
      appendEvent(session, { type: 'TEXT_MESSAGE_START', messageId: parentMessageId, role: 'assistant' });
      appendEvent(session, { type: 'TEXT_MESSAGE_END', messageId: parentMessageId });
    }
    for (const outcome of outcomes) {
      if (outcome.error !== undefined) continue;
      const args = JSON.stringify(outcome.value);
      assistantToolCalls[outcome.index].function.arguments = args;
      if (outcome.repaired) {
        appendEvent(session, {
          type: 'CUSTOM',
          name: 'llm.tool_arguments_repaired',
          payload: { toolCallId: outcome.call.id, toolName: outcome.call.name, raw: outcome.call.arguments },
        });
      }
      appendEvent(session, { type: 'TOOL_CALL_START', toolCallId: outcome.call.id, toolName: outcome.call.name, parentMessageId });
      appendEvent(session, { type: 'TOOL_CALL_ARGS', toolCallId: outcome.call.id, delta: args });
      appendEvent(session, { type: 'TOOL_CALL_END', toolCallId: outcome.call.id });
      session.pendingToolCalls.add(outcome.call.id);
    }
    // Parked: the run ends here and resumes when the last answer arrives (sendToolResult).
    appendEvent(session, { type: 'RUN_FINISHED', runId });
    return;
  }
}

function startTurn(session: ThreadSession, threadId: string, runId: string, prepare?: () => void): Promise<void> {
  const previous = session.pendingTurn;
  const turn = (async () => {
    // Starting a run replaces whatever is in flight: cancel it and wait for
    // it to actually unwind, so two turns never write history concurrently.
    if (session.abort) session.abort.abort();
    if (previous) await previous;

    const controller = new AbortController();
    session.abort = controller;
    session.activeRunId = runId;
    try {
      prepare?.();
      await executeRun(session, threadId, runId, controller.signal);
    } catch (err) {
      if (!controller.signal.aborted) appendRunError(session, runId, 'agent_error', err);
    } finally {
      if (session.activeRunId === runId) {
        session.activeRunId = null;
        session.abort = null;
      }
    }
  })();
  session.pendingTurn = turn;
  return turn;
}

export function startRun(threadId: string, input: RunAgentInput): void {
  const session = getOrCreateSession(threadId);
  // Deferred into the turn so history is only touched once any previous turn has unwound.
  void startTurn(session, threadId, input.runId, () => syncHistory(session, input));
}

/**
 * `ToolResult` (what transport-agui's sendFrontendToolResult POSTs to
 * /tool-results) carries a toolCallId but no threadId -- the transport
 * contract just doesn't include one. Scanning each thread's own event log
 * for the TOOL_CALL_START that introduced this id is how the tool-results
 * route recovers which thread it belongs to.
 */
export function findSessionByToolCallId(toolCallId: string): { threadId: string; session: ThreadSession } | undefined {
  for (const [threadId, session] of sessions) {
    if (session.events.some((e) => e.type === 'TOOL_CALL_START' && e.toolCallId === toolCallId)) {
      return { threadId, session };
    }
  }
  return undefined;
}

/**
 * Delivers a client tool's result to the model, and once every tool call
 * from that model response has been answered, resumes the conversation.
 */
export function sendToolResult(threadId: string, toolCallId: string, result: unknown): void {
  const session = sessions.get(threadId);
  if (!session || !session.pendingToolCalls.has(toolCallId)) return;
  session.pendingToolCalls.delete(toolCallId);
  session.history.push({ role: 'tool', tool_call_id: toolCallId, content: toolResultContent(result) });
  if (session.pendingToolCalls.size === 0) {
    void startTurn(session, threadId, randomUUID());
  }
}

export async function* subscribeFromIndex(
  threadId: string,
  fromIndex: number
): AsyncGenerator<{ index: number; event: ChatEvent }> {
  const session = getOrCreateSession(threadId);
  let index = fromIndex;
  while (true) {
    while (index < session.events.length) {
      yield { index, event: session.events[index] };
      index += 1;
    }
    // Known limitation: a consumer that abandons this generator while parked
    // here (SSE client disconnect) leaves its resolver in session.waiters
    // until the next event -- fine for a local demo process.
    await new Promise<void>((resolve) => {
      session.waiters.push(resolve);
    });
  }
}

export function getCurrentState(threadId: string): unknown {
  return getOrCreateSession(threadId).currentState;
}

export function findSessionByRunId(runId: string): { threadId: string; session: ThreadSession } | undefined {
  for (const [threadId, session] of sessions) {
    if (session.activeRunId === runId) return { threadId, session };
  }
  return undefined;
}

export function abortRun(threadId: string): void {
  sessions.get(threadId)?.abort?.abort();
}

/** Test-only: clears all in-memory sessions between test cases. */
export function __resetSessionsForTest(): void {
  sessions.clear();
}
