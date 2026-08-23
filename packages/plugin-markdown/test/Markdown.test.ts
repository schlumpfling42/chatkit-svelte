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
});
