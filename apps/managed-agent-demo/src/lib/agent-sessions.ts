import { ManagedAgentsAgent } from '@ag-ui/claude-managed-agents';
import { applyPatch } from '@chatkit-svelte/core';
import type { ChatEvent, RunAgentInput } from '@chatkit-svelte/core';
import { getManagedAgentEnv } from './env';
import { fromAguiEvent, toAguiMessages } from './agui-translate';

interface Subscription {
  unsubscribe: () => void;
}

interface ThreadSession {
  agent: ManagedAgentsAgent;
  events: ChatEvent[];
  currentState: unknown;
  activeRunId: string | null;
  activeSubscription: Subscription | null;
  waiters: Array<() => void>;
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
    // Mirrors transport-agui's own emitWithStateGuard self-heal pattern: on
    // a patch that fails to apply, leave currentState as the last known-good
    // snapshot rather than corrupt it. Unlike the client-side version, there
    // is no server to fetch a fresh snapshot from here, so this is as far as
    // the self-heal can go.
    const { result, ok } = applyPatch(session.currentState, event.patch);
    if (ok) {
      session.currentState = result;
    }
  }
  notifyWaiters(session);
}

/**
 * Clears the active-run bookkeeping only if it still belongs to `runId`.
 * A run's `error`/`complete` callback can fire after a newer run has
 * already replaced it (e.g. a slow teardown racing a fresh `startRun` call)
 * — without this guard, the stale callback would clobber the newer run's
 * `activeRunId`/`activeSubscription`.
 */
function clearActiveRunIfCurrent(session: ThreadSession, runId: string): void {
  if (session.activeRunId !== runId) return;
  session.activeRunId = null;
  session.activeSubscription = null;
}

export function getOrCreateSession(threadId: string): ThreadSession {
  let session = sessions.get(threadId);
  if (!session) {
    const env = getManagedAgentEnv();
    session = {
      agent: new ManagedAgentsAgent({ managedAgentId: env.agentId, environmentId: env.environmentId }),
      events: [],
      currentState: undefined,
      activeRunId: null,
      activeSubscription: null,
      waiters: [],
    };
    sessions.set(threadId, session);
  }
  return session;
}

export function startRun(threadId: string, input: RunAgentInput): void {
  const session = getOrCreateSession(threadId);
  // A thread can only have one active run at a time: starting a new one
  // replaces whatever was already in flight rather than running alongside it.
  if (session.activeSubscription) {
    session.activeSubscription.unsubscribe();
  }
  session.activeRunId = input.runId;
  session.activeSubscription = null;
  // `ManagedAgentsAgent.run()` takes @ag-ui/client's own `RunAgentInput` (a
  // different, wire-level message/tool shape than @chatkit-svelte/core's
  // `RunAgentInput`) and emits @ag-ui/client's `BaseEvent` union (a superset
  // of @chatkit-svelte/core's `ChatEvent`, with several same-named fields
  // renamed and a handful of event types ChatEvent doesn't have at all).
  // `toAguiMessages`/`fromAguiEvent` (see agui-translate.ts) do the real
  // field-level translation. `messages` is converted below; `tools`
  // type-checks as-is (both sides use a compatible flat {name, description,
  // parameters} shape). `context` is dropped rather than translated: chatkit
  // types it as `Record<string, unknown>` but AG-UI expects
  // `{value, description}[]`, and nothing in this codebase populates or
  // reads it today, so there's no real shape to translate — inventing one
  // would just be guessing. AG-UI's `context` field is required (not
  // optional), so we pass an empty array rather than omitting the key.
  const { context: _unusedContext, ...rest } = input;
  const agentInput = { ...rest, messages: toAguiMessages(input.messages), context: [] };
  try {
    session.activeSubscription = session.agent.run(agentInput).subscribe({
      next: (event) => appendEvent(session, fromAguiEvent(event as { type: string }, input.runId)),
      error: (err: unknown) => {
        appendEvent(session, {
          type: 'RUN_ERROR',
          runId: input.runId,
          error: {
            code: 'managed_agent_error',
            message: err instanceof Error ? err.message : String(err),
            recoverable: false,
            raw: err,
          },
        });
        clearActiveRunIfCurrent(session, input.runId);
      },
      complete: () => {
        clearActiveRunIfCurrent(session, input.runId);
      },
    });
  } catch (err) {
    // `.run()` itself threw synchronously (before returning an Observable to
    // subscribe to) — there is no subscription to hold, so don't leave the
    // session stuck thinking a run is still active.
    clearActiveRunIfCurrent(session, input.runId);
    appendEvent(session, {
      type: 'RUN_ERROR',
      runId: input.runId,
      error: {
        code: 'managed_agent_error',
        message: err instanceof Error ? err.message : String(err),
        recoverable: false,
        raw: err,
      },
    });
  }
}

// Known limitation: if a consumer abandons this generator while parked on
// the `await` below (e.g. an SSE client disconnects), its resolver stays in
// `session.waiters` forever instead of being actively cleaned up — it just
// never gets called again. Fine for a short-lived demo process; a
// longer-lived server would need a real cancellation path (e.g. tied to the
// request's AbortSignal) to avoid the array growing unbounded.
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
  const session = sessions.get(threadId);
  if (!session) return;
  session.activeSubscription?.unsubscribe();
  session.activeSubscription = null;
  session.activeRunId = null;
}

/** Test-only: clears all in-memory sessions between test cases. */
export function __resetSessionsForTest(): void {
  sessions.clear();
}
