import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ChatEvent, RunAgentInput } from '@chatkit-svelte/core';

const mockRun = vi.fn();
const mockUnsubscribe = vi.fn();

vi.mock('@ag-ui/claude-managed-agents', () => ({
  ManagedAgentsAgent: vi.fn().mockImplementation(() => ({
    run: mockRun,
  })),
}));

vi.mock('../src/lib/env', () => ({
  getManagedAgentEnv: () => ({ agentId: 'agent_test', environmentId: 'env_test' }),
}));

const mockFilesUpload = vi.fn();
const mockResourcesAdd = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    beta: {
      files: { upload: mockFilesUpload },
      sessions: { resources: { add: mockResourcesAdd } },
    },
  })),
  toFile: vi.fn(async (buffer: Buffer, name: string, opts: { type: string }) => ({ buffer, name, type: opts.type })),
}));

const baseInput: RunAgentInput = {
  threadId: 't1',
  runId: 'run1',
  messages: [],
  tools: [],
};

function fakeObservable(events: ChatEvent[]) {
  return {
    subscribe(observer: { next: (e: ChatEvent) => void; error: (e: unknown) => void; complete: () => void }) {
      queueMicrotask(() => {
        for (const event of events) observer.next(event);
        observer.complete();
      });
      return { unsubscribe: mockUnsubscribe };
    },
  };
}

const SESSION_CUSTOM_EVENT = {
  type: 'CUSTOM',
  name: 'managed_agents.session',
  value: { sessionId: 'sesn_test123', threadId: 't1' },
};

