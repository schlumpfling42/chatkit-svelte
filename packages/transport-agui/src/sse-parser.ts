export interface SseFrame {
  event?: string;
  data: string;
  id?: string;
  retry?: number;
}

const LINE_BREAK = /\r\n|\r|\n/;

export interface SseFrameParser {
  /** Feed a decoded text chunk; returns any frames completed by this chunk. */
  push(chunk: string): SseFrame[];
}

export function createSseFrameParser(): SseFrameParser {
  let buffer = '';
  let eventField: string | undefined;
  let dataLines: string[] = [];
  let idField: string | undefined;
  let retryField: number | undefined;

  function reset(): void {
    eventField = undefined;
    dataLines = [];
    idField = undefined;
    retryField = undefined;
  }

  function isEmptyEvent(): boolean {
    return dataLines.length === 0 && eventField === undefined && idField === undefined && retryField === undefined;
  }

  function processLine(line: string, frames: SseFrame[]): void {
    if (line === '') {
      if (!isEmptyEvent()) {
        frames.push({ event: eventField, data: dataLines.join('\n'), id: idField, retry: retryField });
      }
      reset();
      return;
    }
    if (line.startsWith(':')) {
      return;
    }
    const colonIndex = line.indexOf(':');
    const field = colonIndex === -1 ? line : line.slice(0, colonIndex);
    let value = colonIndex === -1 ? '' : line.slice(colonIndex + 1);
    if (value.startsWith(' ')) value = value.slice(1);

    switch (field) {
      case 'event':
        eventField = value;
        break;
      case 'data':
        dataLines.push(value);
        break;
      case 'id':
        idField = value;
        break;
      case 'retry': {
        const ms = Number(value);
        if (!Number.isNaN(ms)) retryField = ms;
        break;
      }
      default:
        break;
    }
  }

  return {
    push(chunk: string): SseFrame[] {
      buffer += chunk;
      const frames: SseFrame[] = [];
      let match: RegExpExecArray | null;
      while ((match = LINE_BREAK.exec(buffer))) {
        const line = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        processLine(line, frames);
      }
      return frames;
    },
  };
}
