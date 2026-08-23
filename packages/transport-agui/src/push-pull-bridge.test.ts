import { describe, expect, it } from 'vitest';
import { createPushPullBridge } from './push-pull-bridge';

describe('createPushPullBridge', () => {
  it('yields items pushed before iteration starts', async () => {
    const bridge = createPushPullBridge<number>();
    bridge.push(1);
    bridge.push(2);
    const iterator = bridge.iterate()[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toBe(1);
    expect((await iterator.next()).value).toBe(2);
  });

  it('parks the generator until an item is pushed, then resumes', async () => {
    const bridge = createPushPullBridge<number>();
    const iterator = bridge.iterate()[Symbol.asyncIterator]();
    const pending = iterator.next();
    let resolved = false;
    pending.then(() => {
      resolved = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(resolved).toBe(false);
    bridge.push(42);
    const result = await pending;
    expect(result.value).toBe(42);
  });

  it('ends the generator cleanly when close() is called with no error', async () => {
    const bridge = createPushPullBridge<number>();
    bridge.push(1);
    bridge.close();
    const iterator = bridge.iterate()[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toBe(1);
    expect((await iterator.next()).done).toBe(true);
  });

  it('throws from the generator when close() is called with an error', async () => {
    const bridge = createPushPullBridge<number>();
    bridge.close(new Error('boom'));
    const iterator = bridge.iterate()[Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toThrow('boom');
  });

  it('ignores pushes after close()', async () => {
    const bridge = createPushPullBridge<number>();
    bridge.close();
    bridge.push(1);
    const iterator = bridge.iterate()[Symbol.asyncIterator]();
    expect((await iterator.next()).done).toBe(true);
  });
});
