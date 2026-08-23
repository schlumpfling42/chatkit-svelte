import { getContext, setContext } from 'svelte';
import type { ChatStore } from './chat-store.svelte';

const CHATKIT_CONTEXT_KEY = Symbol('chatkit');

export function setChatContext(store: ChatStore): void {
  setContext(CHATKIT_CONTEXT_KEY, store);
}

export function getChatContext(): ChatStore {
  const store = getContext<ChatStore | undefined>(CHATKIT_CONTEXT_KEY);
  if (!store) {
    throw new Error('[chatkit] getChatContext() must be called within a <ChatProvider>');
  }
  return store;
}
