export type Role = 'user' | 'assistant' | 'system' | 'tool';

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; url: string; alt?: string; mimeType: string }
  | { type: 'file'; url: string; name: string; mimeType: string; sizeBytes?: number }
  | { type: 'tool_call'; toolCallId: string; toolName: string; args: unknown; status: ToolCallStatus; result?: unknown }
  | { type: 'reasoning'; text: string; encrypted?: boolean }
  | { type: 'artifact_ref'; artifactId: string; kind: ArtifactKind }
  | { type: 'custom'; name: string; payload: unknown };

export type ToolCallStatus =
  | 'streaming_args'
  | 'pending_execution'
  | 'awaiting_approval'
  | 'executing'
  | 'complete'
  | 'error'
  | 'rejected';

export interface Message {
  id: string;
  role: Role;
  parts: ContentPart[];
  createdAt: number;
  streaming: boolean;
}

export type ArtifactKind = 'form' | 'document' | 'generic';

export interface ArtifactRecord {
  id: string;
  kind: ArtifactKind;
  version: number;
  createdByMessageId: string;
  data: unknown;
  status: 'draft' | 'streaming' | 'final' | 'submitted' | 'error';
}

export type RunStatus = 'idle' | 'running' | 'awaiting_tool' | 'awaiting_approval' | 'error';

export interface ChatState {
  messages: Message[];
  runStatus: RunStatus;
  sharedState: unknown;
  activities: ActivityItem[];
  steps: StepInfo[];
  artifacts: Record<string, ArtifactRecord>;
  error: ChatError | null;
}

export interface ActivityItem {
  id: string;
  messageId: string;
  kind: string;
  data: unknown;
}

export interface StepInfo {
  id: string;
  name: string;
  status: 'started' | 'finished';
  parentStepId?: string;
}

export interface ChatError {
  code: string;
  message: string;
  recoverable: boolean;
  raw?: unknown;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JSONSchema;
  executesOn: 'frontend' | 'backend';
}

export interface ToolResult {
  toolCallId: string;
  result: unknown;
  isError?: boolean;
}

// The normalized event union the reducer consumes — transports map wire events into this.
export type ChatEvent =
  | { type: 'RUN_STARTED'; runId: string; threadId: string }
  | { type: 'RUN_FINISHED'; runId: string; result?: unknown }
  | { type: 'RUN_ERROR'; runId: string; error: ChatError }
  | { type: 'STEP_STARTED'; stepId: string; name: string; parentStepId?: string }
  | { type: 'STEP_FINISHED'; stepId: string }
  | { type: 'TEXT_MESSAGE_START'; messageId: string; role: Role }
  | { type: 'TEXT_MESSAGE_CONTENT'; messageId: string; delta: string }
  | { type: 'TEXT_MESSAGE_END'; messageId: string }
  | { type: 'TOOL_CALL_START'; toolCallId: string; toolName: string; parentMessageId: string }
  | { type: 'TOOL_CALL_ARGS'; toolCallId: string; delta: string }
  | { type: 'TOOL_CALL_END'; toolCallId: string }
  | { type: 'TOOL_CALL_RESULT'; toolCallId: string; result: unknown; isError?: boolean }
  | { type: 'REASONING_START'; messageId: string }
  | { type: 'REASONING_CONTENT'; messageId: string; delta: string; encrypted?: boolean }
  | { type: 'REASONING_END'; messageId: string }
  | { type: 'STATE_SNAPSHOT'; snapshot: unknown }
  | { type: 'STATE_DELTA'; patch: JsonPatchOperation[] }
  | { type: 'MESSAGES_SNAPSHOT'; messages: Message[] }
  | { type: 'ACTIVITY_SNAPSHOT'; messageId: string; data: unknown }
  | { type: 'ACTIVITY_DELTA'; messageId: string; patch: JsonPatchOperation[] }
  | { type: 'CUSTOM'; name: string; payload: unknown }
  | { type: 'RAW'; payload: unknown };

export interface JsonPatchOperation {
  op: 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test';
  path: string;
  value?: unknown;
  from?: string;
}

export type JSONSchema = Record<string, unknown>;
