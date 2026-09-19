import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import ToolCallTestHarness from './ToolCallTestHarness.svelte';
import { createFixtureTransport } from '@chatkit-svelte/core';
import type { ChatEvent } from '@chatkit-svelte/core';
import { documentsPlugin } from '../src/index';

function toolCallEvents(args: Record<string, unknown>): ChatEvent[] {
  return [
    { type: 'RUN_STARTED', runId: 'r1', threadId: 't1' },
    { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' },
    { type: 'TEXT_MESSAGE_END', messageId: 'm1' },
    { type: 'TOOL_CALL_START', toolCallId: 'tc1', toolName: 'create_document', parentMessageId: 'm1' },
    { type: 'TOOL_CALL_ARGS', toolCallId: 'tc1', delta: JSON.stringify(args) },
    { type: 'TOOL_CALL_END', toolCallId: 'tc1' },
  ];
}

describe('CreateDocumentToolRenderer', () => {
  it('renders the document (title + content preview) with a real download button, no sandbox path involved', async () => {
    const transport = createFixtureTransport(toolCallEvents({ title: 'Trip Notes', content: '# Hello\n\nBody text.' }));
    render(ToolCallTestHarness, { config: { transport, threadId: 't1', plugins: [documentsPlugin()] }, toolCallId: 'tc1' });

    await waitFor(() => {
      expect(screen.getByText('Trip Notes')).toBeInTheDocument();
    });
    expect(screen.getByTestId('document-content')).toHaveTextContent('Body text.');
    expect(screen.getByText('Export md')).toBeInTheDocument();
    expect(screen.getByText('Export txt')).toBeInTheDocument();
  });

  it('sends a confirmation tool result automatically, with no user action needed', async () => {
    const transport = createFixtureTransport(toolCallEvents({ title: 'Trip Notes', content: 'Body.' }));
    render(ToolCallTestHarness, { config: { transport, threadId: 't1', plugins: [documentsPlugin()] }, toolCallId: 'tc1' });

    await waitFor(() => {
      expect(transport.recorder.toolResults).toHaveLength(1);
    });
    expect(transport.recorder.toolResults[0]).toEqual({ toolCallId: 'tc1', result: { created: true }, isError: false });
  });

  it('keeps showing the original content after auto-resolving, instead of being overwritten by the confirmation result', async () => {
    const transport = createFixtureTransport(toolCallEvents({ title: 'Trip Notes', content: 'Original body.' }));
    render(ToolCallTestHarness, { config: { transport, threadId: 't1', plugins: [documentsPlugin()] }, toolCallId: 'tc1' });

    await waitFor(() => expect(transport.recorder.toolResults).toHaveLength(1));
    expect(screen.getByTestId('document-content')).toHaveTextContent('Original body.');
  });

  it('lets the user edit and save through the real document edit flow', async () => {
    const transport = createFixtureTransport(toolCallEvents({ title: 'Trip Notes', content: 'Original body.' }));
    render(ToolCallTestHarness, { config: { transport, threadId: 't1', plugins: [documentsPlugin()] }, toolCallId: 'tc1' });

    await waitFor(() => expect(screen.getByText('Trip Notes')).toBeInTheDocument());
    await fireEvent.click(screen.getByText('Edit'));
    const textarea = screen.getByRole('textbox');
    await fireEvent.input(textarea, { target: { value: 'Revised body.' } });
    await fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(screen.getByTestId('document-content')).toHaveTextContent('Revised body.');
    });
  });

  it('never registers the document in the global artifact registry, even after an edit — ArtifactPanel renders every entry there unconditionally, and this is already shown inline via toolRenderers, so seeding it too produced a real duplicate', async () => {
    const transport = createFixtureTransport(toolCallEvents({ title: 'Trip Notes', content: 'Original body.' }));
    render(ToolCallTestHarness, { config: { transport, threadId: 't1', plugins: [documentsPlugin()] }, toolCallId: 'tc1' });

    await waitFor(() => expect(screen.getByText('Trip Notes')).toBeInTheDocument());
    expect(screen.getByTestId('global-artifact-count')).toHaveTextContent('0');

    await fireEvent.click(screen.getByText('Edit'));
    await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'Revised body.' } });
    await fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(screen.getByTestId('document-content')).toHaveTextContent('Revised body.'));
    expect(screen.getByTestId('global-artifact-count')).toHaveTextContent('0');
  });

  it('does not render anything while the tool call args are still streaming in', () => {
    const transport = createFixtureTransport([
      { type: 'RUN_STARTED', runId: 'r1', threadId: 't1' },
      { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' },
      { type: 'TEXT_MESSAGE_END', messageId: 'm1' },
      { type: 'TOOL_CALL_START', toolCallId: 'tc1', toolName: 'create_document', parentMessageId: 'm1' },
    ]);
    render(ToolCallTestHarness, { config: { transport, threadId: 't1', plugins: [documentsPlugin()] }, toolCallId: 'tc1' });

    expect(screen.queryByTestId('document-content')).not.toBeInTheDocument();
    expect(transport.recorder.toolResults).toHaveLength(0);
  });
});
