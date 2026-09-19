import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { AgentCapabilities } from '@chatkit-svelte/core';

const capabilities: AgentCapabilities = {
  transports: ['sse'],
  tools: [],
  multimodal: true,
  reasoning: true,
  humanInTheLoop: false,
  sharedStateWritable: false,
};

export const GET: RequestHandler = async () => json(capabilities);
