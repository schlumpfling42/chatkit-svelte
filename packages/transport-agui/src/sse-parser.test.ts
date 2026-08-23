import { describe, expect, it } from 'vitest';
import { createSseFrameParser } from './sse-parser';

describe('createSseFrameParser', () => {
  it('parses a single complete event in one push', () => {
    const parser = createSseFrameParser();
    const frames = parser.push('data: {"hello":"world"}\n\n');
    expect(frames).toEqual([{ event: undefined, data: '{"hello":"world"}', id: undefined, retry: undefined }]);
  });

  it('buffers a chunk split mid-line and only dispatches once complete', () => {
    const parser = createSseFrameParser();
    expect(parser.push('data: {"hel')).toEqual([]);
    expect(parser.push('lo":"world"}\n')).toEqual([]);
    expect(parser.push('\n')).toEqual([{ event: undefined, data: '{"hello":"world"}', id: undefined, retry: undefined }]);
  });

  it('concatenates multiple data: lines with \\n', () => {
    const parser = createSseFrameParser();
    const frames = parser.push('data: line1\ndata: line2\n\n');
    expect(frames).toEqual([{ event: undefined, data: 'line1\nline2', id: undefined, retry: undefined }]);
  });

  it('ignores comment lines starting with ":"', () => {
    const parser = createSseFrameParser();
    const frames = parser.push(': this is a comment\ndata: payload\n\n');
    expect(frames).toEqual([{ event: undefined, data: 'payload', id: undefined, retry: undefined }]);
  });

  it('supports CRLF line endings', () => {
    const parser = createSseFrameParser();
    const frames = parser.push('data: payload\r\n\r\n');
    expect(frames).toEqual([{ event: undefined, data: 'payload', id: undefined, retry: undefined }]);
  });

  it('dispatches multiple events found in a single push', () => {
    const parser = createSseFrameParser();
    const frames = parser.push('data: first\n\ndata: second\n\n');
    expect(frames).toEqual([
      { event: undefined, data: 'first', id: undefined, retry: undefined },
      { event: undefined, data: 'second', id: undefined, retry: undefined },
    ]);
  });

  it('captures event, id, and retry fields', () => {
    const parser = createSseFrameParser();
    const frames = parser.push('event: custom\nid: 42\nretry: 3000\ndata: payload\n\n');
    expect(frames).toEqual([{ event: 'custom', data: 'payload', id: '42', retry: 3000 }]);
  });

  it('does not dispatch an incomplete trailing event with no blank line', () => {
    const parser = createSseFrameParser();
    const frames = parser.push('data: incomplete\n');
    expect(frames).toEqual([]);
  });

  it('does not dispatch a fully empty event (blank line with no fields)', () => {
    const parser = createSseFrameParser();
    const frames = parser.push('\n\n');
    expect(frames).toEqual([]);
  });
});
