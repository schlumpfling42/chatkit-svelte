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
