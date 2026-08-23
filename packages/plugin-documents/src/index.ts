import DocumentCanvas from './DocumentCanvas.svelte';
import { documentArtifactReducer } from './artifact-reducer';
import type { ChatPlugin } from '@chatkit/core';
import type { ExportHandlers } from './types';

export interface DocumentsPluginOptions {
  exportHandlers?: ExportHandlers;
  /** Accepted, not yet wired — no toolbar extension point exists this milestone. See plan decision 7's sibling note. */
  toolbarActions?: unknown[];
  /** Accepted, not yet wired — no version-diff history exists without the persistence layer (M6). */
  onVersionChange?(artifact: unknown, diff: unknown): void;
}

export function documentsPlugin(options: DocumentsPluginOptions = {}): ChatPlugin {
  return {
    name: 'documents',
    version: '1.0.0',
    artifactReducers: [documentArtifactReducer],
    artifactRenderers: {
      document: { component: DocumentCanvas, props: { exportHandlers: options.exportHandlers ?? {} } },
    },
  };
}

export { default as DocumentCanvas } from './DocumentCanvas.svelte';
export { documentArtifactReducer } from './artifact-reducer';
export { exportDocument } from './export';
export type {
  DocumentArtifactData,
  DocumentDeltaPayload,
  DocumentSnapshotPayload,
  ExportFormat,
  ExportHandler,
  ExportHandlers,
} from './types';
