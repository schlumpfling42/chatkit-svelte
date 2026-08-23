import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import TestHarness from './TestHarness.svelte';
import { createFixtureTransport } from '@chatkit-svelte/core';
import type { ArtifactRecord } from '@chatkit-svelte/core';

function makeArtifact(content: string, editable: boolean, status: ArtifactRecord['status'] = 'final'): ArtifactRecord {
  return {
    id: 'd1',
    kind: 'document',
    version: 1,
    createdByMessageId: 'm1',
    status,
    data: { title: 'Trip Notes', format: 'markdown', content, editable, exportFormats: ['md', 'docx'] },
  };
}

describe('DocumentCanvas', () => {
  it('renders the title and streamed content read-only while status is streaming', () => {
    const transport = createFixtureTransport([]);
    const artifact = makeArtifact('Drafting', true, 'streaming');
    render(TestHarness, { config: { transport, threadId: 't1' }, artifact });

    expect(screen.getByText('Trip Notes')).toBeInTheDocument();
    expect(screen.getByTestId('document-content')).toHaveTextContent('Drafting');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('renders a preview by default and can toggle to an editable textarea when editable and final', async () => {
    const transport = createFixtureTransport([]);
    const artifact = makeArtifact('# Hello', true, 'final');
    render(TestHarness, { config: { transport, threadId: 't1' }, artifact });

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

    await fireEvent.click(screen.getByText('Edit'));

    expect(screen.getByRole('textbox')).toHaveValue('# Hello');
  });

  it('does not offer an edit toggle when the document is not editable', () => {
    const transport = createFixtureTransport([]);
    const artifact = makeArtifact('# Hello', false, 'final');
    render(TestHarness, { config: { transport, threadId: 't1' }, artifact });

    expect(screen.queryByText('Edit')).not.toBeInTheDocument();
  });

  it('exports md directly via a downloadable blob without requiring a handler', async () => {
    const transport = createFixtureTransport([]);
    const artifact = makeArtifact('# Hello', false, 'final');
    const createObjectURL = vi.fn(() => 'blob:fake');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });

    render(TestHarness, { config: { transport, threadId: 't1' }, artifact });
    await fireEvent.click(screen.getByText('Export md'));

    expect(createObjectURL).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('exports docx via a registered exportHandlers callback', async () => {
    const transport = createFixtureTransport([]);
    const artifact = makeArtifact('# Hello', false, 'final');
    const docxHandler = vi.fn(async () => new Blob(['fake']));
    const createObjectURL = vi.fn(() => 'blob:fake');
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL: vi.fn() });

    render(TestHarness, { config: { transport, threadId: 't1' }, artifact, exportHandlers: { docx: docxHandler } });
    await fireEvent.click(screen.getByText('Export docx'));

    await waitFor(() => expect(docxHandler).toHaveBeenCalledOnce());
    vi.unstubAllGlobals();
  });
});
