import { describe, expect, it, vi } from 'vitest';
import { documentArtifactReducer } from '../src/artifact-reducer';
import type { ChatEvent } from '@chatkit/core';

describe('documentArtifactReducer', () => {
  it('matches chatkit.document.snapshot and chatkit.document.delta CUSTOM events only', () => {
    expect(documentArtifactReducer.matches({ type: 'CUSTOM', name: 'chatkit.document.snapshot', payload: {} })).toBe(true);
    expect(documentArtifactReducer.matches({ type: 'CUSTOM', name: 'chatkit.document.delta', payload: {} })).toBe(true);
    expect(documentArtifactReducer.matches({ type: 'CUSTOM', name: 'chatkit.document.comment', payload: {} })).toBe(false);
    expect(documentArtifactReducer.matches({ type: 'CUSTOM', name: 'chatkit.form.snapshot', payload: {} })).toBe(false);
  });

  it('creates a final-status document artifact from a snapshot event', () => {
    const event: ChatEvent = {
      type: 'CUSTOM',
      name: 'chatkit.document.snapshot',
      payload: {
        artifactId: 'd1',
        createdByMessageId: 'm1',
        data: { title: 'Notes', format: 'markdown', content: '# Hello', editable: true },
      },
    };
    const artifacts = documentArtifactReducer.apply({}, event);
    expect(artifacts.d1).toMatchObject({ id: 'd1', kind: 'document', version: 1, status: 'final' });
    expect((artifacts.d1.data as { content: string }).content).toBe('# Hello');
  });

  it('appends content and sets status to streaming on a delta event', () => {
    const withSnapshot = documentArtifactReducer.apply({}, {
      type: 'CUSTOM',
      name: 'chatkit.document.snapshot',
      payload: { artifactId: 'd1', data: { title: 'Notes', format: 'markdown', content: 'Hello', editable: false } },
    });
    const withDelta = documentArtifactReducer.apply(withSnapshot, {
      type: 'CUSTOM',
      name: 'chatkit.document.delta',
      payload: { artifactId: 'd1', append: ', world' },
    });
    expect(withDelta.d1.status).toBe('streaming');
    expect((withDelta.d1.data as { content: string }).content).toBe('Hello, world');
    expect(withDelta.d1.version).toBe(2);
  });

  it('ignores a delta for an artifact id that does not exist', () => {
    const artifacts = documentArtifactReducer.apply({}, {
      type: 'CUSTOM',
      name: 'chatkit.document.delta',
      payload: { artifactId: 'missing', append: 'x' },
    });
    expect(artifacts).toEqual({});
  });

  it('drops a malformed snapshot payload with a warning instead of throwing', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const artifacts = documentArtifactReducer.apply({}, { type: 'CUSTOM', name: 'chatkit.document.snapshot', payload: null });
    expect(artifacts).toEqual({});
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
