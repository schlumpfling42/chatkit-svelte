import { describe, expect, it } from 'vitest';
import { drawTree, parseDrawn, parseListing } from '../src/lib/directory-tree';

const LISTING = [
  'app - 5 files in 2 folders; 1 hidden as secrets',
  '  src/ (3 files, 1 folder)',
  '    util/ (1 file)',
  '      files: Helper.java',
  '    files: Main.java, Other.java',
  '  empty/ (empty)',
  '  files: data.bin, README.md',
].join('\n');

describe('parseListing', () => {
  it('reads the header, folders, and files of a recursive listing', () => {
    const parsed = parseListing(LISTING)!;

    expect(parsed.header).toBe('app - 5 files in 2 folders; 1 hidden as secrets');
    expect(parsed.root.folders.map((f) => f.name)).toEqual(['src', 'empty']);
    expect(parsed.root.files).toEqual(['data.bin', 'README.md']);
    const src = parsed.root.folders[0];
    expect(src.detail).toBe('(3 files, 1 folder)');
    expect(src.files).toEqual(['Main.java', 'Other.java']);
    expect(src.folders[0].files).toEqual(['Helper.java']);
  });

  it('returns null for an ordinary listing, an error, or anything else', () => {
    expect(parseListing('Contents of . (3 entries):\napp/\nnotes.txt  12 B')).toBeNull();
    expect(parseListing('ERROR: no such folder')).toBeNull();
    expect(parseListing('')).toBeNull();
  });

  it('keeps page markers and trailing notes apart from the tree', () => {
    const paged = `[page 1 of 3]\n${LISTING}\n(call list_directory with the same arguments and page 2 for the rest)`;

    const parsed = parseListing(paged)!;

    expect(parsed.notes).toEqual(['[page 1 of 3]', '(call list_directory with the same arguments and page 2 for the rest)']);
    expect(parsed.root.folders).toHaveLength(2);
  });

  it('a later page has no header and starts mid-tree, so it is left as plain text rather than drawn wrongly', () => {
    expect(parseListing('[page 2 of 3]\n      files: Deep.java\n    files: Main.java')).toBeNull();
  });

  it('gives up cleanly on a line it cannot place', () => {
    expect(parseListing('app - 1 file in 1 folder\n      files: orphan.java')).toBeNull();
  });
});

describe('drawTree', () => {
  it('draws folders before files with the connectors a terminal tree uses', () => {
    const lines = drawTree(parseListing(LISTING)!.root);

    expect(lines).toEqual([
      '├── src/  (3 files, 1 folder)',
      '│   ├── util/  (1 file)',
      '│   │   └── Helper.java',
      '│   ├── Main.java',
      '│   └── Other.java',
      '├── empty/  (empty)',
      '├── data.bin',
      '└── README.md',
    ]);
  });

  it('marks the last folder with a corner and leaves no dangling bar under it', () => {
    const lines = drawTree(parseListing('x - 1 file in 1 folder\n  only/ (1 file)\n    files: a.txt')!.root);

    expect(lines).toEqual(['└── only/  (1 file)', '    └── a.txt']);
  });
});

describe('parseDrawn', () => {
  const DRAWN = ['app - 2 files in 1 folder', '├── src/  (1 file)', '│   └── Main.java', '└── data.bin', '(call list_directory with the same arguments and page 2 for the rest)'].join('\n');

  it('keeps the gateway-drawn lines as they are and the notes apart', () => {
    const parsed = parseDrawn(DRAWN)!;

    expect(parsed.header).toBe('app - 2 files in 1 folder');
    expect(parsed.drawn).toEqual(['├── src/  (1 file)', '│   └── Main.java', '└── data.bin']);
    expect(parsed.notes).toEqual(['(call list_directory with the same arguments and page 2 for the rest)']);
  });

  it('is not fooled by the compact form, and the compact parser is not fooled by a drawn tree', () => {
    expect(parseDrawn(LISTING)).toBeNull();
    expect(parseDrawn('Contents of . (1 entries):\napp/')).toBeNull();
  });
});