describe('agent-sessions', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../src/lib/agent-sessions');
    mod.__resetSessionsForTest();
  });

  it('reuses the same ManagedAgentsAgent instance for the same threadId', async () => {
    const { getOrCreateSession } = await import('../src/lib/agent-sessions');
    const a = getOrCreateSession('t1');
    const b = getOrCreateSession('t1');
    expect(a.agent).toBe(b.agent);
  });

  it('startRun appends emitted events to the thread log', async () => {
    const events: ChatEvent[] = [
      { type: 'RUN_STARTED', runId: 'run1', threadId: 't1' },
      { type: 'RUN_FINISHED', runId: 'run1' },
    ];
    mockRun.mockReturnValue(fakeObservable(events));
    const { startRun, getOrCreateSession } = await import('../src/lib/agent-sessions');
    startRun('t1', baseInput);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getOrCreateSession('t1').events).toEqual(events);
  });

  it('subscribeFromIndex replays buffered events then yields new ones', async () => {
    const events: ChatEvent[] = [
      { type: 'RUN_STARTED', runId: 'run1', threadId: 't1' },
      { type: 'RUN_FINISHED', runId: 'run1' },
    ];
    mockRun.mockReturnValue(fakeObservable(events));
    const { startRun, subscribeFromIndex } = await import('../src/lib/agent-sessions');
    startRun('t1', baseInput);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const seen: ChatEvent[] = [];
    const gen = subscribeFromIndex('t1', 0);
    seen.push((await gen.next()).value.event);
    seen.push((await gen.next()).value.event);
    expect(seen).toEqual(events);
  });

  it('subscribeFromIndex parks on the internal await when no events exist yet, then resolves once startRun appends one', async () => {
    const events: ChatEvent[] = [{ type: 'RUN_STARTED', runId: 'run1', threadId: 't1' }];
    mockRun.mockReturnValue(fakeObservable(events));
    const { startRun, subscribeFromIndex } = await import('../src/lib/agent-sessions');

    // Create the generator and park it on the internal `await` BEFORE any
    // event exists — this is the race-sensitive branch (a consumer already
    // waiting) that the earlier "replays buffered events" test never
    // exercises, since that test awaits startRun to finish first.
    const gen = subscribeFromIndex('t1', 0);
    const pending = gen.next();

    startRun('t1', baseInput);

    const result = await pending;
    expect(result.done).toBe(false);
    expect(result.value).toEqual({ index: 0, event: events[0] });
  });

  it('findSessionByRunId locates the thread with a matching active run', async () => {
    mockRun.mockReturnValue({ subscribe: () => ({ unsubscribe: mockUnsubscribe }) });
    const { startRun, findSessionByRunId } = await import('../src/lib/agent-sessions');
    startRun('t1', baseInput);
    const found = findSessionByRunId('run1');
    expect(found?.threadId).toBe('t1');
  });

  it('abortRun unsubscribes and clears the active run', async () => {
    mockRun.mockReturnValue({ subscribe: () => ({ unsubscribe: mockUnsubscribe }) });
    const { startRun, abortRun, findSessionByRunId } = await import('../src/lib/agent-sessions');
    startRun('t1', baseInput);
    abortRun('t1');
    expect(mockUnsubscribe).toHaveBeenCalled();
    expect(findSessionByRunId('run1')).toBeUndefined();
  });

  it('getCurrentState reflects the most recent STATE_SNAPSHOT', async () => {
    const events: ChatEvent[] = [{ type: 'STATE_SNAPSHOT', snapshot: { count: 1 } }];
    mockRun.mockReturnValue(fakeObservable(events));
    const { startRun, getCurrentState } = await import('../src/lib/agent-sessions');
    startRun('t1', baseInput);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getCurrentState('t1')).toEqual({ count: 1 });
  });

  describe('attachments', () => {
    const attachInput: RunAgentInput = {
      threadId: 't1',
      runId: 'run-attach',
      messages: [
        {
          id: 'm1',
          role: 'user',
          createdAt: 0,
          streaming: false,
          parts: [
            { type: 'text', text: 'what is this?' },
            { type: 'image', url: 'data:image/png;base64,iVBORw0KGgo=', mimeType: 'image/png' },
          ],
        },
      ],
      tools: [],
    };

    it('runs a text-only turn first, mounts the attachment once the real session id is known, then sends a follow-up turn', async () => {
      const phase1Events: ChatEvent[] = [SESSION_CUSTOM_EVENT as unknown as ChatEvent, { type: 'RUN_FINISHED', runId: 'run-attach' }];
      const phase2Events: ChatEvent[] = [{ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm2', delta: 'nice image' }];
      mockRun.mockReturnValueOnce(fakeObservable(phase1Events)).mockReturnValueOnce(fakeObservable(phase2Events));
      mockFilesUpload.mockResolvedValue({ id: 'file_abc' });
      mockResourcesAdd.mockResolvedValue({ mount_path: '/mnt/session/uploads/file_abc' });

      const { startRun, getOrCreateSession } = await import('../src/lib/agent-sessions');
      startRun('t1', attachInput);
      // Two microtask/setTimeout(0) turns plus the upload/mount awaits — a
      // couple of ticks is enough since everything here is mocked to resolve
      // immediately, but give it a little room.
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Phase 1 was sent text-only (image stripped) — the call args mirror
      // AG-UI's own message shape (see toAguiMessages), so just check no
      // image content part made it into either call's outgoing messages.
      expect(mockRun).toHaveBeenCalledTimes(2);
      const phase1Arg = mockRun.mock.calls[0][0];
      expect(JSON.stringify(phase1Arg.messages)).not.toContain('image');

      expect(mockFilesUpload).toHaveBeenCalledTimes(1);
      expect(mockResourcesAdd).toHaveBeenCalledWith('sesn_test123', { file_id: 'file_abc', type: 'file' });

      // Phase 2's outgoing messages should mention the real mount path.
      const phase2Arg = mockRun.mock.calls[1][0];
      expect(JSON.stringify(phase2Arg.messages)).toContain('/mnt/session/uploads/file_abc');

      const session = getOrCreateSession('t1');
      expect(session.realSessionId).toBe('sesn_test123');
      // fromAguiEvent wraps the raw CUSTOM event (it's not one of the types
      // it maps explicitly) and fills RUN_FINISHED's optional `result` key —
      // so the stored events aren't a byte-for-byte copy of the raw fixtures
      // above, just their translated shape. Check that translation, plus
      // that both phases' events all made it into the log in order.
      expect(session.events).toHaveLength(3);
      expect(session.events[0]).toEqual({ type: 'CUSTOM', name: 'agui:CUSTOM', payload: SESSION_CUSTOM_EVENT });
      expect(session.events[1]).toEqual({ type: 'RUN_FINISHED', runId: 'run-attach', result: undefined });
      expect(session.events[2]).toEqual(phase2Events[0]);
    });

    it('uses placeholder text for the first turn when the message is an attachment with no text', async () => {
      const attachOnlyInput: RunAgentInput = {
        threadId: 't1',
        runId: 'run-attach-only',
        messages: [
          {
            id: 'm1',
            role: 'user',
            createdAt: 0,
            streaming: false,
            parts: [{ type: 'file', url: 'data:application/pdf;base64,JVBERi0=', name: 'report.pdf', mimeType: 'application/pdf', sizeBytes: 4 }],
          },
        ],
        tools: [],
      };
      mockRun
        .mockReturnValueOnce(fakeObservable([SESSION_CUSTOM_EVENT as unknown as ChatEvent, { type: 'RUN_FINISHED', runId: 'run-attach-only' }]))
        .mockReturnValueOnce(fakeObservable([]));
      mockFilesUpload.mockResolvedValue({ id: 'file_pdf' });
      mockResourcesAdd.mockResolvedValue({ mount_path: '/mnt/session/uploads/file_pdf' });

      const { startRun } = await import('../src/lib/agent-sessions');
      startRun('t1', attachOnlyInput);
      await new Promise((resolve) => setTimeout(resolve, 10));

      const phase1Arg = mockRun.mock.calls[0][0];
      expect(JSON.stringify(phase1Arg.messages)).toContain("attaching a file");
    });

    it('appends a recoverable RUN_ERROR and skips the follow-up turn when mounting fails', async () => {
      mockRun.mockReturnValueOnce(
        fakeObservable([SESSION_CUSTOM_EVENT as unknown as ChatEvent, { type: 'RUN_FINISHED', runId: 'run-attach' }])
      );
      mockFilesUpload.mockRejectedValue(new Error('upload failed'));

      const { startRun, getOrCreateSession } = await import('../src/lib/agent-sessions');
      startRun('t1', attachInput);
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Only the phase-1 call — no follow-up turn since nothing mounted.
      expect(mockRun).toHaveBeenCalledTimes(1);
      const session = getOrCreateSession('t1');
      const errorEvent = session.events.find((e) => e.type === 'RUN_ERROR');
      expect(errorEvent).toMatchObject({ type: 'RUN_ERROR', error: { code: 'attachment_mount_failed', recoverable: true } });
    });

    it('reports a clear error instead of mounting when the attachment url is not a data: URI', async () => {
      const nonDataUriInput: RunAgentInput = {
        threadId: 't1',
        runId: 'run-attach-url',
        messages: [
          {
            id: 'm1',
            role: 'user',
            createdAt: 0,
            streaming: false,
            parts: [{ type: 'image', url: 'https://example.com/cat.png', mimeType: 'image/png' }],
          },
        ],
        tools: [],
      };
      mockRun.mockReturnValueOnce(
        fakeObservable([SESSION_CUSTOM_EVENT as unknown as ChatEvent, { type: 'RUN_FINISHED', runId: 'run-attach-url' }])
      );

      const { startRun, getOrCreateSession } = await import('../src/lib/agent-sessions');
      startRun('t1', nonDataUriInput);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockFilesUpload).not.toHaveBeenCalled();
      const session = getOrCreateSession('t1');
      const errorEvent = session.events.find((e) => e.type === 'RUN_ERROR');
      expect(errorEvent).toMatchObject({ type: 'RUN_ERROR', error: { code: 'attachment_mount_failed' } });
    });
  });
});
