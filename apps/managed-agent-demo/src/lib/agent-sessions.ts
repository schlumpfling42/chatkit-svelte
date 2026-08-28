import { ManagedAgentsAgent } from '@ag-ui/claude-managed-agents';
import Anthropic, { toFile } from '@anthropic-ai/sdk';
import { randomUUID } from 'node:crypto';
import { applyPatch } from '@chatkit-svelte/core';
import type { ChatEvent, ContentPart, RunAgentInput } from '@chatkit-svelte/core';
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
  /**
   * The real Anthropic session id, learned from the `managed_agents.session`
   * CUSTOM event `@ag-ui/claude-managed-agents` emits once it creates the
   * underlying session. Needed to mount file resources mid-conversation via
   * sessions.resources.add() -- the adapter has no concept of this itself.
   */
  realSessionId: string | null;
}

const sessions = new Map<string, ThreadSession>();

// Shared with the ManagedAgentsAgent instances below, so uploads/resource
// mounts done directly (bypassing the adapter) hit the same account/session
// space it uses internally.
const anthropicClient = new Anthropic();

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
      agent: new ManagedAgentsAgent({ managedAgentId: env.agentId, environmentId: env.environmentId, client: anthropicClient }),
      events: [],
      currentState: undefined,
      activeRunId: null,
      activeSubscription: null,
      waiters: [],
      realSessionId: null,
    };
    sessions.set(threadId, session);
  }
  return session;
}

/**
 * Runs one real turn against the agent and reports its events. Pure
 * turn-taking only -- no attachment handling. `startRun` (below) is what
 * detects attachments and may call this twice: once for a text-only turn,
 * then again as a follow-up once files are mounted as session resources.
 * Resolves once the turn finishes (error or complete), so a caller can
 * await one turn before starting the next.
 */
function runTurn(session: ThreadSession, input: RunAgentInput): Promise<void> {
  return new Promise((resolveTurn) => {
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
        next: (event) => {
          const raw = event as { type: string; name?: string; value?: { sessionId?: string } };
          // Learn the real Anthropic session id as soon as the adapter
          // creates one, so a later attachment on this thread can be
          // mounted via sessions.resources.add() -- see mountAttachment().
          if (raw.type === 'CUSTOM' && raw.name === 'managed_agents.session' && raw.value?.sessionId) {
            session.realSessionId = raw.value.sessionId;
          }
          appendEvent(session, fromAguiEvent(raw, input.runId));
        },
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
          resolveTurn();
        },
        complete: () => {
          clearActiveRunIfCurrent(session, input.runId);
          resolveTurn();
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
      resolveTurn();
    }
  });
}

interface Attachment {
  kind: 'image' | 'file';
  url: string;
  mimeType: string;
  name?: string;
}

function extractAttachments(parts: ContentPart[]): Attachment[] {
  const result: Attachment[] = [];
  for (const part of parts) {
    if (part.type === 'image') result.push({ kind: 'image', url: part.url, mimeType: part.mimeType });
    else if (part.type === 'file') result.push({ kind: 'file', url: part.url, mimeType: part.mimeType, name: part.name });
  }
  return result;
}

const DATA_URI = /^data:([^;,]+)(?:;charset=[^;,]+)?;base64,(.+)$/s;

/**
 * Uploads one attachment via the Files API and mounts it into the real,
 * already-running Anthropic session as a resource. `@ag-ui/claude-managed-agents`
 * has no concept of this at all (it only wraps message turns), so this goes
 * directly through the same Anthropic client the adapter itself uses.
 * Requires `session.realSessionId` to already be known -- i.e. at least one
 * turn must have already created the real session (see runTurn's capture of
 * the `managed_agents.session` CUSTOM event).
 */
async function mountAttachment(session: ThreadSession, attachment: Attachment): Promise<string> {
  if (!session.realSessionId) {
    throw new Error('No managed session exists yet to attach files to.');
  }
  const match = DATA_URI.exec(attachment.url);
  if (!match) {
    throw new Error(
      `Attachment "${attachment.name ?? attachment.kind}" is not a data: URI -- only files this app's own upload() produced can be mounted.`
    );
  }
  const [, mimeType, base64] = match;
  const buffer = Buffer.from(base64, 'base64');
  const extension = mimeType.includes('/') ? `.${mimeType.split('/')[1]}` : '';
  const filename = attachment.name ?? `${attachment.kind}${extension}`;
  const file = await toFile(buffer, filename, { type: mimeType });
  const uploaded = await anthropicClient.beta.files.upload({ file });
  const resource = await anthropicClient.beta.sessions.resources.add(session.realSessionId, {
    file_id: uploaded.id,
    type: 'file',
  });
  return resource.mount_path;
}

export function startRun(threadId: string, input: RunAgentInput): void {
  const session = getOrCreateSession(threadId);
  const lastMessage = input.messages[input.messages.length - 1];
  const attachments = lastMessage?.role === 'user' ? extractAttachments(lastMessage.parts) : [];

  if (attachments.length === 0) {
    void runTurn(session, input);
    return;
  }

  // A newly-attached file can't be mounted until the real Anthropic session
  // exists, and creating that session is itself part of sending a turn — so
  // the first turn goes out text-only (attachments stripped from the last
  // message; a placeholder if that leaves no text at all, since the adapter
  // rejects a turn with nothing sendable). Once it completes (and
  // session.realSessionId is known), each attachment is uploaded and mounted
  // as a session resource, then a short follow-up turn tells the agent where
  // to find them.
  const strippedParts = lastMessage.parts.filter((p) => p.type !== 'image' && p.type !== 'file');
  const placeholderParts: ContentPart[] =
    strippedParts.length > 0 ? strippedParts : [{ type: 'text', text: "One moment, I'm attaching a file for you to look at." }];
  const textOnlyMessages = input.messages.map((m, i) => (i === input.messages.length - 1 ? { ...m, parts: placeholderParts } : m));

  void (async () => {
    await runTurn(session, { ...input, messages: textOnlyMessages });

    const mounts: string[] = [];
    for (const attachment of attachments) {
      try {
        const mountPath = await mountAttachment(session, attachment);
        mounts.push(`${attachment.name ?? attachment.kind} is now at ${mountPath}`);
      } catch (err) {
        appendEvent(session, {
          type: 'RUN_ERROR',
          runId: input.runId,
          error: {
            code: 'attachment_mount_failed',
            message: err instanceof Error ? err.message : String(err),
            recoverable: true,
            raw: err,
          },
        });
      }
    }
    if (mounts.length === 0) return;

    const followupMessage = {
      id: randomUUID(),
      role: 'user' as const,
      createdAt: Date.now(),
      streaming: false,
      parts: [
        {
          type: 'text' as const,
          text: `(System note: the file(s) you were just sent have been mounted into your workspace.)\n${mounts.join('\n')}\nPlease take a look and respond to the original message accordingly.`,
        },
      ],
    };
    await runTurn(session, {
      threadId,
      runId: randomUUID(),
      messages: [...textOnlyMessages, followupMessage],
      tools: input.tools,
    });
  })();
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
