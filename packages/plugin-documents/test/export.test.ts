import { describe, expect, it } from 'vitest';
import { exportDocument } from '../src/export';
import type { ArtifactRecord } from '@chatkit/core';

function makeArtifact(content: string): ArtifactRecord {
  return {
    id: 'd1',
    kind: 'document',
    version: 1,
    createdByMessageId: 'm1',
    status: 'final',
    data: { title: 'Notes', format: 'markdown', content, editable: false },
  };
}

describe('exportDocument', () => {
  it('returns the raw content directly for md and txt formats', async () => {
    const artifact = makeArtifact('# Hello');
    expect(await exportDocument(artifact, 'md')).toBe('# Hello');
    expect(await exportDocument(artifact, 'txt')).toBe('# Hello');
  });

  it('calls a registered handler for docx/pdf formats', async () => {
    const artifact = makeArtifact('# Hello');
    const handler = async () => new Blob(['fake docx bytes']);
    const result = await exportDocument(artifact, 'docx', { docx: handler });
    expect(result).toBeInstanceOf(Blob);
  });

  it('throws a clear error when no handler is registered for docx/pdf', async () => {
    const artifact = makeArtifact('# Hello');
    await expect(exportDocument(artifact, 'pdf')).rejects.toThrow(/register an export handler/i);
  });
});
