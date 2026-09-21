<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { ChatProvider } from '@chatkit-svelte/svelte';
  import { ChatWindow } from '@chatkit-svelte/ui';
  import { createAguiTransport } from '@chatkit-svelte/transport-agui';
  import type { ConnectionState } from '@chatkit-svelte/transport-agui';
  import { markdownPlugin } from '@chatkit-svelte/plugin-markdown';
  import { fileHandlingPlugin, requestFileToolDefinition } from '@chatkit-svelte/plugin-file-handling';
  import { formsPlugin, showFormToolDefinition } from '@chatkit-svelte/plugin-forms';
  import { documentsPlugin, createDocumentToolDefinition } from '@chatkit-svelte/plugin-documents';
  import { devtoolsPlugin, DevtoolsOverlay } from '@chatkit-svelte/plugin-devtools';
  import type { ChatConfig } from '@chatkit-svelte/core';
  import { rememberThread } from './threads';
  import TransientToolCall from './TransientToolCall.svelte';
  import PermissionBar from './PermissionBar.svelte';

  // One conversation. The page keys this component on the thread id, so opening another conversation builds a whole
  // new store and transport rather than reusing one.
  interface Props {
    threadId: string;
  }
  let { threadId: threadIdProp }: Props = $props();
  const threadId = untrack(() => threadIdProp);

  const devtools = devtoolsPlugin();

  onMount(() => rememberThread(threadId));

  // Returns a base64 data: URI rather than URL.createObjectURL()'s blob:
  // URL. This demo has no real file-hosting backend, and a blob: URL is
  // scoped to this browser tab -- unreachable from the SvelteKit server
  // (where src/lib/openai-messages.ts turns attachments into model input),
  // so the model would never actually see the attachment's bytes.
  function readAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  // ---- connection ---------------------------------------------------------------------------------------
  // The transport tells us when its event stream is not live (server restarting, connection gone silent), so the
  // page can say so instead of just going quiet.
  let connection = $state<ConnectionState>('connecting');
  const CONNECTION_LABEL: Record<ConnectionState, string> = {
    connecting: 'Connecting…',
    live: 'Connected',
    stale: 'Connection lost, reconnecting…',
    reconnecting: 'Reconnecting…',
    closed: 'Disconnected',
  };

  // ---- gateway test tools -------------------------------------------------------------------------------
  // These talk to the chatkit gateway's memory endpoints (see GATEWAY_URL in vite.config.ts). The demo's own
  // local engine has no such endpoints, so they say so instead of failing quietly.
  const NEEDS_GATEWAY = 'Only available when the demo runs against the gateway (set GATEWAY_URL).';
  let toolStatus = $state('');
  let contextText = $state('');

  interface ViewMessage {
    role: string;
    preview: string;
    chars: number;
    toolCalls?: string[];
    turn?: number;
    status?: string;
  }
  interface ContextView {
    budget: { estimatedTokens: number; verbatimTokens: number; compactAtTokens: number };
    memory: { condensedThroughExchange: number; digestsListed: number; digestsNotListed: number; droppedFailedAttempts: number };
    modelSees: ViewMessage[];
    stored: ViewMessage[];
  }

  function line(m: ViewMessage): string {
    const calls = m.toolCalls?.length ? ` -> ${m.toolCalls.join(', ')}` : '';
    const text = m.preview.replace(/\s+/g, ' ');
    return `${m.role}${calls}: ${text}${m.chars > text.length ? `  (${m.chars} chars)` : ''}`;
  }

  function formatContext(view: ContextView): string {
    const { budget, memory } = view;
    return [
      `Prompt ~${budget.estimatedTokens} tokens (${budget.verbatimTokens} word for word; older exchanges are condensed above ${budget.compactAtTokens}). Condensed through exchange ${memory.condensedThroughExchange}: ${memory.digestsListed} digest(s) shown, ${memory.digestsNotListed} not listed; ${memory.droppedFailedAttempts} failed attempt(s) hidden.`,
      '',
      `THE MODEL SEES (${view.modelSees.length} messages):`,
      ...view.modelSees.map((m) => `  ${line(m)}`),
      '',
      `STORED (${view.stored.length} entries, never shrinks):`,
      ...view.stored.map((m) => `  [turn ${m.turn} ${m.status}] ${line(m)}`),
    ].join('\n');
  }

  async function showContext() {
    toolStatus = '';
    try {
      const response = await fetch(`/api/agent/threads/${encodeURIComponent(threadId)}/context`);
      if (response.status === 404) {
        const body = await response.json().catch(() => null);
        contextText = body?.error?.code === 'unknown_thread' ? 'Nothing stored yet: send a message first.' : NEEDS_GATEWAY;
        return;
      }
      contextText = formatContext((await response.json()) as ContextView);
    } catch (err) {
      contextText = `Could not reach the gateway: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  async function forgetLastExchange() {
    contextText = '';
    try {
      const response = await fetch(`/api/agent/threads/${encodeURIComponent(threadId)}/retract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ turns: 1 }),
      });
      const body = await response.json().catch(() => null);
      if (response.ok) {
        toolStatus = `The model forgot the last exchange (${body?.retracted ?? 0} entries). The chat above still shows it; the model no longer remembers it.`;
      } else if (response.status === 404 && body?.error?.code !== 'unknown_thread') {
        toolStatus = NEEDS_GATEWAY;
      } else {
        toolStatus = body?.error?.message ?? `Failed (HTTP ${response.status}).`;
      }
    } catch (err) {
      toolStatus = `Could not reach the gateway: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  const config: ChatConfig = {
    threadId,
    transport: createAguiTransport({ endpoint: '/api/agent', onConnectionChange: (state) => (connection = state) }),
    // Listing a tool here is what tells the model it exists (agent-sessions.ts
    // passes these to the model as its function tools) and what makes it a
    // *client* tool: when the model calls one, the run pauses, the plugin
    // renders its UI, and the run resumes once the answer comes back.
    tools: [showFormToolDefinition, requestFileToolDefinition, createDocumentToolDefinition],
    plugins: [
      { name: 'transient-tool-calls', version: '1.0.0', toolRenderers: { '*': TransientToolCall } },
      markdownPlugin(),
      fileHandlingPlugin({ upload: async (file) => ({ url: await readAsDataUrl(file) }) }),
      formsPlugin(),
      documentsPlugin(),
      devtools,
    ],
  };
</script>

<div class="demo" data-chatkit-theme>
  <div class="demo__bar">
    <span class="demo__bar-title">Memory test tools</span>
    <button type="button" onclick={showContext}>What does the model see?</button>
    <button type="button" onclick={forgetLastExchange}>Forget last exchange</button>
    <span class="demo__bar-status">{toolStatus}</span>
    {#if connection !== 'live'}
      <span class="demo__connection" role="status" data-state={connection}>{CONNECTION_LABEL[connection]}</span>
    {/if}
  </div>
  {#if contextText}
    <pre class="demo__context">{contextText}</pre>
  {/if}
  <ChatProvider {config}>
    {#snippet children()}
      <div class="demo__window">
        <PermissionBar />
        <ChatWindow />
      </div>
      <div class="demo__devtools">
        <DevtoolsOverlay log={devtools.log} />
      </div>
    {/snippet}
  </ChatProvider>
</div>

<style>
  .demo {
    display: flex;
    flex-direction: column;
    height: 100vh;
    /* height:100vh alone only sets this box's own size -- it doesn't clip
       overflow (default is visible). If the flex/min-height chain below
       ever slips for any reason (e.g. the devtools log growing dynamically
       across many small entries), content would otherwise just push the
       whole page taller and scroll at the document level instead of inside
       .demo__window, landing .demo__devtools wherever that overflow happens
       to end up rather than cleanly below the chat window. This is the
       actual clipping boundary that prevents that. */
    overflow: hidden;
    font-family: system-ui, sans-serif;
    min-width: 0;
  }

  .demo__bar {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.35rem 0.75rem;
    font-size: 0.8rem;
    background: #f6f6f8;
    border-bottom: 1px solid #e5e5e7;
  }

  .demo__bar-title {
    font-weight: 600;
    color: #555;
  }

  .demo__bar button {
    font: inherit;
    padding: 0.2rem 0.6rem;
    border: 1px solid #c8c8cc;
    border-radius: 4px;
    background: #fff;
    cursor: pointer;
  }

  .demo__bar button:hover {
    background: #f0f0f3;
  }

  .demo__bar-status {
    color: #555;
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .demo__connection {
    flex-shrink: 0;
    padding: 0.15rem 0.6rem;
    border-radius: 999px;
    background: #fff4d6;
    color: #7a5b00;
    border: 1px solid #f0d98a;
  }

  .demo__connection[data-state='closed'] {
    background: #fde8e8;
    color: #8a1c1c;
    border-color: #f2b8b8;
  }

  .demo__context {
    flex-shrink: 0;
    max-height: 14rem;
    overflow: auto;
    margin: 0;
    padding: 0.5rem 0.75rem;
    font-size: 0.75rem;
    line-height: 1.4;
    white-space: pre-wrap;
    background: #fbfbfc;
    border-bottom: 1px solid #e5e5e7;
  }

  .demo__window {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    /* Same belt-and-suspenders reasoning as .demo's overflow: hidden above
       -- ChatWindow already clips its own overflow, but not relying on a
       single link in the chain to hold is the point. */
    overflow: hidden;
  }

  .demo__devtools {
    flex-shrink: 0;
    max-height: 16rem;
    overflow: auto;
    border-top: 1px solid #e5e5e7;
  }
</style>
