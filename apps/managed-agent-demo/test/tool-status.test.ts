import { describe, expect, it } from 'vitest';
import type { ToolCallStatus } from '@chatkit-svelte/core';
import { OUTPUT_TOOLS, callLabel, isFinished, progressOf } from '../src/lib/tool-status';

describe('isFinished', () => {
  it('a call that is still being prepared or run is not finished', () => {
    const running: ToolCallStatus[] = ['streaming_args', 'pending_execution', 'awaiting_approval', 'executing'];
    for (const status of running) expect(isFinished(status)).toBe(false);
  });

  it('a call that completed or was rejected is finished', () => {
    expect(isFinished('complete')).toBe(true);
    expect(isFinished('rejected')).toBe(true);
  });

  it('a call that failed stays visible, so a failure is never silent', () => {
    expect(isFinished('error')).toBe(false);
  });
});

describe('callLabel', () => {
  it('names the tool and its main argument', () => {
    expect(callLabel('read_file', { path: 'chatkit-gateway/README.md' })).toBe('read_file chatkit-gateway/README.md');
    expect(callLabel('search_files', { pattern: '*.yaml, *.yml' })).toBe('search_files *.yaml, *.yml');
    expect(callLabel('evaluate', { instruction: 'Which scenes?', mode: 'extract' })).toBe('evaluate Which scenes?');
  });

  it('is just the tool name when there is nothing to say about the call', () => {
    expect(callLabel('read_file', {})).toBe('read_file');
    expect(callLabel('read_file', undefined)).toBe('read_file');
    expect(callLabel('read_file', { path: '   ' })).toBe('read_file');
  });
});

describe('OUTPUT_TOOLS', () => {
  it('keeps the tools that fetch content and not the ones that only answer a question', () => {
    for (const name of ['read_file', 'search_files', 'search_text', 'evaluate', 'file_overview', 'compare_files', 'write_file', 'edit_file']) expect(OUTPUT_TOOLS.has(name)).toBe(true);
    expect(OUTPUT_TOOLS.has('system_status')).toBe(false);
    expect(OUTPUT_TOOLS.has('recall')).toBe(false);
  });
});

describe('progressOf', () => {
  const activities = [
    { messageId: 'call-1', data: { done: 3, total: 12, label: 'src/Main.java', elapsedSeconds: 9, tool: 'evaluate' } },
    { messageId: 'call-2', data: { done: 0, total: 0 } },
    { messageId: 'call-3', data: 'not an object' },
  ];

  it('reads the progress reported for a tool call', () => {
    expect(progressOf(activities, 'call-1')).toEqual({ done: 3, total: 12, label: 'src/Main.java', elapsedSeconds: 9 });
  });

  it('is null for a call with no report, an empty total, or data it does not understand', () => {
    expect(progressOf(activities, 'nope')).toBeNull();
    expect(progressOf(activities, 'call-2')).toBeNull();
    expect(progressOf(activities, 'call-3')).toBeNull();
    expect(progressOf([], 'call-1')).toBeNull();
  });
});
