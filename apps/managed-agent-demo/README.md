# managed-agent-demo

Live demo: `@chatkit-svelte/transport-agui` driving a real, hosted Claude
Managed Agent via Anthropic's `@ag-ui/claude-managed-agents` adapter.

## One-time setup (you must run this yourself — it's credential-gated)

1. Install the `ant` CLI and run `ant auth login` (or set `ANTHROPIC_API_KEY`).
2. Provision an environment and agent:
   ```bash
   ant environments create --name managed-agent-demo
   ant agents create --name managed-agent-demo --environment <environment-id>
   ```
   (Exact subcommands may differ — see `ant agents create --help` and
   `ant environments create --help` for your installed CLI version. Your org
   also needs Managed Agents beta access and 30-day data retention enabled.)
3. Copy `.env.example` to `.env` and fill in `ANTHROPIC_AGENT_ID` and
   `ANTHROPIC_ENVIRONMENT_ID` from step 2 (and `ANTHROPIC_API_KEY` if you're
   not using an `ant auth login` profile).

## Run it

```bash
pnpm install
pnpm --filter managed-agent-demo dev
```

Open the printed local URL and chat with your Managed Agent.

## Known limitations

- In-memory session storage only — restarting the dev server drops in-flight
  threads. Fine for a demo; would need a persisted store for production.
- No authentication — AG-UI thread IDs are not bound to user identity here.
  Don't deploy this publicly as-is; see Anthropic's
  `shared/managed-agents-client-patterns.md` guidance on binding threads to
  user identity via a `sessionStore` before doing so.
- No frontend-executing tools are registered, so `/api/agent/tool-results` is
  a no-op — Managed Agents runs tools server-side in Anthropic's own sandbox.
- An abandoned SSE connection's server-side waiter is not actively cleaned up
  on client disconnect (see the comment above `subscribeFromIndex` in
  `src/lib/agent-sessions.ts`) — acceptable for a short-lived local demo,
  would need real cancellation for anything longer-lived.
