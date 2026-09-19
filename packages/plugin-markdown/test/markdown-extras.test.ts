import { describe, expect, it } from 'vitest';
import { isSafeHref, parseBlocks, parseInline } from '../src/markdown-parser';

const text = (t: string) => ({ type: 'text', text: t });

describe('parseInline: what models tend to write', () => {
  it('turns LaTeX symbols into text before emphasis is parsed (the $\\rightarrow$ case)', () => {
    expect(parseInline('go $\\rightarrow$ there')).toEqual([text('go → there')]);
    expect(parseInline('**Step 1** $\\rightarrow$ *Step 2*')).toEqual([
      { type: 'bold', children: [text('Step 1')] },
      text(' → '),
      { type: 'italic', children: [text('Step 2')] },
    ]);
  });

  it('math with * or _ inside is not mistaken for emphasis', () => {
    expect(parseInline('$a \\cdot b_1$')).toEqual([text('a · b₁')]);
  });

  it('parses ~~strikethrough~~', () => {
    expect(parseInline('~~gone~~')).toEqual([{ type: 'strike', children: [text('gone')] }]);
  });

  it('parses __bold__ at word edges but leaves identifiers alone', () => {
    expect(parseInline('__bold__')).toEqual([{ type: 'bold', children: [text('bold')] }]);
    expect(parseInline('use snake_case_name here')).toEqual([text('use snake_case_name here')]);
    expect(parseInline('the_init__method')).toEqual([text('the_init__method')]);
  });

  it('does not treat arithmetic asterisks as italics', () => {
    expect(parseInline('2 * 3 * 4')).toEqual([text('2 * 3 * 4')]);
    expect(parseInline('a *real* emphasis')).toEqual([text('a '), { type: 'italic', children: [text('real')] }, text(' emphasis')]);
  });

  it('turns <br> into a break node', () => {
    expect(parseInline('one<br>two')).toEqual([text('one'), { type: 'break' }, text('two')]);
  });

  it('decodes entities and honours backslash escapes', () => {
    expect(parseInline('Tom &amp; Jerry')).toEqual([text('Tom & Jerry')]);
    expect(parseInline('\\*literal\\*')).toEqual([text('*literal*')]);
  });

  it('leaves code spans exactly as written', () => {
    expect(parseInline('`$\\rightarrow$ &amp; \\*`')).toEqual([{ type: 'code', text: '$\\rightarrow$ &amp; \\*' }]);
  });

  it('leaves money alone', () => {
    expect(parseInline('It costs $5 and $10.')).toEqual([text('It costs $5 and $10.')]);
  });
});

describe('isSafeHref: links come from model output', () => {
  it('allows web, mail and relative links', () => {
    for (const href of ['https://example.com/a?b=c', 'http://example.com', 'mailto:a@b.co', '/docs/page', '#section', './x', 'page.html']) {
      expect(isSafeHref(href), href).toBe(true);
    }
  });

  it('refuses script-running and data schemes, however they are disguised', () => {
    for (const href of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)', 'java\nscript:alert(1)', 'data:text/html,<script>1</script>', 'vbscript:x', 'file:///etc/passwd']) {
      expect(isSafeHref(href), JSON.stringify(href)).toBe(false);
    }
  });
});

describe('parseBlocks: rules, quotes, task lists', () => {
  it('recognises horizontal rules in their usual spellings', () => {
    for (const rule of ['---', '***', '___', '* * *', '- - -', '----------']) {
      expect(parseBlocks(rule), rule).toEqual([{ type: 'rule' }]);
    }
  });

  it('does not mistake a bullet, a table separator, or a longer dash line of text for a rule', () => {
    expect(parseBlocks('* item')[0].type).toBe('list');
    expect(parseBlocks('| a | b |\n|---|---|\n| 1 | 2 |')[0].type).toBe('table');
    expect(parseBlocks('-- not a rule')[0].type).toBe('paragraph');
  });

  it('separates a rule from the text around it', () => {
    expect(parseBlocks('above\n\n---\n\nbelow')).toEqual([
      { type: 'paragraph', children: [text('above')] },
      { type: 'rule' },
      { type: 'paragraph', children: [text('below')] },
    ]);
  });

  it('parses a block quote across lines, with inline formatting', () => {
    expect(parseBlocks('> first **line**\n> second line')).toEqual([
      { type: 'quote', children: [text('first '), { type: 'bold', children: [text('line')] }, text('\nsecond line')] },
    ]);
  });

  it('ends a quote at the first non-quoted line', () => {
    expect(parseBlocks('> quoted\nplain')).toEqual([
      { type: 'quote', children: [text('quoted')] },
      { type: 'paragraph', children: [text('plain')] },
    ]);
  });

  it('shows task list items with a checkbox glyph', () => {
    expect(parseBlocks('- [ ] todo\n- [x] done\n- plain')).toEqual([
      {
        type: 'list',
        ordered: false,
        items: [[text('☐ '), text('todo')], [text('☑ '), text('done')], [text('plain')]],
      },
    ]);
  });
});
