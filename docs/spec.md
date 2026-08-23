# Svelte 5 Agentic Chat Framework — Implementation Spec
**Working name:** `chatkit-svelte` (rename freely)
**Status:** Draft v0.2 — comprehensive, implementation-ready
**Target runtime:** Svelte 5 (runes), SvelteKit optional (framework must not require it)

---

## 0. How to read this spec

Sections 1–7 are architecture (stable, shouldn't need changes). Sections 8–13 are
full reference implementations — types, reducer, transport, plugin host, store —
written close to final form so a team can implement against them directly rather
than re-deriving the design. Section 14 covers the two new content-generation
plugin families (**forms** and **documents**) in the same depth as file-handling.
Sections 15–22 cover styling/theming, persistence, security, a11y, i18n, build
tooling, the CLI, testing, and versioning. Everything under "Styling" is
intentionally left as tokens/hooks rather than a finished look — that's the one
piece meant for visual tweaking per-project.

---

## 1. Goals & Non-Goals

### Goals

- Spin up a fully working AG-UI-compatible chat client in minutes with sane defaults.
- First-class support for the **AG-UI protocol** (event-based, streaming, snapshot/delta state), with an adapter layer so other transports (plain SSE/JSON, Vercel AI SDK data stream protocol, WebSocket-based custom protocols) can be plugged in later without touching UI code.
- A **plugin system** as the primary extension mechanism — file handling, form generation, document/artifact creation, custom message renderers, tool-call UI, slash commands, telemetry, etc. are all plugins, including the ones shipped by default.
- Config-driven setup: a consumer should be able to get a working chat with a config object + one component, and progressively eject/override pieces.
- Headless-core / themed-shell split: business logic and protocol handling must work with zero styling opinions; a default themed UI ships on top, restyle-only via CSS variables/Tailwind preset.
- Svelte 5 idioms throughout: runes-based stores (`$state`, `$derived`, `$effect`), snippets instead of slots-as-strings, no legacy stores unless needed for interop.
- Production concerns handled out of the box: reconnect/backoff, offline queueing, XSS-safe rendering, accessible components, i18n-ready strings.

### Non-Goals (v1)

- Not a hosted backend or agent runtime — this is a **client** framework. It talks to an AG-UI-compliant (or adapted) server.
- Not attempting to implement MCP or A2A directly — those live server-side; the framework only needs to *render* what AG-UI surfaces from them (tool calls, sub-agent steps, etc.).
- No built-in generative-UI DSL renderer in v1 (AG-UI's declarative generative-UI spec is still emerging) — leave an extension point (see 5.3) instead.
- No built-in real-time multi-user collaborative editing (Yjs/CRDT-style) for the document plugin in v1 — single-user-editing-while-agent-streams only. Flagged as a v2 candidate.

---

## 2. High-Level Architecture

```
┌───────────────────────────────────────────────────────────────────┐
│  App (consumer)                                                   │
│  <ChatProvider config={...}> <ChatWindow /> </ChatProvider>       │
├───────────────────────────────────────────────────────────────────┤
│  UI Layer (@chatkit-svelte/ui)                                            │
│  Themed components + headless primitives, snippet-based render     │
│  slots for messages / tools / attachments / forms / documents      │
├───────────────────────────────────────────────────────────────────┤
│  Plugin Runtime (@chatkit-svelte/core → PluginHost)                       │
│  Lifecycle hooks, capability registration, extension-point registry │
├───────────────────────────────────────────────────────────────────┤
│  Session/State Layer (@chatkit-svelte/core → ChatStore)                   │
│  Runes-based reactive store: threads, messages, run state,          │
│  shared agent state (snapshot+JSON Patch), tool calls, artifacts    │
├───────────────────────────────────────────────────────────────────┤
│  Transport Layer (@chatkit-svelte/core → ChatTransport interface)         │
│  AG-UI SSE/WebSocket client (default), pluggable adapters          │
├───────────────────────────────────────────────────────────────────┤
│  Wire Protocols: AG-UI (default) │ Vercel AI SDK │ custom          │
└───────────────────────────────────────────────────────────────────┘
```

### Package layout (monorepo, pnpm workspaces)

```
packages/
  core/                  # framework-agnostic: transport contracts, reducer, plugin host, types, JSON Patch
  svelte/                # svelte 5 bindings: runes stores wrapping core, context provider, headless primitives
  ui/                     # themed component library (CSS-variable theme + optional Tailwind preset)
  transport-agui/        # AG-UI protocol client (SSE + WebSocket + HTTP fallback, reconnect/backoff)
  transport-vercel-ai/   # optional adapter for Vercel AI SDK data stream protocol
  plugin-file-handling/
  plugin-markdown/
  plugin-tool-render/
  plugin-forms/          # agent-driven dynamic forms
  plugin-documents/      # agent-authored documents / artifact canvas
  plugin-devtools/       # event log / inspector overlay
  cli/                   # `create-chatkit` scaffolding tool
apps/
  playground/            # SvelteKit demo app used for e2e + visual testing, exercises every plugin
docs/
  fixtures/              # recorded AG-UI event-stream JSON fixtures used by unit + conformance tests
```

`core` has **no Svelte dependency, no DOM dependency**. This matters for
testability (pure functions run in Node under Vitest with no jsdom) and for
reusing protocol/plugin logic from a future non-Svelte binding.

---

## 3. Wire Protocol Layer

### 3.1 AG-UI as the primary transport

AG-UI is an open, event-based protocol (from CopilotKit) that standardizes
bidirectional streaming between agent backends and frontends, and is
transport-agnostic (HTTP/SSE/WebSocket) rather than tied to a specific
rendering target. The default transport (`transport-agui`) implements the
AG-UI event model directly against `/v1/*`-style endpoints (path configurable).

**AG-UI event categories implemented:**

| Category | Events |
|---|---|
| Lifecycle | `RUN_STARTED`, `RUN_FINISHED`, `RUN_ERROR`, `STEP_STARTED`, `STEP_FINISHED` |
| Text messages | `TEXT_MESSAGE_START`, `TEXT_MESSAGE_CONTENT`, `TEXT_MESSAGE_END`, `TEXT_MESSAGE_CHUNK` |
| Tool calls | `TOOL_CALL_START`, `TOOL_CALL_ARGS`, `TOOL_CALL_END`, `TOOL_CALL_RESULT`, `TOOL_CALL_CHUNK` |
| Reasoning | `REASONING_START`, `REASONING_MESSAGE_START/CONTENT/END`, `REASONING_END`, `REASONING_ENCRYPTED_VALUE` |
| State sync | `STATE_SNAPSHOT` (full replace), `STATE_DELTA` (RFC 6902 JSON Patch) |
| Messages sync | `MESSAGES_SNAPSHOT` (full history — reconnect/branch recovery) |
| Activity (frontend-only, never re-sent to the agent) | `ACTIVITY_SNAPSHOT`, `ACTIVITY_DELTA` |
| Escape hatches | `RAW`, `CUSTOM` — **this is the hook the forms/documents plugins use to carry structured payloads** (see §14) |

**Client → server:** a `RunAgentInput` (thread id, run id, messages, tools,
state, context) is POSTed to start a run; the response is the event stream.
Frontend tool calls resolve back into the conversation as tool-result messages
appended to the *next* run's input.

### 3.2 Transport interface

```ts
// packages/core/src/transport.ts
export interface RunAgentInput {
  threadId: string;
  runId: string;
  messages: Message[];
  tools: ToolDefinition[];
  state?: unknown;
  context?: Record<string, unknown>;
  forwardedProps?: Record<string, unknown>;
}

export interface AgentCapabilities {
  transports: ('sse' | 'websocket' | 'http-polling')[];
  tools: string[];
  multimodal: boolean;
  reasoning: boolean;
  humanInTheLoop: boolean;
  sharedStateWritable: boolean;
}

export interface ChatTransport {
  /** Open (or resume) the event stream for a thread. Returns an async iterable of normalized events. */
  connect(session: { threadId: string; resumeToken?: string }): AsyncIterable<ChatEvent>;
  /** Start a new run. May be a fire-and-forget POST (events arrive via connect()) or return its own stream. */
  sendRun(input: RunAgentInput): Promise<void>;
  /** Deliver a frontend-executed tool's result back to the agent. */
  sendFrontendToolResult(result: ToolResult): Promise<void>;
  /** Cooperatively cancel an in-flight run. */
  abortRun(runId: string): Promise<void>;
  /** Optional capability negotiation, called once at connect time if the server supports it. */
  getCapabilities?(): Promise<AgentCapabilities>;
  /** Clean up sockets/listeners. */
  dispose(): void;
}
```

Other backends (a Vercel AI SDK data-stream endpoint, a bespoke WebSocket
protocol) are supported by writing a transport that **normalizes into the same
`ChatEvent` union** the reducer consumes. UI and plugin layers never see raw
wire formats.

### 3.3 AG-UI transport implementation notes (`transport-agui`)

- **SSE by default**, WebSocket opt-in (`{ mode: 'sse' | 'websocket' }`).
- Reconnect strategy: exponential backoff (`base=500ms, factor=2, max=15s, jitter=±20%`), capped retry count configurable (`maxRetries`, default `Infinity` with backoff ceiling — chat UIs should keep trying).
- On reconnect, request `MESSAGES_SNAPSHOT` (or replay from `resumeToken`/last seen `eventId` if the server supports cursoring) rather than assuming delta continuity.
- `STATE_DELTA` application failures (patch doesn't apply cleanly) trigger an automatic request for a fresh `STATE_SNAPSHOT` rather than surfacing an error to the user.
- All outbound requests carry an `Idempotency-Key` header (UUID per logical send) so retried POSTs on flaky networks don't double-submit a run.
- Backpressure: incoming events are pushed into a bounded async queue (default 500); if the UI thread can't keep up (rare, but possible on huge tool-arg streams), oldest *non-terminal* events for the same `messageId`/`toolCallId` are coalesced rather than dropped arbitrarily.

### 3.4 Reducer

A pure function `reduceEvent(state, event) → state` (in `core`, fully
unit-testable, no Svelte) turns the event stream into:

- `messages: Message[]` — role, content parts, tool calls, streaming partials keyed by `messageId`.
- `runStatus: RunStatus` — `'idle' | 'running' | 'awaiting_tool' | 'awaiting_approval' | 'error'`.
- `sharedState: unknown` — JSON-Patch-applied agent state, read-only or read-write per config.
- `activities: ActivityItem[]` — frontend-only, e.g. progress bars/status.
- `steps: StepInfo[]` — sub-agent/step visualization.
- `artifacts: ArtifactRecord[]` — documents/forms/generic structured payloads surfaced via `CUSTOM` events (see §14); this is what the forms/documents plugins render from.

The Svelte store layer wraps this reducer in `$state` and re-runs it per
incoming event; it never reimplements protocol logic itself.

---

## 4. Core Type Definitions (reference — `packages/core/src/types.ts`)

```ts
export type Role = 'user' | 'assistant' | 'system' | 'tool';

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; url: string; alt?: string; mimeType: string }
  | { type: 'file'; url: string; name: string; mimeType: string; sizeBytes?: number }
  | { type: 'tool_call'; toolCallId: string; toolName: string; args: unknown; status: ToolCallStatus; result?: unknown }
  | { type: 'reasoning'; text: string; encrypted?: boolean }
  | { type: 'artifact_ref'; artifactId: string; kind: ArtifactKind } // form / document reference (§14)
  | { type: 'custom'; name: string; payload: unknown };

export type ToolCallStatus =
  | 'streaming_args'
  | 'pending_execution'
  | 'awaiting_approval'
  | 'executing'
  | 'complete'
  | 'error'
  | 'rejected';

export interface Message {
  id: string;
  role: Role;
  parts: ContentPart[];
  createdAt: number;
  streaming: boolean; // true while any part is still being appended to
}

export type ArtifactKind = 'form' | 'document' | 'generic';

export interface ArtifactRecord {
  id: string;
  kind: ArtifactKind;
  version: number;                 // incremented on every update; drives diffing/undo
  createdByMessageId: string;
  data: unknown;                   // shape depends on kind — see §14
  status: 'draft' | 'streaming' | 'final' | 'submitted' | 'error';
}

export type RunStatus = 'idle' | 'running' | 'awaiting_tool' | 'awaiting_approval' | 'error';

export interface ChatState {
  messages: Message[];
  runStatus: RunStatus;
  sharedState: unknown;
  activities: ActivityItem[];
  steps: StepInfo[];
  artifacts: Record<string, ArtifactRecord>;
  error: ChatError | null;
}

export interface ActivityItem { id: string; messageId: string; kind: string; data: unknown; }
export interface StepInfo { id: string; name: string; status: 'started' | 'finished'; parentStepId?: string; }
export interface ChatError { code: string; message: string; recoverable: boolean; raw?: unknown; }
export interface ToolDefinition { name: string; description: string; parameters: JSONSchema; executesOn: 'frontend' | 'backend'; }
export interface ToolResult { toolCallId: string; result: unknown; isError?: boolean; }

// The normalized event union the reducer consumes — transports map wire events into this.
export type ChatEvent =
  | { type: 'RUN_STARTED'; runId: string; threadId: string }
  | { type: 'RUN_FINISHED'; runId: string; result?: unknown }
  | { type: 'RUN_ERROR'; runId: string; error: ChatError }
  | { type: 'STEP_STARTED'; stepId: string; name: string; parentStepId?: string }
  | { type: 'STEP_FINISHED'; stepId: string }
  | { type: 'TEXT_MESSAGE_START'; messageId: string; role: Role }
  | { type: 'TEXT_MESSAGE_CONTENT'; messageId: string; delta: string }
  | { type: 'TEXT_MESSAGE_END'; messageId: string }
  | { type: 'TOOL_CALL_START'; toolCallId: string; toolName: string; parentMessageId: string }
  | { type: 'TOOL_CALL_ARGS'; toolCallId: string; delta: string }
  | { type: 'TOOL_CALL_END'; toolCallId: string }
  | { type: 'TOOL_CALL_RESULT'; toolCallId: string; result: unknown; isError?: boolean }
  | { type: 'REASONING_START'; messageId: string }
  | { type: 'REASONING_CONTENT'; messageId: string; delta: string; encrypted?: boolean }
  | { type: 'REASONING_END'; messageId: string }
  | { type: 'STATE_SNAPSHOT'; snapshot: unknown }
  | { type: 'STATE_DELTA'; patch: JsonPatchOperation[] }
  | { type: 'MESSAGES_SNAPSHOT'; messages: Message[] }
  | { type: 'ACTIVITY_SNAPSHOT'; messageId: string; data: unknown }
  | { type: 'ACTIVITY_DELTA'; messageId: string; patch: JsonPatchOperation[] }
  | { type: 'CUSTOM'; name: string; payload: unknown }
  | { type: 'RAW'; payload: unknown };

export interface JsonPatchOperation { op: 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test'; path: string; value?: unknown; from?: string; }

export type JSONSchema = Record<string, unknown>;
```

---

## 5. Reducer Reference Implementation (`packages/core/src/reducer.ts`)

```ts
import { applyPatch } from './json-patch';
import type { ChatState, ChatEvent, Message, ContentPart } from './types';

export const initialState = (initial?: unknown): ChatState => ({
  messages: [],
  runStatus: 'idle',
  sharedState: initial ?? null,
  activities: [],
  steps: [],
  artifacts: {},
  error: null,
});

export function reduceEvent(state: ChatState, event: ChatEvent): ChatState {
  switch (event.type) {
    case 'RUN_STARTED':
      return { ...state, runStatus: 'running', error: null };
    case 'RUN_FINISHED':
      return { ...state, runStatus: 'idle' };
    case 'RUN_ERROR':
      return { ...state, runStatus: 'error', error: event.error };
    case 'STEP_STARTED':
      return { ...state, steps: [...state.steps, { id: event.stepId, name: event.name, status: 'started', parentStepId: event.parentStepId }] };
    case 'STEP_FINISHED':
      return { ...state, steps: state.steps.map(s => s.id === event.stepId ? { ...s, status: 'finished' } : s) };
    case 'TEXT_MESSAGE_START':
      return {
        ...state,
        messages: [...state.messages, { id: event.messageId, role: event.role, parts: [{ type: 'text', text: '' }], createdAt: Date.now(), streaming: true }],
      };
    case 'TEXT_MESSAGE_CONTENT':
      return { ...state, messages: mapMessage(state.messages, event.messageId, m => appendText(m, event.delta)) };
    case 'TEXT_MESSAGE_END':
      return { ...state, messages: mapMessage(state.messages, event.messageId, m => ({ ...m, streaming: false })) };
    case 'TOOL_CALL_START':
      return {
        ...state,
        messages: mapMessage(state.messages, event.parentMessageId, m => ({
          ...m,
          parts: [...m.parts, { type: 'tool_call', toolCallId: event.toolCallId, toolName: event.toolName, args: {}, status: 'streaming_args' }],
        })),
      };
    case 'TOOL_CALL_ARGS':
      return { ...state, messages: mapToolCall(state.messages, event.toolCallId, tc => ({ ...tc, args: appendJsonFragment(tc.args, event.delta) })) };
    case 'TOOL_CALL_END':
      return { ...state, messages: mapToolCall(state.messages, event.toolCallId, tc => ({ ...tc, status: 'pending_execution' })) };
    case 'TOOL_CALL_RESULT':
      return { ...state, messages: mapToolCall(state.messages, event.toolCallId, tc => ({ ...tc, status: event.isError ? 'error' : 'complete', result: event.result })) };
    case 'STATE_SNAPSHOT':
      return { ...state, sharedState: event.snapshot };
    case 'STATE_DELTA': {
      const { result, ok } = applyPatch(state.sharedState, event.patch);
      // Conflict → caller (transport layer) is responsible for requesting a fresh STATE_SNAPSHOT;
      // reducer just surfaces a recoverable error and keeps last-known-good state.
      return ok ? { ...state, sharedState: result } : { ...state, error: { code: 'STATE_PATCH_CONFLICT', message: 'Failed to apply state patch', recoverable: true } };
    }
    case 'MESSAGES_SNAPSHOT':
      return { ...state, messages: event.messages };
    case 'ACTIVITY_SNAPSHOT':
      return { ...state, activities: upsertActivity(state.activities, event.messageId, event.data) };
    case 'ACTIVITY_DELTA': {
      const existing = state.activities.find(a => a.messageId === event.messageId);
      const { result, ok } = applyPatch(existing?.data ?? {}, event.patch);
      return ok ? { ...state, activities: upsertActivity(state.activities, event.messageId, result) } : state;
    }
    case 'CUSTOM':
      // Forms/documents/generic artifacts are surfaced here — delegated to a
      // registered artifact handler (see §14.4) rather than hardcoded in core.
      return state; // artifact reducer middleware wraps this in practice — see below
    default:
      return state;
  }
}

// --- helpers (mapMessage, appendText, mapToolCall, appendJsonFragment, upsertActivity) omitted for brevity ---
```

> **Artifact middleware:** `CUSTOM` events with `name` matching a registered
> artifact type (`chatkit.form.*`, `chatkit.document.*`) are routed through a
> small **reducer middleware chain** (`ArtifactReducer[]`, one per artifact
> kind, registered by the forms/documents plugins) before falling through to
> the default no-op. This keeps `core` ignorant of what a "form" or
> "document" actually is — see §14.4 for the exact contract.

---

## 6. Plugin Host Reference Implementation (`packages/core/src/plugin-host.ts`)

```ts
export interface PluginContext {
  getState(): ChatState;
  dispatch(event: ChatEvent): void;
  sendRun(input: Partial<RunAgentInput>): Promise<void>;
  logger: { debug: Fn; warn: Fn; error: Fn };
  storage: { get<T>(key: string): T | undefined; set<T>(key: string, value: T): void }; // plugin-scoped, namespaced by plugin name
  config: ChatConfig;
}

export interface ChatPlugin {
  name: string;
  version: string;
  setup?(ctx: PluginContext): void | (() => void);
  hooks?: {
    onInit?(ctx: PluginContext): void;
    beforeSend?(input: UserInput, ctx: PluginContext): UserInput | Promise<UserInput>;
    onEvent?(event: ChatEvent, ctx: PluginContext): void;
    onMessage?(message: Message, ctx: PluginContext): void;
    onToolCall?(call: ToolCall, ctx: PluginContext): ToolResult | Promise<ToolResult> | void;
    onError?(error: ChatError, ctx: PluginContext): void;
  };
  artifactReducers?: ArtifactReducer[];                 // §14.4 — how forms/documents hook the reducer
  messageRenderers?: MessageRendererRegistration[];
  toolRenderers?: Record<string, ToolRendererComponent>;
  artifactRenderers?: Record<ArtifactKind, ArtifactRendererComponent>; // §14
  slashCommands?: SlashCommand[];
  inputTransforms?: InputTransform[];
  attachmentHandlers?: AttachmentHandler[];
}

export function createPluginHost(plugins: ChatPlugin[]) {
  const seen = new Set<string>();
  for (const p of plugins) {
    if (seen.has(p.name)) throw new Error(`[chatkit] duplicate plugin name "${p.name}"`);
    seen.add(p.name);
  }

  const registry = {
    artifactReducers: indexByKind(plugins.flatMap(p => p.artifactReducers ?? [])),
    messageRenderers: sortByPriority(plugins.flatMap(p => p.messageRenderers ?? [])),
    toolRenderers: Object.assign({}, ...plugins.map(p => p.toolRenderers ?? {})),
    artifactRenderers: Object.assign({}, ...plugins.map(p => p.artifactRenderers ?? {})),
    slashCommands: plugins.flatMap(p => p.slashCommands ?? []),
    inputTransforms: plugins.flatMap(p => p.inputTransforms ?? []),
    attachmentHandlers: plugins.flatMap(p => p.attachmentHandlers ?? []),
  };

  const teardowns: Array<() => void> = [];

  function init(ctx: PluginContext) {
    for (const p of plugins) {
      const t = p.setup?.(ctx);
      if (typeof t === 'function') teardowns.push(t);
      p.hooks?.onInit?.(ctx);
    }
  }

  async function runHook<K extends keyof NonNullable<ChatPlugin['hooks']>>(
    hook: K, arg: any, ctx: PluginContext
  ) {
    let value = arg;
    for (const p of plugins) {
      const fn = p.hooks?.[hook] as any;
      if (!fn) continue;
      const out = await fn(value, ctx);
      if (out !== undefined) value = out; // pipeline semantics for beforeSend; fire-and-forget for observers
    }
    return value;
  }

  function dispose() { teardowns.forEach(t => t()); }

  return { registry, init, runHook, dispose };
}
```

### 6.1 Extension points in detail

| Extension point | Purpose |
|---|---|
| `messageRenderers` | Map a content-part `type` to a Svelte component. Resolved by priority + type match; falls back to a default renderer. |
| `toolRenderers` | Map a tool name (or `'*'` wildcard) to a component rendering streaming args + result. Used for generative-UI-style tool visualizations. |
| `artifactRenderers` | One component per `ArtifactKind` (`form`, `document`, `generic`) — the forms/documents plugins register these. |
| `artifactReducers` | Middleware that turns `CUSTOM` events into `ArtifactRecord` updates (§14.4). |
| `attachmentHandlers` | Intercept files before upload: validation, transformation, producing the AG-UI-compatible content part. |
| `slashCommands` | Local, client-only commands (`/clear`, `/export`, `/model gpt-x`). |
| `inputTransforms` | Modify composer input pre-send: drag-drop, paste-as-file, @mentions. |
| `onToolCall` | Implement **frontend tool calls** (AG-UI supports agent → frontend tool execution and back). |

### 6.2 Ordering & conflicts

- Renderers resolved by `priority` (higher wins), tie-broken by registration order.
- `beforeSend` composes as a pipeline; each plugin receives the previous plugin's output.
- Duplicate plugin `name` → thrown error at construction time, not a silent overwrite.
- Duplicate `artifactRenderers` for the same `ArtifactKind`, or duplicate `toolRenderers` for the same tool name, throw at `createPluginHost` time — same fail-fast policy as duplicate plugin names.

---

## 7. Svelte 5 State Layer (`packages/svelte/src/chat-store.svelte.ts`)

```ts
import { reduceEvent, initialState } from '@chatkit-svelte/core';
import { createPluginHost } from '@chatkit-svelte/core';
import { createTransport } from '@chatkit-svelte/core';

export function createChatStore(config: ChatConfig) {
  let state = $state(initialState(config.initialState));
  let currentRunId: string | null = null;

  const transport = createTransport(config.transport);
  const pluginHost = createPluginHost(config.plugins ?? []);

  const ctx: PluginContext = {
    getState: () => state,
    dispatch: (event) => { state = reduceEvent(state, event); },
    sendRun: (partial) => startRun(partial),
    logger: scopedLogger('chatkit'),
    storage: pluginScopedStorage(config.persistence),
    config,
  };

  pluginHost.init(ctx);

  const pendingApprovals = $derived(
    state.messages.flatMap(m => m.parts).filter(
      (p): p is ContentPart & { type: 'tool_call' } => p.type === 'tool_call' && p.status === 'awaiting_approval'
    )
  );

  const documents = $derived(Object.values(state.artifacts).filter(a => a.kind === 'document'));
  const forms = $derived(Object.values(state.artifacts).filter(a => a.kind === 'form'));

  async function consumeStream(stream: AsyncIterable<ChatEvent>) {
    for await (const event of stream) {
      await pluginHost.runHook('onEvent', event, ctx);
      state = reduceEvent(state, event);
      const approvalNeeded = detectApprovalNeeded(state, config.humanInTheLoop);
      if (approvalNeeded) state = { ...state, runStatus: 'awaiting_approval' };
    }
  }

  async function startRun(partial: Partial<RunAgentInput>) {
    currentRunId = crypto.randomUUID();
    const input: RunAgentInput = {
      threadId: config.threadId ?? 'default',
      runId: currentRunId,
      messages: state.messages,
      tools: config.tools ?? [],
      state: state.sharedState,
      ...partial,
    };
    await transport.sendRun(input);
  }

  async function sendMessage(input: UserInput) {
    const processed = await pluginHost.runHook('beforeSend', input, ctx);
    state = { ...state, messages: [...state.messages, userInputToMessage(processed)] };
    await startRun({});
  }

  async function approveToolCall(toolCallId: string) { /* resolve status, resume run via sendFrontendToolResult or re-run */ }
  async function rejectToolCall(toolCallId: string, reason?: string) { /* mark rejected, send result */ }
  async function editAndRetry(toolCallId: string, newArgs: unknown) { /* mutate args, re-execute */ }

  const stream = transport.connect({ threadId: config.threadId ?? 'default' });
  consumeStream(stream);

  return {
    get state() { return state },
    get messages() { return state.messages },
    get runStatus() { return state.runStatus },
    get sharedState() { return state.sharedState },
    get pendingApprovals() { return pendingApprovals },
    get documents() { return documents },
    get forms() { return forms },
    registry: pluginHost.registry,
    sendMessage,
    abort: () => currentRunId && transport.abortRun(currentRunId),
    approveToolCall, rejectToolCall, editAndRetry,
    dispose: () => { pluginHost.dispose(); transport.dispose(); },
  };
}
```

Exposed via Svelte context (`setContext`/`getContext`) so nested components
call `getChatContext()` instead of prop-drilling. `$effect` is used only at
component boundaries (auto-scroll, persistence side-effects, focus
management) — never inside `core`.

---

## 8. Configuration System

Single `ChatConfig`, validated with `valibot` (lighter than `zod`, tree-shakes
well for a client bundle) so misconfiguration fails fast with readable errors
at `createChatStore` time, not at first event.

```ts
interface ChatConfig {
  threadId?: string;
  transport: TransportConfig;
  tools?: ToolDefinition[];
  plugins?: ChatPlugin[];
  theme?: ThemeConfig;
  initialState?: unknown;
  humanInTheLoop?: {
    autoApproveTools?: string[];
    requireApprovalFor?: string[];
  };
  persistence?: PersistenceAdapter;
  i18n?: I18nConfig;
  telemetry?: TelemetryHook;
  limits?: {
    maxAttachmentBytes?: number;
    maxMessagesInMemory?: number; // older messages virtualized/paged, not discarded from persistence
  };
}
```

Config can be provided at the `<ChatProvider>` root and *partially* overridden
per `<ChatWindow>` instance for multi-thread UIs (e.g. a dashboard with
several concurrent agent panels, each with its own `threadId`).

---

## 9. UI Component Layer

Two tiers:

1. **Headless primitives** (`@chatkit-svelte/svelte`): `getChatContext()`,
   `useThread(id)` — no markup, no CSS. Lets consumers build fully custom UI.
2. **Themed components** (`@chatkit-svelte/ui`): `<ChatWindow>`, `<MessageList>`,
   `<Composer>`, `<ToolCallCard>`, `<ApprovalBar>`, `<ThreadSidebar>`,
   `<FormRenderer>`, `<DocumentCanvas>` (§14). Built from the primitives,
   using **Svelte 5 snippets** for every customizable region:

```svelte
<ChatWindow>
  {#snippet message(msg)}
    {#if msg.role === 'assistant'}
      <AssistantBubble {msg} />
    {:else}
      <UserBubble {msg} />
    {/if}
  {/snippet}

  {#snippet composerActions()}
    <AttachmentButton />
    <SendButton />
  {/snippet}
</ChatWindow>
```

Every themed component accepts a `class` / `style` override and reads only
from the CSS variable tokens defined in §15 — no hardcoded colors, spacing
constants, or font stacks anywhere in `@chatkit-svelte/ui`'s source. This is what
makes the package "tweak, don't rewrite": a consumer can restyle the entire
surface by overriding the token set in one CSS file.

---

## 10. Human-in-the-loop & Interrupts

AG-UI treats HITL as ordinary conversation plus explicit approval-style tool
calls rather than a dedicated "pause" primitive, so the framework implements:

- `runStatus === 'awaiting_approval'` when a tool call matches `humanInTheLoop.requireApprovalFor`.
- `<ApprovalBar>` + `approveToolCall()/rejectToolCall()/editAndRetry()`, which resume the run by sending the appropriate tool result back through the transport.
- Abort/cancel closes the event stream and, where the transport supports it, sends an explicit cancellation signal (AG-UI doesn't mandate one; `transport-agui` sends `DELETE /runs/:runId` if the server advertises that capability via `getCapabilities()`, else just stops consuming and lets the server time out).
- Document and form artifacts (§14) that require explicit user submission/approval before being sent back to the agent reuse this same `awaiting_approval` status rather than inventing a parallel state machine.

---

## 11. Persistence

```ts
export interface PersistenceAdapter {
  loadThread(threadId: string): Promise<ChatState | null>;
  saveThread(threadId: string, state: ChatState): Promise<void>;
  listThreads(): Promise<{ id: string; title: string; updatedAt: number }[]>;
  deleteThread(threadId: string): Promise<void>;
}
```

Ships three implementations:

- `memoryPersistence()` — default, no persistence across reload.
- `localStoragePersistence()` — simple, size-limited (warns above ~4MB serialized).
- `indexedDbPersistence()` — recommended for real use; stores messages and artifacts (including document version history) in separate object stores so large documents don't bloat every read.

Saves are debounced (default 400ms) off the `$effect` boundary in `svelte`,
never inside `core`. Persistence is opt-in per `ChatConfig.persistence`; the
framework does not silently persist conversation content anywhere by default
(privacy-by-default).

---

## 12. Security Considerations

- **Rendered content is never raw HTML from the agent by default.** The markdown plugin (§13) parses to a restricted AST and renders via Svelte components — no `{@html}` of unsanitized model output. If a plugin *does* need `{@html}`, it must run content through `dompurify` (or equivalent) first; this is enforced by a lint rule in the repo (`no-raw-html-without-sanitize`).
- **File attachments**: `attachmentHandlers` validate MIME type and size *before* upload; the framework never trusts the browser-reported MIME type alone for anything security-sensitive server-side — that's a server concern, but the client-side check still fails fast with a clear error rather than silently uploading.
- **Tool-call args and results are data, not code.** Nothing in `core` or `ui` ever `eval`s or dynamically imports based on agent-supplied strings. `toolRenderers` are registered ahead of time by the app developer, keyed by a fixed tool name — the agent can pick *which* registered renderer runs, never *what code* runs.
- **CUSTOM events are schema-validated** by the matching `artifactReducer` before being merged into state (§14.4); malformed payloads are dropped with a logged warning, not thrown into the UI as-is.
- **CSP guidance** documented for consumers: framework ships no inline `<script>`/inline `style` attributes that would require `unsafe-inline`.

---

## 13. Baseline Plugins

### 13.1 `plugin-file-handling`

```ts
export function fileHandlingPlugin(opts: FileHandlingOptions = {}): ChatPlugin {
  return {
    name: 'file-handling',
    version: '1.0.0',
    attachmentHandlers: [{
      accept: opts.accept ?? ['image/*', 'application/pdf', 'text/*'],
      maxSizeBytes: opts.maxSizeBytes ?? 25 * 1024 * 1024,
      async process(file, ctx) {
        const uploaded = await opts.upload(file, ctx.abortSignal);
        return { type: 'file', mimeType: file.type, name: file.name, url: uploaded.url };
      },
    }],
    messageRenderers: [
      { partType: 'file', component: FileAttachmentRenderer, priority: 10 },
      { partType: 'image', component: ImagePreviewRenderer, priority: 10 },
    ],
    inputTransforms: [dragDropTransform(), pasteFileTransform()],
  };
}
```

### 13.2 `plugin-markdown`

Streaming-safe markdown renderer (handles partial/unterminated syntax
gracefully while `streaming: true`), code block syntax highlighting (Shiki,
lazy-loaded per language), copy-to-clipboard on code blocks.

### 13.3 `plugin-tool-render`

Generic fallback tool-call visualization (collapsible args/result JSON view)
for any tool without a custom `toolRenderer` registered — ensures no tool call
ever renders as raw JSON dumped in the chat by accident.

### 13.4 `plugin-devtools`

Overlay logging raw wire events + reducer state diffs, toggled via config
flag. Also exposes an "export fixture" button that dumps the current event
sequence in the exact format the test fixtures use (§18) — closes the loop
between a bug seen in the playground and a regression test.

---

## 14. Forms & Documents (new in this revision)

Both are modeled as **artifacts**: agent-produced structured payloads that
live alongside the message stream, get their own `ArtifactRecord`, and are
rendered by a dedicated full-width component rather than squeezed into a chat
bubble — the same conceptual shape as "generative UI" in AG-UI's terminology,
implemented here concretely instead of waiting on the still-emerging
declarative-UI sub-spec.

### 14.1 Transport convention

Both plugins are transport-agnostic in the same way the rest of the framework
is: they consume `CUSTOM` AG-UI events with a reserved `name` prefix.

| Event name | Meaning |
|---|---|
| `chatkit.form.snapshot` | Full form definition (JSON Schema + UI hints) — creates or fully replaces a form artifact. |
| `chatkit.form.result` | *Client → server*, sent as a tool result / follow-up message when the user submits. |
| `chatkit.document.snapshot` | Full document content + metadata — creates or fully replaces a document artifact. |
| `chatkit.document.delta` | Incremental content patch (RFC 6902 over the document's JSON representation) — used while the agent is actively drafting/streaming into the doc. |
| `chatkit.document.comment` | Optional: agent leaves an inline comment/suggestion on a range, rendered like a review comment. |

This keeps the actual AG-UI wire contract untouched (still just `CUSTOM`
events with a payload) — any AG-UI-compliant backend can emit these without
protocol changes, and a backend that doesn't know about forms/documents just
never emits them.

### 14.2 `plugin-forms`

**Purpose:** let the agent ask the user to fill out structured input —
booking details, preferences, multi-field confirmation — instead of doing it
turn-by-turn in chat.

**Payload shape (`chatkit.form.snapshot`):**

```ts
interface FormArtifactData {
  schema: JSONSchema;              // standard JSON Schema (draft 2020-12 subset)
  uiSchema?: UiSchemaHints;        // widget hints: field order, groupings, widget type overrides, help text
  submitLabel?: string;
  initialValues?: Record<string, unknown>;
  mode: 'single-submit' | 'live';  // live = value changes stream back via STATE_DELTA-style updates as the user types, for agents that want to react mid-fill
}

interface UiSchemaHints {
  order?: string[];
  widgets?: Record<string, 'text' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'date' | 'file' | 'slider'>;
  groups?: { title: string; fields: string[] }[];
}
```

**Rendering:** `<FormRenderer artifact={artifact} />` (registered as the
`ArtifactKind: 'form'` renderer) generates inputs from the JSON Schema using a
small internal schema-to-form mapper (no heavy dependency — hand-rolled
switch over `type`/`format`/`enum`), applies client-side validation from the
schema (`required`, `minLength`, `pattern`, `minimum`/`maximum`, etc.) before
allowing submit, and is fully keyboard-navigable (§16).

**Submission flow:**

1. User fills fields; local validation runs on blur + on submit attempt.
2. On submit, `store.submitForm(artifactId, values)` is called.
3. Plugin's `beforeSend`-equivalent packages `values` into a
   `chatkit.form.result` custom message part and a corresponding tool result
   if the form was itself presented as a tool call (both patterns supported —
   `presentedAs: 'tool_call' | 'artifact'` in the snapshot payload disambiguates).
4. Artifact status flips `draft → submitted`; the rendered form becomes
   read-only (shows submitted values), matching the "already answered"
   pattern users expect from chat forms.

**Extension points exposed by this plugin for further customization:**

- `widgetOverrides` option to register custom field components per JSON
  Schema `format` (e.g. a phone-number input, an address autocomplete).
- `onBeforeSubmit(values) => values | Promise<values>` hook for
  client-side enrichment (e.g. attach a computed field) before the result is sent.

### 14.3 `plugin-documents`

**Purpose:** a Claude-Artifacts-style canvas where the agent drafts/edits a
document (markdown, or a constrained rich-text JSON doc model) that the user
can read alongside the conversation, edit themselves, and export — rather
than the document's content being pasted inline as chat text.

**Payload shape:**

```ts
interface DocumentArtifactData {
  title: string;
  format: 'markdown' | 'richtext';   // richtext = ProseMirror-style JSON doc, for tables/structured docs
  content: string | RichTextDoc;
  editable: boolean;                 // can the user edit, or is it agent-authored/read-only
  exportFormats?: ('md' | 'docx' | 'pdf' | 'txt')[];
}
```

**Streaming behavior:** while the agent drafts, `chatkit.document.delta`
events arrive as the document is written; the canvas renders these
incrementally (same "watch it being written" feel as streamed chat text, but
scoped to the document pane, not the message list). Once the agent finishes,
status flips to `final`, at which point `editable: true` documents become
user-editable in place.

**Editing model (v1, single-user):**

- Markdown documents: a lightweight editable text area with a live-preview
  toggle (not a full WYSIWYG in v1 — keeps the dependency footprint small).
- Richtext documents: a minimal ProseMirror-based editor instance
  (`@chatkit-svelte/plugin-documents` depends on `prosemirror-*` directly rather than
  pulling in a larger editor framework) supporting headings, lists, bold/
  italic, tables, and links — the intersection of "common agent-authored
  document" needs, not a general word processor.
- Every user edit bumps `ArtifactRecord.version` and is diffable against the
  prior version (stored via the persistence layer's version history table, see §11) —
  this is what powers an "agent revises based on your edit" loop: the next
  run's `RunAgentInput.context` includes the diff, not just the final text, so
  the agent can see *what the user changed* rather than only the end state.

**Export:** `exportDocument(artifactId, format)` on the store. `md`/`txt` are
trivial serializations. `docx`/`pdf` export is **delegated to a
consumer-supplied callback** (`opts.exportHandlers`) rather than bundled —
generating real `.docx`/`.pdf` client-side pulls in heavy dependencies
(docx.js, pdf-lib) that most consumers won't want forced into their bundle.
Default behavior without a supplied handler: `md`/`txt` work out of the box,
`docx`/`pdf` throw a clear "register an export handler" error rather than
failing silently or bloating the default bundle.

**Extension points:**

- `toolbarActions` — add custom buttons to the document canvas toolbar (e.g. "Send to Notion").
- `onVersionChange(artifact, diff)` hook — for telemetry or triggering the "let the agent know" resend flow.
- Custom `richTextNodeRenderers` for domain-specific node types (e.g. an embedded chart node) beyond the built-in set.

### 14.4 Artifact reducer contract (how §5/§6 tie together)

```ts
export interface ArtifactReducer {
  kind: ArtifactKind;
  matches(event: ChatEvent): boolean;              // typically: event.type === 'CUSTOM' && event.name.startsWith('chatkit.form.')
  apply(artifacts: Record<string, ArtifactRecord>, event: ChatEvent): Record<string, ArtifactRecord>;
  validate?(data: unknown): data is unknown;        // schema guard; invalid payloads are dropped with a warning, not thrown
}
```

`plugin-forms` and `plugin-documents` each register one `ArtifactReducer`.
`core`'s reducer, on a `CUSTOM` event, looks up a matching registered reducer
and delegates; if none matches, the event is a no-op (safe for
forward-compatibility — an older client ignores artifact types it doesn't
know about instead of crashing).

### 14.5 Config example

```ts
const config: ChatConfig = {
  transport: aguiTransport({ endpoint: '/api/agent' }),
  plugins: [
    fileHandlingPlugin({ upload: myUploadFn }),
    markdownPlugin({ codeHighlighting: true }),
    formsPlugin({
      widgetOverrides: { phone: PhoneInput },
    }),
    documentsPlugin({
      exportHandlers: { docx: exportToDocx, pdf: exportToPdf },
    }),
  ],
};
```

---

## 15. Styling & Theming (the intended "tweak this" surface)

Everything visual in `@chatkit-svelte/ui` reads from a single CSS custom-property
namespace, set on a root wrapper (`<ChatProvider>` applies `data-chatkit-theme`
and injects the default token file):

```css
:root[data-chatkit-theme] {
  /* Color */
  --ck-color-bg: #ffffff;
  --ck-color-surface: #f7f7f8;
  --ck-color-border: #e5e5e7;
  --ck-color-text: #16161a;
  --ck-color-text-muted: #6b6b74;
  --ck-color-accent: #4f46e5;
  --ck-color-accent-contrast: #ffffff;
  --ck-color-user-bubble: #4f46e5;
  --ck-color-user-bubble-text: #ffffff;
  --ck-color-assistant-bubble: #f2f2f4;
  --ck-color-assistant-bubble-text: #16161a;
  --ck-color-error: #d7263d;
  --ck-color-success: #1a9e5c;

  /* Typography */
  --ck-font-sans: system-ui, -apple-system, 'Segoe UI', sans-serif;
  --ck-font-mono: 'JetBrains Mono', ui-monospace, monospace;
  --ck-font-size-sm: 0.8125rem;
  --ck-font-size-base: 0.9375rem;
  --ck-font-size-lg: 1.0625rem;

  /* Spacing / shape */
  --ck-radius-sm: 6px;
  --ck-radius-md: 10px;
  --ck-radius-lg: 16px;
  --ck-space-1: 4px;
  --ck-space-2: 8px;
  --ck-space-3: 12px;
  --ck-space-4: 16px;
  --ck-space-6: 24px;

  /* Motion */
  --ck-transition-fast: 120ms ease;
  --ck-transition-base: 200ms ease;
}

:root[data-chatkit-theme='dark'] {
  --ck-color-bg: #16161a;
  --ck-color-surface: #1e1e22;
  --ck-color-border: #2c2c31;
  --ck-color-text: #f2f2f4;
  --ck-color-text-muted: #9a9aa3;
  --ck-color-assistant-bubble: #26262b;
  --ck-color-assistant-bubble-text: #f2f2f4;
  /* accent/user-bubble/error/success intentionally unchanged for brand consistency */
}
```

- **Tailwind preset** (optional, `@chatkit-svelte/ui/tailwind-preset`): maps the same
  tokens to Tailwind theme values, for consumers who want `class="bg-ck-surface"`-
  style utilities instead of raw CSS vars. Never required.
- **Per-component style overrides**: every themed component accepts `class`
  and merges it after internal classes (so Tailwind/utility overrides win),
  plus a `--ck-*` scoped override block if a single instance needs to diverge
  from the global theme (e.g. one `<ChatWindow>` on a marketing page using
  brand colors while the rest of the app uses the default theme).
- **Density variants**: `data-ck-density="comfortable" | "compact"` toggles a
  parallel spacing token set, for embedding a smaller chat widget vs. a
  full-page assistant.
- **What's *not* themeable via tokens**: structural layout (flex/grid
  composition) — that's a component-swap ("eject" the component and re-lay-it-
  out) rather than a token, keeping the token surface focused on colors/type/
  spacing/motion, which covers the overwhelming majority of "make it match our
  brand" requests.

This is the section meant to absorb "just needs styling tweaks" — swapping
the token values (and optionally the Tailwind preset config) rebrands the
entire framework without touching component logic.

---

## 16. Accessibility

- All interactive components (`Composer`, `ApprovalBar`, `FormRenderer`,
  `DocumentCanvas` toolbar) are keyboard-navigable and carry correct ARIA
  roles (`role="log"` + `aria-live="polite"` on the streaming message list,
  `role="form"` on generated forms, etc.).
- Streaming text updates use `aria-live="polite"` with a debounced
  announcement (not per-token, to avoid screen-reader spam) — announces on
  sentence/paragraph boundaries or on `TEXT_MESSAGE_END`.
- Focus management: sending a message keeps focus in the composer; a new
  approval request moves focus to the `<ApprovalBar>` and returns it to the
  composer on resolution.
- Color tokens (§15) default to WCAG AA contrast; the default theme is
  audited as part of CI (see §18).

---

## 17. Internationalization

```ts
interface I18nConfig {
  locale: string;
  messages: Record<string, string>; // key → translated string, dot-namespaced (e.g. "composer.placeholder")
  formatDate?(ts: number, locale: string): string;
}
```

All user-facing strings in `@chatkit-svelte/ui` (button labels, empty states, error
messages, form validation messages) are pulled from a single default
`en`-locale message table with stable keys, overridable wholesale or
per-key. RTL handled via `dir` attribute propagation, not mirrored CSS
per-property.

---

## 18. Testing Strategy

- **Unit** (`core`): reducer, JSON Patch application, plugin host ordering/
  conflict errors, artifact reducers — Vitest, no DOM.
- **Component** (`ui`): `@testing-library/svelte`, including a11y assertions
  (`vitest-axe`) and a contrast check against the default token file.
- **Protocol conformance**: a mock AG-UI server replaying recorded event-
  stream fixtures (`docs/fixtures/*.json`) covering: normal text streaming,
  out-of-order tool-call args, reconnect + `MESSAGES_SNAPSHOT` recovery,
  `STATE_DELTA` conflict → snapshot fallback, form submit round-trip,
  document delta streaming + user-edit diff round-trip.
- **E2E**: Playwright against `apps/playground`, one spec per baseline
  plugin plus one "kitchen sink" spec exercising forms + documents + file
  upload + HITL approval in one flow.
- **Devtools "export fixture"** (§13.4) is the intended source of new
  fixtures when a real-world bug is found — keeps fixtures representative
  instead of hand-written and drifting from reality.

---

## 19. Build Tooling

- **Monorepo**: pnpm workspaces + Turborepo (or Nx) for task graph caching
  across `core`/`svelte`/`ui`/plugins.
- **Per-package build**: `vite build --mode lib` with `vite-plugin-dts` for
  type declarations; `core` builds to plain ESM with zero runtime deps beyond
  a tiny JSON Patch implementation (bundle target: <5kb gzip for `core`
  itself, excluding transports/plugins).
- **Exports map**: every package uses a proper `exports` field (`"."`,
  `"./package.json"`) with `types`/`import` conditions; no `main`-only CJS.
- **Peer deps**: `svelte` is a peer dependency everywhere in `svelte`/`ui`/
  plugins, pinned to `^5.0.0`.
- **Changesets** for versioned releases across the monorepo (see §20).

---

## 20. Versioning & Release Policy

- Semver per package, independent versioning (a plugin can bump major without
  forcing `core` to bump).
- `core`'s `ChatEvent`/`ChatPlugin`/`ArtifactReducer` shapes are the framework's
  public contract — changes there follow a deprecation-window policy (old
  shape supported ≥1 minor version with a console warning before removal).
- AG-UI protocol version compatibility is tracked explicitly in
  `transport-agui`'s README (which AG-UI event set/version it targets), since
  AG-UI itself is still evolving — this isolates protocol churn to one package.

---

## 21. CLI Scaffold (`create-chatkit`)

```
npx create-chatkit my-chat-app
```

Prompts:

1. SvelteKit app, or bare Vite + Svelte?
2. Transport: AG-UI (default) / Vercel AI SDK adapter / custom stub.
3. Plugins to include: file-handling, markdown, forms, documents, devtools (checkbox, all default-checked except devtools).
4. Theme: light / dark / system.

Generates a working app with `<ChatProvider>` + `<ChatWindow>` wired to a
placeholder `/api/agent` route stub (SSE echo server for local dev without a
real backend), a `chatkit.config.ts` with the chosen plugins pre-imported, and
the default token CSS file copied in (editable) rather than hidden in
`node_modules` — reinforcing that styling is meant to be touched directly.

---

## 22. Milestones

1. **M0 — Core skeleton**: types, reducer, plugin host, in-memory transport with fixture playback. No UI.
2. **M1 — AG-UI transport**: real SSE + WebSocket client, reconnect/backoff, run lifecycle, text streaming, tool calls.
3. **M2 — Svelte bindings + minimal UI**: `ChatProvider`, `ChatWindow`, streaming text rendering, basic composer, default theme tokens.
4. **M3 — Plugin system + file handling**: attachment pipeline, markdown plugin, generic tool renderer.
5. **M4 — State sync + HITL**: `STATE_SNAPSHOT`/`STATE_DELTA`, approval flow, activities.
6. **M5 — Forms & documents**: artifact reducer contract, `plugin-forms`, `plugin-documents` (markdown mode first, richtext second).
7. **M6 — Theming polish, persistence adapters (localStorage + IndexedDB), a11y/i18n pass, CLI scaffold.**
8. **M7 — Second transport adapter** (Vercel AI SDK) to prove the abstraction holds; devtools fixture export.

## 23. Open Questions

- How much of AG-UI's emerging declarative generative-UI spec to adopt natively once it stabilizes, vs. keep the hand-rolled forms/documents artifacts as the permanent approach.
- Richtext document collaborative editing (multi-user) — v2 candidate, would likely mean adopting Yjs and rethinking the artifact version model.
- Whether `docx`/`pdf` export should eventually ship an *optional* first-party handler package (`@chatkit-svelte/plugin-documents-export`) instead of always requiring consumer-supplied callbacks, once a lightweight enough implementation is found.
