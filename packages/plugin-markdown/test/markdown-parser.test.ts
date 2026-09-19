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

  it('parses a heading at each level', () => {
    expect(parseBlocks('# One')).toEqual([{ type: 'heading', level: 1, children: [{ type: 'text', text: 'One' }] }]);
    expect(parseBlocks('### Three')).toEqual([{ type: 'heading', level: 3, children: [{ type: 'text', text: 'Three' }] }]);
  });

  it('parses inline formatting inside a heading', () => {
    expect(parseBlocks('## **Bold** heading')).toEqual([
      {
        type: 'heading',
        level: 2,
        children: [{ type: 'bold', children: [{ type: 'text', text: 'Bold' }] }, { type: 'text', text: ' heading' }],
      },
    ]);
  });

  it('does not treat a bare "#" with no following text as a heading', () => {
    expect(parseBlocks('#nothash')).toEqual([{ type: 'paragraph', children: [{ type: 'text', text: '#nothash' }] }]);
  });

  it('parses a paragraph immediately followed by a heading with no blank line between', () => {
    expect(parseBlocks('intro text\n# Heading')).toEqual([
      { type: 'paragraph', children: [{ type: 'text', text: 'intro text' }] },
      { type: 'heading', level: 1, children: [{ type: 'text', text: 'Heading' }] },
    ]);
  });

  it('parses an unordered list', () => {
    expect(parseBlocks('- one\n- two\n- three')).toEqual([
      {
        type: 'list',
        ordered: false,
        items: [[{ type: 'text', text: 'one' }], [{ type: 'text', text: 'two' }], [{ type: 'text', text: 'three' }]],
      },
    ]);
  });

  it('parses an ordered list', () => {
    expect(parseBlocks('1. first\n2. second')).toEqual([
      { type: 'list', ordered: true, items: [[{ type: 'text', text: 'first' }], [{ type: 'text', text: 'second' }]] },
    ]);
  });

  it('parses inline formatting inside list items', () => {
    expect(parseBlocks('- **bold** item')).toEqual([
      {
        type: 'list',
        ordered: false,
        items: [[{ type: 'bold', children: [{ type: 'text', text: 'bold' }] }, { type: 'text', text: ' item' }]],
      },
    ]);
  });

  it('ends a list at the first non-item line', () => {
    expect(parseBlocks('- one\n- two\n\nafter')).toEqual([
      { type: 'list', ordered: false, items: [[{ type: 'text', text: 'one' }], [{ type: 'text', text: 'two' }]] },
      { type: 'paragraph', children: [{ type: 'text', text: 'after' }] },
    ]);
  });

  it('parses a GFM table with a header, separator, and data rows', () => {
    const result = parseBlocks('| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |');
    expect(result).toEqual([
      {
        type: 'table',
        header: [[{ type: 'text', text: 'A' }], [{ type: 'text', text: 'B' }]],
        align: [null, null],
        rows: [
          [[{ type: 'text', text: '1' }], [{ type: 'text', text: '2' }]],
          [[{ type: 'text', text: '3' }], [{ type: 'text', text: '4' }]],
        ],
      },
    ]);
  });

  it('parses column alignment from the separator row', () => {
    const result = parseBlocks('| L | C | R |\n|:---|:---:|---:|\n| a | b | c |');
    expect(result).toEqual([
      {
        type: 'table',
        header: [[{ type: 'text', text: 'L' }], [{ type: 'text', text: 'C' }], [{ type: 'text', text: 'R' }]],
        align: ['left', 'center', 'right'],
        rows: [[[{ type: 'text', text: 'a' }], [{ type: 'text', text: 'b' }], [{ type: 'text', text: 'c' }]]],
      },
    ]);
  });

  it('parses a table with no leading/trailing pipes', () => {
    const result = parseBlocks('A | B\n--- | ---\n1 | 2');
    expect(result).toEqual([
      {
        type: 'table',
        header: [[{ type: 'text', text: 'A' }], [{ type: 'text', text: 'B' }]],
        align: [null, null],
        rows: [[[{ type: 'text', text: '1' }], [{ type: 'text', text: '2' }]]],
      },
    ]);
  });

  it('does not treat a lone header-looking row with no confirmed separator as a table yet (streaming safety)', () => {
    // Mid-stream, the separator line hasn't arrived yet -- must not guess.
    const result = parseBlocks('| A | B |');
    expect(result).toEqual([{ type: 'paragraph', children: expect.anything() }]);
  });

  it('parses a table immediately following a paragraph with no blank line between', () => {
    const result = parseBlocks('Results:\n| A | B |\n|---|---|\n| 1 | 2 |');
    expect(result).toEqual([
      { type: 'paragraph', children: [{ type: 'text', text: 'Results:' }] },
      {
        type: 'table',
        header: [[{ type: 'text', text: 'A' }], [{ type: 'text', text: 'B' }]],
        align: [null, null],
        rows: [[[{ type: 'text', text: '1' }], [{ type: 'text', text: '2' }]]],
      },
    ]);
  });

  it('ends a table at the first blank line', () => {
    const result = parseBlocks('| A |\n|---|\n| 1 |\n\nafter');
    expect(result).toEqual([
      { type: 'table', header: [[{ type: 'text', text: 'A' }]], align: [null], rows: [[[{ type: 'text', text: '1' }]]] },
      { type: 'paragraph', children: [{ type: 'text', text: 'after' }] },
    ]);
  });
});
