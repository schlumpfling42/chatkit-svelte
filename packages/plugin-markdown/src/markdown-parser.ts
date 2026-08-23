export type InlineNode =
  | { type: 'text'; text: string }
  | { type: 'bold'; children: InlineNode[] }
  | { type: 'italic'; children: InlineNode[] }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string; children: InlineNode[] };

export type BlockNode = { type: 'paragraph'; children: InlineNode[] } | { type: 'code'; lang?: string; text: string };

const INLINE_PATTERN = /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(`(.+?)`)|(\[(.+?)\]\((.+?)\))/;

export function parseInline(text: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    const match = INLINE_PATTERN.exec(remaining);
    if (!match) {
      nodes.push({ type: 'text', text: remaining });
      break;
    }
    if (match.index > 0) {
      nodes.push({ type: 'text', text: remaining.slice(0, match.index) });
    }
    if (match[2] !== undefined) {
      nodes.push({ type: 'bold', children: parseInline(match[2]) });
    } else if (match[4] !== undefined) {
      nodes.push({ type: 'italic', children: parseInline(match[4]) });
    } else if (match[6] !== undefined) {
      nodes.push({ type: 'code', text: match[6] });
    } else if (match[8] !== undefined && match[9] !== undefined) {
      nodes.push({ type: 'link', href: match[9], children: parseInline(match[8]) });
    }
    remaining = remaining.slice(match.index + match[0].length);
  }
  return nodes;
}

export function parseBlocks(source: string): BlockNode[] {
  const blocks: BlockNode[] = [];
  const lines = source.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fenceMatch = /^```(\w*)\s*$/.exec(line);
    if (fenceMatch) {
      const lang = fenceMatch[1] || undefined;
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1; // consume closing fence if present; if streaming and unterminated, we just stop at EOF
      blocks.push({ type: 'code', lang, text: codeLines.join('\n') });
      continue;
    }
    if (line.trim() === '') {
      i += 1;
      continue;
    }
    const paraLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' && !/^```(\w*)\s*$/.test(lines[i])) {
      paraLines.push(lines[i]);
      i += 1;
    }
    blocks.push({ type: 'paragraph', children: parseInline(paraLines.join('\n')) });
  }
  return blocks;
}
