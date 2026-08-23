import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import TestHarness from './TestHarness.svelte';
import { createFixtureTransport } from '@chatkit-svelte/core';
import type { ArtifactRecord } from '@chatkit-svelte/core';
import type { FormArtifactData } from '../src/types';

function makeArtifact(data: Partial<FormArtifactData>, status: ArtifactRecord['status'] = 'draft'): ArtifactRecord {
  return {
    id: 'f1',
    kind: 'form',
    version: 1,
    createdByMessageId: 'm1',
    status,
    data: {
      schema: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', title: 'Name' },
          plan: { type: 'string', enum: ['free', 'pro'], title: 'Plan' },
        },
      },
      mode: 'single-submit',
      ...data,
    },
  };
}

describe('FormRenderer', () => {
  it('renders a field per schema property with initial values pre-filled', () => {
    const transport = createFixtureTransport([]);
    const artifact = makeArtifact({ initialValues: { name: 'Ada' } });
    render(TestHarness, { config: { transport, threadId: 't1' }, artifact });

    expect(screen.getByLabelText('name')).toHaveValue('Ada');
  });

  it('shows a validation error and blocks submit when a required field is empty', async () => {
    const transport = createFixtureTransport([]);
    const artifact = makeArtifact({});
    render(TestHarness, { config: { transport, threadId: 't1' }, artifact });

    await fireEvent.click(screen.getByText('Submit'));

    expect(screen.getByTestId('form-error-name')).toHaveTextContent('This field is required.');
    expect(transport.recorder.runs).toHaveLength(0);
  });

  it('dispatches chatkit.form.result and sends it through the transport on a valid submit', async () => {
    const transport = createFixtureTransport([]);
    const artifact = makeArtifact({ initialValues: { name: 'Ada', plan: 'free' } });
    render(TestHarness, { config: { transport, threadId: 't1' }, artifact });

    await fireEvent.click(screen.getByText('Submit'));

    await waitFor(() => {
      expect(transport.recorder.runs).toHaveLength(1);
    });
    const sentMessage = transport.recorder.runs[0].messages.at(-1);
    expect(sentMessage?.parts[0]).toMatchObject({
      type: 'custom',
      name: 'chatkit.form.result',
      payload: { artifactId: 'f1', values: { name: 'Ada', plan: 'free' } },
    });
  });

  it('calls onBeforeSubmit and sends its returned values instead of the raw form values', async () => {
    const transport = createFixtureTransport([]);
    const artifact = makeArtifact({ initialValues: { name: 'Ada', plan: 'free' } });
    const onBeforeSubmit = vi.fn(async (values: Record<string, unknown>) => ({ ...values, enriched: true }));
    render(TestHarness, { config: { transport, threadId: 't1' }, artifact, onBeforeSubmit });

    await fireEvent.click(screen.getByText('Submit'));

    await waitFor(() => expect(transport.recorder.runs).toHaveLength(1));
    const sentMessage = transport.recorder.runs[0].messages.at(-1);
    expect(sentMessage?.parts[0]).toMatchObject({ payload: { values: { name: 'Ada', plan: 'free', enriched: true } } });
  });

  it('renders read-only submitted values instead of inputs once the artifact status is submitted', () => {
    const transport = createFixtureTransport([]);
    const artifact = makeArtifact({ values: { name: 'Ada', plan: 'pro' } }, 'submitted');
    render(TestHarness, { config: { transport, threadId: 't1' }, artifact });

    expect(screen.getByTestId('form-value-name')).toHaveTextContent('Ada');
    expect(screen.queryByText('Submit')).not.toBeInTheDocument();
  });
});
