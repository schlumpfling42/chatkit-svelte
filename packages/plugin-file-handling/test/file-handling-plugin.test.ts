import { describe, expect, it, vi } from 'vitest';
import { fileHandlingPlugin } from '../src/file-handling-plugin';

function makeFile(name: string, type: string, sizeBytes: number): File {
  return new File([new Uint8Array(sizeBytes)], name, { type });
}

describe('fileHandlingPlugin', () => {
  it('registers an attachmentHandler accepting images/pdf/text by default', () => {
    const upload = vi.fn(async () => ({ url: 'https://example.com/f' }));
    const plugin = fileHandlingPlugin({ upload });
    expect(plugin.attachmentHandlers).toHaveLength(1);
    expect(plugin.attachmentHandlers?.[0].accept).toEqual(['image/*', 'application/pdf', 'text/*']);
  });

  it('produces an image ContentPart for an image file', async () => {
    const upload = vi.fn(async () => ({ url: 'https://example.com/pic.png' }));
    const plugin = fileHandlingPlugin({ upload });
    const file = makeFile('pic.png', 'image/png', 100);

    const part = await plugin.attachmentHandlers![0].process(file, {});

    expect(part).toEqual({ type: 'image', url: 'https://example.com/pic.png', mimeType: 'image/png' });
    expect(upload).toHaveBeenCalledWith(file, undefined);
  });

  it('produces a file ContentPart for a non-image file', async () => {
    const upload = vi.fn(async () => ({ url: 'https://example.com/doc.pdf' }));
    const plugin = fileHandlingPlugin({ upload });
    const file = makeFile('doc.pdf', 'application/pdf', 2048);

    const part = await plugin.attachmentHandlers![0].process(file, {});

    expect(part).toEqual({
      type: 'file',
      url: 'https://example.com/doc.pdf',
      name: 'doc.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 2048,
    });
  });

  it('registers messageRenderers for both file and image content-part types', () => {
    const plugin = fileHandlingPlugin({ upload: vi.fn() });
    const partTypes = plugin.messageRenderers?.map((r) => r.partType);
    expect(partTypes).toEqual(expect.arrayContaining(['file', 'image']));
  });

  it('allows overriding accept and maxSizeBytes', () => {
    const plugin = fileHandlingPlugin({ upload: vi.fn(), accept: ['application/pdf'], maxSizeBytes: 1000 });
    expect(plugin.attachmentHandlers?.[0].accept).toEqual(['application/pdf']);
    expect(plugin.attachmentHandlers?.[0].maxSizeBytes).toBe(1000);
  });
});
