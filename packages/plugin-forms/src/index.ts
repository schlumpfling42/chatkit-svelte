import FormRenderer from './FormRenderer.svelte';
import ShowFormToolRenderer from './ShowFormToolRenderer.svelte';
import { formArtifactReducer } from './artifact-reducer';
import type { ChatPlugin, ToolDefinition } from '@chatkit-svelte/core';

export interface FormsPluginOptions {
  /** Accepted, not yet wired — no built-in widget takes a format-keyed component override this milestone. See plan decision 7. */
  widgetOverrides?: Record<string, unknown>;
  onBeforeSubmit?(values: Record<string, unknown>): Record<string, unknown> | Promise<Record<string, unknown>>;
}

/**
 * The tool name plugin-forms listens for. An app registers
 * `showFormToolDefinition` (below) in its ChatConfig.tools so the agent
 * knows this tool exists and what shape to call it with; this plugin does
 * the rest (renders it as a real form via ShowFormToolRenderer, and feeds
 * the filled-in values back as the tool's result via editAndRetry) with no
 * further app-side wiring.
 */
export const SHOW_FORM_TOOL_NAME = 'show_form';

/**
 * A ready-to-use ToolDefinition for ChatConfig.tools. This is how "the app
 * and agent need to analyze and return that format" actually happens: the
 * agent decides it needs structured input instead of prose, calls this tool
 * with a JSON Schema describing the fields, and — because it's listed here
 * as a tool at all — the run pauses until the client (this plugin) sends
 * back a result, which is exactly what the agent receives once the user
 * submits the rendered form.
 */
export const showFormToolDefinition: ToolDefinition = {
  name: SHOW_FORM_TOOL_NAME,
  description:
    "Ask the user for structured information via a real form instead of asking in prose. Use this whenever you need several distinct pieces of information at once (multiple ratings, choices, or fields) rather than a single free-text answer — faster and less error-prone for the user than a back-and-forth in chat. Call this, then wait: the filled-in values arrive as this tool's result once the user submits.",
  parameters: {
    type: 'object',
    required: ['schema'],
    properties: {
      schema: {
        type: 'object',
        description:
          'A JSON Schema object (type: "object", with "properties" and optionally "required") describing the fields to collect. Each property should have a "title" for its label; use "enum" for a fixed set of choices. Supported field shapes: strings (free text), enums (dropdown by default), booleans (checkbox), arrays of an enum (multi-select checkboxes), numbers.',
      },
      uiSchema: {
        type: 'object',
        description:
          'Optional rendering hints: { order?: string[] (field display order), widgets?: Record<fieldName, "radio"|"select"|"textarea"|"checkbox-group"|"date"> }. Use widgets.<field>="radio" to show an enum field as a radio group instead of a dropdown.',
      },
      submitLabel: { type: 'string', description: 'Optional label for the submit button, e.g. "Send answers".' },
      initialValues: { type: 'object', description: 'Optional pre-filled values, keyed by field name.' },
    },
  },
  executesOn: 'frontend',
};

export function formsPlugin(options: FormsPluginOptions = {}): ChatPlugin {
  return {
    name: 'forms',
    version: '1.0.0',
    artifactReducers: [formArtifactReducer],
    artifactRenderers: {
      form: { component: FormRenderer, props: { onBeforeSubmit: options.onBeforeSubmit } },
    },
    toolRenderers: {
      [SHOW_FORM_TOOL_NAME]: ShowFormToolRenderer,
    },
    hooks: {
      // editAndRetry (called by ShowFormToolRenderer on submit) runs this
      // hook to compute the tool's result -- by the time it fires, the tool
      // call's own args have already been overwritten with the user's
      // filled-in values, so echoing `args` back is exactly "send what the
      // user submitted" (see chat-store.svelte.ts's resolveApproval).
      onToolCall(call) {
        if (call.toolName !== SHOW_FORM_TOOL_NAME) return undefined;
        return { toolCallId: call.toolCallId, result: call.args };
      },
    },
  };
}

export { default as FormRenderer } from './FormRenderer.svelte';
export { default as ShowFormToolRenderer } from './ShowFormToolRenderer.svelte';
export { formArtifactReducer } from './artifact-reducer';
export { validateForm, validateField } from './validate';
export { gradeForm } from './grade';
export type { FormArtifactData, FormResultPayload, FormSnapshotPayload, UiSchemaHints, FormFieldWidget, FormAudioClip } from './types';
export type { FieldGrade, FormGrade } from './grade';
