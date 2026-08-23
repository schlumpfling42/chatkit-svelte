import type { ArtifactKind, ChatError, ChatEvent, ChatState, ContentPart, Message, ToolResult } from './types';
import type { RunAgentInput } from './transport';
import type { ChatConfig } from './config';

export interface UserInput {
  text: string;
  attachments?: ContentPart[];
}

export interface ToolCall {
  toolCallId: string;
  toolName: string;
  args: unknown;
}

export interface MessageRendererRegistration {
  partType: ContentPart['type'];
  component: unknown; // concrete Svelte component type supplied by @chatkit/svelte consumers (later milestone)
  priority?: number;
}

export type ToolRendererComponent = unknown;
/**
 * A Svelte component for rendering an artifact of a given kind, OR
 * `{ component, props }` when the plugin needs to bake construction-time
 * options into the rendering (e.g. `formsPlugin({ onBeforeSubmit })`,
 * `documentsPlugin({ exportHandlers })`) without a module-level singleton —
 * see the M5 plan's decision 3. `@chatkit/ui`'s `<ArtifactPanel>` is the
 * consumer that unwraps whichever shape it finds.
 */
export type ArtifactRendererComponent = unknown;

export interface SlashCommand {
  name: string;
  description?: string;
  run(args: string, ctx: PluginContext): void | Promise<void>;
}

export interface InputTransform {
  name: string;
  transform(input: UserInput, ctx: PluginContext): UserInput | Promise<UserInput>;
}

export interface AttachmentHandler {
  accept: string[];
  maxSizeBytes?: number;
  process(file: { name: string; type: string; size: number }, ctx: { abortSignal?: AbortSignal }): Promise<ContentPart>;
}

export interface ArtifactReducer {
  kind: ArtifactKind;
  matches(event: ChatEvent): boolean;
  apply(artifacts: ChatState['artifacts'], event: ChatEvent): ChatState['artifacts'];
  validate?(data: unknown): boolean;
}

export interface Logger {
  debug(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export interface PluginContext {
  getState(): ChatState;
  dispatch(event: ChatEvent): void;
  sendRun(input: Partial<RunAgentInput>): Promise<void>;
  logger: Logger;
  storage: { get<T>(key: string): T | undefined; set<T>(key: string, value: T): void };
  config: ChatConfig;
}

export interface ChatPluginHooks {
  onInit?(ctx: PluginContext): void;
  beforeSend?(input: UserInput, ctx: PluginContext): UserInput | Promise<UserInput>;
  onEvent?(event: ChatEvent, ctx: PluginContext): void;
  onMessage?(message: Message, ctx: PluginContext): void;
  onToolCall?(call: ToolCall, ctx: PluginContext): ToolResult | Promise<ToolResult> | void;
  onError?(error: ChatError, ctx: PluginContext): void;
}

export interface ChatPlugin {
  name: string;
  version: string;
  setup?(ctx: PluginContext): void | (() => void);
  hooks?: ChatPluginHooks;
  artifactReducers?: ArtifactReducer[];
  messageRenderers?: MessageRendererRegistration[];
  toolRenderers?: Record<string, ToolRendererComponent>;
  artifactRenderers?: Partial<Record<ArtifactKind, ArtifactRendererComponent>>;
  slashCommands?: SlashCommand[];
  inputTransforms?: InputTransform[];
  attachmentHandlers?: AttachmentHandler[];
}

export interface PluginRegistry {
  artifactReducers: Record<string, ArtifactReducer[]>;
  messageRenderers: MessageRendererRegistration[];
  toolRenderers: Record<string, ToolRendererComponent>;
  artifactRenderers: Partial<Record<ArtifactKind, ArtifactRendererComponent>>;
  slashCommands: SlashCommand[];
  inputTransforms: InputTransform[];
  attachmentHandlers: AttachmentHandler[];
}

function indexByKind(reducers: ArtifactReducer[]): Record<string, ArtifactReducer[]> {
  const index: Record<string, ArtifactReducer[]> = {};
  for (const reducer of reducers) {
    (index[reducer.kind] ??= []).push(reducer);
  }
  return index;
}

function sortByPriority(renderers: MessageRendererRegistration[]): MessageRendererRegistration[] {
  return [...renderers].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
}

function mergeUnique(entries: Array<[string, unknown]>, kind: string): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    if (key in merged) {
      throw new Error(`[chatkit] duplicate ${kind} registration for "${key}"`);
    }
    merged[key] = value;
  }
  return merged;
}

export interface PluginHost {
  registry: PluginRegistry;
  init(ctx: PluginContext): void;
  runHook(hook: keyof ChatPluginHooks, arg: unknown, ctx: PluginContext): Promise<unknown>;
  dispose(): void;
}

export function createPluginHost(plugins: ChatPlugin[]): PluginHost {
  const seen = new Set<string>();
  for (const plugin of plugins) {
    if (seen.has(plugin.name)) {
      throw new Error(`[chatkit] duplicate plugin name "${plugin.name}"`);
    }
    seen.add(plugin.name);
  }

  const toolRendererEntries = plugins.flatMap((p) => Object.entries(p.toolRenderers ?? {}));
  const artifactRendererEntries = plugins.flatMap((p) => Object.entries(p.artifactRenderers ?? {}));

  const registry: PluginRegistry = {
    artifactReducers: indexByKind(plugins.flatMap((p) => p.artifactReducers ?? [])),
    messageRenderers: sortByPriority(plugins.flatMap((p) => p.messageRenderers ?? [])),
    toolRenderers: mergeUnique(toolRendererEntries, 'toolRenderer'),
    artifactRenderers: mergeUnique(artifactRendererEntries, 'artifactRenderer') as Partial<Record<ArtifactKind, ArtifactRendererComponent>>,
    slashCommands: plugins.flatMap((p) => p.slashCommands ?? []),
    inputTransforms: plugins.flatMap((p) => p.inputTransforms ?? []),
    attachmentHandlers: plugins.flatMap((p) => p.attachmentHandlers ?? []),
  };

  const teardowns: Array<() => void> = [];

  function init(ctx: PluginContext) {
    for (const plugin of plugins) {
      const teardown = plugin.setup?.(ctx);
      if (typeof teardown === 'function') teardowns.push(teardown);
      plugin.hooks?.onInit?.(ctx);
    }
  }

  async function runHook(hook: keyof ChatPluginHooks, arg: unknown, ctx: PluginContext): Promise<unknown> {
    let value = arg;
    for (const plugin of plugins) {
      const fn = plugin.hooks?.[hook] as ((a: unknown, c: PluginContext) => unknown) | undefined;
      if (!fn) continue;
      const out = await fn(value, ctx);
      if (out !== undefined) value = out;
    }
    return value;
  }

  function dispose() {
    for (const teardown of teardowns) teardown();
  }

  return { registry, init, runHook, dispose };
}
