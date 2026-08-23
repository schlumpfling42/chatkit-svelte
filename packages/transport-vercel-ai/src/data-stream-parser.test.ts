import { describe, expect, it } from 'vitest';
import { createDataStreamParser } from './data-stream-parser';

describe('createDataStreamParser', () => {
  it('parses a complete text delta line into a typed part', () => {
    const parser = createDataStreamParser();
    const parts = parser.push('0:"hello"\n');
    expect(parts).toEqual([{ prefix: '0', value: 'hello' }]);
  });

  it('parses multiple lines arriving in one chunk', () => {
    const parser = createDataStreamParser();
    const parts = parser.push('0:"hi"\n0:" there"\n');
    expect(parts).toEqual([
      { prefix: '0', value: 'hi' },
      { prefix: '0', value: ' there' },
    ]);
  });

  it('buffers a line split across two chunks and only yields it once complete', () => {
    const parser = createDataStreamParser();
    expect(parser.push('0:"par')).toEqual([]);
    expect(parser.push('tial"\n')).toEqual([{ prefix: '0', value: 'partial' }]);
  });

  it('parses object-payload prefixes (tool call parts)', () => {
    const parser = createDataStreamParser();
    const parts = parser.push('9:{"toolCallId":"tc1","toolName":"search","args":{"q":"x"}}\n');
    expect(parts).toEqual([{ prefix: '9', value: { toolCallId: 'tc1', toolName: 'search', args: { q: 'x' } } }]);
  });

  it('skips a malformed line instead of throwing', () => {
    const parser = createDataStreamParser();
    expect(() => parser.push('not a valid line\n')).not.toThrow();
    expect(parser.push('not a valid line\n')).toEqual([]);
  });

  it('skips an unrecognized-but-well-formed prefix without throwing', () => {
    const parser = createDataStreamParser();
    expect(parser.push('z:"unknown prefix"\n')).toEqual([]);
  });
});
