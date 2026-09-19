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

  it('a file with no matching handler is silently ignored', async () => {
    const transport = createFixtureTransport([]);
    const process = vi.fn();
    const plugin: ChatPlugin = {
      name: 'attach-test',
      version: '1.0.0',
      attachmentHandlers: [{ accept: ['image/*'], process }],
    };
    render(ComposerHarness, { config: { transport, threadId: 't1', plugins: [plugin] } });

    const fileInput = screen.getByLabelText('Attach file', { selector: 'input' }) as HTMLInputElement;
    const file = new File(['hello'], 'y.txt', { type: 'text/plain' });
    await fireEvent.change(fileInput, { target: { files: [file] } });

    expect(process).not.toHaveBeenCalled();
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
