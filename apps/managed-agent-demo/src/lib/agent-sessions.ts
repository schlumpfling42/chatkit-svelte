import { ManagedAgentsAgent } from '@ag-ui/claude-managed-agents';
import type { SessionRecord, SessionStore } from '@ag-ui/claude-managed-agents';
import Anthropic, { toFile } from '@anthropic-ai/sdk';
import { randomUUID } from 'node:crypto';
import { applyPatch } from '@chatkit-svelte/core';
import type { ChatEvent, ContentPart, RunAgentInput } from '@chatkit-svelte/core';
import { getManagedAgentEnv } from './env';
import { fromAguiEvent, toAguiMessages } from './agui-translate';

interface Subscription {
  unsubscribe: () => void;
}

/**
 * `@ag-ui/claude-managed-agents` looks up/stores its thread↔session mapping
 * under an opaque, undocumented-format key -- by design (see its own
 * `SessionStore` doc comment: "treat it as a string to store under, not as
 * a thread id to parse"). Since agent-sessions.ts already constructs one
 * `ManagedAgentsAgent` per thread (see getOrCreateSession below), each
 * instance's store only ever needs to hold that one thread's single record,
 * so it never needs to understand the key at all -- just remember whatever
 * was last set, and let a pre-seeded record short-circuit the adapter's own
 * session creation. That's what makes the single-turn attachment flow in
 * startRun() below possible: pre-create the real session with files already
 * attached as resources, seed this store with it, then let the adapter's
 * next getOrCreateSession() call find it already there.
 */
class SingleRecordSessionStore implements SessionStore {
  private record: SessionRecord | undefined;
  get(): SessionRecord | undefined {
    return this.record;
  }
  set(_key: string, record: SessionRecord): void {
    this.record = record;
  }
  delete(): void {
    this.record = undefined;
  }
  seed(record: SessionRecord): void {
    this.record = record;
  }
}

interface ThreadSession {
  agent: ManagedAgentsAgent;
  sessionStore: SingleRecordSessionStore;
  events: ChatEvent[];
  currentState: unknown;
  activeRunId: string | null;
  activeSubscription: Subscription | null;
  waiters: Array<() => void>;
  /**
   * The real Anthropic session id. Either learned from the
   * `managed_agents.session` CUSTOM event the adapter emits once it creates
   * a session itself, or set directly by startRun() when it pre-creates one
   * for a first message that carries an attachment.
   */
  realSessionId: string | null;
}

const sessions = new Map<string, ThreadSession>();

// Shared with the ManagedAgentsAgent instances below, so uploads/session
// creation/resource mounts done directly (bypassing the adapter for what it
// doesn't expose) hit the same account/session space it uses internally.
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

