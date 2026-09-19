import DocumentCanvas from './DocumentCanvas.svelte';
import CreateDocumentToolRenderer from './CreateDocumentToolRenderer.svelte';
import { documentArtifactReducer } from './artifact-reducer';
import type { ChatPlugin, ToolDefinition } from '@chatkit-svelte/core';
import type { ExportHandlers } from './types';

export interface DocumentsPluginOptions {
  exportHandlers?: ExportHandlers;
  /** Accepted, not yet wired — no toolbar extension point exists this milestone. See plan decision 7's sibling note. */
  toolbarActions?: unknown[];
  /** Accepted, not yet wired — no version-diff history exists without the persistence layer (M6). */
  onVersionChange?(artifact: unknown, diff: unknown): void;
}

/**
 * The tool name documentsPlugin listens for. An app registers
 * `createDocumentToolDefinition` (below) in its ChatConfig.tools so the
 * agent knows it can hand over a finished document directly instead of
 * writing one to a file the user has no way to reach; this plugin does the
 * rest (renders it as a real, previewable, downloadable, editable document
 * via CreateDocumentToolRenderer/DocumentCanvas) — the same pattern
 * @chatkit-svelte/plugin-forms uses for show_form.
 */
export const CREATE_DOCUMENT_TOOL_NAME = 'create_document';

/** A ready-to-use ToolDefinition for ChatConfig.tools — see SHOW_FORM_TOOL_NAME's sibling in plugin-forms for the same idea applied to a document instead of a form. */
export const createDocumentToolDefinition: ToolDefinition = {
  name: CREATE_DOCUMENT_TOOL_NAME,
  description:
    "Show the user a document you've written (notes, a summary, a draft, a report) with a real preview and download button, instead of writing it to a file — the user has no way to reach a file you write yourself. Call this with the finished content as markdown; there's nothing to wait for, the conversation continues immediately once it's shown.",
  parameters: {
    type: 'object',
    required: ['title', 'content'],
    properties: {
      title: { type: 'string', description: 'Document title — also used as the downloaded filename.' },
      content: { type: 'string', description: 'The full document content, as markdown.' },
    },
  },
  executesOn: 'frontend',
};

export function documentsPlugin(options: DocumentsPluginOptions = {}): ChatPlugin {
  return {
    name: 'documents',
    version: '1.0.0',
    artifactReducers: [documentArtifactReducer],
    artifactRenderers: {
      document: { component: DocumentCanvas, props: { exportHandlers: options.exportHandlers ?? {} } },
    },
    // Unlike artifactRenderers, toolRenderers takes a component directly --
    // no { component, props } wrapper support -- which is why
    // CreateDocumentToolRenderer takes no exportHandlers prop (see its own
    // comment for why it doesn't need one).
    toolRenderers: {
      [CREATE_DOCUMENT_TOOL_NAME]: CreateDocumentToolRenderer,
    },
    hooks: {
      onToolCall(call) {
        if (call.toolName !== CREATE_DOCUMENT_TOOL_NAME) return undefined;
        return { toolCallId: call.toolCallId, result: { created: true } };
      },
    },
  };
}

export { default as DocumentCanvas } from './DocumentCanvas.svelte';
export { default as CreateDocumentToolRenderer } from './CreateDocumentToolRenderer.svelte';
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
