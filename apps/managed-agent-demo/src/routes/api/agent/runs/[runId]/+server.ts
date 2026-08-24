import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { abortRun, findSessionByRunId } from '$lib/agent-sessions';

export const DELETE: RequestHandler = async ({ params }) => {
  const found = findSessionByRunId(params.runId);
  if (!found) {
    throw error(404, 'Unknown run');
  }
  abortRun(found.threadId);
  return json({ ok: true });
};
