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
});
