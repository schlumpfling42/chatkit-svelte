import type { JsonPatchOperation } from './types';

export interface ApplyPatchResult {
  result: unknown;
  ok: boolean;
}

function parsePointer(path: string): string[] {
  if (path === '') return [];
  if (path[0] !== '/') {
    throw new Error(`Invalid JSON Pointer: "${path}"`);
  }
  return path
    .split('/')
    .slice(1)
    .map((token) => token.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function navigate(doc: unknown, tokens: string[]): unknown {
  let current = doc;
  for (const token of tokens) {
    if (Array.isArray(current)) {
      const index = token === '-' ? current.length : Number(token);
      if (Number.isNaN(index) || index < 0 || index >= current.length) {
        throw new Error(`Invalid array index "${token}"`);
      }
      current = current[index];
    } else if (current !== null && typeof current === 'object') {
      if (!(token in (current as Record<string, unknown>))) {
        throw new Error(`Path segment "${token}" not found`);
      }
      current = (current as Record<string, unknown>)[token];
    } else {
      throw new Error(`Cannot navigate into non-object at "${token}"`);
    }
  }
  return current;
}

function setAtPath(doc: unknown, tokens: string[], value: unknown, mode: 'add' | 'replace'): unknown {
  if (tokens.length === 0) {
    return value;
  }
  const parentTokens = tokens.slice(0, -1);
  const key = tokens[tokens.length - 1];
  const parent = navigate(doc, parentTokens);

  if (Array.isArray(parent)) {
    const index = key === '-' ? parent.length : Number(key);
    if (Number.isNaN(index) || index < 0 || index > parent.length) {
      throw new Error(`Invalid array index "${key}"`);
    }
    if (mode === 'add') {
      parent.splice(index, 0, value);
    } else {
      if (index >= parent.length) throw new Error(`Cannot replace missing index "${key}"`);
      parent[index] = value;
    }
  } else if (parent !== null && typeof parent === 'object') {
    const record = parent as Record<string, unknown>;
    if (mode === 'replace' && !(key in record)) {
      throw new Error(`Cannot replace missing key "${key}"`);
    }
    record[key] = value;
  } else {
    throw new Error(`Cannot set property on non-object at "${key}"`);
  }
  return doc;
}

function removeAtPath(doc: unknown, tokens: string[]): unknown {
  if (tokens.length === 0) {
    throw new Error('Cannot remove the root document');
  }
  const parentTokens = tokens.slice(0, -1);
  const key = tokens[tokens.length - 1];
  const parent = navigate(doc, parentTokens);

  if (Array.isArray(parent)) {
    const index = Number(key);
    if (Number.isNaN(index) || index < 0 || index >= parent.length) {
      throw new Error(`Invalid array index "${key}"`);
    }
    parent.splice(index, 1);
  } else if (parent !== null && typeof parent === 'object') {
    const record = parent as Record<string, unknown>;
    if (!(key in record)) throw new Error(`Cannot remove missing key "${key}"`);
    delete record[key];
  } else {
    throw new Error(`Cannot remove property on non-object at "${key}"`);
  }
  return doc;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function deepClone<T>(value: T): T {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : (JSON.parse(JSON.stringify(value)) as T);
}

function applyOperation(doc: unknown, op: JsonPatchOperation): unknown {
  const tokens = parsePointer(op.path);
  switch (op.op) {
    case 'add':
      return setAtPath(doc, tokens, deepClone(op.value), 'add');
    case 'replace':
      return setAtPath(doc, tokens, deepClone(op.value), 'replace');
    case 'remove':
      return removeAtPath(doc, tokens);
    case 'test': {
      const current = navigate(doc, tokens);
      if (!deepEqual(current, op.value)) {
        throw new Error(`Test operation failed at "${op.path}"`);
      }
      return doc;
    }
    case 'move': {
      if (op.from === undefined) throw new Error('"move" requires "from"');
      const fromTokens = parsePointer(op.from);
      const value = deepClone(navigate(doc, fromTokens));
      removeAtPath(doc, fromTokens);
      return setAtPath(doc, tokens, value, 'add');
    }
    case 'copy': {
      if (op.from === undefined) throw new Error('"copy" requires "from"');
      const fromTokens = parsePointer(op.from);
      const value = deepClone(navigate(doc, fromTokens));
      return setAtPath(doc, tokens, value, 'add');
    }
    default:
      throw new Error(`Unknown operation "${(op as JsonPatchOperation).op}"`);
  }
}

export function applyPatch(document: unknown, patch: JsonPatchOperation[]): ApplyPatchResult {
  let working = deepClone(document);
  try {
    for (const op of patch) {
      working = applyOperation(working, op);
    }
    return { result: working, ok: true };
  } catch {
    return { result: document, ok: false };
  }
}
