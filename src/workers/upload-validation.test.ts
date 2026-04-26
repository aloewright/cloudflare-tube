import { describe, expect, it } from 'vitest';
import {
  MAX_CHUNK_BYTES,
  MAX_CHUNK_COUNT,
  MAX_VIDEO_BYTES,
  validateChunkShape,
  validateInitialFile,
} from './upload-validation';

describe('validateInitialFile', () => {
  it('accepts a normal mp4', () => {
    expect(
      validateInitialFile({ fileName: 'clip.mp4', mimeType: 'video/mp4', totalSize: 1024 }),
    ).toBeNull();
  });

  it('rejects unknown mime types', () => {
    const result = validateInitialFile({ fileName: 'clip.mp4', mimeType: 'image/png' });
    expect(result?.code).toBe('mime_not_allowed');
  });

  it('rejects mismatched extension', () => {
    const result = validateInitialFile({ fileName: 'clip.exe', mimeType: 'video/mp4' });
    expect(result?.code).toBe('extension_not_allowed');
  });

  it('rejects oversized files', () => {
    const result = validateInitialFile({
      fileName: 'big.mp4',
      mimeType: 'video/mp4',
      totalSize: MAX_VIDEO_BYTES + 1,
    });
    expect(result?.code).toBe('file_too_large');
  });

  it('accepts mkv, mov, webm', () => {
    expect(
      validateInitialFile({ fileName: 'a.mkv', mimeType: 'video/x-matroska' }),
    ).toBeNull();
    expect(validateInitialFile({ fileName: 'b.mov', mimeType: 'video/quicktime' })).toBeNull();
    expect(validateInitialFile({ fileName: 'c.webm', mimeType: 'video/webm' })).toBeNull();
  });
});

describe('validateChunkShape', () => {
  it('accepts a valid chunk', () => {
    expect(
      validateChunkShape({ chunkSize: 1024, chunkIndex: 0, chunkCount: 1 }),
    ).toBeNull();
  });

  it('rejects empty chunk', () => {
    expect(
      validateChunkShape({ chunkSize: 0, chunkIndex: 0, chunkCount: 1 })?.code,
    ).toBe('empty_file');
  });

  it('rejects oversized chunk', () => {
    expect(
      validateChunkShape({
        chunkSize: MAX_CHUNK_BYTES + 1,
        chunkIndex: 0,
        chunkCount: 1,
      })?.code,
    ).toBe('chunk_too_large');
  });

  it('rejects chunkCount over the cap', () => {
    expect(
      validateChunkShape({
        chunkSize: 1024,
        chunkIndex: 0,
        chunkCount: MAX_CHUNK_COUNT + 1,
      })?.code,
    ).toBe('chunk_count_invalid');
  });

  it('rejects chunkIndex out of range', () => {
    expect(
      validateChunkShape({ chunkSize: 1024, chunkIndex: 5, chunkCount: 3 })?.code,
    ).toBe('chunk_index_out_of_range');
  });
});
