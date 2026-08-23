<script lang="ts">
  import { getChatContext } from '@chatkit/svelte';
  import type { Component } from 'svelte';

  interface Props {
    class?: string;
  }

  let { class: className }: Props = $props();
  const store = getChatContext();

  function resolve(kind: string): { component: Component<Record<string, unknown>>; props: Record<string, unknown> } | undefined {
    const registration = (store.registry.artifactRenderers as Record<string, unknown>)[kind];
    if (!registration) return undefined;
    if (typeof registration === 'object' && registration !== null && 'component' in registration) {
      const r = registration as { component: Component<Record<string, unknown>>; props?: Record<string, unknown> };
      return { component: r.component, props: r.props ?? {} };
    }
    return { component: registration as Component<Record<string, unknown>>, props: {} };
  }
</script>

{#if Object.keys(store.state.artifacts).length > 0}
  <div class="ck-artifact-panel {className ?? ''}">
    {#each Object.values(store.state.artifacts) as artifact (artifact.id)}
      {@const resolved = resolve(artifact.kind)}
      {#if resolved}
        {@const Comp = resolved.component}
        <div class="ck-artifact" data-testid="artifact">
          <Comp {artifact} {...resolved.props} />
        </div>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .ck-artifact-panel {
    display: flex;
    flex-direction: column;
    gap: var(--ck-space-3);
    padding: var(--ck-space-3);
    border-bottom: 1px solid var(--ck-color-border);
  }

  .ck-artifact {
    border: 1px solid var(--ck-color-border);
    border-radius: var(--ck-radius-md);
    padding: var(--ck-space-3);
    background: var(--ck-color-surface);
  }
</style>
