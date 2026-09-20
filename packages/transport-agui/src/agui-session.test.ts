import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createAguiTransport } from './agui-transport';

// The session handshake and connection handling: what the transport does when the server restarts, goes silent, or
// refuses. (The basics of connect(), resume and backoff are in agui-transport.test.ts.)

async function startServer(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<{ server: Server; endpoint: string }> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('expected an AddressInfo');
  return { server, endpoint: `http://127.0.0.1:${address.port}` };
}

function sseFrame(event: unknown, id?: string): string {
  const idLine = id ? `id: ${id}\n` : '';
  return `${idLine}data: ${JSON.stringify(event)}\n\n`;
}

function helloFrame(hello: Record<string, unknown>): string {
  return `event: hello\ndata: ${JSON.stringify(hello)}\n\n`;
}

function hello(instanceId: string, mode: 'resume' | 'snapshot', extra: Record<string, unknown> = {}) {
  return { instanceId, mode, threadKnown: true, events: 0, runActive: false, ...extra };
}

function query(req: IncomingMessage): URLSearchParams {
  return new URL(req.url ?? '/', 'http://localhost').searchParams;
}

let activeServer: Server | undefined;

afterEach(async () => {
  if (activeServer) {
    activeServer.closeAllConnections();
    await new Promise<void>((resolve) => activeServer!.close(() => resolve()));
    activeServer = undefined;
  }
});

