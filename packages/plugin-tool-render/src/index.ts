import ToolCallCard from './ToolCallCard.svelte';
import type { ChatPlugin } from '@chatkit/core';

/**
 * Registers ToolCallCard as the '*' wildcard toolRenderer — applies to any
 * tool call that doesn't have a more specific renderer registered by another
 * plugin, ensuring no tool call ever falls back to raw JSON in the chat.
 */
export function toolRenderPlugin(): ChatPlugin {
  return {
    name: 'tool-render',
    version: '1.0.0',
    toolRenderers: { '*': ToolCallCard },
  };
}

export { default as ToolCallCard } from './ToolCallCard.svelte';
