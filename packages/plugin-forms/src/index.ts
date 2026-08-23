import FormRenderer from './FormRenderer.svelte';
import { formArtifactReducer } from './artifact-reducer';
import type { ChatPlugin } from '@chatkit-svelte/core';

export interface FormsPluginOptions {
  /** Accepted, not yet wired — no built-in widget takes a format-keyed component override this milestone. See plan decision 7. */
  widgetOverrides?: Record<string, unknown>;
  onBeforeSubmit?(values: Record<string, unknown>): Record<string, unknown> | Promise<Record<string, unknown>>;
}

export function formsPlugin(options: FormsPluginOptions = {}): ChatPlugin {
  return {
    name: 'forms',
    version: '1.0.0',
    artifactReducers: [formArtifactReducer],
    artifactRenderers: {
      form: { component: FormRenderer, props: { onBeforeSubmit: options.onBeforeSubmit } },
    },
  };
}

export { default as FormRenderer } from './FormRenderer.svelte';
export { formArtifactReducer } from './artifact-reducer';
export { validateForm, validateField } from './validate';
export type { FormArtifactData, FormResultPayload, FormSnapshotPayload, UiSchemaHints, FormFieldWidget } from './types';
