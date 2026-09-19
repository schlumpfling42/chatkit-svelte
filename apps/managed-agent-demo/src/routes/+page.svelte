<script lang="ts">
  import { ChatProvider } from '@chatkit-svelte/svelte';
  import { ChatWindow } from '@chatkit-svelte/ui';
  import { createAguiTransport } from '@chatkit-svelte/transport-agui';
  import { toolRenderPlugin } from '@chatkit-svelte/plugin-tool-render';
  import { markdownPlugin } from '@chatkit-svelte/plugin-markdown';
  import { fileHandlingPlugin, requestFileToolDefinition } from '@chatkit-svelte/plugin-file-handling';
  import { formsPlugin, showFormToolDefinition } from '@chatkit-svelte/plugin-forms';
  import { documentsPlugin, createDocumentToolDefinition } from '@chatkit-svelte/plugin-documents';
  import { devtoolsPlugin, DevtoolsOverlay } from '@chatkit-svelte/plugin-devtools';
  import type { ChatConfig } from '@chatkit-svelte/core';

  const devtools = devtoolsPlugin();

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

  const threadId = crypto.randomUUID();

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
    budget: { estimatedTokens: number; maxTokens: number };
    trim: { droppedTurns: number; droppedMessages: number; agedToolResults: number; droppedQuarantined: number };
    modelSees: ViewMessage[];
    stored: ViewMessage[];
  }

  function line(m: ViewMessage): string {
    const calls = m.toolCalls?.length ? ` -> ${m.toolCalls.join(', ')}` : '';
    const text = m.preview.replace(/\s+/g, ' ');
    return `${m.role}${calls}: ${text}${m.chars > text.length ? `  (${m.chars} chars)` : ''}`;
  }

  function formatContext(view: ContextView): string {
    const { budget, trim } = view;
    return [
      `Prompt size ~${budget.estimatedTokens} / ${budget.maxTokens} tokens. Left out or shrunk: ${trim.droppedTurns} old turns, ${trim.agedToolResults} old tool results, ${trim.droppedQuarantined} failed attempts.`,
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
      const response = await fetch(`/api/agent/threads/${threadId}/context`);
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
      const response = await fetch(`/api/agent/threads/${threadId}/retract`, {
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
    transport: createAguiTransport({ endpoint: '/api/agent' }),
    // Listing a tool here is what tells the model it exists (agent-sessions.ts
    // passes these to the model as its function tools) and what makes it a
    // *client* tool: when the model calls one, the run pauses, the plugin
    // renders its UI, and the run resumes once the answer comes back.
    tools: [showFormToolDefinition, requestFileToolDefinition, createDocumentToolDefinition],
    plugins: [
      toolRenderPlugin(),
      markdownPlugin(),
      fileHandlingPlugin({ upload: async (file) => ({ url: await readAsDataUrl(file) }) }),
      formsPlugin(),
      documentsPlugin(),
      devtools,
    ],
  };
</script>

<svelte:head>
  <title>chatkit — local model demo</title>
</svelte:head>

<div class="demo" data-chatkit-theme>
  <div class="demo__bar">
    <span class="demo__bar-title">Memory test tools</span>
    <button type="button" onclick={showContext}>What does the model see?</button>
    <button type="button" onclick={forgetLastExchange}>Forget last exchange</button>
    <span class="demo__bar-status">{toolStatus}</span>
  </div>
  {#if contextText}
    <pre class="demo__context">{contextText}</pre>
  {/if}
  <ChatProvider {config}>
    {#snippet children()}
      <div class="demo__window">
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
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
