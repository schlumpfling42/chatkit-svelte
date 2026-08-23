import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import ToolCallCard from '../src/ToolCallCard.svelte';
import type { ContentPart } from '@chatkit-svelte/core';

function toolCall(overrides: Partial<ContentPart & { type: 'tool_call' }> = {}): ContentPart & { type: 'tool_call' } {
  return {
    type: 'tool_call',
    toolCallId: 'tc1',
    toolName: 'search',
    args: { query: 'svelte' },
    status: 'pending_execution',
    ...overrides,
  };
}

describe('ToolCallCard', () => {
  it('shows the tool name and status', () => {
    render(ToolCallCard, { toolCall: toolCall() });
    expect(screen.getByText('search')).toBeInTheDocument();
    expect(screen.getByText('pending_execution')).toBeInTheDocument();
  });

  it('shows formatted args', () => {
    render(ToolCallCard, { toolCall: toolCall() });
    expect(screen.getByText(/"query": "svelte"/)).toBeInTheDocument();
  });

  it('shows the result once present', () => {
    render(ToolCallCard, { toolCall: toolCall({ status: 'complete', result: { hits: 3 } }) });
    expect(screen.getByText(/"hits": 3/)).toBeInTheDocument();
  });

  it('does not render a result block when there is no result yet', () => {
    render(ToolCallCard, { toolCall: toolCall() });
    expect(screen.queryByTestId('tool-call-result')).not.toBeInTheDocument();
  });
});
