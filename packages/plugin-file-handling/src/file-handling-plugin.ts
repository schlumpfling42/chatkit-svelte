import FileRenderer from './FileRenderer.svelte';
import ImageRenderer from './ImageRenderer.svelte';
import type { ChatPlugin, ContentPart } from '@chatkit-svelte/core';

export interface FileHandlingOptions {
  /** MIME type patterns accepted, e.g. 'image/*' or 'application/pdf'. Default: images, PDFs, text files. */
  accept?: string[];
  /** Max file size in bytes. Default 25MB. */
  maxSizeBytes?: number;
  /** Uploads the file to wherever attachments are hosted and returns its accessible URL. */
  upload: (file: File, abortSignal?: AbortSignal) => Promise<{ url: string }>;
}

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
  };
}
