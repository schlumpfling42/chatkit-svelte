// Turns the gateway's compact recursive listing (list_directory with recursive: true) into a drawn tree.
//
// The model reads one line per folder, which keeps the prompt small and lets it answer in seconds; the person
// reading wants the tree they know from a terminal. Drawing it here costs the model nothing, however big the tree is.
//
//   app - 5 files in 2 folders            app - 5 files in 2 folders
//     src/ (3 files, 1 folder)             ├── src/  (3 files, 1 folder)
//       util/ (1 file)             =>      │   ├── util/  (1 file)
//         files: Helper.java               │   │   └── Helper.java
//       files: Main.java                   │   └── Main.java
//     files: data.bin                      └── data.bin

export interface TreeNode {
  name: string;
  /** "(3 files, 1 folder)", "(skipped)", "(empty)" ... as the gateway wrote it; empty for files. */
  detail: string;
  folders: TreeNode[];
  files: string[];
}

export interface ParsedListing {
  /** "app - 5 files in 2 folders; 1 hidden as secrets" */
  header: string;
  root: TreeNode;
  /** Lines around the tree that are not part of it: "[page 1 of 3]", "(call list_directory ... page 2 ...)", "(stopped: ...)". */
  notes: string[];
  /** Already-drawn lines, when the gateway drew the tree itself. */
  drawn?: string[];
}

const HEADER = /^.+ - \d+ files? in \d+ folders?/;
const FOLDER_LINE = /^(.+?)\/(?: (\(.*\)))?$/;

/** The parsed tree, or null when the text is not a recursive listing (an ordinary listing, an error, another tool). */
export function parseListing(text: string): ParsedListing | null {
  const lines = text.split('\n');
  const headerAt = lines.findIndex((line) => HEADER.test(line));
  if (headerAt < 0) return null;

  const notes = lines.slice(0, headerAt).filter((line) => line.trim() !== '');
  const root: TreeNode = { name: '.', detail: '', folders: [], files: [] };
  // stack[level] is the folder whose entries are printed at that level (root's entries are at level 1)
  const stack: TreeNode[] = [root, root];

  for (const line of lines.slice(headerAt + 1)) {
    if (line.trim() === '') continue;
    const indent = line.length - line.trimStart().length;
    if (indent === 0) {
      notes.push(line);
      continue;
    }
    const level = Math.floor(indent / 2);
    const parent = stack[level];
    if (!parent) return null;
    const content = line.trim();
    if (content.startsWith('files: ')) {
      parent.files.push(...content.slice('files: '.length).split(', '));
      continue;
    }
    const folder = FOLDER_LINE.exec(content);
    if (!folder) return null;
    const node: TreeNode = { name: folder[1], detail: folder[2] ?? '', folders: [], files: [] };
    parent.folders.push(node);
    stack.length = level + 1;
    stack[level + 1] = node;
  }
  return { header: lines[headerAt], root, notes };
}

/**
 * A listing the gateway already drew (list_directory with style "tree"): the header, the drawn lines as they are, and
 * the notes around them. Null when the text is not one.
 */
export function parseDrawn(text: string): ParsedListing | null {
  const lines = text.split('\n');
  const headerAt = lines.findIndex((line) => HEADER.test(line));
  if (headerAt < 0) return null;
  const rest = lines.slice(headerAt + 1);
  const isDrawn = (line: string) => /^[│ ]*[├└]── /.test(line);
  if (!rest.some(isDrawn)) return null;
  const notes = [...lines.slice(0, headerAt), ...rest.filter((line) => line.trim() !== '' && !isDrawn(line))].filter((line) => line.trim() !== '');
  return { header: lines[headerAt], root: { name: '.', detail: '', folders: [], files: [] }, notes, drawn: rest.filter(isDrawn) };
}

/** The tree as lines of box-drawing characters, folders before files, the way `tree` prints it. */
export function drawTree(root: TreeNode): string[] {
  const out: string[] = [];
  const walk = (folder: TreeNode, prefix: string) => {
    const entries: Array<{ label: string; folder?: TreeNode }> = [
      ...folder.folders.map((f) => ({ label: f.detail ? `${f.name}/  ${f.detail}` : `${f.name}/`, folder: f })),
      ...folder.files.map((name) => ({ label: name })),
    ];
    entries.forEach((entry, index) => {
      const last = index === entries.length - 1;
      out.push(`${prefix}${last ? '└── ' : '├── '}${entry.label}`);
      if (entry.folder) walk(entry.folder, prefix + (last ? '    ' : '│   '));
    });
  };
  walk(root, '');
  return out;
}
