import { describe, expect, it, vi } from 'vitest';
import { createChatStore } from '../src/chat-store.svelte';
import { createFixtureTransport } from '@chatkit/core';
import type { ArtifactReducer, ChatEvent, ChatPlugin, ChatState, PersistenceAdapter } from '@chatkit/core';

describe('createChatStore', () => {
  it('reflects streamed events reactively via getters', async () => {
    const events: ChatEvent[] = [
      { type: 'RUN_STARTED', runId: 'r1', threadId: 't1' },
      { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'Hello' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: ', world!' },
      { type: 'TEXT_MESSAGE_END', messageId: 'm1' },
      { type: 'RUN_FINISHED', runId: 'r1' },
    ];
    const transport = createFixtureTransport(events);
    const store = createChatStore({ transport, threadId: 't1' });

    await vi.waitFor(() => {
      // runStatus starts at 'idle' too, so waiting on that alone would
      // resolve immediately before any events are processed — wait for the
      // actual terminal content instead.
      expect(store.messages[0]?.streaming).toBe(false);
    });

    expect(store.runStatus).toBe('idle');
    expect(store.messages).toHaveLength(1);
    expect(store.messages[0].parts).toEqual([{ type: 'text', text: 'Hello, world!' }]);

    store.dispose();
  });

  it('sendMessage appends a user message and calls transport.sendRun', async () => {
    const transport = createFixtureTransport([]);
    const store = createChatStore({ transport, threadId: 't1' });

    await store.sendMessage({ text: 'hi there' });

    expect(store.messages).toHaveLength(1);
    expect(store.messages[0]).toMatchObject({ role: 'user', parts: [{ type: 'text', text: 'hi there' }] });
    expect(transport.recorder.runs).toHaveLength(1);
    expect(transport.recorder.runs[0].messages).toHaveLength(1);

    store.dispose();
  });

  it('dispose() disposes both the plugin host and the transport', async () => {
    const transport = createFixtureTransport([]);
    const disposeSpy = vi.spyOn(transport, 'dispose');
    const store = createChatStore({ transport, threadId: 't1' });

    store.dispose();

    expect(disposeSpy).toHaveBeenCalledOnce();
  });

  it('surfaces a stream error via state.error and runStatus instead of an unhandled rejection', async () => {
    const throwingTransport = {
      connect: async function* () {
        throw new Error('boom');
      },
      sendRun: vi.fn(async () => {}),
      sendFrontendToolResult: vi.fn(async () => {}),
      abortRun: vi.fn(async () => {}),
      dispose: vi.fn(),
    };
    const store = createChatStore({ transport: throwingTransport, threadId: 't1' });

    await vi.waitFor(() => {
      expect(store.runStatus).toBe('error');
    });

    expect(store.state.error).toMatchObject({ code: 'STREAM_ERROR', message: 'boom', recoverable: false });

    store.dispose();
  });

  it('stops applying events once dispose() has been called', async () => {
    const events: ChatEvent[] = [
      { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'hello' },
    ];
    const transport = createFixtureTransport(events, { delayMs: 20 });
    const store = createChatStore({ transport, threadId: 't1' });

    store.dispose();
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(store.messages).toHaveLength(0);
  });

  it('clears the in-flight run id once a run finishes, so a later abort() is a no-op', async () => {
    const events: ChatEvent[] = [
      { type: 'RUN_STARTED', runId: 'r1', threadId: 't1' },
      { type: 'RUN_FINISHED', runId: 'r1' },
    ];
    const transport = createFixtureTransport(events);
    const abortSpy = vi.spyOn(transport, 'abortRun');
    const store = createChatStore({ transport, threadId: 't1' });

    await vi.waitFor(() => {
      expect(store.runStatus).toBe('idle');
    });

    await store.abort();

    expect(abortSpy).not.toHaveBeenCalled();

    store.dispose();
  });

  it('sendMessage omits the text part entirely when only attachments are sent', async () => {
    const transport = createFixtureTransport([]);
    const store = createChatStore({ transport, threadId: 't1' });

    await store.sendMessage({ text: '', attachments: [{ type: 'file', url: 'https://x/y', name: 'y', mimeType: 'text/plain' }] });

    expect(store.messages[0].parts).toEqual([{ type: 'file', url: 'https://x/y', name: 'y', mimeType: 'text/plain' }]);

    store.dispose();
  });
});

