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

describe('FormRenderer — html mode (self-contained document, no schema)', () => {
  function makeHtmlArtifact(html: string, extra: Partial<FormArtifactData> = {}, status: ArtifactRecord['status'] = 'draft'): ArtifactRecord {
    return makeArtifact({ schema: undefined, html, ...extra }, status);
  }

  it('renders the document\'s body content directly as real DOM, and no schema-driven fields', () => {
    const transport = createFixtureTransport([]);
    const artifact = makeHtmlArtifact('<!doctype html><body><label>Feedback<input name="feedback" /></label></body>');
    render(TestHarness, { config: { transport, threadId: 't1' }, artifact });

    expect(screen.queryByTestId('form-html-frame')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Feedback')).toBeInTheDocument();
  });

  it('harvests a text input\'s value on submit and sends chatkit.form.result in the same shape a schema-driven submit uses', async () => {
    const transport = createFixtureTransport([]);
    const artifact = makeHtmlArtifact('<label>Feedback<input name="feedback" /></label>');
    render(TestHarness, { config: { transport, threadId: 't1' }, artifact });

    await fireEvent.input(screen.getByLabelText('Feedback'), { target: { value: 'loved it' } });
    await fireEvent.click(screen.getByTestId('form-html-submit'));

    await waitFor(() => expect(transport.recorder.runs).toHaveLength(1));
    const sentMessage = transport.recorder.runs[0].messages.at(-1);
    expect(sentMessage?.parts[0]).toMatchObject({
      type: 'custom',
      name: 'chatkit.form.result',
      payload: { artifactId: 'f1', values: { feedback: 'loved it' } },
    });
  });

  it('treats a lone checkbox as a boolean, same-name checkboxes as a multi-select array, and only the checked radio in a group', async () => {
    const transport = createFixtureTransport([]);
    const artifact = makeHtmlArtifact(`
      <label>Subscribe <input type="checkbox" name="subscribe" checked /></label>
      <label>Io <input type="checkbox" name="moons" value="Io" checked /></label>
      <label>Titan <input type="checkbox" name="moons" value="Titan" /></label>
      <label>Rhea <input type="checkbox" name="moons" value="Rhea" checked /></label>
      <label>Small <input type="radio" name="size" value="small" /></label>
      <label>Large <input type="radio" name="size" value="large" checked /></label>
    `);
    render(TestHarness, { config: { transport, threadId: 't1' }, artifact });

    await fireEvent.click(screen.getByTestId('form-html-submit'));

    await waitFor(() => expect(transport.recorder.runs).toHaveLength(1));
    const sentMessage = transport.recorder.runs[0].messages.at(-1);
    expect(sentMessage?.parts[0]).toMatchObject({
      payload: { values: { subscribe: true, moons: ['Io', 'Rhea'], size: 'large' } },
    });
  });

  it('treats a <select multiple> as an array of the selected option values', async () => {
    const transport = createFixtureTransport([]);
    const artifact = makeHtmlArtifact(`
      <select name="toppings" multiple>
        <option value="cheese" selected>Cheese</option>
        <option value="olives">Olives</option>
        <option value="basil" selected>Basil</option>
      </select>
    `);
    render(TestHarness, { config: { transport, threadId: 't1' }, artifact });

    await fireEvent.click(screen.getByTestId('form-html-submit'));

    await waitFor(() => expect(transport.recorder.runs).toHaveLength(1));
    const sentMessage = transport.recorder.runs[0].messages.at(-1);
    expect(sentMessage?.parts[0]).toMatchObject({ payload: { values: { toppings: ['cheese', 'basil'] } } });
  });

  it('never executes a <script> in the source document -- it is rendered as real page content, not run as a program', async () => {
    const transport = createFixtureTransport([]);
    const marker = '__chatkit_html_mode_script_should_not_run__';
    const artifact = makeHtmlArtifact(`<script>window.${marker} = true;</script><input name="x" />`);
    render(TestHarness, { config: { transport, threadId: 't1' }, artifact });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect((window as unknown as Record<string, unknown>)[marker]).toBeUndefined();
  });

  it('shows a read-only summary of the reported values once submitted', () => {
    const transport = createFixtureTransport([]);
    const artifact = makeHtmlArtifact('<input name="feedback" />', { values: { score: 6, total: 8 } }, 'submitted');
    render(TestHarness, { config: { transport, threadId: 't1' }, artifact });

    expect(screen.queryByTestId('form-html-body')).not.toBeInTheDocument();
    expect(screen.getByTestId('form-html-result-values')).toHaveTextContent('"score": 6');
    expect(screen.getByTestId('form-html-result-values')).toHaveTextContent('"total": 8');
  });
});

describe('FormRenderer — listening quiz features', () => {
  it('renders an audio clip with its label when data.audio is present', () => {
    const transport = createFixtureTransport([]);
    const artifact = makeArtifact({ audio: { url: 'https://x/clip.mp3', label: 'Listen, then answer below.' } });
    render(TestHarness, { config: { transport, threadId: 't1' }, artifact });

    expect(screen.getByText('Listen, then answer below.')).toBeInTheDocument();
    expect(screen.getByTestId('form-audio')).toHaveAttribute('src', 'https://x/clip.mp3');
  });

  it('renders a radio group for an enum field with the radio widget override, and submits the selected option', async () => {
    const transport = createFixtureTransport([]);
    const artifact = makeArtifact({
      schema: {
        type: 'object',
        required: ['moon'],
        properties: { moon: { type: 'string', enum: ['Io', 'Titan', 'Rhea'], title: 'Which moon?' } },
      },
      uiSchema: { widgets: { moon: 'radio' } },
    });
    render(TestHarness, { config: { transport, threadId: 't1' }, artifact });

    expect(screen.getByRole('radiogroup', { name: 'moon' })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('radio', { name: 'Titan' }));
    await fireEvent.click(screen.getByText('Submit'));

    await waitFor(() => expect(transport.recorder.runs).toHaveLength(1));
    const sentMessage = transport.recorder.runs[0].messages.at(-1);
    expect(sentMessage?.parts[0]).toMatchObject({ payload: { values: { moon: 'Titan' } } });
  });

  it('renders a checkbox group for an array/enum-items field, and submits the selected options as an array', async () => {
    const transport = createFixtureTransport([]);
    const artifact = makeArtifact({
      schema: {
        type: 'object',
        properties: {
          moons: { type: 'array', items: { type: 'string', enum: ['Io', 'Titan', 'Rhea'] }, title: 'Which moons? (pick all that apply)' },
        },
      },
    });
    render(TestHarness, { config: { transport, threadId: 't1' }, artifact });

    expect(screen.getByRole('group', { name: 'moons' })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('checkbox', { name: 'Io' }));
    await fireEvent.click(screen.getByRole('checkbox', { name: 'Rhea' }));
    await fireEvent.click(screen.getByText('Submit'));

    await waitFor(() => expect(transport.recorder.runs).toHaveLength(1));
    const sentMessage = transport.recorder.runs[0].messages.at(-1);
    expect(sentMessage?.parts[0]).toMatchObject({ payload: { values: { moons: ['Io', 'Rhea'] } } });
  });

  it('shows a per-field correct/incorrect indicator and a score summary once submitted with an answerKey', () => {
    const transport = createFixtureTransport([]);
    const artifact = makeArtifact(
      {
        answerKey: { name: 'Ada', plan: 'pro' },
        values: { name: 'Ada', plan: 'free' },
      },
      'submitted'
    );
    render(TestHarness, { config: { transport, threadId: 't1' }, artifact });

    expect(screen.getByTestId('form-grade-name')).toHaveTextContent('✓');
    expect(screen.getByTestId('form-grade-plan')).toHaveTextContent('✗');
    expect(screen.getByTestId('form-score')).toHaveTextContent('Score: 1 / 2');
  });

  it('omits the grade indicator and score summary when the form has no answerKey', () => {
    const transport = createFixtureTransport([]);
    const artifact = makeArtifact({ values: { name: 'Ada', plan: 'pro' } }, 'submitted');
    render(TestHarness, { config: { transport, threadId: 't1' }, artifact });

    expect(screen.queryByTestId('form-grade-name')).not.toBeInTheDocument();
    expect(screen.queryByTestId('form-score')).not.toBeInTheDocument();
  });
});
