import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { ToolResult } from '@chatkit-svelte/core';
import { findSessionByToolCallId, sendToolResult } from '$lib/agent-sessions';

// transport-agui's sendFrontendToolResult() POSTs here whenever a client
// tool call (e.g. show_form -- see +page.svelte's ChatConfig.tools) is
// resolved: store.editAndRetry(toolCallId, filledInFormValues) triggers
// this. The POST body carries only {toolCallId, result, isError} -- no
// threadId -- so the owning thread is recovered from the tool call's own
// TOOL_CALL_START event (see findSessionByToolCallId).
export const POST: RequestHandler = async ({ request }) => {
  const toolResult = (await request.json()) as ToolResult;
  const found = findSessionByToolCallId(toolResult.toolCallId);
  if (!found) {
    throw error(404, `No thread found for tool call "${toolResult.toolCallId}"`);
  }
  sendToolResult(found.threadId, toolResult.toolCallId, toolResult.result);
  return json({ ok: true }, { status: 202 });
};