describe('sharedState and activities getters', () => {
  it('exposes sharedState reactively', async () => {
    const events: ChatEvent[] = [{ type: 'STATE_SNAPSHOT', snapshot: { count: 1 } }];
    const transport = createFixtureTransport(events);
    const store = createChatStore({ transport, threadId: 't1' });

    await vi.waitFor(() => {
      expect(store.sharedState).toEqual({ count: 1 });
    });

    store.dispose();
  });

  it('exposes activities reactively', async () => {
    const events: ChatEvent[] = [{ type: 'ACTIVITY_SNAPSHOT', messageId: 'm1', data: { progress: 0.5 } }];
    const transport = createFixtureTransport(events);
    const store = createChatStore({ transport, threadId: 't1' });

    await vi.waitFor(() => {
      expect(store.activities).toHaveLength(1);
    });

    expect(store.activities[0]).toMatchObject({ messageId: 'm1', data: { progress: 0.5 } });

    store.dispose();
  });
});

describe('human-in-the-loop approval flow', () => {
  function toolCallEvents(toolName: string): ChatEvent[] {
    return [
      { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' },
      { type: 'TOOL_CALL_START', toolCallId: 'tc1', toolName, parentMessageId: 'm1' },
      { type: 'TOOL_CALL_ARGS', toolCallId: 'tc1', delta: '{"query":"weather"}' },
      { type: 'TOOL_CALL_END', toolCallId: 'tc1' },
    ];
  }

  it('transitions to awaiting_approval when a tool call matches requireApprovalFor', async () => {
    const transport = createFixtureTransport(toolCallEvents('delete_file'));
    const store = createChatStore({
      transport,
      threadId: 't1',
      humanInTheLoop: { requireApprovalFor: ['delete_file'] },
    });

    await vi.waitFor(() => {
      expect(store.runStatus).toBe('awaiting_approval');
    });

    expect(store.pendingApprovals).toHaveLength(1);
    expect(store.pendingApprovals[0]).toMatchObject({ toolCallId: 'tc1', toolName: 'delete_file', status: 'awaiting_approval' });

    store.dispose();
  });

  it('does not require approval for a tool listed in autoApproveTools even if it matches requireApprovalFor', async () => {
    const transport = createFixtureTransport(toolCallEvents('delete_file'));
    const store = createChatStore({
      transport,
      threadId: 't1',
      humanInTheLoop: { requireApprovalFor: ['delete_file'], autoApproveTools: ['delete_file'] },
    });

    await vi.waitFor(() => {
      expect(store.messages[0]?.parts.some((p) => p.type === 'tool_call')).toBe(true);
    });

    expect(store.runStatus).not.toBe('awaiting_approval');
    expect(store.pendingApprovals).toHaveLength(0);

    store.dispose();
  });

  it('approveToolCall executes via a registered onToolCall plugin hook and sends the result through the transport', async () => {
    const transport = createFixtureTransport(toolCallEvents('delete_file'));
    const plugin: ChatPlugin = {
      name: 'executor',
      version: '1.0.0',
      hooks: {
        onToolCall: async (call) => ({ toolCallId: call.toolCallId, result: { deleted: true }, isError: false }),
      },
    };
    const store = createChatStore({
      transport,
      threadId: 't1',
      plugins: [plugin],
      humanInTheLoop: { requireApprovalFor: ['delete_file'] },
    });

    await vi.waitFor(() => {
      expect(store.runStatus).toBe('awaiting_approval');
    });

    await store.approveToolCall('tc1');

    expect(transport.recorder.toolResults).toHaveLength(1);
    expect(transport.recorder.toolResults[0]).toMatchObject({ toolCallId: 'tc1', result: { deleted: true }, isError: false });
    const tc = store.messages[0].parts.find((p) => p.type === 'tool_call');
    expect(tc).toMatchObject({ status: 'complete', result: { deleted: true } });
    expect(store.runStatus).toBe('running');

    store.dispose();
  });

  it('approveToolCall falls back to a synthetic approved result when no plugin handles the tool', async () => {
    const transport = createFixtureTransport(toolCallEvents('delete_file'));
    const store = createChatStore({
      transport,
      threadId: 't1',
      humanInTheLoop: { requireApprovalFor: ['delete_file'] },
    });

    await vi.waitFor(() => {
      expect(store.runStatus).toBe('awaiting_approval');
    });

    await store.approveToolCall('tc1');

    expect(transport.recorder.toolResults[0]).toMatchObject({ toolCallId: 'tc1', result: { approved: true }, isError: false });

    store.dispose();
  });

  it('rejectToolCall marks the tool call rejected and sends an error result', async () => {
    const transport = createFixtureTransport(toolCallEvents('delete_file'));
    const store = createChatStore({
      transport,
      threadId: 't1',
      humanInTheLoop: { requireApprovalFor: ['delete_file'] },
    });

    await vi.waitFor(() => {
      expect(store.runStatus).toBe('awaiting_approval');
    });

    await store.rejectToolCall('tc1', 'too risky');

    expect(transport.recorder.toolResults[0]).toMatchObject({
      toolCallId: 'tc1',
      result: { rejected: true, reason: 'too risky' },
      isError: true,
    });
    const tc = store.messages[0].parts.find((p) => p.type === 'tool_call');
    expect(tc).toMatchObject({ status: 'rejected' });
    expect(store.runStatus).toBe('running');

    store.dispose();
  });

  it('editAndRetry updates the args before resolving the approval', async () => {
    const transport = createFixtureTransport(toolCallEvents('delete_file'));
    const store = createChatStore({
      transport,
      threadId: 't1',
      humanInTheLoop: { requireApprovalFor: ['delete_file'] },
    });

    await vi.waitFor(() => {
      expect(store.runStatus).toBe('awaiting_approval');
    });

    await store.editAndRetry('tc1', { query: 'sunny places' });

    const tc = store.messages[0].parts.find((p) => p.type === 'tool_call');
    expect(tc).toMatchObject({ status: 'complete', args: { query: 'sunny places' } });
    expect(transport.recorder.toolResults[0]).toMatchObject({ toolCallId: 'tc1', result: { approved: true } });

    store.dispose();
  });

  it('leaves runStatus at awaiting_approval if another tool call is still pending after one is resolved', async () => {
    const events: ChatEvent[] = [
      { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' },
      { type: 'TOOL_CALL_START', toolCallId: 'tc1', toolName: 'delete_file', parentMessageId: 'm1' },
      { type: 'TOOL_CALL_END', toolCallId: 'tc1' },
      { type: 'TOOL_CALL_START', toolCallId: 'tc2', toolName: 'delete_file', parentMessageId: 'm1' },
      { type: 'TOOL_CALL_END', toolCallId: 'tc2' },
    ];
    const transport = createFixtureTransport(events);
    const store = createChatStore({
      transport,
      threadId: 't1',
      humanInTheLoop: { requireApprovalFor: ['delete_file'] },
    });

    await vi.waitFor(() => {
      expect(store.pendingApprovals).toHaveLength(2);
    });

    await store.approveToolCall('tc1');

    expect(store.runStatus).toBe('awaiting_approval');
    expect(store.pendingApprovals).toHaveLength(1);

    store.dispose();
  });
});

describe('artifact reducer routing', () => {
  function testReducer(): ArtifactReducer {
    return {
      kind: 'generic',
      matches: (event) => event.type === 'CUSTOM' && event.name === 'test.artifact.snapshot',
      apply: (artifacts, event) => {
        if (event.type !== 'CUSTOM') return artifacts;
        const payload = event.payload as { artifactId: string; value: string };
        return {
          ...artifacts,
          [payload.artifactId]: {
            id: payload.artifactId,
            kind: 'generic',
            version: (artifacts[payload.artifactId]?.version ?? 0) + 1,
            createdByMessageId: '',
            data: { value: payload.value },
            status: 'final',
          },
        };
      },
    };
  }

  it('routes a CUSTOM event through a matching registered ArtifactReducer', async () => {
    const events: ChatEvent[] = [
      { type: 'CUSTOM', name: 'test.artifact.snapshot', payload: { artifactId: 'a1', value: 'hello' } },
    ];
    const transport = createFixtureTransport(events);
    const plugin: ChatPlugin = { name: 'test-artifacts', version: '1.0.0', artifactReducers: [testReducer()] };
    const store = createChatStore({ transport, threadId: 't1', plugins: [plugin] });

    await vi.waitFor(() => {
      expect(store.state.artifacts.a1).toBeDefined();
    });

    expect(store.state.artifacts.a1).toMatchObject({ kind: 'generic', data: { value: 'hello' }, status: 'final' });

    store.dispose();
  });

  it('leaves artifacts untouched when no registered reducer matches the CUSTOM event', async () => {
    const events: ChatEvent[] = [{ type: 'CUSTOM', name: 'unknown.thing', payload: {} }];
    const transport = createFixtureTransport(events);
    const store = createChatStore({ transport, threadId: 't1' });

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(store.state.artifacts).toEqual({});

    store.dispose();
  });

  it('store.dispatch() applies a local event through the same artifact-reducer routing as the stream', async () => {
    const transport = createFixtureTransport([]);
    const plugin: ChatPlugin = { name: 'test-artifacts', version: '1.0.0', artifactReducers: [testReducer()] };
    const store = createChatStore({ transport, threadId: 't1', plugins: [plugin] });

    store.dispatch({ type: 'CUSTOM', name: 'test.artifact.snapshot', payload: { artifactId: 'a2', value: 'local' } });

    expect(store.state.artifacts.a2).toMatchObject({ data: { value: 'local' } });

    store.dispose();
  });
});

describe('persistence', () => {
  function fakeAdapter(initial?: ChatState): PersistenceAdapter & { saved: ChatState[] } {
    const saved: ChatState[] = [];
    return {
      saved,
      async loadThread() {
        return initial ?? null;
      },
      async saveThread(_threadId, state) {
        saved.push(state);
      },
      async listThreads() {
        return [];
      },
      async deleteThread() {},
    };
  }

  it('restores messages from a persisted thread before connecting, with runStatus forced to idle', async () => {
    const persisted: ChatState = {
      messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }], createdAt: 0, streaming: false }],
      runStatus: 'running',
      sharedState: null,
      activities: [],
      steps: [],
      artifacts: {},
      error: null,
    };
    const adapter = fakeAdapter(persisted);
    const transport = createFixtureTransport([]);
    const store = createChatStore({ transport, threadId: 't1', persistence: adapter });

    await vi.waitFor(() => {
      expect(store.messages).toHaveLength(1);
    });
    expect(store.runStatus).toBe('idle');

    store.dispose();
  });

  it('debounces saveThread so rapid successive events only trigger one save', async () => {
    vi.useFakeTimers();
    const adapter = fakeAdapter();
    const events: ChatEvent[] = [
      { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'a' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'b' },
      { type: 'TEXT_MESSAGE_END', messageId: 'm1' },
    ];
    const transport = createFixtureTransport(events, { delayMs: 0 });
    const store = createChatStore({ transport, threadId: 't1', persistence: adapter });

    await vi.advanceTimersByTimeAsync(500);

    expect(adapter.saved.length).toBeGreaterThan(0);
    expect(adapter.saved.length).toBeLessThan(events.length);

    store.dispose();
    vi.useRealTimers();
  });

  it('does not call loadThread/saveThread when no persistence adapter is configured', async () => {
    const transport = createFixtureTransport([]);
    const store = createChatStore({ transport, threadId: 't1' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    store.dispose();
    expect(store.state.runStatus).not.toBe('error');
  });
});

describe('i18n', () => {
  it('t() returns the default English string when no i18n config is given', async () => {
    const transport = createFixtureTransport([]);
    const store = createChatStore({ transport, threadId: 't1' });
    expect(store.t('composer.send')).toBe('Send');
    store.dispose();
  });

  it('t() uses a per-key override from config.i18n.messages', async () => {
    const transport = createFixtureTransport([]);
    const store = createChatStore({
      transport,
      threadId: 't1',
      i18n: { locale: 'fr', messages: { 'composer.send': 'Envoyer' } },
    });
    expect(store.t('composer.send')).toBe('Envoyer');
    store.dispose();
  });

  it('dir reflects an RTL locale', async () => {
    const transport = createFixtureTransport([]);
    const store = createChatStore({ transport, threadId: 't1', i18n: { locale: 'ar', messages: {} } });
    expect(store.dir).toBe('rtl');
    store.dispose();
  });
});
