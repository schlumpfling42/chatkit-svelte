export const sseEchoServerSource = `import { createServer } from 'node:http';

// Minimal AG-UI-shaped SSE echo server for local development: POST a run,
// GET the event stream, and it plays the last user message back as a
// streamed assistant reply. Not a real agent backend — replace this once
// you have one.
const PORT = process.env.PORT ? Number(process.env.PORT) : 8787;
const clients = new Map(); // threadId -> Set<ServerResponse>
let lastUserText = 'Hello! Ask me anything.';

function send(res, event) {
  res.write(\`data: \${JSON.stringify(event)}\\n\\n\`);
}

function broadcast(threadId, event) {
  for (const res of clients.get(threadId) ?? []) send(res, event);
}

async function streamReply(threadId, text) {
  const runId = crypto.randomUUID();
  const messageId = crypto.randomUUID();
  broadcast(threadId, { type: 'RUN_STARTED', runId, threadId });
  broadcast(threadId, { type: 'TEXT_MESSAGE_START', messageId, role: 'assistant' });
  const reply = \`You said: \${text}\`;
  for (const word of reply.split(' ')) {
    broadcast(threadId, { type: 'TEXT_MESSAGE_CONTENT', messageId, delta: word + ' ' });
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  broadcast(threadId, { type: 'TEXT_MESSAGE_END', messageId });
  broadcast(threadId, { type: 'RUN_FINISHED', runId });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, \`http://\${req.headers.host}\`);

  if (req.method === 'GET' && url.pathname.match(/^\\/threads\\/(.+)\\/events$/)) {
    const threadId = url.pathname.split('/')[2];
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    if (!clients.has(threadId)) clients.set(threadId, new Set());
    clients.get(threadId).add(res);
    req.on('close', () => clients.get(threadId)?.delete(res));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/runs') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', async () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
      const input = JSON.parse(body || '{}');
      const lastMessage = input.messages?.at(-1);
      const text = lastMessage?.parts?.find((p) => p.type === 'text')?.text ?? lastUserText;
      lastUserText = text;
      await streamReply(input.threadId, text);
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  console.log(\`chatkit SSE echo server listening on http://localhost:\${PORT}\`);
});
`;
