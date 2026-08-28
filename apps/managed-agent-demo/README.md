# managed-agent-demo

Live demo: `@chatkit-svelte/transport-agui` driving a real, hosted Claude
Managed Agent via Anthropic's `@ag-ui/claude-managed-agents` adapter.

## One-time setup (you must run this yourself — it's credential-gated)

1. Install the `ant` CLI (macOS: `brew install anthropics/tap/ant`; Linux/WSL/Windows: grab
   the release for your platform from
   [github.com/anthropics/anthropic-cli/releases](https://github.com/anthropics/anthropic-cli/releases),
   or `go install github.com/anthropics/anthropic-cli/cmd/ant@latest` with Go 1.22+).
2. `ant auth login` (opens a browser, stores a profile — no static key to manage), or set
   `ANTHROPIC_API_KEY` instead. Your org needs Managed Agents beta access and 30-day data
   retention enabled.
3. Provision the environment and agent from the two YAML files already in this directory
   (`managed-agent-demo.environment.yaml`, `managed-agent-demo.agent.yaml`):
   ```bash
   AGENT_ID=$(ant beta:agents create < managed-agent-demo.agent.yaml --transform id -r)
   ENV_ID=$(ant beta:environments create < managed-agent-demo.environment.yaml --transform id -r)
   echo "ANTHROPIC_AGENT_ID=$AGENT_ID"
   echo "ANTHROPIC_ENVIRONMENT_ID=$ENV_ID"
   ```
   (PowerShell: `$AGENT_ID = ant beta:agents create --% < managed-agent-demo.agent.yaml --transform id -r`,
   same for `beta:environments`.) These are one-time — re-running `create` makes a new
   agent/environment, not an update; see `ant beta:agents update --help` to change an
   existing one instead. Run `ant beta:agents create --help` / `ant beta:environments create
   --help` first if anything above doesn't match your installed CLI version's exact syntax.
4. Copy `.env.example` to `.env` and fill in `ANTHROPIC_AGENT_ID` and
   `ANTHROPIC_ENVIRONMENT_ID` from step 3 (and `ANTHROPIC_API_KEY` if you're
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
