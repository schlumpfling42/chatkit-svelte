import FileRenderer from './FileRenderer.svelte';
import ImageRenderer from './ImageRenderer.svelte';
import RequestFileToolRenderer from './RequestFileToolRenderer.svelte';
import type { ChatPlugin, ContentPart, ToolDefinition } from '@chatkit-svelte/core';

export interface FileHandlingOptions {
  /** MIME type patterns accepted, e.g. 'image/*' or 'application/pdf'. Default: images, PDFs, text files. */
  accept?: string[];
  /** Max file size in bytes. Default 25MB. */
  maxSizeBytes?: number;
  /** Uploads the file to wherever attachments are hosted and returns its accessible URL. */
  upload: (file: File, abortSignal?: AbortSignal) => Promise<{ url: string }>;
}

/**
 * The tool name fileHandlingPlugin listens for. An app registers
 * `requestFileToolDefinition` (below) in its ChatConfig.tools so the agent
 * knows it can ask for a file at all; this plugin does the rest (renders it
 * as a real upload control via RequestFileToolRenderer, and feeds the
 * uploaded file's ContentPart back as the tool's result via editAndRetry) —
 * the same pattern @chatkit-svelte/plugin-forms uses for show_form.
 */
export const REQUEST_FILE_TOOL_NAME = 'request_file';

/** A ready-to-use ToolDefinition for ChatConfig.tools — see SHOW_FORM_TOOL_NAME's sibling in plugin-forms for the same idea applied to structured fields instead of a file. */
export const requestFileToolDefinition: ToolDefinition = {
  name: REQUEST_FILE_TOOL_NAME,
  description:
    "Ask the user to upload/attach a file (a document, image, spreadsheet, etc.) instead of asking in prose. Call this, then wait: you'll receive a reference to the uploaded file (url, name, mimeType) as this tool's result once they attach one.",
  parameters: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'What to ask the user for, e.g. "Please upload your resume (PDF)."' },
      accept: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Optional MIME type patterns narrowing what\'s accepted for this specific request (e.g. ["application/pdf"]), on top of whatever the app itself already accepts. Omit to accept anything the app allows.',
      },
    },
  },
  executesOn: 'frontend',
};

export function fileHandlingPlugin(opts: FileHandlingOptions): ChatPlugin {
  return {
    name: 'file-handling',
    version: '1.0.0',
    attachmentHandlers: [
      {
        accept: opts.accept ?? ['image/*', 'application/pdf', 'text/*'],
        maxSizeBytes: opts.maxSizeBytes ?? 25 * 1024 * 1024,
        async process(file, ctx): Promise<ContentPart> {
          // AttachmentHandler.process's `file` parameter is typed structurally
          // ({ name, type, size }) by @chatkit-svelte/core so the plugin-host contract
          // stays DOM-independent; at runtime it's always the real browser
          // File object Composer.svelte passes through, which `opts.upload`
          // needs directly (to read its bytes) — hence the cast.
          const uploaded = await opts.upload(file as File, ctx.abortSignal);
          if (file.type.startsWith('image/')) {
            return { type: 'image', url: uploaded.url, mimeType: file.type };
          }
          return { type: 'file', url: uploaded.url, name: file.name, mimeType: file.type, sizeBytes: file.size };
        },
      },
    ],
    messageRenderers: [
      { partType: 'file', component: FileRenderer, priority: 10 },
      { partType: 'image', component: ImageRenderer, priority: 10 },
    ],
    toolRenderers: {
      [REQUEST_FILE_TOOL_NAME]: RequestFileToolRenderer,
    },
    hooks: {
      onToolCall(call) {
        if (call.toolName !== REQUEST_FILE_TOOL_NAME) return undefined;
        return { toolCallId: call.toolCallId, result: call.args };
      },
    },
  };
}
