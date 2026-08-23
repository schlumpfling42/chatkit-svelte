import type { ArtifactKind, ArtifactRecord, ChatEvent } from '@chatkit-svelte/core';
import type { DocumentArtifactData, DocumentDeltaPayload, DocumentSnapshotPayload } from './types';

function isDocumentSnapshotPayload(payload: unknown): payload is DocumentSnapshotPayload {
  if (typeof payload !== 'object' || payload === null) return false;
  const p = payload as Record<string, unknown>;
  return typeof p.artifactId === 'string' && typeof p.data === 'object' && p.data !== null;
}

function isDocumentDeltaPayload(payload: unknown): payload is DocumentDeltaPayload {
  if (typeof payload !== 'object' || payload === null) return false;
  const p = payload as Record<string, unknown>;
  return typeof p.artifactId === 'string' && typeof p.append === 'string';
}

export const documentArtifactReducer = {
  kind: 'document' as ArtifactKind,
  matches(event: ChatEvent): boolean {
    return event.type === 'CUSTOM' && (event.name === 'chatkit.document.snapshot' || event.name === 'chatkit.document.delta');
  },
  apply(artifacts: Record<string, ArtifactRecord>, event: ChatEvent): Record<string, ArtifactRecord> {
    if (event.type !== 'CUSTOM') return artifacts;

    if (event.name === 'chatkit.document.snapshot') {
      if (!isDocumentSnapshotPayload(event.payload)) {
        console.warn('[chatkit.plugin-documents] dropped malformed chatkit.document.snapshot payload', event.payload);
        return artifacts;
      }
      const existing = artifacts[event.payload.artifactId];
      const record: ArtifactRecord = {
        id: event.payload.artifactId,
        kind: 'document',
        version: (existing?.version ?? 0) + 1,
        createdByMessageId: event.payload.createdByMessageId ?? existing?.createdByMessageId ?? '',
        data: event.payload.data,
        status: 'final',
      };
      return { ...artifacts, [record.id]: record };
    }

    if (event.name === 'chatkit.document.delta') {
      if (!isDocumentDeltaPayload(event.payload)) {
        console.warn('[chatkit.plugin-documents] dropped malformed chatkit.document.delta payload', event.payload);
        return artifacts;
      }
      const existing = artifacts[event.payload.artifactId];
      if (!existing || existing.kind !== 'document') return artifacts;
      const data = existing.data as DocumentArtifactData;
      const record: ArtifactRecord = {
        ...existing,
        version: existing.version + 1,
        data: { ...data, content: data.content + event.payload.append },
        status: 'streaming',
      };
      return { ...artifacts, [record.id]: record };
    }

    return artifacts;
  },
};
