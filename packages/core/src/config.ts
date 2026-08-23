import type { ChatPlugin } from './plugin-host';
import type { ChatTransport } from './transport';
import type { ToolDefinition } from './types';
import type { I18nConfig } from './i18n';
import type { PersistenceAdapter } from './persistence';

export interface HumanInTheLoopConfig {
  autoApproveTools?: string[];
  requireApprovalFor?: string[];
}

export interface ChatConfig {
  threadId?: string;
  transport: ChatTransport;
  tools?: ToolDefinition[];
  plugins?: ChatPlugin[];
  initialState?: unknown;
  humanInTheLoop?: HumanInTheLoopConfig;
  persistence?: PersistenceAdapter;
  i18n?: I18nConfig;
}
