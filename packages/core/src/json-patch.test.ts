import { describe, expect, it } from 'vitest';
import { applyPatch } from './json-patch';

describe('applyPatch', () => {
  it('adds a new key without mutating the original document', () => {
    const doc = { a: 1 };
    const { result, ok } = applyPatch(doc, [{ op: 'add', path: '/b', value: 2 }]);
    expect(ok).toBe(true);
    expect(result).toEqual({ a: 1, b: 2 });
    expect(doc).toEqual({ a: 1 });
  });

  it('replaces an existing key', () => {
    const doc = { a: 1 };
    const { result, ok } = applyPatch(doc, [{ op: 'replace', path: '/a', value: 99 }]);
    expect(ok).toBe(true);
    expect(result).toEqual({ a: 99 });
  });

  it('removes a key', () => {
    const doc = { a: 1, b: 2 };
    const { result, ok } = applyPatch(doc, [{ op: 'remove', path: '/b' }]);
    expect(ok).toBe(true);
    expect(result).toEqual({ a: 1 });
  });

  it('appends to an array with the "-" token', () => {
    const doc = { items: [1, 2] };
    const { result, ok } = applyPatch(doc, [{ op: 'add', path: '/items/-', value: 3 }]);
    expect(ok).toBe(true);
    expect(result).toEqual({ items: [1, 2, 3] });
  });

  it('unescapes ~1 and ~0 in path tokens', () => {
    const doc = { 'a/b': { 'c~d': 1 } };
    const { result, ok } = applyPatch(doc, [{ op: 'replace', path: '/a~1b/c~0d', value: 5 }]);
    expect(ok).toBe(true);
    expect(result).toEqual({ 'a/b': { 'c~d': 5 } });
  });

  it('returns ok:false and the original document when a test operation fails', () => {
    const doc = { a: 1 };
    const { result, ok } = applyPatch(doc, [{ op: 'test', path: '/a', value: 2 }]);
    expect(ok).toBe(false);
    expect(result).toBe(doc);
  });

  it('returns ok:false when replacing a missing key', () => {
    const doc = { a: 1 };
    const { result, ok } = applyPatch(doc, [{ op: 'replace', path: '/missing', value: 1 }]);
    expect(ok).toBe(false);
    expect(result).toBe(doc);
  });

  it('moves a value between paths', () => {
    const doc = { from: 'x', to: null };
    const { result, ok } = applyPatch(doc, [{ op: 'move', from: '/from', path: '/to' }]);
    expect(ok).toBe(true);
    expect(result).toEqual({ to: 'x' });
  });
});
