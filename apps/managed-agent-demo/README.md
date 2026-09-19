# managed-agent-demo

Live demo: `@chatkit-svelte/transport-agui` driving any **OpenAI-compatible**
model server. The default target is [FastFlowLM](https://fastflowlm.com)
(local models on AMD Ryzen AI NPUs), but the same code talks to Ollama, LM
Studio, OpenAI, Azure OpenAI, etc. — only the base URL and model change.

(The app directory keeps its old name from when it drove a hosted Claude
Managed Agent; nothing Claude-specific remains.)

## Setup (FastFlowLM)

1. Install FastFlowLM and pull a model: `flm pull llama3.2:1b` (`flm list` shows what's available).
2. Serve it: `flm serve llama3.2:1b` — listens on `http://localhost:52625/v1`.
3. Copy `.env.example` to `.env` and set `OPENAI_MODEL` to the tag you're serving.
4. Run the app:
   ```bash
   pnpm install
   pnpm --filter managed-agent-demo dev
   ```

Other servers: set `OPENAI_BASE_URL` (and `OPENAI_API_KEY` if it needs one) in `.env`.

## Running against the gateway (the Java server layer)

Instead of this app's own engine (`src/lib/agent-sessions.ts`), `vite dev` can forward `/api/agent/*` to the
chatkit gateway, which owns sessions, tool-call repair and validation, and the smart-session memory:

1. Put the gateway's address in `.env.local` (git-ignored): `GATEWAY_URL=http://<host>:7788`.
2. `pnpm --filter managed-agent-demo dev`. The browser still talks to one origin, so there is no CORS setup;
   editing `.env.local` while the dev server runs is picked up automatically.

With `GATEWAY_URL` unset the app uses its own routes exactly as before. The gateway has no login yet, so only
point it at a host you trust. The **Memory test tools** bar at the top of the page only works against the
gateway: *What does the model see?* shows the prompt the model would get next next to everything the gateway
stored (with aging, quarantine and budget trimming applied), and *Forget last exchange* makes the model forget
the most recent exchange (the chat above still shows it).

## How it fits together

`src/lib/agent-sessions.ts` is the only place that knows about the AI backend.
Everything upstream of it — the `/api/agent/*` routes, `transport-agui`, all
the plugins — only sees chatkit events, so the backend is swappable without
touching any plugin.

- **Streaming**: plain `fetch` + an SSE parser (`src/lib/openai-stream.ts`), no SDK. Text deltas are
  forwarded as they arrive; tool-call argument fragments are buffered and surfaced once, whole.
  Reasoning is picked up from `reasoning_content`/`reasoning` fields or inline `<think>…</think>`.
- **Client tools**: the frontend's `ChatConfig.tools` (`show_form`, `request_file`, `create_document`)
  are passed to the model as function tools. When the model calls one, the run parks, the plugin
  renders its UI, and `/api/agent/tool-results` resumes the conversation with the answer as a `tool`
  message. If the user types instead of answering, the pending call is closed out as unanswered.
- **History**: the server keeps each thread's model-facing history. The client's message list is used
  only for what's new, and to rebuild history if the dev server restarted under an open tab.

### Bad tool-call JSON

Small models often emit *almost*-valid tool arguments: raw newlines inside strings, unescaped inner
quotes, invalid escapes like `\'`, trailing commas, markdown fences, truncated output. That's a
property of model-generated text, not of the protocol, so it's handled in one place
(`src/lib/tool-args.ts`): a tolerant parser repairs what it can (recorded as an
`llm.tool_arguments_repaired` event, visible in devtools). If a call can't be recovered — or the
response hit the token limit — nothing broken reaches the UI: the model gets a tool-error result and
another attempt, up to 3 times, before the run fails with a recoverable `tool_arguments_invalid`.

## Attachments

- **Images** go to the model as `image_url` parts (needs a vision-capable model).
- **Text-like files** (`text/*`, JSON, XML, YAML, …) are inlined into the prompt, up to 100k characters.
- **Anything else (PDFs, Office files)** can't be read by this backend; the model is told so and
  should say so to the user. There is no sandbox or server-side extraction.

## Known limitations

- In-memory session storage only — restarting the dev server drops server-side history (the client
  rebuilds it from its own message list on the next message).
- No authentication — thread IDs are not bound to user identity. Don't deploy this publicly as-is.
- Tool-calling quality depends on the model. Small local models can pick the wrong tool or produce
  weak schemas; `flm` also silently drops `tools` for its "flash" model variants.
- Thinking models that omit the opening `<think>` tag (their chat template puts it in the prompt) have
  the stray closing tag dropped, but text streamed before it can't be reclassified as reasoning.
- An abandoned SSE connection's server-side waiter isn't actively cleaned up on client disconnect (see
  the comment in `subscribeFromIndex`) — fine for a local demo.
