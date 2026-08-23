import type { JSONSchema } from '@chatkit-svelte/core';

export type FormFieldWidget = 'text' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'date' | 'file' | 'slider';

export interface UiSchemaHints {
  order?: string[];
  widgets?: Record<string, FormFieldWidget>;
  groups?: { title: string; fields: string[] }[];
}

export interface FormArtifactData {
  schema: JSONSchema;
  uiSchema?: UiSchemaHints;
  submitLabel?: string;
  initialValues?: Record<string, unknown>;
  /** 'live' is accepted but not yet wired — see plan decision 7. Only 'single-submit' actually streams a result today. */
  mode: 'single-submit' | 'live';
  presentedAs?: 'tool_call' | 'artifact';
  toolCallId?: string;
  values?: Record<string, unknown>;
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
