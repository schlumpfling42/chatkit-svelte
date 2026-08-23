import type { ChatEvent, Message, ToolDefinition, ToolResult } from './types';

export interface RunAgentInput {
  threadId: string;
  runId: string;
  messages: Message[];
  tools: ToolDefinition[];
  state?: unknown;
  context?: Record<string, unknown>;
  forwardedProps?: Record<string, unknown>;
}

export interface AgentCapabilities {
  transports: ('sse' | 'websocket' | 'http-polling')[];
  tools: string[];
  multimodal: boolean;
  reasoning: boolean;
  humanInTheLoop: boolean;
  sharedStateWritable: boolean;
}

export interface ChatTransport {
  /** Open (or resume) the event stream for a thread. Returns an async iterable of normalized events. */
  connect(session: { threadId: string; resumeToken?: string }): AsyncIterable<ChatEvent>;
  /** Start a new run. May be a fire-and-forget POST (events arrive via connect()) or return its own stream. */
  sendRun(input: RunAgentInput): Promise<void>;
  /** Deliver a frontend-executed tool's result back to the agent. */
  sendFrontendToolResult(result: ToolResult): Promise<void>;
  /** Cooperatively cancel an in-flight run. */
  abortRun(runId: string): Promise<void>;
  /** Optional capability negotiation, called once at connect time if the server supports it. */
  getCapabilities?(): Promise<AgentCapabilities>;
  /** Clean up sockets/listeners. */
  dispose(): void;
}
