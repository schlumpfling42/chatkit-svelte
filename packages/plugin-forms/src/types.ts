import type { JSONSchema } from '@chatkit-svelte/core';

export type FormFieldWidget = 'text' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'checkbox-group' | 'date' | 'file' | 'slider';

export interface UiSchemaHints {
  order?: string[];
  widgets?: Record<string, FormFieldWidget>;
  groups?: { title: string; fields: string[] }[];
}

export interface FormAudioClip {
  url: string;
  mimeType?: string;
  /** e.g. "Listen, then answer the questions below." */
  label?: string;
}

export interface FormArtifactData {
  /**
   * Omit when `html` is set — the two are mutually exclusive rendering
   * modes (see `html` below). Required for the schema-driven mode.
   */
  schema?: JSONSchema;
  uiSchema?: UiSchemaHints;
  submitLabel?: string;
  initialValues?: Record<string, unknown>;
  /** 'live' is accepted but not yet wired — see plan decision 7. Only 'single-submit' actually streams a result today. */
  mode: 'single-submit' | 'live';
  presentedAs?: 'tool_call' | 'artifact';
  toolCallId?: string;
  values?: Record<string, unknown>;
  /** Rendered above the fields — e.g. for listening-comprehension quizzes. */
  audio?: FormAudioClip;
  /**
   * Correct answer per field, used for auto-grading once the form is submitted.
   * Array-valued entries (multi-select / checkbox-group fields) are graded by
   * set equality, order-independent; everything else by strict equality.
   * Fields with no entry here are excluded from scoring.
   */
  answerKey?: Record<string, unknown>;
  /**
   * A complete, self-contained HTML document (its own inline markup/CSS),
   * rendered directly as real DOM in the page instead of schema-driven
   * fields. Use this when the form was authored as a whole document rather
   * than built from `schema` — e.g. one an agent generated with a
   * code-execution tool and that got pulled back out of that session's
   * files. Mutually exclusive with `schema`; when both are omitted this is a
   * rendering error, not a valid empty form.
   *
   * Only the body's markup is used — any `<script>` in the document is
   * parsed but never executed (this is inserted as real page content, not
   * run as a program), so there is no contract the document's own code needs
   * to follow. On submit, FormRenderer reads every `input[name]` /
   * `textarea[name]` / `select[name]` in the rendered body directly (a lone
   * checkbox as a boolean, same-name checkboxes as a multi-select array,
   * only the checked option in a same-name radio group, `<select multiple>`
   * as an array) and feeds the result into the exact same submit path
   * (`chatkit.form.result` CUSTOM event + store.sendMessage) the
   * schema-driven form's Submit button uses — so the agent sees an
   * identical shape either way, regardless of what the document's markup
   * looked like.
   */
  html?: string;
}

export interface FormSnapshotPayload {
  artifactId: string;
  createdByMessageId?: string;
  data: FormArtifactData;
}

export interface FormResultPayload {
  artifactId: string;
  values: Record<string, unknown>;
}
