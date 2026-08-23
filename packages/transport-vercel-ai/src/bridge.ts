export interface Bridge<T> {
  push(value: T): void;
  close(error?: Error): void;
  iterate(): AsyncIterable<T>;
}

export function createBridge<T>(): Bridge<T> {
  const queue: T[] = [];
  const waiters: Array<(result: IteratorResult<T>) => void> = [];
  let closed = false;
  let closeError: Error | undefined;

  function push(value: T): void {
    const waiter = waiters.shift();
    if (waiter) {
      waiter({ value, done: false });
    } else {
      queue.push(value);
    }
  }

  function close(error?: Error): void {
    closed = true;
    closeError = error;
    while (waiters.length > 0) {
      waiters.shift()!({ value: undefined, done: true });
    }
  }

  function iterate(): AsyncIterable<T> {
    return {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<T>> {
            if (queue.length > 0) return { value: queue.shift()!, done: false };
            if (closed) {
              if (closeError) throw closeError;
              return { value: undefined, done: true };
            }
            return new Promise<IteratorResult<T>>((resolve) => waiters.push(resolve));
          },
        };
      },
    };
  }

  return { push, close, iterate };
}
