import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import ComposerHarness from './ComposerHarness.svelte';
import { createFixtureTransport } from '@chatkit-svelte/core';
import type { ChatPlugin } from '@chatkit-svelte/core';

describe('Composer — attachments', () => {
  it('does not show an attach button when no attachmentHandlers are registered', () => {
    const transport = createFixtureTransport([]);
    render(ComposerHarness, { config: { transport, threadId: 't1' } });

    expect(screen.queryByLabelText('Attach')).not.toBeInTheDocument();
  });

  it('shows an attach button when a plugin registers an attachmentHandler', () => {
    const transport = createFixtureTransport([]);
    const plugin: ChatPlugin = {
      name: 'attach-test',
      version: '1.0.0',
      attachmentHandlers: [{ accept: ['text/plain'], process: vi.fn() }],
    };
    render(ComposerHarness, { config: { transport, threadId: 't1', plugins: [plugin] } });

    expect(screen.getByLabelText('Attach')).toBeInTheDocument();
  });

  it('picking a matching file calls the handler and includes the resulting part in the next sendMessage', async () => {
    const transport = createFixtureTransport([]);
    const process = vi.fn(async () => ({ type: 'file' as const, url: 'https://x/y', name: 'y.txt', mimeType: 'text/plain' }));
    const plugin: ChatPlugin = {
      name: 'attach-test',
      version: '1.0.0',
      attachmentHandlers: [{ accept: ['text/plain'], process }],
    };
    render(ComposerHarness, { config: { transport, threadId: 't1', plugins: [plugin] } });

    const fileInput = screen.getByLabelText('Attach file', { selector: 'input' }) as HTMLInputElement;
    const file = new File(['hello'], 'y.txt', { type: 'text/plain' });
    await fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(process).toHaveBeenCalledWith(file, {});
    });

    await fireEvent.submit(fileInput.closest('form')!);

    await waitFor(() => {
      expect(transport.recorder.runs).toHaveLength(1);
    });
    expect(transport.recorder.runs[0].messages[0].parts).toEqual([
      { type: 'file', url: 'https://x/y', name: 'y.txt', mimeType: 'text/plain' },
    ]);
  });

  function setup(handler: { accept: string[]; maxSizeBytes?: number; process: ReturnType<typeof vi.fn> }) {
    const transport = createFixtureTransport([]);
    const plugin: ChatPlugin = { name: 'attach-test', version: '1.0.0', attachmentHandlers: [handler as never] };
    render(ComposerHarness, { config: { transport, threadId: 't1', plugins: [plugin] } });
    return screen.getByLabelText('Attach file', { selector: 'input' }) as HTMLInputElement;
  }

  const partFor = (name: string, mimeType: string) => vi.fn(async () => ({ type: 'file' as const, url: 'data:x', name, mimeType }));

  it('a file no handler accepts is refused with a visible explanation, never silently', async () => {
    const process = vi.fn();
    const fileInput = setup({ accept: ['image/*', 'application/pdf'], process });

    await fireEvent.change(fileInput, { target: { files: [new File(['x'], 'report.docx', { type: 'application/msword' })] } });

    expect(process).not.toHaveBeenCalled();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('report.docx');
    expect(alert).toHaveTextContent('image/*, application/pdf');
  });

  it('a file over the size limit is refused with a visible explanation', async () => {
    const process = vi.fn();
    const fileInput = setup({ accept: ['text/*'], maxSizeBytes: 10, process });

    await fireEvent.change(fileInput, { target: { files: [new File(['this is longer than ten bytes'], 'big.txt', { type: 'text/plain' })] } });

    expect(process).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent('“big.txt” is too large (the limit is 10 bytes)');
  });

  it('a handler that throws (say, the upload failed) is reported, not swallowed', async () => {
    const process = vi.fn(async () => {
      throw new Error('network down');
    });
    const fileInput = setup({ accept: ['text/*'], process });

    await fireEvent.change(fileInput, { target: { files: [new File(['x'], 'a.txt', { type: 'text/plain' })] } });

    expect(await screen.findByRole('alert')).toHaveTextContent('“a.txt” couldn’t be attached');
    expect(screen.queryByText('a.txt')).not.toBeInTheDocument();
  });

  it('the explanation goes away once a later file attaches fine', async () => {
    const process = partFor('ok.txt', 'text/plain');
    const fileInput = setup({ accept: ['text/*'], process });

    await fireEvent.change(fileInput, { target: { files: [new File(['x'], 'nope.docx', { type: 'application/msword' })] } });
    await screen.findByRole('alert');
    await fireEvent.change(fileInput, { target: { files: [new File(['x'], 'ok.txt', { type: 'text/plain' })] } });

    await waitFor(() => expect(screen.getByText('ok.txt')).toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('a .json file is accepted where the handler lists application/json (the type that used to be dropped)', async () => {
    const process = partFor('config.json', 'application/json');
    const fileInput = setup({ accept: ['text/*', 'application/json'], process });

    await fireEvent.change(fileInput, { target: { files: [new File(['{"a":1}'], 'config.json', { type: 'application/json' })] } });

    await waitFor(() => expect(screen.getByText('config.json')).toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('goes by the extension when the OS reports no type (.md on Windows) and hands the handler a file with the inferred type', async () => {
    const process = partFor('notes.md', 'text/markdown');
    const fileInput = setup({ accept: ['text/*'], process });

    await fireEvent.change(fileInput, { target: { files: [new File(['# hi'], 'notes.md', { type: '' })] } });

    await waitFor(() => expect(process).toHaveBeenCalledTimes(1));
    const handed = (process.mock.calls[0] as unknown as [File])[0];
    expect(handed.name).toBe('notes.md');
    expect(handed.type).toBe('text/markdown');
    expect(await screen.findByText('notes.md')).toBeInTheDocument();
  });

  it('treats a .csv that Excel claimed (application/vnd.ms-excel) as CSV', async () => {
    const process = partFor('data.csv', 'text/csv');
    const fileInput = setup({ accept: ['text/*'], process });

    await fireEvent.change(fileInput, { target: { files: [new File(['a,b'], 'data.csv', { type: 'application/vnd.ms-excel' })] } });

    await waitFor(() => expect(process).toHaveBeenCalledTimes(1));
    expect(((process.mock.calls[0] as unknown as [File])[0]).type).toBe('text/csv');
  });

  it('a handler accepting */* takes any file', async () => {
    const process = partFor('archive.zip', 'application/zip');
    const fileInput = setup({ accept: ['*/*'], process });

    await fireEvent.change(fileInput, { target: { files: [new File(['x'], 'archive.zip', { type: 'application/zip' })] } });

    await waitFor(() => expect(screen.getByText('archive.zip')).toBeInTheDocument());
  });

  it('shows a pending-attachment chip with the filename as soon as a file is picked, before sending', async () => {
    const transport = createFixtureTransport([]);
    const process = vi.fn(async () => ({ type: 'file' as const, url: 'https://x/y', name: 'report.pdf', mimeType: 'application/pdf' }));
    const plugin: ChatPlugin = {
      name: 'attach-test',
      version: '1.0.0',
      attachmentHandlers: [{ accept: ['application/pdf'], process }],
    };
    render(ComposerHarness, { config: { transport, threadId: 't1', plugins: [plugin] } });

    const fileInput = screen.getByLabelText('Attach file', { selector: 'input' }) as HTMLInputElement;
    const file = new File(['hello'], 'report.pdf', { type: 'application/pdf' });
    await fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText('report.pdf')).toBeInTheDocument();
    });
    // Nothing sent yet — the chip appearing must not itself trigger a send.
    expect(transport.recorder.runs).toHaveLength(0);
  });

  it('shows a generic "Image" label (not a crash) for an image attachment, which has no name field', async () => {
    const transport = createFixtureTransport([]);
    const process = vi.fn(async () => ({ type: 'image' as const, url: 'data:image/png;base64,abc', mimeType: 'image/png' }));
    const plugin: ChatPlugin = {
      name: 'attach-test',
      version: '1.0.0',
      attachmentHandlers: [{ accept: ['image/*'], process }],
    };
    render(ComposerHarness, { config: { transport, threadId: 't1', plugins: [plugin] } });

    const fileInput = screen.getByLabelText('Attach file', { selector: 'input' }) as HTMLInputElement;
    const file = new File(['hello'], 'photo.png', { type: 'image/png' });
    await fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText('Image')).toBeInTheDocument();
    });
  });

  it('removing a pending attachment before sending excludes it from the next sendMessage', async () => {
    const transport = createFixtureTransport([]);
    const process = vi.fn(async () => ({ type: 'file' as const, url: 'https://x/y', name: 'report.pdf', mimeType: 'application/pdf' }));
    const plugin: ChatPlugin = {
      name: 'attach-test',
      version: '1.0.0',
      attachmentHandlers: [{ accept: ['application/pdf'], process }],
    };
    render(ComposerHarness, { config: { transport, threadId: 't1', plugins: [plugin] } });

    const fileInput = screen.getByLabelText('Attach file', { selector: 'input' }) as HTMLInputElement;
    const file = new File(['hello'], 'report.pdf', { type: 'application/pdf' });
    await fireEvent.change(fileInput, { target: { files: [file] } });
    await waitFor(() => {
      expect(screen.getByText('report.pdf')).toBeInTheDocument();
    });

    await fireEvent.click(screen.getByLabelText('Remove attachment'));
    expect(screen.queryByText('report.pdf')).not.toBeInTheDocument();

    const input = screen.getByLabelText('Message') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'hi' } });
    await fireEvent.submit(fileInput.closest('form')!);

    await waitFor(() => {
      expect(transport.recorder.runs).toHaveLength(1);
    });
    expect(transport.recorder.runs[0].messages[0].parts).toEqual([{ type: 'text', text: 'hi' }]);
  });

  it('clears the pending-attachment chip after a successful send', async () => {
    const transport = createFixtureTransport([]);
    const process = vi.fn(async () => ({ type: 'file' as const, url: 'https://x/y', name: 'report.pdf', mimeType: 'application/pdf' }));
    const plugin: ChatPlugin = {
      name: 'attach-test',
      version: '1.0.0',
      attachmentHandlers: [{ accept: ['application/pdf'], process }],
    };
    render(ComposerHarness, { config: { transport, threadId: 't1', plugins: [plugin] } });

    const fileInput = screen.getByLabelText('Attach file', { selector: 'input' }) as HTMLInputElement;
    const file = new File(['hello'], 'report.pdf', { type: 'application/pdf' });
    await fireEvent.change(fileInput, { target: { files: [file] } });
    await waitFor(() => {
      expect(screen.getByText('report.pdf')).toBeInTheDocument();
    });

    await fireEvent.submit(fileInput.closest('form')!);

    await waitFor(() => {
      expect(transport.recorder.runs).toHaveLength(1);
    });
    expect(screen.queryByText('report.pdf')).not.toBeInTheDocument();
  });
});

