import { describe, expect, it, vi } from 'vitest';
import { formArtifactReducer } from '../src/artifact-reducer';
import type { ChatEvent } from '@chatkit-svelte/core';

describe('formArtifactReducer', () => {
  it('matches chatkit.form.snapshot and chatkit.form.result CUSTOM events only', () => {
    expect(formArtifactReducer.matches({ type: 'CUSTOM', name: 'chatkit.form.snapshot', payload: {} })).toBe(true);
    expect(formArtifactReducer.matches({ type: 'CUSTOM', name: 'chatkit.form.result', payload: {} })).toBe(true);
    expect(formArtifactReducer.matches({ type: 'CUSTOM', name: 'chatkit.document.snapshot', payload: {} })).toBe(false);
    expect(formArtifactReducer.matches({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' })).toBe(false);
  });

  it('creates a draft form artifact from a chatkit.form.snapshot event', () => {
    const event: ChatEvent = {
      type: 'CUSTOM',
      name: 'chatkit.form.snapshot',
      payload: {
        artifactId: 'f1',
        createdByMessageId: 'm1',
        data: { schema: { type: 'object', properties: {} }, mode: 'single-submit' },
      },
    };
    const artifacts = formArtifactReducer.apply({}, event);
    expect(artifacts.f1).toMatchObject({ id: 'f1', kind: 'form', version: 1, status: 'draft', createdByMessageId: 'm1' });
  });

  it('increments version on a second snapshot for the same artifactId', () => {
    const first = formArtifactReducer.apply({}, {
      type: 'CUSTOM',
      name: 'chatkit.form.snapshot',
      payload: { artifactId: 'f1', data: { schema: {}, mode: 'single-submit' } },
    });
    const second = formArtifactReducer.apply(first, {
      type: 'CUSTOM',
      name: 'chatkit.form.snapshot',
      payload: { artifactId: 'f1', data: { schema: {}, mode: 'single-submit' } },
    });
    expect(second.f1.version).toBe(2);
  });

  it('drops a malformed snapshot payload with a warning instead of throwing', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const artifacts = formArtifactReducer.apply({}, { type: 'CUSTOM', name: 'chatkit.form.snapshot', payload: 'not an object' });
    expect(artifacts).toEqual({});
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('flips status to submitted and stores values on a chatkit.form.result event', () => {
    const withForm = formArtifactReducer.apply({}, {
      type: 'CUSTOM',
      name: 'chatkit.form.snapshot',
      payload: { artifactId: 'f1', data: { schema: {}, mode: 'single-submit' } },
    });
    const withResult = formArtifactReducer.apply(withForm, {
      type: 'CUSTOM',
      name: 'chatkit.form.result',
      payload: { artifactId: 'f1', values: { name: 'Ada' } },
    });
    expect(withResult.f1).toMatchObject({ status: 'submitted', version: 2 });
    expect((withResult.f1.data as { values?: Record<string, unknown> }).values).toEqual({ name: 'Ada' });
  });

  it('ignores a chatkit.form.result for an artifact id that does not exist', () => {
    const artifacts = formArtifactReducer.apply({}, {
      type: 'CUSTOM',
      name: 'chatkit.form.result',
      payload: { artifactId: 'missing', values: {} },
    });
    expect(artifacts).toEqual({});
  });
});
