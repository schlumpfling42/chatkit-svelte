# Managed Agent Demo — Design

## Overview

A new example app, `apps/managed-agent-demo`, proving `@chatkit-svelte/transport-agui`
can drive a real, hosted Claude Managed Agent end to end. It pairs our existing
AG-UI transport with Anthropic's official `@ag-ui/claude-managed-agents` adapter
package, which wraps a Managed Agent as an AG-UI-emitting agent object.

This is the first example in the monorepo backed by a live LLM instead of fixture
data — `apps/playground` is deliberately fixture-driven and stays that way; this is
a separate app.

## Why a new app instead of extending `playground`

`playground` uses `@sveltejs/adapter-static` and prerenders against fixture
transports specifically so it has no runtime dependencies (no API keys, no server
process) and can be e2e-tested in CI without live network calls. A Managed-Agent-
backed demo needs a real running Node server and live credentials, which is a
different deployment shape — bundling it into `playground` would break that
static-build property for the whole app.

## Architecture

```
apps/managed-agent-demo/
  src/
    routes/
      +page.svelte              # minimal chat UI
      api/agent/
        runs/+server.ts         # POST — start a run
        runs/[runId]/+server.ts # POST — abort a run
        threads/[id]/events/+server.ts # GET (SSE) — event stream
        threads/[id]/state/+server.ts  # GET — state snapshot
        tool-results/+server.ts # POST — frontend tool results
        capabilities/+server.ts # GET — static capabilities
    lib/
      agent-sessions.ts         # in-memory threadId -> ManagedAgentsAgent map
  svelte.config.js              # adapter-node (not adapter-static)
  .env.example
  README.md                     # one-time `ant` provisioning steps
```

### Frontend

`src/routes/+page.svelte`: `<ChatProvider>` (from `@chatkit-svelte/svelte`) wrapping
`<ChatWindow>` (from `@chatkit-svelte/ui`), constructed with
`createAguiTransport({ endpoint: '/api/agent' })` from `@chatkit-svelte/transport-agui`.
No fixtures, no plugin roster beyond what a bare Claude conversation needs
(text + tool-call rendering via `@chatkit-svelte/plugin-tool-render`).

### Backend routes

Each SvelteKit `+server.ts` implements one leg of `transport-agui`'s existing
contract (`packages/transport-agui/src/agui-transport.ts` — this contract is fixed
by the already-shipped client, not up for revision here):

| Route | Method | Purpose |
|---|---|---|
| `/api/agent/runs` | POST | Start a run: look up or create the thread's `ManagedAgentsAgent`, call `.run(...)`, return immediately (the client opens the SSE stream separately) |
| `/api/agent/threads/:id/events` | GET (SSE) | Subscribe to the agent's Observable for this thread; frame each emitted AG-UI event as `data: <json>\n\n` |
| `/api/agent/tool-results` | POST | Forward a frontend-executed tool's result into the agent's run |
| `/api/agent/runs/:id` | POST | Abort the run |
| `/api/agent/capabilities` | GET | Static `AgentCapabilities` response |
| `/api/agent/threads/:id/state` | GET | Current state snapshot, for resume-after-reconnect |

### Session bookkeeping

`src/lib/agent-sessions.ts` holds an in-memory `Map<string, ManagedAgentsAgent>`
keyed by AG-UI `threadId`. First request for a thread constructs a
`new ManagedAgentsAgent({ managedAgentId, environmentId })` from
`@ag-ui/claude-managed-agents`; subsequent requests reuse it. No persistence layer
— a server restart drops in-flight threads. This is intentional for a demo app;
a persisted store would be premature complexity here (see `shared/managed-agents-
client-patterns.md`'s `sessionStore` guidance if this ever needs to become
production-shaped).

### Event translation

`@chatkit-svelte/core`'s `ChatEvent` union (`packages/core/src/types.ts`) already
mirrors the real AG-UI spec's event taxonomy (`RUN_STARTED`, `TEXT_MESSAGE_CONTENT`,
`TOOL_CALL_*`, `STATE_SNAPSHOT`/`STATE_DELTA`, etc.), and `ManagedAgentsAgent.run()`
emits genuine AG-UI events. So the backend does **not** need a field-by-field
translation layer — it passes emitted events through as-is, only adding SSE framing
and thread/session routing.

## Configuration

Server-side-only env vars (never sent to the browser):

- `ANTHROPIC_API_KEY` (or an `ant auth login` profile — see README)
- `ANTHROPIC_ENVIRONMENT_ID`
- `ANTHROPIC_AGENT_ID`

`.env.example` documents the shape; `.env` is gitignored. `README.md` documents the
one-time `ant` CLI provisioning steps (creating the environment + agent) — this is
credential-gated and must be run by the project owner, not automated here.

## Error handling

- Missing/invalid env vars at startup: fail fast with a clear error naming which
  var is missing, rather than a confusing downstream Anthropic API error.
- `ManagedAgentsAgent` errors during a run: surface as `RUN_ERROR` events through
  the existing SSE stream — `transport-agui`'s client already handles `RUN_ERROR`,
  no new client-side handling needed.
- Unknown `threadId` on `/tool-results`, `/runs/:id`, or `/threads/:id/state`: 404.

## Testing

- Unit tests for each route handler with a mocked `ManagedAgentsAgent` (no real
  network calls) — same `vitest` pattern used across the rest of the monorepo.
- No Playwright e2e for this app initially: e2e would require live credentials in
  CI, which is out of scope for this demo (unlike `playground`, which is fully
  fixture-driven and safe to run in CI without secrets).
- Real end-to-end verification (chatting with a live Managed Agent in the browser
  preview) happens manually once real `ANTHROPIC_AGENT_ID`/`ANTHROPIC_ENVIRONMENT_ID`
  are provisioned — this is a manual verification step, not part of the automated
  suite.

## Out of scope

- Persisted/multi-instance session storage (in-memory map is sufficient for a demo).
- Authentication/authorization of end users (per `shared/managed-agents-client-
  patterns.md`, AG-UI thread IDs act as bearer tokens in production and need to be
  bound to user identity — explicitly out of scope for this demo, noted as a caveat
  in the README rather than implemented).
- Deployment/hosting instructions beyond local dev.
- Any change to `transport-agui`'s existing client-side contract.
