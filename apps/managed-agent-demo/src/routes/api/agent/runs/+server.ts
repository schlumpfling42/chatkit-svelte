import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { RunAgentInput } from '@chatkit-svelte/core';
import { startRun } from '$lib/agent-sessions';

export const POST: RequestHandler = async ({ request }) => {
  const input = (await request.json()) as RunAgentInput;
  startRun(input.threadId, input);
  return json({ ok: true }, { status: 202 });
};
