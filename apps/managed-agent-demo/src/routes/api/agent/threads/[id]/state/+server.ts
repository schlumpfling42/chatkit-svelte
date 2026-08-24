import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getCurrentState } from '$lib/agent-sessions';

export const GET: RequestHandler = async ({ params }) => {
  return json(getCurrentState(params.id));
};
