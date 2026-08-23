import type { ArtifactKind, ArtifactRecord, ChatEvent } from '@chatkit-svelte/core';
import type { FormArtifactData, FormResultPayload, FormSnapshotPayload } from './types';

function isFormSnapshotPayload(payload: unknown): payload is FormSnapshotPayload {
  if (typeof payload !== 'object' || payload === null) return false;
  const p = payload as Record<string, unknown>;
  return typeof p.artifactId === 'string' && typeof p.data === 'object' && p.data !== null;
}

function isFormResultPayload(payload: unknown): payload is FormResultPayload {
  if (typeof payload !== 'object' || payload === null) return false;
  const p = payload as Record<string, unknown>;
  return typeof p.artifactId === 'string' && typeof p.values === 'object' && p.values !== null;
}

export const formArtifactReducer = {
  kind: 'form' as ArtifactKind,
  matches(event: ChatEvent): boolean {
    return event.type === 'CUSTOM' && (event.name === 'chatkit.form.snapshot' || event.name === 'chatkit.form.result');
  },
  apply(artifacts: Record<string, ArtifactRecord>, event: ChatEvent): Record<string, ArtifactRecord> {
    if (event.type !== 'CUSTOM') return artifacts;

    if (event.name === 'chatkit.form.snapshot') {
      if (!isFormSnapshotPayload(event.payload)) {
        console.warn('[chatkit.plugin-forms] dropped malformed chatkit.form.snapshot payload', event.payload);
        return artifacts;
      }
      const existing = artifacts[event.payload.artifactId];
      const record: ArtifactRecord = {
        id: event.payload.artifactId,
        kind: 'form',
        version: (existing?.version ?? 0) + 1,
        createdByMessageId: event.payload.createdByMessageId ?? existing?.createdByMessageId ?? '',
        data: event.payload.data,
        status: 'draft',
      };
      return { ...artifacts, [record.id]: record };
    }

    if (event.name === 'chatkit.form.result') {
      if (!isFormResultPayload(event.payload)) {
        console.warn('[chatkit.plugin-forms] dropped malformed chatkit.form.result payload', event.payload);
        return artifacts;
      }
      const existing = artifacts[event.payload.artifactId];
      if (!existing || existing.kind !== 'form') return artifacts;
      const data = existing.data as FormArtifactData;
      const record: ArtifactRecord = {
        ...existing,
        version: existing.version + 1,
        data: { ...data, values: event.payload.values },
        status: 'submitted',
      };
      return { ...artifacts, [record.id]: record };
    }

    return artifacts;
  },
};