describe('session handshake', () => {
  it('asks for the handshake, remembers which server it spoke to, and sends that back after a drop', async () => {
    let connectionCount = 0;
    const seen: { instance: string | null; resumeToken: string | null }[] = [];
    const { server, endpoint } = await startServer((req, res) => {
      connectionCount += 1;
      seen.push({ instance: query(req).get('instance'), resumeToken: query(req).get('resumeToken') });
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(helloFrame(hello('A', 'snapshot')));
      if (connectionCount === 1) {
        res.write(sseFrame({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' }, '4'), () => res.destroy());
      } else {
        res.write(sseFrame({ type: 'RUN_FINISHED', runId: 'r1' }, '5'));
        res.end();
      }
    });
    activeServer = server;

    const transport = createAguiTransport({ endpoint, backoff: { base: 5, max: 20, jitter: 0 } });
    const generator = transport.connect({ threadId: 't1' })[Symbol.asyncIterator]();
    await generator.next();
    await generator.next();
    transport.dispose();

    expect(seen[0]).toEqual({ instance: '', resumeToken: null });
    expect(seen[1]).toEqual({ instance: 'A', resumeToken: '4' });
  });

  it('does not pass hello on as an event, but tells the listener', async () => {
    const { server, endpoint } = await startServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(helloFrame(hello('A', 'snapshot', { threadKnown: true, events: 7, runActive: true })));
      res.write(sseFrame({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' }, '1'));
      res.end();
    });
    activeServer = server;

    const sessions: unknown[] = [];
    const transport = createAguiTransport({ endpoint, onSession: (h) => sessions.push(h) });
    const generator = transport.connect({ threadId: 't1' })[Symbol.asyncIterator]();
    const first = await generator.next();
    transport.dispose();

    expect(first.value).toEqual({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' });
    expect(sessions).toEqual([{ instanceId: 'A', mode: 'snapshot', threadKnown: true, events: 7, runActive: true }]);
  });

  it('passes a conversation snapshot through as an event, and continues from the position it carries', async () => {
    let connectionCount = 0;
    const seen: { instance: string | null; resumeToken: string | null }[] = [];
    const snapshot = { type: 'MESSAGES_SNAPSHOT', messages: [{ id: 'm1', role: 'user', parts: [], createdAt: 1, streaming: false }] };
    const { server, endpoint } = await startServer((req, res) => {
      connectionCount += 1;
      seen.push({ instance: query(req).get('instance'), resumeToken: query(req).get('resumeToken') });
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      if (connectionCount === 1) {
        // The browser was talking to gateway A and had seen event 320.
        res.write(helloFrame(hello('A', 'resume')));
        res.write(sseFrame({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' }, '320'), () => res.destroy());
      } else if (connectionCount === 2) {
        // Gateway B restarted: it does not know position 320, so it answers with the whole conversation.
        res.write(helloFrame(hello('B', 'snapshot')));
        res.write(sseFrame(snapshot, '6'), () => res.destroy());
      } else {
        res.write(helloFrame(hello('B', 'resume')));
        res.write(sseFrame({ type: 'RUN_FINISHED', runId: 'r1' }, '7'));
        res.end();
      }
    });
    activeServer = server;

    const transport = createAguiTransport({ endpoint, backoff: { base: 5, max: 20, jitter: 0 } });
    const generator = transport.connect({ threadId: 't1' })[Symbol.asyncIterator]();
    await generator.next();
    const second = await generator.next();
    await generator.next();
    transport.dispose();

    expect(second.value).toEqual(snapshot);
    expect(seen).toEqual([
      { instance: '', resumeToken: null },
      { instance: 'A', resumeToken: '320' }, // sent as is; the server decides it means nothing to it
      { instance: 'B', resumeToken: '6' }, // the position from the new server, not the old one
    ]);
  });

  it('forgets the old position when the server has nothing to send in its place', async () => {
    let connectionCount = 0;
    const seen: (string | null)[] = [];
    const { server, endpoint } = await startServer((req, res) => {
      connectionCount += 1;
      seen.push(query(req).get('resumeToken'));
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      if (connectionCount === 1) {
        res.write(helloFrame(hello('A', 'resume')));
        res.write(sseFrame({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' }, '320'), () => res.destroy());
      } else if (connectionCount === 2) {
        res.write(helloFrame(hello('B', 'snapshot', { threadKnown: false })));
        res.write(': keep-alive\n\n', () => res.destroy());
      } else {
        res.write(helloFrame(hello('B', 'snapshot', { threadKnown: false })));
        res.write(sseFrame({ type: 'RUN_STARTED', runId: 'r2', threadId: 't1' }, '0'));
        res.end();
      }
    });
    activeServer = server;

    const transport = createAguiTransport({ endpoint, backoff: { base: 5, max: 20, jitter: 0 } });
    const generator = transport.connect({ threadId: 't1' })[Symbol.asyncIterator]();
    await generator.next();
    await generator.next();
    transport.dispose();

    expect(seen).toEqual([null, '320', null]);
  });

  it('can be told not to ask for the handshake', async () => {
    let asked: boolean | undefined;
    const { server, endpoint } = await startServer((req, res) => {
      asked = query(req).has('instance');
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(sseFrame({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' }, '1'));
      res.end();
    });
    activeServer = server;

    const transport = createAguiTransport({ endpoint, handshake: false });
    const generator = transport.connect({ threadId: 't1' })[Symbol.asyncIterator]();
    await generator.next();
    transport.dispose();

    expect(asked).toBe(false);
  });
});

describe('a message sent into a dead connection', () => {
  // A restarted server can leave the browser's stream open but deaf (some proxies never pass the close on). A live
  // server answers a run within milliseconds, so bytes not arriving after an accepted run means the stream is dead.
  function deafFirstConnection() {
    let connectionCount = 0;
    const seen: (string | null)[] = [];
    const handler = (req: IncomingMessage, res: ServerResponse) => {
      if (req.method === 'POST') {
        res.writeHead(202, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
        return;
      }
      connectionCount += 1;
      seen.push(query(req).get('resumeToken'));
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      if (connectionCount === 1) {
        res.write(sseFrame({ type: 'RUN_FINISHED', runId: 'earlier' }, '1')); // then nothing, ever: no keep-alive, no close
      } else {
        res.write(sseFrame({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' }, '2'));
        res.write(sseFrame({ type: 'RUN_FINISHED', runId: 'r1' }, '3'));
      }
    };
    return { handler, count: () => connectionCount, seen };
  }

  it('replaces the connection when nothing comes back after the run is accepted', async () => {
    const deaf = deafFirstConnection();
    const { server, endpoint } = await startServer(deaf.handler);
    activeServer = server;
    const states: string[] = [];
    const transport = createAguiTransport({
      endpoint,
      idleTimeoutMs: 0, // the watchdog alone would take far too long: this is the fast path
      runAckTimeoutMs: 150,
      backoff: { base: 5, max: 20, jitter: 0 },
      onConnectionChange: (s) => states.push(s),
    });
    const generator = transport.connect({ threadId: 't1' })[Symbol.asyncIterator]();
    await generator.next(); // the earlier event; the connection is live and now silent

    await transport.sendRun({ threadId: 't1', runId: 'r1', messages: [], tools: [] });
    const started = await generator.next();
    transport.dispose();

    expect(started.value).toEqual({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' });
    expect(deaf.count()).toBe(2);
    expect(deaf.seen).toEqual([null, '1']);
    expect(states).toContain('stale');
  });

  it('leaves a healthy connection alone when the answer arrives promptly', async () => {
    let connectionCount = 0;
    let open: ServerResponse | undefined;
    const { server, endpoint } = await startServer((req, res) => {
      if (req.method === 'POST') {
        res.writeHead(202, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
        // A live server answers at once.
        setTimeout(() => open?.write(sseFrame({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' }, '1')), 20);
        return;
      }
      connectionCount += 1;
      open = res;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(': connected\n\n');
    });
    activeServer = server;

    const transport = createAguiTransport({ endpoint, idleTimeoutMs: 0, runAckTimeoutMs: 200 });
    const generator = transport.connect({ threadId: 't1' })[Symbol.asyncIterator]();
    const pending = generator.next();
    await new Promise((resolve) => setTimeout(resolve, 50)); // let the stream open
    await transport.sendRun({ threadId: 't1', runId: 'r1', messages: [], tools: [] });
    const started = await pending;
    await new Promise((resolve) => setTimeout(resolve, 350)); // well past the probe
    transport.dispose();

    expect(started.value).toEqual({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' });
    expect(connectionCount).toBe(1);
  });
});

describe('starting a run', () => {
  it('fails visibly when the server refuses the request, instead of pretending the run began', async () => {
    const { server, endpoint } = await startServer((req, res) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end('{"error":{"message":"boom"}}');
    });
    activeServer = server;

    const transport = createAguiTransport({ endpoint });

    await expect(transport.sendRun({ threadId: 't1', runId: 'r1', messages: [], tools: [] })).rejects.toThrow(/HTTP 500/);
  });
});

describe('dead and refused connections', () => {
  it('replaces a connection that goes silent without closing (restarted server, half-open socket)', async () => {
    let connectionCount = 0;
    const seenResumeTokens: (string | null)[] = [];
    const { server, endpoint } = await startServer((req, res) => {
      connectionCount += 1;
      seenResumeTokens.push(query(req).get('resumeToken'));
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      if (connectionCount === 1) {
        // One event, then nothing: no keep-alive, no close. A plain reader.read() would wait here forever.
        res.write(sseFrame({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' }, 'frame-1'));
      } else {
        res.write(sseFrame({ type: 'RUN_FINISHED', runId: 'r1' }, 'frame-2'));
        res.end();
      }
    });
    activeServer = server;

    const transport = createAguiTransport({ endpoint, idleTimeoutMs: 150, backoff: { base: 5, max: 20, jitter: 0 } });
    const generator = transport.connect({ threadId: 't1' })[Symbol.asyncIterator]();
    const first = await generator.next();
    const second = await generator.next();
    transport.dispose();

    expect(first.value).toEqual({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' });
    expect(second.value).toEqual({ type: 'RUN_FINISHED', runId: 'r1' });
    expect(connectionCount).toBe(2);
    expect(seenResumeTokens).toEqual([null, 'frame-1']);
  });

  it('does not mistake keep-alive comments for silence', async () => {
    let connectionCount = 0;
    const { server, endpoint } = await startServer((req, res) => {
      connectionCount += 1;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(': connected\n\n');
      const beat = setInterval(() => res.write(': keep-alive\n\n'), 40);
      setTimeout(() => {
        clearInterval(beat);
        res.write(sseFrame({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' }, '1'));
      }, 400);
      res.on('close', () => clearInterval(beat));
    });
    activeServer = server;

    const transport = createAguiTransport({ endpoint, idleTimeoutMs: 150 });
    const generator = transport.connect({ threadId: 't1' })[Symbol.asyncIterator]();
    const first = await generator.next();
    transport.dispose();

    expect(first.value).toEqual({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' });
    expect(connectionCount).toBe(1);
  });

  it('reports its state as the connection goes through its life', async () => {
    let connectionCount = 0;
    const { server, endpoint } = await startServer((req, res) => {
      connectionCount += 1;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      if (connectionCount === 1) {
        res.write(sseFrame({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' }, '1')); // then silence
      } else {
        res.write(sseFrame({ type: 'RUN_FINISHED', runId: 'r1' }, '2'));
      }
    });
    activeServer = server;

    const states: string[] = [];
    const transport = createAguiTransport({
      endpoint,
      idleTimeoutMs: 120,
      backoff: { base: 5, max: 20, jitter: 0 },
      onConnectionChange: (state) => states.push(state),
    });
    const generator = transport.connect({ threadId: 't1' })[Symbol.asyncIterator]();
    await generator.next();
    await generator.next();
    transport.dispose();

    expect(states).toEqual(['connecting', 'live', 'stale', 'reconnecting', 'live', 'closed']);
  });

  it('backs off when the server refuses the connection instead of retrying in a tight loop', async () => {
    let connectionCount = 0;
    const { server, endpoint } = await startServer((req, res) => {
      connectionCount += 1;
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('boom');
    });
    activeServer = server;

    const transport = createAguiTransport({ endpoint, backoff: { base: 100, max: 100, jitter: 0 } });
    const generator = transport.connect({ threadId: 't1' })[Symbol.asyncIterator]();
    void generator.next();
    await new Promise((resolve) => setTimeout(resolve, 450));
    transport.dispose();

    // With backoff there is time for a handful of attempts; without it there would be hundreds.
    expect(connectionCount).toBeGreaterThanOrEqual(2);
    expect(connectionCount).toBeLessThanOrEqual(7);
  });
});