describe('Composer — run-in-progress guard', () => {
  it('disables Send while a run is in progress, and does not call sendMessage if submitted anyway', async () => {
    // The fixture transport's connect() stream fires at mount (chat-store's
    // own bootstrap), independent of sendRun — so a RUN_STARTED with no
    // matching RUN_FINISHED puts runStatus into 'running' and leaves it
    // there, exactly the window a second send must be blocked in.
    const transport = createFixtureTransport([{ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' }]);
    render(ComposerHarness, { config: { transport, threadId: 't1' } });

    const sendButton = await screen.findByText('Send');
    await waitFor(() => {
      expect(sendButton).toBeDisabled();
    });

    const input = screen.getByLabelText('Message') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'should not send' } });
    await fireEvent.submit(input.closest('form')!);

    // Give any (incorrect) async sendMessage call a chance to land before asserting it didn't.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(transport.recorder.runs).toHaveLength(0);
  });

  it('re-enables Send once the run finishes', async () => {
    const transport = createFixtureTransport([
      { type: 'RUN_STARTED', runId: 'r1', threadId: 't1' },
      { type: 'RUN_FINISHED', runId: 'r1' },
    ]);
    render(ComposerHarness, { config: { transport, threadId: 't1' } });

    const sendButton = await screen.findByText('Send');
    await waitFor(() => {
      expect(sendButton).not.toBeDisabled();
    });
  });
});

