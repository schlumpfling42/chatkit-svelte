import type { ArtifactRecord } from '@chatkit/core';
import type { DocumentArtifactData, ExportFormat, ExportHandlers } from './types';

export async function exportDocument(
  artifact: ArtifactRecord,
  format: ExportFormat,
  handlers: ExportHandlers = {}
): Promise<string | Blob> {
  const data = artifact.data as DocumentArtifactData;
  if (format === 'md' || format === 'txt') {
    return data.content;
  }
  const handler = handlers[format];
  if (!handler) {
    throw new Error(
      `[chatkit.plugin-documents] register an export handler for format "${format}" — pass documentsPlugin({ exportHandlers: { ${format}: ... } }).`
    );
  }
  return handler(artifact);
}
