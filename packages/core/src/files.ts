/**
 * Helpers for deciding what to do with a file the user picked. Kept free of DOM types so the plugin-host
 * contract stays DOM-independent: they only need a name and a MIME type.
 */

/** Text-like formats by extension. Browsers report these inconsistently (or not at all), and the OS decides. */
const TYPE_BY_EXTENSION: Record<string, string> = {
  txt: 'text/plain',
  text: 'text/plain',
  log: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  json: 'application/json',
  xml: 'application/xml',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  toml: 'text/plain',
  ini: 'text/plain',
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  mjs: 'text/javascript',
  ts: 'text/plain',
  tsx: 'text/plain',
  py: 'text/plain',
  java: 'text/plain',
  kt: 'text/plain',
  go: 'text/plain',
  rs: 'text/plain',
  c: 'text/plain',
  h: 'text/plain',
  cpp: 'text/plain',
  sh: 'text/plain',
  sql: 'text/plain',
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

/** Types the browser reports that carry no real information about the file. */
const UNINFORMATIVE_TYPES = new Set(['', 'application/octet-stream']);

/** Known-wrong guesses: an extension whose usual OS association claims a different, unrelated type. */
const WRONG_GUESSES: Record<string, string[]> = {
  csv: ['application/vnd.ms-excel'], // Windows, when Excel owns .csv
  ts: ['video/mp2t'], // Chrome reads .ts as an MPEG transport stream
};

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

/**
 * The MIME type to treat a file as. The browser's own value is trusted unless it is empty or uninformative
 * (Windows reports no type for .md, .yaml, .log, ...) or a known-wrong guess for that extension.
 */
export function inferMimeType(file: { name: string; type: string }): string {
  const known = TYPE_BY_EXTENSION[extensionOf(file.name)];
  if (!known) return file.type;
  const reported = file.type.toLowerCase();
  if (UNINFORMATIVE_TYPES.has(reported) || (WRONG_GUESSES[extensionOf(file.name)] ?? []).includes(reported)) return known;
  return file.type;
}

/** Whether a MIME type is allowed by a list of patterns: exact (application/pdf), a family (image/ followed by a star), or the match-anything pattern. */
export function matchesAccept(mimeType: string, patterns: string[]): boolean {
  const type = mimeType.toLowerCase();
  return patterns.some((raw) => {
    const pattern = raw.toLowerCase();
    if (pattern === '*/*' || pattern === '*') return true;
    return pattern.endsWith('/*') ? type.startsWith(pattern.slice(0, -1)) : type === pattern;
  });
}

/** "25 MB", "512 KB": how a size limit is shown to people. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}
