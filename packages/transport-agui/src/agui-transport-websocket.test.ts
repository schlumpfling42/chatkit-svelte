import { WebSocketServer, WebSocket as NodeWebSocket } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { createAguiTransport } from './agui-transport';

async function startWsServer(onConnection: (ws: import('ws').WebSocket) => void): Promise<{ wss: WebSocketServer; endpoint: string }> {
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise<void>((resolve) => wss.once('listening', resolve));
  wss.on('connection', onConnection);
  const address = wss.address();
  if (address === null || typeof address === 'string') throw new Error('expected an AddressInfo');
  return { wss, endpoint: `http://127.0.0.1:${address.port}` };
}

let activeWss: WebSocketServer | undefined;

afterEach(async () => {
  if (activeWss) {
    for (const client of activeWss.clients) client.terminate();
    await new Promise<void>((resolve) => activeWss!.close(() => resolve()));
    activeWss = undefined;
  }
});

describe('createAguiTransport — websocket mode', () => {
  it('streams JSON messages as ChatEvents in order', async () => {
    const { wss, endpoint } = await startWsServer((ws) => {
      ws.send(JSON.stringify({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' }));
      ws.send(JSON.stringify({ type: 'RUN_FINISHED', runId: 'r1' }));
    });
    activeWss = wss;

    const transport = createAguiTransport({ endpoint, mode: 'websocket', WebSocketImpl: NodeWebSocket as unknown as typeof WebSocket });
    const iterator = transport.connect({ threadId: 't1' })[Symbol.asyncIterator]();
    const first = await iterator.next();
    const second = await iterator.next();
    transport.dispose();

    expect(first.value).toEqual({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' });
    expect(second.value).toEqual({ type: 'RUN_FINISHED', runId: 'r1' });
  });

  it('reconnects with backoff after the socket closes unexpectedly', async () => {
    let connectionCount = 0;
    const { wss, endpoint } = await startWsServer((ws) => {
      connectionCount += 1;
      if (connectionCount === 1) {
        ws.send(JSON.stringify({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' }));
        setTimeout(() => ws.terminate(), 10); // simulate an abrupt drop, not a clean close
      } else {
        ws.send(JSON.stringify({ type: 'RUN_FINISHED', runId: 'r1' }));
      }
    });
    activeWss = wss;

    const transport = createAguiTransport({
      endpoint,
      mode: 'websocket',
      WebSocketImpl: NodeWebSocket as unknown as typeof WebSocket,
      backoff: { base: 5, max: 20, jitter: 0 },
    });
    const iterator = transport.connect({ threadId: 't1' })[Symbol.asyncIterator]();
    const first = await iterator.next();
    const second = await iterator.next();
    transport.dispose();

    expect(first.value).toEqual({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' });
    expect(second.value).toEqual({ type: 'RUN_FINISHED', runId: 'r1' });
    expect(connectionCount).toBe(2);
  });

  it('escalates backoff across repeated abrupt socket drops instead of resetting each time', async () => {
    const connectionTimestamps: number[] = [];
    let connectionCount = 0;
    const { wss, endpoint } = await startWsServer((ws) => {
      connectionCount += 1;
      connectionTimestamps.push(Date.now());
      if (connectionCount <= 2) {
        // Accept the connection, then terminate it abruptly (no close
        // handshake) to simulate a network drop / crash, not a clean close.
        // Terminate immediately (no extra setTimeout) to keep handshake/IO
        // jitter small relative to the configured backoff steps below.
        ws.terminate();
        return;
      }
      ws.send(JSON.stringify({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' }));
    });
    activeWss = wss;

    const transport = createAguiTransport({
      endpoint,
      mode: 'websocket',
      WebSocketImpl: NodeWebSocket as unknown as typeof WebSocket,
      backoff: { base: 40, factor: 3, max: 1000, jitter: 0 },
      minStableConnectionMs: 10000, // effectively "never stable" for this fast test
    });
    const generator = transport.connect({ threadId: 't1' })[Symbol.asyncIterator]();
    await generator.next();
    transport.dispose();

    expect(connectionCount).toBe(3);
    const gap1 = connectionTimestamps[1] - connectionTimestamps[0];
    const gap2 = connectionTimestamps[2] - connectionTimestamps[1];
    // With correct escalation: gap1 ~= backoff(attempt=1) = 40ms, gap2 ~= backoff(attempt=2) = 120ms.
    // With the bug (close listener never signals an error, so streamFailed
    // stays false and the "clean close" path is always taken): both gaps
    // would be near-zero regardless of configured backoff. Assert gap2 is
    // meaningfully larger than gap1 rather than asserting exact values, to
    // tolerate normal timer/CI scheduling slop.
    expect(gap2).toBeGreaterThan(gap1 * 1.4);
  }, 10000);

  it('requests a fresh snapshot when a STATE_DELTA fails to apply', async () => {
    // WebSocket mode still recovers state via plain HTTP GET /threads/:id/state
    // (only the event stream itself differs by mode), so this test attaches
    // the WebSocketServer to a real http.Server that also answers that route
    // — both share one origin, matching how a real AG-UI server would.
    const { createServer } = await import('node:http');
    const httpServer = createServer((req, res) => {
      if (req.url?.endsWith('/state')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ count: 99 }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    const wss = new WebSocketServer({ server: httpServer });
    wss.on('connection', (ws) => {
      ws.send(JSON.stringify({ type: 'STATE_SNAPSHOT', snapshot: { count: 1 } }));
      ws.send(JSON.stringify({ type: 'STATE_DELTA', patch: [{ op: 'replace', path: '/missing', value: 2 }] }));
    });
    activeWss = wss;
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const address = httpServer.address();
    if (address === null || typeof address === 'string') throw new Error('bad address');
    const endpoint = `http://127.0.0.1:${address.port}`;

    const transport = createAguiTransport({ endpoint, mode: 'websocket', WebSocketImpl: NodeWebSocket as unknown as typeof WebSocket });
    const iterator = transport.connect({ threadId: 't1' })[Symbol.asyncIterator]();
    const first = await iterator.next();
    const second = await iterator.next();
    transport.dispose();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));

    expect(first.value).toEqual({ type: 'STATE_SNAPSHOT', snapshot: { count: 1 } });
    expect(second.value).toEqual({ type: 'STATE_SNAPSHOT', snapshot: { count: 99 } });
  });
});
