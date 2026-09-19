import { describe, expect, it } from 'vitest';
import { formatBytes, inferMimeType, matchesAccept } from './files';

describe('inferMimeType', () => {
  it('trusts the browser when it reports a real type', () => {
    expect(inferMimeType({ name: 'notes.txt', type: 'text/plain' })).toBe('text/plain');
    expect(inferMimeType({ name: 'photo.png', type: 'image/png' })).toBe('image/png');
    expect(inferMimeType({ name: 'config.json', type: 'application/json' })).toBe('application/json');
  });

  it('fills in a type for common text formats the OS leaves untyped', () => {
    expect(inferMimeType({ name: 'notes.md', type: '' })).toBe('text/markdown');
    expect(inferMimeType({ name: 'settings.yaml', type: '' })).toBe('application/yaml');
    expect(inferMimeType({ name: 'server.LOG', type: '' })).toBe('text/plain');
    expect(inferMimeType({ name: 'data.json', type: 'application/octet-stream' })).toBe('application/json');
  });

  it('overrides known-wrong guesses (Excel claiming .csv, Chrome reading .ts as video)', () => {
    expect(inferMimeType({ name: 'data.csv', type: 'application/vnd.ms-excel' })).toBe('text/csv');
    expect(inferMimeType({ name: 'app.ts', type: 'video/mp2t' })).toBe('text/plain');
  });

  it('does not override a specific type the browser gave for a different reason', () => {
    expect(inferMimeType({ name: 'sheet.csv', type: 'text/csv' })).toBe('text/csv');
    expect(inferMimeType({ name: 'archive.json', type: 'application/zip' })).toBe('application/zip');
  });

  it('leaves unknown extensions and files with no extension alone', () => {
    expect(inferMimeType({ name: 'report.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    expect(inferMimeType({ name: 'Makefile', type: '' })).toBe('');
    expect(inferMimeType({ name: 'mystery.xyz', type: '' })).toBe('');
  });
});

describe('matchesAccept', () => {
  it('matches exact types, families, and the wildcard', () => {
    expect(matchesAccept('application/pdf', ['application/pdf'])).toBe(true);
    expect(matchesAccept('image/png', ['image/*'])).toBe(true);
    expect(matchesAccept('anything/at-all', ['*/*'])).toBe(true);
    expect(matchesAccept('text/plain', ['image/*', 'application/pdf'])).toBe(false);
  });

  it('ignores case, and an empty type matches nothing but the wildcard', () => {
    expect(matchesAccept('Image/PNG', ['image/*'])).toBe(true);
    expect(matchesAccept('', ['text/*'])).toBe(false);
    expect(matchesAccept('', ['*/*'])).toBe(true);
  });
});

describe('formatBytes', () => {
  it('shows a size the way people read it', () => {
    expect(formatBytes(25 * 1024 * 1024)).toBe('25 MB');
    expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.5 MB');
    expect(formatBytes(512 * 1024)).toBe('512 KB');
    expect(formatBytes(100)).toBe('100 bytes');
  });
});
