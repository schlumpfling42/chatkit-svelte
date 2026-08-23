import type { Message } from '@chatkit-svelte/core';

export interface VercelMessage {
  role: string;
  content: string;
}

export function toVercelMessages(messages: Message[]): VercelMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.parts
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join(''),
  }));
}
