import type { ArtifactRecord } from '@chatkit-svelte/core';

export type ExportFormat = 'md' | 'txt' | 'docx' | 'pdf';

export interface DocumentArtifactData {
  title: string;
  /** richtext is deferred — see plan decision 4/5; only 'markdown' is implemented this milestone. */
  format: 'markdown';
  content: string;
  editable: boolean;
  exportFormats?: ExportFormat[];
}

export interface DocumentSnapshotPayload {
  artifactId: string;
  createdByMessageId?: string;
  data: DocumentArtifactData;
}

export interface DocumentDeltaPayload {
  artifactId: string;
  append: string;
}

export type ExportHandler = (artifact: ArtifactRecord) => string | Promise<string> | Blob | Promise<Blob>;
export type ExportHandlers = Partial<Record<ExportFormat, ExportHandler>>;
