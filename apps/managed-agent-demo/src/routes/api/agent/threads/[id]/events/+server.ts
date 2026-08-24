import type { RequestHandler } from './$types';
import { subscribeFromIndex } from '$lib/agent-sessions';

export const GET: RequestHandler = async ({ params, url }) => {
  const threadId = params.id;
  const resumeToken = url.searchParams.get('resumeToken');
  const fromIndex = resumeToken ? Number(resumeToken) + 1 : 0;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const { index, event } of subscribeFromIndex(threadId, fromIndex)) {
          const frame = `id: ${index}\ndata: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(encoder.encode(frame));
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
};
