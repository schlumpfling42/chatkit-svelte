import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import Markdown from '../src/Markdown.svelte';

describe('Markdown', () => {
  it('renders bold/italic/code/link inline formatting as real elements, not innerHTML', () => {
    render(Markdown, { part: { type: 'text', text: 'a **bold** and *italic* and `code` and [a link](https://example.com)' } });

    const strong = screen.getByText('bold');
    expect(strong.tagName).toBe('STRONG');
    const em = screen.getByText('italic');
    expect(em.tagName).toBe('EM');
    const code = screen.getByText('code');
    expect(code.tagName).toBe('CODE');
    const link = screen.getByText('a link');
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', 'https://example.com');
  });

  it('renders a fenced code block with its language as a data attribute', () => {
    render(Markdown, { part: { type: 'text', text: '```js\nconst x = 1;\n```' } });
    const code = screen.getByText('const x = 1;');
    expect(code.tagName).toBe('CODE');
    expect(code).toHaveAttribute('data-lang', 'js');
  });

  it('renders multiple paragraphs as separate <p> elements', () => {
    render(Markdown, { part: { type: 'text', text: 'first\n\nsecond' } });
    expect(screen.getByText('first').tagName).toBe('P');
    expect(screen.getByText('second').tagName).toBe('P');
  });

  it('renders an unterminated bold marker as literal text while streaming, without crashing', () => {
    render(Markdown, { part: { type: 'text', text: 'thinking **abo' } });
    expect(screen.getByText('thinking **abo')).toBeInTheDocument();
  });

  it('re-renders reactively as the part prop grows (streaming)', async () => {
    const { rerender } = render(Markdown, { part: { type: 'text', text: 'Hello' } });
    expect(screen.getByText('Hello')).toBeInTheDocument();
    await rerender({ part: { type: 'text', text: 'Hello, **world**!' } });
    expect(screen.getByText('world').tagName).toBe('STRONG');
  });

  it('renders a heading as a real h1-h6 element', () => {
    render(Markdown, { part: { type: 'text', text: '## Section title' } });
    const heading = screen.getByText('Section title');
    expect(heading.tagName).toBe('H2');
  });

  it('renders a list as real ul/li elements', () => {
    render(Markdown, { part: { type: 'text', text: '- first\n- second' } });
    const first = screen.getByText('first');
    expect(first.tagName).toBe('LI');
    expect(first.closest('ul')).not.toBeNull();
  });

  it('renders an ordered list as a real ol element', () => {
    render(Markdown, { part: { type: 'text', text: '1. first\n2. second' } });
    expect(screen.getByText('first').closest('ol')).not.toBeNull();
  });

  it('renders a GFM table as a real table with header and data cells, not raw pipe syntax', () => {
    render(Markdown, { part: { type: 'text', text: '| Name | Score |\n|---|---|\n| Ada | 9 |' } });

    expect(screen.queryByText(/---/)).not.toBeInTheDocument();
    const nameHeader = screen.getByText('Name');
    expect(nameHeader.tagName).toBe('TH');
    const adaCell = screen.getByText('Ada');
    expect(adaCell.tagName).toBe('TD');
    expect(adaCell.closest('table')).not.toBeNull();
  });

  it('never makes a javascript: link clickable, but still shows its label', () => {
    render(Markdown, { part: { type: 'text', text: 'try [click me](javascript:alert(1)) now' } });

    expect(screen.getByText(/click me/)).toBeInTheDocument();
    expect(document.querySelector('a')).toBeNull();
  });

  it('renders <br>, ~~strike~~, rules, quotes and LaTeX arrows as real elements and symbols', () => {
    render(Markdown, { part: { type: 'text', text: 'line one<br>line two ~~old~~ $\\rightarrow$ new\n\n---\n\n> wise words' } });

    expect(document.querySelector('br')).not.toBeNull();
    expect(screen.getByText('old').tagName).toBe('DEL');
    expect(document.querySelector('hr')).not.toBeNull();
    expect(screen.getByText('wise words').tagName).toBe('BLOCKQUOTE');
    expect(document.body.textContent).toContain('→');
    expect(document.body.textContent).not.toContain('rightarrow');
  });

  it('applies column alignment from the separator row as a style', () => {
    render(Markdown, { part: { type: 'text', text: '| A |\n|---:|\n| 1 |' } });
    const cell = screen.getByText('1');
    expect(cell.style.textAlign).toBe('right');
  });
});
