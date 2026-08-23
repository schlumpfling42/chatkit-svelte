import type { ChatEvent, ToolResult } from '../types';
import type { ChatTransport, RunAgentInput } from '../transport';

export interface FixtureTransportOptions {
  /** Delay in ms between yielded events; 0 (default) yields as fast as microtasks allow. */
  delayMs?: number;
}

export interface FixtureTransportRecorder {
  runs: RunAgentInput[];
  toolResults: ToolResult[];
  abortedRunIds: string[];
}

export function createFixtureTransport(
  events: ChatEvent[],
  options: FixtureTransportOptions = {}
): ChatTransport & { recorder: FixtureTransportRecorder } {
  const recorder: FixtureTransportRecorder = { runs: [], toolResults: [], abortedRunIds: [] };
  const delayMs = options.delayMs ?? 0;

  async function* replay(): AsyncIterable<ChatEvent> {
    for (const event of events) {
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      yield event;
    }
  }

  return {
    recorder,
    connect() {
      return replay();
    },
    async sendRun(input) {
      recorder.runs.push(input);
    },
    async sendFrontendToolResult(result) {
      recorder.toolResults.push(result);
    },
    async abortRun(runId) {
      recorder.abortedRunIds.push(runId);
    },
    dispose() {
      // no sockets/timers held open by this transport
    },
  };
}