function appendRunError(session: ThreadSession, runId: string, code: string, err: unknown, recoverable = false): void {
  appendEvent(session, {
    type: 'RUN_ERROR',
    runId,
    error: {
      code,
      message: err instanceof Error ? err.message : String(err),
      recoverable,
      raw: err,
    },
  });
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
    const sessionStore = new SingleRecordSessionStore();
    session = {
      agent: new ManagedAgentsAgent({ managedAgentId: env.agentId, environmentId: env.environmentId, client: anthropicClient, sessionStore }),
      sessionStore,
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
 * turn-taking only -- attachment handling (uploading, mounting, and
 * rewriting the outgoing message) happens in startRun below, before this is
 * ever called. Resolves once the turn finishes (error or complete).
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
          // creates one itself (the no-attachment path never pre-creates
          // one, so this is still how that path learns it).
          if (raw.type === 'CUSTOM' && raw.name === 'managed_agents.session' && raw.value?.sessionId) {
            session.realSessionId = raw.value.sessionId;
          }
          appendEvent(session, fromAguiEvent(raw, input.runId));
        },
        error: (err: unknown) => {
          appendRunError(session, input.runId, 'managed_agent_error', err);
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
      appendRunError(session, input.runId, 'managed_agent_error', err);
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

function attachmentFilename(attachment: Attachment): string {
  const extension = attachment.mimeType.includes('/') ? `.${attachment.mimeType.split('/')[1]}` : '';
  return attachment.name ?? `${attachment.kind}${extension}`;
}

/** Uploads one attachment's bytes via the Files API. Throws if `url` isn't a
 * data: URI -- only files this app's own upload() produced can be handled,
 * since there's no other source of raw bytes to upload here. */
async function uploadAttachment(attachment: Attachment): Promise<string> {
  const match = DATA_URI.exec(attachment.url);
  if (!match) {
    throw new Error(`Attachment "${attachment.name ?? attachment.kind}" is not a data: URI -- only files this app's own upload() produced can be mounted.`);
  }
  const [, mimeType, base64] = match;
  const buffer = Buffer.from(base64, 'base64');
  const file = await toFile(buffer, attachmentFilename(attachment), { type: mimeType });
  const uploaded = await anthropicClient.beta.files.upload({ file });
  return uploaded.id;
}

/**
 * Uploads and mounts one attachment into a session that already exists,
 * via sessions.resources.add() -- @ag-ui/claude-managed-agents doesn't
 * expose this at all, so it's done directly against the same Anthropic
 * client the adapter itself uses. Requires `session.realSessionId`.
 */
async function mountOnExistingSession(session: ThreadSession, attachment: Attachment): Promise<string> {
  if (!session.realSessionId) {
    throw new Error('No managed session exists yet to attach files to.');
  }
  const fileId = await uploadAttachment(attachment);
  const resource = await anthropicClient.beta.sessions.resources.add(session.realSessionId, { file_id: fileId, type: 'file' });
  return resource.mount_path;
}

/**
 * Uploads every attachment and pre-creates the real Anthropic session with
 * them already attached as resources, seeding the thread's SessionStore so
 * the adapter's next run() call finds this session instead of making its
 * own. This is what lets a first message with an attachment reach the agent
 * in a single turn, with the file already mounted, instead of the
 * text-only-turn-then-follow-up dance a lazily-created session would need.
 */
async function createSessionWithAttachments(session: ThreadSession, attachments: Attachment[]): Promise<Map<Attachment, string>> {
  const env = getManagedAgentEnv();
  const fileIds = await Promise.all(attachments.map(uploadAttachment));
  const created = await anthropicClient.beta.sessions.create({
    agent: env.agentId,
    environment_id: env.environmentId,
    resources: fileIds.map((file_id) => ({ type: 'file' as const, file_id })),
  });
  session.realSessionId = created.id;
  session.sessionStore.seed({ sessionId: created.id, toolNames: [], pendingClientToolUseIds: [] });

  const mountPaths = new Map<Attachment, string>();
  for (let i = 0; i < attachments.length; i += 1) {
    const resource = created.resources.find((r) => r.type === 'file' && r.file_id === fileIds[i]);
    if (resource && resource.type === 'file') mountPaths.set(attachments[i], resource.mount_path);
  }
  return mountPaths;
}

export function startRun(threadId: string, input: RunAgentInput): void {
  const session = getOrCreateSession(threadId);
  const lastMessage = input.messages[input.messages.length - 1];
  const attachments = lastMessage?.role === 'user' ? extractAttachments(lastMessage.parts) : [];

  if (attachments.length === 0) {
    void runTurn(session, input);
    return;
  }

  void (async () => {
    const mountNotes: string[] = [];
    try {
      if (session.realSessionId) {
        // A session already exists for this thread -- mount straight into
        // it, then send one turn. No need to pre-create anything.
        for (const attachment of attachments) {
          const mountPath = await mountOnExistingSession(session, attachment);
          mountNotes.push(`${attachmentFilename(attachment)} → ${mountPath}`);
        }
      } else {
        // No session yet for this thread. Creating one is normally
        // something the adapter does lazily on the first turn -- pre-empt
        // that so the files are already mounted before the agent ever sees
        // this message, avoiding a separate "I don't see anything" turn.
        const mountPaths = await createSessionWithAttachments(session, attachments);
        for (const attachment of attachments) {
          const mountPath = mountPaths.get(attachment);
          if (mountPath) mountNotes.push(`${attachmentFilename(attachment)} → ${mountPath}`);
        }
      }
    } catch (err) {
      appendRunError(session, input.runId, 'attachment_mount_failed', err, true);
    }

    const strippedParts = lastMessage.parts.filter((p) => p.type !== 'image' && p.type !== 'file');
    const noteText =
      mountNotes.length > 0
        ? `\n\n(System note: the attached file(s) are available in your workspace at:\n${mountNotes.join('\n')})`
        : '';
    const finalParts: ContentPart[] =
      strippedParts.length > 0 || !noteText
        ? [...strippedParts, ...(noteText ? [{ type: 'text' as const, text: noteText.trim() }] : [])]
        : [{ type: 'text', text: noteText.trim() }];
    const finalMessages = input.messages.map((m, i) => (i === input.messages.length - 1 ? { ...m, parts: finalParts } : m));

    await runTurn(session, { ...input, messages: finalMessages });
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
