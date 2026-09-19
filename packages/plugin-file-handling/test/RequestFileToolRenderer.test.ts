import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import TestHarness from './TestHarness.svelte';
import { createFixtureTransport } from '@chatkit-svelte/core';
import type { ChatEvent } from '@chatkit-svelte/core';
import { fileHandlingPlugin } from '../src/file-handling-plugin';

function toolCallEvents(args: Record<string, unknown>): ChatEvent[] {
  return [
    { type: 'RUN_STARTED', runId: 'r1', threadId: 't1' },
    { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' },
    { type: 'TEXT_MESSAGE_END', messageId: 'm1' },
    { type: 'TOOL_CALL_START', toolCallId: 'tc1', toolName: 'request_file', parentMessageId: 'm1' },
    { type: 'TOOL_CALL_ARGS', toolCallId: 'tc1', delta: JSON.stringify(args) },
    { type: 'TOOL_CALL_END', toolCallId: 'tc1' },
  ];
}

describe('RequestFileToolRenderer', () => {
  it('shows the prompt and a file input while pending', async () => {
    const transport = createFixtureTransport(toolCallEvents({ prompt: 'Please upload your resume (PDF).' }));
    const upload = vi.fn(async () => ({ url: 'https://x/resume.pdf' }));
    render(TestHarness, { config: { transport, threadId: 't1', plugins: [fileHandlingPlugin({ upload })] }, toolCallId: 'tc1' });

    await waitFor(() => {
      expect(screen.getByText('Please upload your resume (PDF).')).toBeInTheDocument();
    });
    expect(screen.getByLabelText('Attach file')).toBeInTheDocument();
  });

  it('uploads the file via the matching attachmentHandler and sends the result back as the tool result', async () => {
    const transport = createFixtureTransport(toolCallEvents({ prompt: 'Please upload your resume (PDF).' }));
    const upload = vi.fn(async () => ({ url: 'https://x/resume.pdf' }));
    render(TestHarness, { config: { transport, threadId: 't1', plugins: [fileHandlingPlugin({ upload })] }, toolCallId: 'tc1' });

    const fileInput = await screen.findByLabelText('Attach file');
    const file = new File(['hello'], 'resume.pdf', { type: 'application/pdf' });
    await fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => expect(transport.recorder.toolResults).toHaveLength(1));
    expect(upload).toHaveBeenCalledWith(file, undefined);
    expect(transport.recorder.toolResults[0]).toEqual({
      toolCallId: 'tc1',
      result: { type: 'file', url: 'https://x/resume.pdf', name: 'resume.pdf', mimeType: 'application/pdf', sizeBytes: 5 },
      isError: false,
    });
  });

  it('shows the filename once submitted, instead of the file input', async () => {
    const transport = createFixtureTransport(toolCallEvents({}));
    const upload = vi.fn(async () => ({ url: 'https://x/resume.pdf' }));
    render(TestHarness, { config: { transport, threadId: 't1', plugins: [fileHandlingPlugin({ upload })] }, toolCallId: 'tc1' });

    const fileInput = await screen.findByLabelText('Attach file');
    const file = new File(['hello'], 'resume.pdf', { type: 'application/pdf' });
    await fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByTestId('request-file-name')).toHaveTextContent('resume.pdf');
    });
    expect(screen.queryByLabelText('Attach file')).not.toBeInTheDocument();
  });

  it('rejects a file that does not match this request\'s narrower accept list, without uploading it', async () => {
    const transport = createFixtureTransport(toolCallEvents({ accept: ['application/pdf'] }));
    const upload = vi.fn(async () => ({ url: 'https://x/y' }));
    render(TestHarness, { config: { transport, threadId: 't1', plugins: [fileHandlingPlugin({ upload })] }, toolCallId: 'tc1' });

    const fileInput = await screen.findByLabelText('Attach file');
    const file = new File(['hello'], 'photo.png', { type: 'image/png' });
    await fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByTestId('request-file-error')).toHaveTextContent('That file type isn’t accepted here.');
    });
    expect(upload).not.toHaveBeenCalled();
    expect(transport.recorder.toolResults).toHaveLength(0);
  });

  it('accepts a .json file by default and sends it back with its type', async () => {
    const transport = createFixtureTransport(toolCallEvents({}));
    const upload = vi.fn(async () => ({ url: 'data:application/json;base64,e30=' }));
    render(TestHarness, { config: { transport, threadId: 't1', plugins: [fileHandlingPlugin({ upload })] }, toolCallId: 'tc1' });

    const fileInput = await screen.findByLabelText('Attach file');
    await fireEvent.change(fileInput, { target: { files: [new File(['{}'], 'config.json', { type: 'application/json' })] } });

    await waitFor(() => expect(transport.recorder.toolResults).toHaveLength(1));
    expect(transport.recorder.toolResults[0].result).toMatchObject({ type: 'file', name: 'config.json', mimeType: 'application/json' });
  });

  it('goes by the extension when the OS reports no type, so a .md file is not refused', async () => {
    const transport = createFixtureTransport(toolCallEvents({}));
    const upload = vi.fn(async (file: File) => ({ url: `data:${file.type};base64,IyBoaQ==` }));
    render(TestHarness, { config: { transport, threadId: 't1', plugins: [fileHandlingPlugin({ upload })] }, toolCallId: 'tc1' });

    const fileInput = await screen.findByLabelText('Attach file');
    await fireEvent.change(fileInput, { target: { files: [new File(['# hi'], 'notes.md', { type: '' })] } });

    await waitFor(() => expect(transport.recorder.toolResults).toHaveLength(1));
    expect(transport.recorder.toolResults[0].result).toMatchObject({ name: 'notes.md', mimeType: 'text/markdown' });
    expect(screen.queryByTestId('request-file-error')).not.toBeInTheDocument();
  });

  it('says so when the upload itself fails, and leaves the request open to try again', async () => {
    const transport = createFixtureTransport(toolCallEvents({}));
    const upload = vi.fn(async () => {
      throw new Error('network down');
    });
    render(TestHarness, { config: { transport, threadId: 't1', plugins: [fileHandlingPlugin({ upload })] }, toolCallId: 'tc1' });

    const fileInput = await screen.findByLabelText('Attach file');
    await fireEvent.change(fileInput, { target: { files: [new File(['x'], 'a.txt', { type: 'text/plain' })] } });

    await waitFor(() => expect(screen.getByTestId('request-file-error')).toHaveTextContent('couldn’t be uploaded'));
    expect(transport.recorder.toolResults).toHaveLength(0);
    expect(screen.getByLabelText('Attach file')).toBeInTheDocument();
  });

  it('rejects a file with no matching attachmentHandler registered at all', async () => {
    const transport = createFixtureTransport(toolCallEvents({}));
    const upload = vi.fn(async () => ({ url: 'https://x/y' }));
    render(TestHarness, {
      config: { transport, threadId: 't1', plugins: [fileHandlingPlugin({ upload, accept: ['application/pdf'] })] },
      toolCallId: 'tc1',
    });

    const fileInput = await screen.findByLabelText('Attach file');
    const file = new File(['hello'], 'photo.png', { type: 'image/png' });
    await fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByTestId('request-file-error')).toHaveTextContent('That file type isn’t accepted here.');
    });
    expect(upload).not.toHaveBeenCalled();
  });
});
