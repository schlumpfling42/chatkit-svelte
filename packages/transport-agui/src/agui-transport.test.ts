import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createAguiTransport } from './agui-transport';

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

let activeServer: Server | undefined;

afterEach(async () => {
  if (activeServer) {
    // Force-close any lingering keep-alive sockets (e.g. from a connection
    // the client aborted but didn't cleanly finish) — otherwise server.close()
    // waits out Node's default keep-alive timeout (~5s) before resolving.
    activeServer.closeAllConnections();
    await new Promise<void>((resolve) => activeServer!.close(() => resolve()));
    activeServer = undefined;
  }
});

describe('createAguiTransport — connect', () => {
  it('streams SSE events as ChatEvents in order', async () => {
    const { server, endpoint } = await startServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(sseFrame({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' }, '1'));
      res.write(sseFrame({ type: 'RUN_FINISHED', runId: 'r1' }, '2'));
      res.end();
    });
    activeServer = server;

    const transport = createAguiTransport({ endpoint });
    const generator = transport.connect({ threadId: 't1' })[Symbol.asyncIterator]();
    const first = await generator.next();
    const second = await generator.next();
    transport.dispose();

    expect(first.value).toEqual({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' });
    expect(second.value).toEqual({ type: 'RUN_FINISHED', runId: 'r1' });
  });

  it('reconnects with the last-seen frame id as resumeToken after a dropped connection', async () => {
    let connectionCount = 0;
    const seenResumeTokens: (string | null)[] = [];
    const { server, endpoint } = await startServer((req, res) => {
      connectionCount += 1;
      const url = new URL(req.url ?? '/', 'http://localhost');
      seenResumeTokens.push(url.searchParams.get('resumeToken'));
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      if (connectionCount === 1) {
        // Simulate a dropped connection: destroy the socket without a clean
        // end(), but only after the write is actually flushed to the wire —
        // destroying synchronously right after write() can race the buffered
        // write and drop the frame entirely.
        res.write(sseFrame({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' }, 'frame-1'), () => {
          res.destroy();
        });
      } else {
        res.write(sseFrame({ type: 'RUN_FINISHED', runId: 'r1' }, 'frame-2'));
        res.end();
      }
    });
    activeServer = server;

    const transport = createAguiTransport({ endpoint, backoff: { base: 5, max: 20, jitter: 0 } });
    const generator = transport.connect({ threadId: 't1' })[Symbol.asyncIterator]();
    const first = await generator.next();
    const second = await generator.next();
    transport.dispose();

    expect(first.value).toEqual({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' });
    expect(second.value).toEqual({ type: 'RUN_FINISHED', runId: 'r1' });
    expect(connectionCount).toBe(2);
    expect(seenResumeTokens).toEqual([null, 'frame-1']);
  });

  it('requests a fresh snapshot and substitutes it when a STATE_DELTA fails to apply', async () => {
    const { server, endpoint } = await startServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname.endsWith('/state')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ count: 99 }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(sseFrame({ type: 'STATE_SNAPSHOT', snapshot: { count: 1 } }, '1'));
      // This delta targets a path that doesn't exist in { count: 1 }, so it fails to apply.
      res.write(sseFrame({ type: 'STATE_DELTA', patch: [{ op: 'replace', path: '/missing', value: 2 }] }, '2'));
      res.end();
    });
    activeServer = server;

    const transport = createAguiTransport({ endpoint });
    const generator = transport.connect({ threadId: 't1' })[Symbol.asyncIterator]();
    const first = await generator.next();
    const second = await generator.next();
    transport.dispose();

    expect(first.value).toEqual({ type: 'STATE_SNAPSHOT', snapshot: { count: 1 } });
    // The broken STATE_DELTA is never yielded; a fresh STATE_SNAPSHOT from
    // GET /threads/:id/state is synthesized and yielded instead.
    expect(second.value).toEqual({ type: 'STATE_SNAPSHOT', snapshot: { count: 99 } });
  });

  it('forwards a STATE_DELTA unchanged when it applies successfully', async () => {
    let stateEndpointHit = false;
    const { server, endpoint } = await startServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname.endsWith('/state')) {
        stateEndpointHit = true;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ count: -1 }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(sseFrame({ type: 'STATE_SNAPSHOT', snapshot: { count: 1 } }, '1'));
      // This delta targets a path that DOES exist in { count: 1 }, so it applies cleanly.
      res.write(sseFrame({ type: 'STATE_DELTA', patch: [{ op: 'replace', path: '/count', value: 2 }] }, '2'));
      res.end();
    });
    activeServer = server;

    const transport = createAguiTransport({ endpoint });
    const generator = transport.connect({ threadId: 't1' })[Symbol.asyncIterator]();
    const first = await generator.next();
    const second = await generator.next();
    transport.dispose();

    expect(first.value).toEqual({ type: 'STATE_SNAPSHOT', snapshot: { count: 1 } });
    // The delta applies cleanly, so it's forwarded exactly as received —
    // not synthesized into a STATE_SNAPSHOT, and /state is never called.
    expect(second.value).toEqual({ type: 'STATE_DELTA', patch: [{ op: 'replace', path: '/count', value: 2 }] });
    expect(stateEndpointHit).toBe(false);
  });

  it('stops without reconnecting once dispose() is called', async () => {
    let connectionCount = 0;
    const { server, endpoint } = await startServer((req, res) => {
      connectionCount += 1;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(sseFrame({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' }, '1'));
      // never end() — keep the connection open until the client aborts it
    });
    activeServer = server;

    const transport = createAguiTransport({ endpoint, backoff: { base: 5, max: 20, jitter: 0 } });
    const generator = transport.connect({ threadId: 't1' })[Symbol.asyncIterator]();
    await generator.next();
    transport.dispose();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(connectionCount).toBe(1);
  });

  it('escalates backoff across repeated near-instant connection failures instead of resetting each time', async () => {
    const connectionTimestamps: number[] = [];
    let connectionCount = 0;
    const { server, endpoint } = await startServer((req, res) => {
      connectionCount += 1;
      connectionTimestamps.push(Date.now());
      if (connectionCount <= 2) {
        // Accept the connection, then drop it almost immediately — well
        // under minStableConnectionMs — to simulate a flapping connection.
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.destroy();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(sseFrame({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' }, '1'));
      res.end();
    });
    activeServer = server;

    const transport = createAguiTransport({
      endpoint,
      backoff: { base: 30, factor: 2, max: 1000, jitter: 0 },
      minStableConnectionMs: 10000, // effectively "never stable" for this fast test
    });
    const generator = transport.connect({ threadId: 't1' })[Symbol.asyncIterator]();
    await generator.next();
    transport.dispose();

    expect(connectionCount).toBe(3);
    const gap1 = connectionTimestamps[1] - connectionTimestamps[0];
    const gap2 = connectionTimestamps[2] - connectionTimestamps[1];
    // With correct escalation: gap1 ~= backoff(attempt=1) = 30ms, gap2 ~= backoff(attempt=2) = 60ms.
    // With the bug (reset every time): both gaps would be ~30ms. Assert gap2
    // is meaningfully larger than gap1 rather than asserting exact values,
    // to tolerate normal timer/CI scheduling slop.
    expect(gap2).toBeGreaterThan(gap1 * 1.4);
  }, 10000);
});

describe('createAguiTransport — sendRun', () => {
  it('POSTs to /runs with an Idempotency-Key header and the run input as JSON', async () => {
    let capturedBody: unknown;
    let capturedIdempotencyKey: string | undefined;
    const { server, endpoint } = await startServer((req, res) => {
      capturedIdempotencyKey = req.headers['idempotency-key'] as string | undefined;
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        capturedBody = JSON.parse(raw);
        res.writeHead(200);
        res.end();
      });
    });
    activeServer = server;

    const transport = createAguiTransport({ endpoint });
    await transport.sendRun({ threadId: 't1', runId: 'r1', messages: [], tools: [] });

    expect(capturedBody).toEqual({ threadId: 't1', runId: 'r1', messages: [], tools: [] });
    expect(capturedIdempotencyKey).toBeTruthy();
  });
});

describe('createAguiTransport — sendFrontendToolResult', () => {
  it('POSTs to /tool-results with the result as JSON', async () => {
    let capturedBody: unknown;
    const { server, endpoint } = await startServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        capturedBody = JSON.parse(raw);
        res.writeHead(200);
        res.end();
      });
    });
    activeServer = server;

    const transport = createAguiTransport({ endpoint });
    await transport.sendFrontendToolResult({ toolCallId: 'tc1', result: 'ok' });

    expect(capturedBody).toEqual({ toolCallId: 'tc1', result: 'ok' });
  });
});

describe('createAguiTransport — abortRun', () => {
  it('sends DELETE /runs/:runId', async () => {
    let capturedMethod: string | undefined;
    let capturedPath: string | undefined;
    const { server, endpoint } = await startServer((req, res) => {
      capturedMethod = req.method;
      capturedPath = req.url;
      res.writeHead(200);
      res.end();
    });
    activeServer = server;

    const transport = createAguiTransport({ endpoint });
    await transport.abortRun('r1');

    expect(capturedMethod).toBe('DELETE');
    expect(capturedPath).toBe('/runs/r1');
  });

  it('swallows errors when the server does not support cancellation', async () => {
    const { server, endpoint } = await startServer((req, res) => {
      res.writeHead(404);
      res.end();
    });
    activeServer = server;

    const transport = createAguiTransport({ endpoint });
    await expect(transport.abortRun('r1')).resolves.toBeUndefined();
  });
});

describe('createAguiTransport — getCapabilities', () => {
  it('GETs /capabilities and parses the JSON response', async () => {
    const capabilities = {
      transports: ['sse'],
      tools: ['search'],
      multimodal: false,
      reasoning: true,
      humanInTheLoop: true,
      sharedStateWritable: false,
    };
    const { server, endpoint } = await startServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(capabilities));
    });
    activeServer = server;

    const transport = createAguiTransport({ endpoint });
    const result = await transport.getCapabilities?.();

    expect(result).toEqual(capabilities);
  });
});
