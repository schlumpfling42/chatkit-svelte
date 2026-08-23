import { describe, expect, it, vi } from 'vitest';
import { createPluginHost } from './plugin-host';
import type { ChatPlugin, PluginContext } from './plugin-host';
import { initialState } from './reducer';
import type { ChatConfig } from './config';

function makeCtx(overrides: Partial<PluginContext> = {}): PluginContext {
  return {
    getState: () => initialState(),
    dispatch: vi.fn(),
    sendRun: vi.fn(async () => {}),
    logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
    storage: { get: () => undefined, set: () => {} },
    config: {} as ChatConfig,
    ...overrides,
  };
}

describe('createPluginHost — registration', () => {
  it('throws on duplicate plugin names', () => {
    const plugin: ChatPlugin = { name: 'dup', version: '1.0.0' };
    expect(() => createPluginHost([plugin, { ...plugin }])).toThrow('duplicate plugin name "dup"');
  });

  it('throws on duplicate toolRenderer registrations across plugins', () => {
    const a: ChatPlugin = { name: 'a', version: '1.0.0', toolRenderers: { search: 'ComponentA' } };
    const b: ChatPlugin = { name: 'b', version: '1.0.0', toolRenderers: { search: 'ComponentB' } };
    expect(() => createPluginHost([a, b])).toThrow('duplicate toolRenderer registration for "search"');
  });

  it('throws on duplicate artifactRenderer registrations for the same kind', () => {
    const a: ChatPlugin = { name: 'a', version: '1.0.0', artifactRenderers: { form: 'FormA' } };
    const b: ChatPlugin = { name: 'b', version: '1.0.0', artifactRenderers: { form: 'FormB' } };
    expect(() => createPluginHost([a, b])).toThrow('duplicate artifactRenderer registration for "form"');
  });

  it('sorts messageRenderers by descending priority, preserving registration order on ties', () => {
    const a: ChatPlugin = {
      name: 'a',
      version: '1.0.0',
      messageRenderers: [{ partType: 'text', component: 'Low', priority: 1 }],
    };
    const b: ChatPlugin = {
      name: 'b',
      version: '1.0.0',
      messageRenderers: [
        { partType: 'text', component: 'High', priority: 10 },
        { partType: 'text', component: 'Default' },
      ],
    };
    const host = createPluginHost([a, b]);
    expect(host.registry.messageRenderers.map((r) => r.component)).toEqual(['High', 'Low', 'Default']);
  });

  it('aggregates slashCommands, inputTransforms, and attachmentHandlers across plugins', () => {
    const a: ChatPlugin = {
      name: 'a',
      version: '1.0.0',
      slashCommands: [{ name: 'clear', run: () => {} }],
    };
    const b: ChatPlugin = {
      name: 'b',
      version: '1.0.0',
      slashCommands: [{ name: 'export', run: () => {} }],
    };
    const host = createPluginHost([a, b]);
    expect(host.registry.slashCommands.map((c) => c.name)).toEqual(['clear', 'export']);
  });
});

describe('createPluginHost — lifecycle', () => {
  it('calls setup and onInit for every plugin, and dispose runs setup teardowns', () => {
    const teardown = vi.fn();
    const setup = vi.fn(() => teardown);
    const onInit = vi.fn();
    const plugin: ChatPlugin = { name: 'p', version: '1.0.0', setup, hooks: { onInit } };
    const host = createPluginHost([plugin]);
    const ctx = makeCtx();

    host.init(ctx);
    expect(setup).toHaveBeenCalledWith(ctx);
    expect(onInit).toHaveBeenCalledWith(ctx);
    expect(teardown).not.toHaveBeenCalled();

    host.dispose();
    expect(teardown).toHaveBeenCalledTimes(1);
  });
});

describe('createPluginHost — runHook', () => {
  it('pipes beforeSend output from one plugin into the next', async () => {
    const upper: ChatPlugin = {
      name: 'upper',
      version: '1.0.0',
      hooks: { beforeSend: (input) => ({ ...input, text: input.text.toUpperCase() }) },
    };
    const exclaim: ChatPlugin = {
      name: 'exclaim',
      version: '1.0.0',
      hooks: { beforeSend: (input) => ({ ...input, text: `${input.text}!` }) },
    };
    const host = createPluginHost([upper, exclaim]);
    const result = await host.runHook('beforeSend', { text: 'hello' }, makeCtx());
    expect(result).toEqual({ text: 'HELLO!' });
  });

  it('fires onEvent for observers without requiring a return value', async () => {
    const seen: string[] = [];
    const plugin: ChatPlugin = {
      name: 'observer',
      version: '1.0.0',
      hooks: { onEvent: (event) => { seen.push(event.type); } },
    };
    const host = createPluginHost([plugin]);
    const event = { type: 'RUN_STARTED', runId: 'r1', threadId: 't1' } as const;
    const result = await host.runHook('onEvent', event, makeCtx());
    expect(seen).toEqual(['RUN_STARTED']);
    expect(result).toBe(event);
  });
});
