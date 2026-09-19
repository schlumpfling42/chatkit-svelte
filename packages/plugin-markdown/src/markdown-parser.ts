export type InlineNode =
  | { type: 'text'; text: string }
  | { type: 'bold'; children: InlineNode[] }
  | { type: 'italic'; children: InlineNode[] }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string; children: InlineNode[] };

export type TableAlign = 'left' | 'center' | 'right' | null;

export type BlockNode =
  | { type: 'paragraph'; children: InlineNode[] }
  | { type: 'code'; lang?: string; text: string }
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; children: InlineNode[] }
  | { type: 'list'; ordered: boolean; items: InlineNode[][] }
  | { type: 'table'; header: InlineNode[][]; align: TableAlign[]; rows: InlineNode[][][] };

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

const HEADING_PATTERN = /^(#{1,6})\s+(.*)$/;
const LIST_ITEM_PATTERN = /^\s*[-*+]\s+(.*)$/;
const ORDERED_ITEM_PATTERN = /^\s*\d+\.\s+(.*)$/;
// A GFM table separator row: one or more `---`/`:--`/`--:`/`:-:` cells,
// pipe-delimited, with optional leading/trailing pipes. Whether a candidate
// header row is *actually* a table hinges entirely on the NEXT line matching
// this -- while streaming, a header row with no separator line yet just
// falls through to an ordinary paragraph below, and re-parses as a table
// once the separator arrives, the same "wait for confirmation" approach the
// fenced-code-block handling already uses.
const TABLE_SEPARATOR_PATTERN = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

function splitTableRow(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
  if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);
  return trimmed.split('|').map((cell) => cell.trim());
}

function parseAlignment(cell: string): TableAlign {
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  if (left) return 'left';
  return null;
}

function isTableStart(lines: string[], i: number): boolean {
  return lines[i].includes('|') && i + 1 < lines.length && TABLE_SEPARATOR_PATTERN.test(lines[i + 1]);
}

function isBlockBoundary(lines: string[], i: number): boolean {
  return (
    lines[i].trim() === '' ||
    /^```(\w*)\s*$/.test(lines[i]) ||
    HEADING_PATTERN.test(lines[i]) ||
    LIST_ITEM_PATTERN.test(lines[i]) ||
    ORDERED_ITEM_PATTERN.test(lines[i]) ||
    isTableStart(lines, i)
  );
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
    const headingMatch = HEADING_PATTERN.exec(line);
    if (headingMatch) {
      blocks.push({
        type: 'heading',
        level: headingMatch[1].length as 1 | 2 | 3 | 4 | 5 | 6,
        children: parseInline(headingMatch[2]),
      });
      i += 1;
      continue;
    }
    if (isTableStart(lines, i)) {
      const header = splitTableRow(line).map(parseInline);
      const align = splitTableRow(lines[i + 1]).map(parseAlignment);
      i += 2;
      const rows: InlineNode[][][] = [];
      while (i < lines.length && lines[i].trim() !== '' && lines[i].includes('|')) {
        rows.push(splitTableRow(lines[i]).map(parseInline));
        i += 1;
      }
      blocks.push({ type: 'table', header, align, rows });
      continue;
    }
    if (LIST_ITEM_PATTERN.test(line) || ORDERED_ITEM_PATTERN.test(line)) {
      const ordered = !LIST_ITEM_PATTERN.test(line);
      const itemPattern = ordered ? ORDERED_ITEM_PATTERN : LIST_ITEM_PATTERN;
      const items: InlineNode[][] = [];
      while (i < lines.length) {
        const itemMatch = itemPattern.exec(lines[i]);
        if (!itemMatch) break;
        items.push(parseInline(itemMatch[1]));
        i += 1;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }
    const paraLines: string[] = [];
    while (i < lines.length && !isBlockBoundary(lines, i)) {
      paraLines.push(lines[i]);
      i += 1;
    }
    blocks.push({ type: 'paragraph', children: parseInline(paraLines.join('\n')) });
  }
  return blocks;
}
