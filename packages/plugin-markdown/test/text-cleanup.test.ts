import { describe, expect, it } from 'vitest';
import { LINE_BREAK, decodeEntities, latexToText, prepareInline, restoreEscapes } from '../src/text-cleanup';

/** What a reader ends up seeing for a run of prose, before markdown emphasis is parsed. */
function clean(text: string): string {
  const { text: prepared, stash } = prepareInline(text);
  return restoreEscapes(prepared, stash);
}

describe('LaTeX the model wrote instead of a symbol', () => {
  it('turns the arrow in the wild ($\\rightarrow$) into an arrow', () => {
    expect(clean('Step one $\\rightarrow$ step two')).toBe('Step one → step two');
  });

  it('converts everyday symbols', () => {
    expect(clean('3 $\\times$ 4 $\\approx$ 12')).toBe('3 × 4 ≈ 12');
    expect(clean('$\\leq$ and $\\geq$ and $\\neq$')).toBe('≤ and ≥ and ≠');
    expect(clean('$\\alpha + \\beta = \\gamma$')).toBe('α + β = γ');
    expect(clean('$\\infty$ and $\\pm$ and $\\cdot$')).toBe('∞ and ± and ·');
  });

  it('shows simple superscripts and subscripts as real ones', () => {
    expect(clean('$10^{-3}$')).toBe('10⁻³');
    expect(clean('$x^2$')).toBe('x²');
    expect(clean('$H_2O$')).toBe('H₂O');
    expect(clean('$a_n$')).toBe('aₙ');
  });

  it('keeps a script it cannot draw readable instead of dropping it', () => {
    expect(clean('$e^{i\\pi}$')).toBe('e^(iπ)');
    expect(latexToText('x^y')).toBe('x^y');
  });

  it('handles fractions, roots, and text wrappers', () => {
    expect(clean('$\\frac{a}{b}$')).toBe('a/b');
    expect(clean('$\\frac{a+b}{2}$')).toBe('(a+b)/2');
    expect(clean('$\\sqrt{x}$')).toBe('√x');
    expect(clean('$\\sqrt{x+1}$')).toBe('√(x+1)');
    expect(clean('$\\text{km/h}$')).toBe('km/h');
    expect(clean('$\\text{snake_case}$')).toBe('snake_case');
  });

  it('understands the other math delimiters too', () => {
    expect(clean('\\(\\alpha + \\beta\\)')).toBe('α + β');
    expect(clean('\\[E = mc^2\\]')).toBe('E = mc²');
    expect(clean('$$\\leq$$')).toBe('≤');
    expect(clean('$5\\%$')).toBe('5%');
  });

  it('shows a lone variable without the dollar signs', () => {
    expect(clean('Let $x$ be the count')).toBe('Let x be the count');
  });

  it('leaves money alone: a dollar sign is not math', () => {
    expect(clean('It costs $5 and $10.')).toBe('It costs $5 and $10.');
    expect(clean('Range: $5-$10')).toBe('Range: $5-$10');
    expect(clean('Pay $20 today')).toBe('Pay $20 today');
    expect(clean('Price \\$5 and \\$6')).toBe('Price $5 and $6');
  });

  it('leaves a fragment it does not fully understand exactly as written', () => {
    expect(clean('See $\\unknowncommand$ here')).toBe('See $\\unknowncommand$ here');
    expect(latexToText('\\unknowncommand')).toBeNull();
  });

  it('converts a bare, unambiguous symbol but not one that could be a path', () => {
    expect(clean('go \\rightarrow now')).toBe('go → now');
    expect(clean('C:\\to\\file')).toBe('C:\\to\\file');
  });

  it('never touches code', () => {
    expect(clean('run `$\\rightarrow$` now')).toBe('run `$\\rightarrow$` now');
  });
});

describe('HTML the model wrote', () => {
  it('decodes named and numeric entities and leaves unknown ones alone', () => {
    expect(decodeEntities('Tom &amp; Jerry')).toBe('Tom & Jerry');
    expect(decodeEntities('a &lt; b &gt; c')).toBe('a < b > c');
    expect(decodeEntities('&#8594; and &#x2192;')).toBe('→ and →');
    expect(decodeEntities('&nbsp;x&mdash;y&hellip;')).toBe(' x—y…');
    expect(decodeEntities('&bogus; and &#0;')).toBe('&bogus; and &#0;');
  });

  it('turns <br> into a hard break marker', () => {
    expect(clean('one<br>two<br/>three')).toBe(`one${LINE_BREAK}two${LINE_BREAK}three`);
  });

  it('turns simple inline tags into their markdown equivalents', () => {
    expect(clean('<b>bold</b> and <strong>strong</strong>')).toBe('**bold** and **strong**');
    expect(clean('<i>it</i> and <em>em</em>')).toBe('*it* and *em*');
    expect(clean('<del>gone</del>')).toBe('~~gone~~');
    expect(clean('x<sup>2</sup> and H<sub>2</sub>O')).toBe('x² and H₂O');
  });

  it('does not double-decode: an escaped tag stays text', () => {
    expect(clean('&lt;b&gt;not bold&lt;/b&gt;')).toBe('<b>not bold</b>');
  });
});

describe('backslash escapes', () => {
  it('hides an escaped character from markdown, then shows it plainly', () => {
    const { text, stash } = prepareInline('\\*not italic\\*');
    expect(text).not.toContain('*');
    expect(restoreEscapes(text, stash)).toBe('*not italic*');
  });

  it('leaves a backslash that escapes nothing', () => {
    expect(clean('a \\d b')).toBe('a \\d b');
  });
});
