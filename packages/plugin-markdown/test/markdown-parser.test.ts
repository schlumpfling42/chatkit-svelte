import { describe, expect, it } from 'vitest';
import { parseBlocks, parseInline } from '../src/markdown-parser';

describe('parseInline', () => {
  it('parses plain text with no markup', () => {
    expect(parseInline('hello world')).toEqual([{ type: 'text', text: 'hello world' }]);
  });

  it('parses bold', () => {
    expect(parseInline('**bold**')).toEqual([{ type: 'bold', children: [{ type: 'text', text: 'bold' }] }]);
  });

  it('parses italic', () => {
    expect(parseInline('*italic*')).toEqual([{ type: 'italic', children: [{ type: 'text', text: 'italic' }] }]);
  });

  it('parses inline code', () => {
    expect(parseInline('`code`')).toEqual([{ type: 'code', text: 'code' }]);
  });

  it('parses a link', () => {
    expect(parseInline('[text](https://example.com)')).toEqual([
      { type: 'link', href: 'https://example.com', children: [{ type: 'text', text: 'text' }] },
    ]);
  });

  it('parses mixed text and markup', () => {
    expect(parseInline('a **b** c')).toEqual([
      { type: 'text', text: 'a ' },
      { type: 'bold', children: [{ type: 'text', text: 'b' }] },
      { type: 'text', text: ' c' },
    ]);
  });

  it('leaves an unterminated bold marker as literal text (streaming safety)', () => {
    expect(parseInline('hello **wor')).toEqual([{ type: 'text', text: 'hello **wor' }]);
  });

  it('leaves an unterminated code marker as literal text (streaming safety)', () => {
    expect(parseInline('call `foo(')).toEqual([{ type: 'text', text: 'call `foo(' }]);
  });
});

describe('parseBlocks', () => {
  it('parses a single paragraph', () => {
    expect(parseBlocks('hello world')).toEqual([{ type: 'paragraph', children: [{ type: 'text', text: 'hello world' }] }]);
  });

  it('splits paragraphs on blank lines', () => {
    expect(parseBlocks('first\n\nsecond')).toEqual([
      { type: 'paragraph', children: [{ type: 'text', text: 'first' }] },
      { type: 'paragraph', children: [{ type: 'text', text: 'second' }] },
    ]);
  });

  it('parses a fenced code block with a language', () => {
    expect(parseBlocks('```js\nconst x = 1;\n```')).toEqual([{ type: 'code', lang: 'js', text: 'const x = 1;' }]);
  });

  it('parses a fenced code block with no language', () => {
    expect(parseBlocks('```\nplain\n```')).toEqual([{ type: 'code', lang: undefined, text: 'plain' }]);
  });

  it('handles an unterminated code fence gracefully (streaming safety) by treating the rest as code so far', () => {
    expect(parseBlocks('```js\nconst x = 1;')).toEqual([{ type: 'code', lang: 'js', text: 'const x = 1;' }]);
  });

  it('parses a paragraph followed by a code block', () => {
    expect(parseBlocks('intro\n\n```\ncode\n```')).toEqual([
      { type: 'paragraph', children: [{ type: 'text', text: 'intro' }] },
      { type: 'code', lang: undefined, text: 'code' },
    ]);
  });

  it('does not hang on a fence-opening line with trailing info-string content it cannot parse as a language', () => {
    const result = parseBlocks('```js title="app.js"\nconst x = 1;');
    expect(result).toBeDefined();
  });

  it('treats a malformed fence-opening line (extra content after the language word) as ordinary paragraph text rather than a fence', () => {
    const result = parseBlocks('```js title="app.js"\nmore text');
    // The leading ``` is absorbed as paragraph text (not treated as a fence), then parsed
    // inline as ordinary text: the first two backticks pair up as an inline-code span
    // (capturing the middle backtick), and the remainder is plain text. This is pre-existing
    // parseInline behavior applied to a line that no longer incorrectly stalls the parser.
    expect(result).toEqual([
      {
        type: 'paragraph',
        children: [
          { type: 'code', text: '`' },
          { type: 'text', text: 'js title="app.js"\nmore text' },
        ],
      },
    ]);
  });
});
