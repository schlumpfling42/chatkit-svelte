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
const mockSessionsCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    beta: {
      files: { upload: mockFilesUpload },
      sessions: { create: mockSessionsCreate, resources: { add: mockResourcesAdd } },
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

    it('pre-creates the real session with the attachment already mounted, then sends ONE turn (no separate follow-up)', async () => {
      const responseEvents: ChatEvent[] = [{ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm2', delta: 'nice image' }];
      mockRun.mockReturnValueOnce(fakeObservable(responseEvents));
      mockFilesUpload.mockResolvedValue({ id: 'file_abc' });
      mockSessionsCreate.mockResolvedValue({
        id: 'sesn_test123',
        resources: [{ type: 'file', file_id: 'file_abc', mount_path: '/mnt/session/uploads/file_abc' }],
      });

      const { startRun, getOrCreateSession } = await import('../src/lib/agent-sessions');
      startRun('t1', attachInput);
      await new Promise((resolve) => setTimeout(resolve, 10));

      // A single real turn — no separate text-only-then-follow-up round trip.
      expect(mockRun).toHaveBeenCalledTimes(1);

      expect(mockFilesUpload).toHaveBeenCalledTimes(1);
      expect(mockSessionsCreate).toHaveBeenCalledWith({
        agent: 'agent_test',
        environment_id: 'env_test',
        resources: [{ type: 'file', file_id: 'file_abc' }],
      });
      expect(mockResourcesAdd).not.toHaveBeenCalled();

      // The single outgoing turn should have the image stripped and the
      // real resolved mount path mentioned, all in one message.
      const arg = mockRun.mock.calls[0][0];
      const serialized = JSON.stringify(arg.messages);
      expect(serialized).not.toContain('"type":"image"');
      expect(serialized).toContain('/mnt/session/uploads/file_abc');

      const session = getOrCreateSession('t1');
      expect(session.realSessionId).toBe('sesn_test123');
      expect(session.events).toEqual(responseEvents);
    });

    it('mounts directly onto an already-existing session (no pre-create) when one is already known for the thread', async () => {
      const { startRun, getOrCreateSession } = await import('../src/lib/agent-sessions');
      const session = getOrCreateSession('t1');
      session.realSessionId = 'sesn_existing';

      mockRun.mockReturnValueOnce(fakeObservable([]));
      mockFilesUpload.mockResolvedValue({ id: 'file_abc' });
      mockResourcesAdd.mockResolvedValue({ mount_path: '/mnt/session/uploads/file_abc' });

      startRun('t1', attachInput);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockSessionsCreate).not.toHaveBeenCalled();
      expect(mockResourcesAdd).toHaveBeenCalledWith('sesn_existing', { file_id: 'file_abc', type: 'file' });
      expect(mockRun).toHaveBeenCalledTimes(1);
    });

    it('uses placeholder text when the message is an attachment with no text at all', async () => {
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
      mockRun.mockReturnValueOnce(fakeObservable([]));
      mockFilesUpload.mockResolvedValue({ id: 'file_pdf' });
      mockSessionsCreate.mockResolvedValue({
        id: 'sesn_test123',
        resources: [{ type: 'file', file_id: 'file_pdf', mount_path: '/mnt/session/uploads/file_pdf' }],
      });

      const { startRun } = await import('../src/lib/agent-sessions');
      startRun('t1', attachOnlyInput);
      await new Promise((resolve) => setTimeout(resolve, 10));

      const arg = mockRun.mock.calls[0][0];
      // No original text existed, so the only text present should be the
      // system note about the mount path (still no placeholder "attaching a
      // file" filler needed now that mounting happens before the turn).
      expect(JSON.stringify(arg.messages)).toContain('/mnt/session/uploads/file_pdf');
    });

    it('appends a recoverable RUN_ERROR and still sends the turn (without a mount note) when uploading fails', async () => {
      mockRun.mockReturnValueOnce(fakeObservable([]));
      mockFilesUpload.mockRejectedValue(new Error('upload failed'));

      const { startRun, getOrCreateSession } = await import('../src/lib/agent-sessions');
      startRun('t1', attachInput);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockSessionsCreate).not.toHaveBeenCalled();
      // The turn still goes out (text-only, since nothing mounted) rather
      // than being silently dropped.
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
      mockRun.mockReturnValueOnce(fakeObservable([]));

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
