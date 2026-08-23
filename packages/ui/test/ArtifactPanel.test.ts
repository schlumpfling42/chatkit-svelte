import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import TestHarness from './TestHarness.svelte';
import ArtifactPanelHarness from './ArtifactPanelHarness.svelte';
import { createFixtureTransport } from '@chatkit/core';
import type { ArtifactRecord, ChatEvent, ChatPlugin } from '@chatkit/core';
import CustomArtifactCard from './CustomArtifactCard.test-helper.svelte';

function snapshotEvent(artifactId: string, value: string): ChatEvent {
  return { type: 'CUSTOM', name: 'test.artifact.snapshot', payload: { artifactId, value } };
}

function testPlugin(rendererRegistration: unknown): ChatPlugin {
  return {
    name: 'test-artifacts',
    version: '1.0.0',
    artifactReducers: [
      {
        kind: 'generic',
        matches: (event) => event.type === 'CUSTOM' && event.name === 'test.artifact.snapshot',
        apply: (artifacts, event) => {
          if (event.type !== 'CUSTOM') return artifacts;
          const payload = event.payload as { artifactId: string; value: string };
          const record: ArtifactRecord = {
            id: payload.artifactId,
            kind: 'generic',
            version: (artifacts[payload.artifactId]?.version ?? 0) + 1,
            createdByMessageId: '',
            data: { value: payload.value },
            status: 'final',
          };
          return { ...artifacts, [record.id]: record };
        },
      },
    ],
    artifactRenderers: { generic: rendererRegistration as never },
  };
}

describe('ArtifactPanel (via ChatWindow)', () => {
  it('renders nothing when there are no artifacts', async () => {
    const transport = createFixtureTransport([]);
    render(TestHarness, { config: { transport, threadId: 't1' } });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(screen.queryByTestId('artifact')).not.toBeInTheDocument();
  });

  it('renders a bare-component artifact renderer registration', async () => {
    const transport = createFixtureTransport([snapshotEvent('a1', 'hello')]);
    render(TestHarness, { config: { transport, threadId: 't1', plugins: [testPlugin(CustomArtifactCard)] } });

    await waitFor(() => {
      expect(screen.getByTestId('custom-artifact')).toHaveTextContent('hello');
    });
  });

  it('renders a { component, props } artifact renderer registration and spreads the extra props', async () => {
    const transport = createFixtureTransport([snapshotEvent('a1', 'hello')]);
    render(TestHarness, {
      config: {
        transport,
        threadId: 't1',
        plugins: [testPlugin({ component: CustomArtifactCard, props: { label: 'Extra' } })],
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId('custom-artifact')).toHaveTextContent('Extra: hello');
    });
  });

  it('merges a passed class prop with the internal root class', async () => {
    const transport = createFixtureTransport([snapshotEvent('a1', 'hello')]);
    render(ArtifactPanelHarness, {
      config: { transport, threadId: 't1', plugins: [testPlugin(CustomArtifactCard)] },
      class: 'custom-panel',
    });

    await waitFor(() => screen.getByTestId('custom-artifact'));
    const root = document.querySelector('.ck-artifact-panel')!;
    expect(root.className).toContain('ck-artifact-panel');
    expect(root.className).toContain('custom-panel');
  });
});
