import { describe, expect, it } from 'vitest';
import { parseToolArguments } from '../src/lib/tool-args';

function ok(raw: string) {
  const result = parseToolArguments(raw);
  if (!result.ok) throw new Error(`expected ok, got: ${result.error}`);
  return result;
}

describe('parseToolArguments', () => {
  it('parses valid JSON untouched and flags it as not repaired', () => {
    expect(ok('{"a":1,"b":"two"}')).toEqual({ ok: true, value: { a: 1, b: 'two' }, repaired: false });
  });

  it('treats empty arguments as an empty object (a tool with no parameters)', () => {
    expect(ok('')).toEqual({ ok: true, value: {}, repaired: false });
    expect(ok('   ')).toEqual({ ok: true, value: {}, repaired: false });
  });

  it('repairs raw newlines and tabs inside string values', () => {
    const result = ok('{"content":"line one\nline two\tindented"}');
    expect(result.value).toEqual({ content: 'line one\nline two\tindented' });
    expect(result.repaired).toBe(true);
  });

  it('repairs an invalid escape like \\\' to the apostrophe it meant', () => {
    expect(ok("{\"text\":\"it\\'s fine\"}").value).toEqual({ text: "it's fine" });
  });

  it('keeps a lone backslash the model forgot to double (Windows paths, regex)', () => {
    expect(ok('{"path":"C:\\Users\\me"}').value).toEqual({ path: 'C:\\Users\\me' });
  });

  it('keeps valid escapes and unicode escapes as they are', () => {
    expect(ok('{"a":"line\\nbreak \\"quoted\\" \\u00e9"}').value).toEqual({ a: 'line\nbreak "quoted" é' });
  });

  it('escapes an unescaped inner quote', () => {
    expect(ok('{"title":"The "Art" of Listening","n":2}').value).toEqual({ title: 'The "Art" of Listening', n: 2 });
  });

  it('removes trailing commas', () => {
    expect(ok('{"a":[1,2,],"b":3,}').value).toEqual({ a: [1, 2], b: 3 });
  });

  it('strips markdown fences and prose around the object', () => {
    expect(ok('```json\n{"a":1}\n```').value).toEqual({ a: 1 });
    expect(ok('Sure! Here you go: {"a":1} Hope that helps.').value).toEqual({ a: 1 });
  });

  it('unwraps an object that was double-encoded as a JSON string', () => {
    expect(ok(JSON.stringify(JSON.stringify({ a: 1 }))).value).toEqual({ a: 1 });
  });

  it('closes output that was cut off mid-value', () => {
    expect(ok('{"title":"Notes","content":"half a sen').value).toEqual({ title: 'Notes', content: 'half a sen' });
  });

  it('repairs a realistic escape-heavy document body in one go', () => {
    const raw = '{"title":"Fromm: "Listening"","content":"# Heading\n\nHe said "yes".\n- item\tone\nPath C:\\tmp\\x"}';
    const result = ok(raw);
    expect(result.value.title).toBe('Fromm: "Listening"');
    expect(result.value.content).toContain('# Heading');
    expect(result.value.content).toContain('- item\tone');
  });

  it('gives up cleanly (no throw) on something that is not an object at all', () => {
    expect(parseToolArguments('not json at all')).toEqual({ ok: false, error: expect.stringContaining('valid JSON object') });
    expect(parseToolArguments('[1,2,3]').ok).toBe(false);
    expect(parseToolArguments('42').ok).toBe(false);
  });
});
