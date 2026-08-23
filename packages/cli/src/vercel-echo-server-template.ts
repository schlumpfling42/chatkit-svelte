export const vercelEchoServerSource = `import { createServer } from 'node:http';

// Minimal Vercel AI SDK "data stream protocol" echo server for local
// development: POST the message history, get back a streamed reply in the
// same type-prefixed-line format @chatkit/transport-vercel-ai parses
// (see that package's README/plan for the format reference). Not a real
// agent backend — replace this once you have one.
const PORT = process.env.PORT ? Number(process.env.PORT) : 8787;

function textPart(text) {
  return \`0:\${JSON.stringify(text)}\\n\`;
}

function finishPart() {
  return \`d:\${JSON.stringify({ finishReason: 'stop' })}\\n\`;
}

const server = createServer(async (req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(404);
    res.end();
    return;
  }

  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', async () => {
    const input = JSON.parse(body || '{}');
    const lastMessage = input.messages?.at(-1);
    const text = lastMessage?.content ?? 'Hello! Ask me anything.';

    res.writeHead(200, { 'Content-Type': 'text/plain', 'Transfer-Encoding': 'chunked' });
    const reply = \`You said: \${text}\`;
    for (const word of reply.split(' ')) {
      res.write(textPart(word + ' '));
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    res.write(finishPart());
    res.end();
  });
});

server.listen(PORT, () => {
  console.log(\`chatkit Vercel AI SDK echo server listening on http://localhost:\${PORT}\`);
});
`;
