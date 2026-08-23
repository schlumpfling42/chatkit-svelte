import Markdown from './Markdown.svelte';
import type { ChatPlugin } from '@chatkit-svelte/core';

/**
 * Registers Markdown as the messageRenderer for 'text' content parts, taking
 * priority over MessageList's built-in plain-<p> fallback.
 */
export function markdownPlugin(): ChatPlugin {
  return {
    name: 'markdown',
    version: '1.0.0',
    messageRenderers: [{ partType: 'text', component: Markdown, priority: 10 }],
  };
}

export { default as Markdown } from './Markdown.svelte';
export { parseBlocks, parseInline } from './markdown-parser';
export type { BlockNode, InlineNode } from './markdown-parser';
