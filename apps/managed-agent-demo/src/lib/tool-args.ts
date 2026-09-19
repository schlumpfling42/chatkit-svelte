/**
 * Small models routinely emit tool-call arguments that are *almost* valid
 * JSON: raw newlines/tabs inside string values, invalid escapes like `\'` or
 * a lone backslash, unescaped inner quotes, trailing commas, markdown fences
 * around the object, or the whole object double-encoded as a JSON string.
 * The wire protocol isn't at fault (the arguments are model-generated text
 * either way), so this is where it gets absorbed: one tolerant parser that
 * every tool call passes through before anything reaches the UI. When it
 * can't recover a plain object it says so, and the caller hands the model an
 * error result to retry with instead of surfacing a broken tool call.
 */

export type ParsedToolArguments =
  | { ok: true; value: Record<string, unknown>; repaired: boolean }
  | { ok: false; error: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stripFences(text: string): string {
  return text.replace(/^```[a-zA-Z0-9_-]*\s*/, '').replace(/\s*```\s*$/, '').trim();
}

function extractOuterObject(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start !== -1 && end > start ? text.slice(start, end + 1) : text;
}

const VALID_SIMPLE_ESCAPES = new Set(['"', '\\', '/', 'b', 'f', 'n', 'r', 't']);
const CLOSES_A_STRING = new Set([',', '}', ']', ':']);

function nextNonWhitespace(text: string, from: number): string | undefined {
  for (let i = from; i < text.length; i += 1) {
    if (!/\s/.test(text[i])) return text[i];
  }
  return undefined;
}

function nextNonWhitespaceIndex(text: string, from: number): number {
  for (let i = from; i < text.length; i += 1) {
    if (!/\s/.test(text[i])) return i;
  }
  return -1;
}

/** Best-effort repair of near-JSON. Exported for tests; callers want parseToolArguments. */
export function repairJson(text: string): string {
  let out = '';
  let inString = false;
  const closers: string[] = [];

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (!inString) {
      if (ch === '"') {
        inString = true;
        out += ch;
      } else if (ch === '{') {
        closers.push('}');
        out += ch;
      } else if (ch === '[') {
        closers.push(']');
        out += ch;
      } else if (ch === '}' || ch === ']') {
        closers.pop();
        out += ch;
      } else if (ch === ',') {
        // Trailing comma: `,` followed (ignoring whitespace) by a closer.
        const next = nextNonWhitespace(text, i + 1);
        if (next !== '}' && next !== ']') out += ch;
      } else {
        out += ch;
      }
      continue;
    }

    if (ch === '\\') {
      const next = text[i + 1];
      if (next === undefined) {
        out += '\\\\';
      } else if (VALID_SIMPLE_ESCAPES.has(next)) {
        out += ch + next;
        i += 1;
      } else if (next === 'u' && /^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) {
        out += text.slice(i, i + 6);
        i += 5;
      } else if (next === "'") {
        // `\'` is a habit from other languages, and only ever means an apostrophe.
        out += "'";
        i += 1;
      } else {
        // Anything else (`C:\Users`, `\d`, `\(`) was a literal backslash the model forgot to double.
        out += '\\\\';
      }
      continue;
    }

    if (ch === '"') {
      // A quote closes the string only if what follows could legally follow a
      // string (`,` `}` `]` `:` or end of input); otherwise it's an inner
      // quote the model forgot to escape.
      const nextIndex = nextNonWhitespaceIndex(text, i + 1);
      if (nextIndex === -1 || CLOSES_A_STRING.has(text[nextIndex])) {
        inString = false;
        out += ch;
      } else {
        out += '\\"';
      }
      continue;
    }

    if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (ch.charCodeAt(0) < 0x20) out += `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`;
    else out += ch;
  }

  // Output cut off mid-value (e.g. hit the token limit): close what's open.
  if (inString) out += '"';
  while (closers.length > 0) out += closers.pop();
  return out;
}

function tryParseObject(text: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    if (isPlainObject(parsed)) return parsed;
    if (typeof parsed === 'string') {
      // Double-encoded: the model put the whole object in a JSON string.
      const inner: unknown = JSON.parse(parsed);
      if (isPlainObject(inner)) return inner;
    }
  } catch {
    // fall through
  }
  return undefined;
}

export function parseToolArguments(raw: string): ParsedToolArguments {
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: true, value: {}, repaired: false };

  try {
    const direct: unknown = JSON.parse(trimmed);
    if (isPlainObject(direct)) return { ok: true, value: direct, repaired: false };
  } catch {
    // try the repairs below
  }

  const fenced = stripFences(trimmed);
  const candidates = [trimmed, fenced, extractOuterObject(fenced)];
  for (const candidate of candidates) {
    const asIs = tryParseObject(candidate);
    if (asIs) return { ok: true, value: asIs, repaired: true };
    const repaired = tryParseObject(repairJson(candidate));
    if (repaired) return { ok: true, value: repaired, repaired: true };
  }

  return { ok: false, error: 'Tool arguments were not a valid JSON object.' };
}
