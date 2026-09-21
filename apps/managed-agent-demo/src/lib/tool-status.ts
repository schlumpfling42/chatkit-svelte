import type { ToolCallStatus } from '@chatkit-svelte/core';

/**
 * Whether a tool call is over and needs no place in the conversation any more. A call that failed is not counted as
 * over: it stays on screen so a failure is never silent.
 */
export function isFinished(status: ToolCallStatus): boolean {
  return status === 'complete' || status === 'rejected';
}

/**
 * Tools whose result is the point of the request ("show me that file", "find every yaml file"): the result is put on
 * screen as it arrives, so the model does not have to copy it into its answer, which at a local model's speed takes
 * minutes for a file.
 */
export const OUTPUT_TOOLS: ReadonlySet<string> = new Set(['read_file', 'search_files', 'search_text', 'evaluate', 'file_overview', 'compare_files', 'write_file', 'edit_file']);

/** What a call was about, for the card's title: the tool and its main argument, e.g. `read_file chatkit-gateway/README.md`. */
export function callLabel(toolName: string, args: unknown): string {
  if (args && typeof args === 'object') {
    for (const key of ['path', 'first', 'pattern', 'query', 'text', 'instruction']) {
      const value = (args as Record<string, unknown>)[key];
      if (typeof value === 'string' && value.trim() !== '') return `${toolName} ${value.trim()}`;
    }
  }
  return toolName;
}

/** How far a long job has got, as the gateway reports it on the tool call's activity. */
export interface JobProgress {
  done: number;
  total: number;
  label: string;
  elapsedSeconds: number;
}

/** The progress reported for one tool call, or null when there is none (an ordinary tool, or a job that has not started counting). */
export function progressOf(activities: ReadonlyArray<{ messageId: string; data: unknown }>, toolCallId: string): JobProgress | null {
  const activity = activities.find((a) => a.messageId === toolCallId);
  const data = activity?.data as Partial<JobProgress> | undefined;
  if (!data || typeof data.done !== 'number' || typeof data.total !== 'number' || data.total <= 0) return null;
  return { done: data.done, total: data.total, label: typeof data.label === 'string' ? data.label : '', elapsedSeconds: typeof data.elapsedSeconds === 'number' ? data.elapsedSeconds : 0 };
}
