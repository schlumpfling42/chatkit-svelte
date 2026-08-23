export type DataStreamPart =
  | { prefix: '0'; value: string }
  | { prefix: '3'; value: string }
  | { prefix: '9'; value: { toolCallId: string; toolName: string; args: unknown } }
  | { prefix: 'b'; value: { toolCallId: string; toolName: string } }
  | { prefix: 'c'; value: { toolCallId: string; argsTextDelta: string } }
  | { prefix: 'a'; value: { toolCallId: string; result: unknown } }
  | { prefix: 'd'; value: { finishReason: string; usage?: unknown } };

const KNOWN_PREFIXES = new Set(['0', '3', '9', 'b', 'c', 'a', 'd']);

export interface DataStreamParser {
  push(chunk: string): DataStreamPart[];
}

export function createDataStreamParser(): DataStreamParser {
  let buffer = '';

  return {
    push(chunk: string): DataStreamPart[] {
      buffer += chunk;
      const parts: DataStreamPart[] = [];
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        const colonIndex = line.indexOf(':');
        if (colonIndex === -1) continue;
        const prefix = line.slice(0, colonIndex);
        if (!KNOWN_PREFIXES.has(prefix)) continue;
        try {
          const value = JSON.parse(line.slice(colonIndex + 1));
          parts.push({ prefix, value } as DataStreamPart);
        } catch {
          continue;
        }
      }
      return parts;
    },
  };
}
