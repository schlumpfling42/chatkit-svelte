import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import TestHarness from './TestHarness.svelte';
import ApprovalBarHarness from './ApprovalBarHarness.svelte';
import { createFixtureTransport } from '@chatkit-svelte/core';
import type { ChatEvent } from '@chatkit-svelte/core';

function toolCallEvents(): ChatEvent[] {
  return [
    { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' },
    { type: 'TOOL_CALL_START', toolCallId: 'tc1', toolName: 'delete_file', parentMessageId: 'm1' },
    { type: 'TOOL_CALL_ARGS', toolCallId: 'tc1', delta: '{"path":"/tmp/x"}' },
    { type: 'TOOL_CALL_END', toolCallId: 'tc1' },
  ];
}

describe('ApprovalBar (via ChatWindow)', () => {
  it('renders nothing when there are no pending approvals', async () => {
    const transport = createFixtureTransport([]);
    render(TestHarness, { config: { transport, threadId: 't1' } });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(screen.queryByTestId('approval')).not.toBeInTheDocument();
  });

  it('shows a pending approval with tool name and args', async () => {
    const transport = createFixtureTransport(toolCallEvents());
    render(TestHarness, {
      config: { transport, threadId: 't1', humanInTheLoop: { requireApprovalFor: ['delete_file'] } },
    });

    await waitFor(() => {
      expect(screen.getByTestId('approval')).toHaveTextContent('delete_file');
    });
    expect(screen.getByTestId('approval')).toHaveTextContent('/tmp/x');
  });

  it('clicking Approve resolves the approval and removes the bar', async () => {
    const transport = createFixtureTransport(toolCallEvents());
    render(TestHarness, {
      config: { transport, threadId: 't1', humanInTheLoop: { requireApprovalFor: ['delete_file'] } },
    });

    await waitFor(() => screen.getByTestId('approval'));
    await fireEvent.click(screen.getByText('Approve'));

    await waitFor(() => {
      expect(screen.queryByTestId('approval')).not.toBeInTheDocument();
    });
    expect(transport.recorder.toolResults).toHaveLength(1);
  });

  it('clicking Reject sends a rejected/error result', async () => {
    const transport = createFixtureTransport(toolCallEvents());
    render(TestHarness, {
      config: { transport, threadId: 't1', humanInTheLoop: { requireApprovalFor: ['delete_file'] } },
    });

    await waitFor(() => screen.getByTestId('approval'));
    await fireEvent.click(screen.getByText('Reject'));

    await waitFor(() => {
      expect(transport.recorder.toolResults[0]).toMatchObject({ toolCallId: 'tc1', isError: true });
    });
  });

  it('Edit then Retry sends the edited args', async () => {
    const transport = createFixtureTransport(toolCallEvents());
    render(TestHarness, {
      config: { transport, threadId: 't1', humanInTheLoop: { requireApprovalFor: ['delete_file'] } },
    });

    await waitFor(() => screen.getByTestId('approval'));
    await fireEvent.click(screen.getByText('Edit'));

    const textarea = screen.getByLabelText('Edit arguments') as HTMLTextAreaElement;
    await fireEvent.input(textarea, { target: { value: '{"path":"/tmp/y"}' } });
    await fireEvent.click(screen.getByText('Retry'));

    await waitFor(() => {
      expect(transport.recorder.toolResults[0]).toMatchObject({ toolCallId: 'tc1' });
    });
  });

  it('merges a passed class prop with the internal root class', async () => {
    const transport = createFixtureTransport(toolCallEvents());
    render(ApprovalBarHarness, {
      config: { transport, threadId: 't1', humanInTheLoop: { requireApprovalFor: ['delete_file'] } },
      class: 'custom-approval-bar',
    });

    await waitFor(() => screen.getByTestId('approval'));
    const root = document.querySelector('.ck-approval-bar')!;
    expect(root.className).toContain('ck-approval-bar');
    expect(root.className).toContain('custom-approval-bar');
  });

  it('moves focus to the composer input once the last pending approval resolves', async () => {
    const transport = createFixtureTransport(toolCallEvents());
    render(TestHarness, {
      config: { transport, threadId: 't1', humanInTheLoop: { requireApprovalFor: ['delete_file'] } },
    });

    await waitFor(() => screen.getByTestId('approval'));
    await fireEvent.click(screen.getByText('Approve'));

    await waitFor(() => {
      expect(document.activeElement?.id).toBe('ck-composer-input');
    });
  });
});
