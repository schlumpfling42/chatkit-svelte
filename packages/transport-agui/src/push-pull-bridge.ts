/**
 * Bridges a callback-driven producer (e.g. WebSocket 'message' events) into a
 * pull-based AsyncGenerator, buffering pushed items until a consumer pulls
 * them and parking the generator on a pending promise when the buffer is
 * empty and nothing has closed it yet.
 */
export interface PushPullBridge<T> {
  push(item: T): void;
  close(error?: unknown): void;
  /** Returns a fresh generator each call, but only one should be actively consumed at a time — concurrent consumers would interfere with each other over the same buffer. */
  iterate(): AsyncGenerator<T>;
}

export function createPushPullBridge<T>(): PushPullBridge<T> {
  const buffer: T[] = [];
  let resolveWaiting: (() => void) | null = null;
  let closed = false;
  let closeError: unknown;

  function push(item: T): void {
    if (closed) return;
    buffer.push(item);
    if (resolveWaiting) {
      const resolve = resolveWaiting;
      resolveWaiting = null;
      resolve();
    }
  }

  function close(error?: unknown): void {
    if (closed) return;
    closed = true;
    closeError = error;
    if (resolveWaiting) {
      const resolve = resolveWaiting;
      resolveWaiting = null;
      resolve();
    }
  }

  async function* iterate(): AsyncGenerator<T> {
    while (true) {
      while (buffer.length > 0) {
        yield buffer.shift() as T;
      }
      if (closed) {
        if (closeError !== undefined) throw closeError;
        return;
      }
      await new Promise<void>((resolve) => {
        resolveWaiting = resolve;
      });
    }
  }

  return { push, close, iterate };
}
