import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// This demo has no frontend-executing tools — Managed Agents runs tools
// server-side in Anthropic's own sandbox, so transport-agui's
// sendFrontendToolResult() is never actually invoked here. This route exists
// only to satisfy the transport's existing contract.
export const POST: RequestHandler = async () => {
  return json({ ok: true }, { status: 200 });
};