describe('Composer — class prop, i18n, focus', () => {
  it('merges a passed class prop with the internal root class', () => {
    const transport = createFixtureTransport([]);
    render(ComposerHarness, { config: { transport, threadId: 't1' }, class: 'custom-composer' });

    const form = document.querySelector('form.ck-composer')!;
    expect(form.className).toContain('ck-composer');
    expect(form.className).toContain('custom-composer');
  });

  it('renders an i18n override for the send button label', () => {
    const transport = createFixtureTransport([]);
    render(ComposerHarness, {
      config: { transport, threadId: 't1', i18n: { locale: 'fr', messages: { 'composer.send': 'Envoyer' } } },
    });

    expect(screen.getByText('Envoyer')).toBeInTheDocument();
  });

  it('keeps focus on the input after a successful send', async () => {
    const transport = createFixtureTransport([]);
    render(ComposerHarness, { config: { transport, threadId: 't1' } });

    const input = screen.getByLabelText('Message') as HTMLInputElement;
    input.focus();
    await fireEvent.input(input, { target: { value: 'hi there' } });
    await fireEvent.submit(input.closest('form')!);

    await waitFor(() => {
      expect(transport.recorder.runs).toHaveLength(1);
    });
    expect(document.activeElement).toBe(input);
  });
});
