import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createVercelAiTransport } from './vercel-ai-transport';
import type { RunAgentInput } from '@chatkit/core';

async function startServer(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<{ server: Server; endpoint: string }> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('expected an AddressInfo');
  return { server, endpoint: `http://127.0.0.1:${address.port}` };
}

let activeServer: Server | undefined;

afterEach(async () => {
  if (activeServer) {
    activeServer.closeAllConnections();
    await new Promise<void>((resolve) => activeServer!.close(() => resolve()));
    activeServer = undefined;
  }
});

function baseInput(overrides: Partial<RunAgentInput> = {}): RunAgentInput {
  return { threadId: 't1', runId: 'r1', messages: [], tools: [], ...overrides };
}

describe('createVercelAiTransport', () => {
  it('streams a text reply as RUN_STARTED, TEXT_MESSAGE_*, RUN_FINISHED', async () => {
    const { server, endpoint } = await startServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.write('0:"Hello"\n');
      res.write('0:", world"\n');
      res.write('d:{"finishReason":"stop"}\n');
      res.end();
    });
    activeServer = server;

    const transport = createVercelAiTransport({ endpoint });
    const events: unknown[] = [];
    const iterator = transport.connect({ threadId: 't1' })[Symbol.asyncIterator]();
    const collectPromise = (async () => {
      for (let i = 0; i < 5; i++) events.push((await iterator.next()).value);
    })();

    await transport.sendRun(baseInput());
    await collectPromise;
    transport.dispose();

    expect(events[0]).toMatchObject({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' });
    expect(events[1]).toMatchObject({ type: 'TEXT_MESSAGE_START', role: 'assistant' });
    expect(events[2]).toMatchObject({ type: 'TEXT_MESSAGE_CONTENT', delta: 'Hello' });
    expect(events[3]).toMatchObject({ type: 'TEXT_MESSAGE_CONTENT', delta: ', world' });
    expect(events[4]).toMatchObject({ type: 'TEXT_MESSAGE_END' });
  });

  it('emits RUN_ERROR on a server error part instead of throwing out of sendRun', async () => {
    const { server, endpoint } = await startServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.write('3:"something broke"\n');
      res.end();
    });
    activeServer = server;

    const transport = createVercelAiTransport({ endpoint });
    const iterator = transport.connect({ threadId: 't1' })[Symbol.asyncIterator]();
    const first = iterator.next();
    const second = iterator.next();

    await transport.sendRun(baseInput());
    await first; // RUN_STARTED, always emitted first
    const event = (await second).value;
    transport.dispose();

    expect(event).toMatchObject({ type: 'RUN_ERROR', runId: 'r1' });
    expect((event as { error: { message: string } }).error.message).toContain('something broke');
  });

  it('maps complete tool call parts to TOOL_CALL_START/ARGS/END', async () => {
    const { server, endpoint } = await startServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.write('9:{"toolCallId":"tc1","toolName":"search","args":{"q":"x"}}\n');
      res.write('d:{"finishReason":"tool-calls"}\n');
      res.end();
    });
    activeServer = server;

    const transport = createVercelAiTransport({ endpoint });
    const events: unknown[] = [];
    const iterator = transport.connect({ threadId: 't1' })[Symbol.asyncIterator]();
    const collectPromise = (async () => {
      for (let i = 0; i < 4; i++) events.push((await iterator.next()).value);
    })();

    await transport.sendRun(baseInput());
    await collectPromise;
    transport.dispose();

    expect(events[1]).toMatchObject({ type: 'TOOL_CALL_START', toolCallId: 'tc1', toolName: 'search' });
    expect(events[2]).toMatchObject({ type: 'TOOL_CALL_ARGS', toolCallId: 'tc1' });
    expect(events[3]).toMatchObject({ type: 'TOOL_CALL_END', toolCallId: 'tc1' });
  });

  it('POSTs a text-only mapping of the message history to the endpoint', async () => {
    let receivedBody: unknown;
    const { server, endpoint } = await startServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        receivedBody = JSON.parse(body);
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('d:{"finishReason":"stop"}\n');
      });
    });
    activeServer = server;

    const transport = createVercelAiTransport({ endpoint });
    const iterator = transport.connect({ threadId: 't1' })[Symbol.asyncIterator]();
    const drain = iterator.next();

    await transport.sendRun(
      baseInput({
        messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }], createdAt: 0, streaming: false }],
      })
    );
    await drain;
    transport.dispose();

    expect(receivedBody).toEqual({ messages: [{ role: 'user', content: 'hi' }] });
  });

  it('abortRun aborts the in-flight fetch', async () => {
    const { server, endpoint } = await startServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      // Never ends on its own — the test drives the abort.
    });
    activeServer = server;

    const transport = createVercelAiTransport({ endpoint });
    transport.connect({ threadId: 't1' });
    const runPromise = transport.sendRun(baseInput());
    await transport.abortRun('r1');
    await runPromise;
    transport.dispose();
  });

  it('sendFrontendToolResult resolves without making a request (documented no-op — see plan decision 5)', async () => {
    const transport = createVercelAiTransport({ endpoint: 'http://127.0.0.1:1' });
    await expect(transport.sendFrontendToolResult({ toolCallId: 'tc1', result: {} })).resolves.toBeUndefined();
    transport.dispose();
  });
});
