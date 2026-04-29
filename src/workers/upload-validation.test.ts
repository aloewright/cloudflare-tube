import { describe, expect, it } from 'vitest';
import {
  ALLOWED_VIDEO_MIME_TYPES,
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

  it('accepts chunk at exactly MAX_CHUNK_BYTES', () => {
    expect(
      validateChunkShape({ chunkSize: MAX_CHUNK_BYTES, chunkIndex: 0, chunkCount: 1 }),
    ).toBeNull();
  });

  it('accepts last valid chunk index (MAX_CHUNK_COUNT - 1)', () => {
    expect(
      validateChunkShape({ chunkSize: 1024, chunkIndex: MAX_CHUNK_COUNT - 1, chunkCount: MAX_CHUNK_COUNT }),
    ).toBeNull();
  });

  it('accepts exactly MAX_CHUNK_COUNT chunks', () => {
    expect(
      validateChunkShape({ chunkSize: 1024, chunkIndex: 0, chunkCount: MAX_CHUNK_COUNT }),
    ).toBeNull();
  });

  it('rejects chunkCount of zero', () => {
    expect(
      validateChunkShape({ chunkSize: 1024, chunkIndex: 0, chunkCount: 0 })?.code,
    ).toBe('chunk_count_invalid');
  });

  it('rejects negative chunkIndex', () => {
    expect(
      validateChunkShape({ chunkSize: 1024, chunkIndex: -1, chunkCount: 1 })?.code,
    ).toBe('chunk_index_out_of_range');
  });
});

describe('upload constants (5GB/5MB limits)', () => {
  it('MAX_VIDEO_BYTES is 5GB', () => {
    expect(MAX_VIDEO_BYTES).toBe(5 * 1024 * 1024 * 1024);
  });

  it('MAX_CHUNK_BYTES is 50MB', () => {
    expect(MAX_CHUNK_BYTES).toBe(50 * 1024 * 1024);
  });

  it('MAX_CHUNK_COUNT matches 5GB / 5MB ceiling', () => {
    expect(MAX_CHUNK_COUNT).toBe(Math.ceil((5 * 1024 * 1024 * 1024) / (5 * 1024 * 1024)));
  });

  it('ALLOWED_VIDEO_MIME_TYPES contains exactly the four supported types', () => {
    expect(ALLOWED_VIDEO_MIME_TYPES.has('video/mp4')).toBe(true);
    expect(ALLOWED_VIDEO_MIME_TYPES.has('video/webm')).toBe(true);
    expect(ALLOWED_VIDEO_MIME_TYPES.has('video/quicktime')).toBe(true);
    expect(ALLOWED_VIDEO_MIME_TYPES.has('video/x-matroska')).toBe(true);
    expect(ALLOWED_VIDEO_MIME_TYPES.size).toBe(4);
  });
});

describe('validateInitialFile — stricter MIME enforcement', () => {
  // Previously-permissive types that are now rejected after the PR.
  it('rejects application/octet-stream (no longer a pass-through)', () => {
    expect(
      validateInitialFile({ fileName: 'clip.mp4', mimeType: 'application/octet-stream' })?.code,
    ).toBe('mime_not_allowed');
  });

  it('rejects empty MIME type', () => {
    expect(
      validateInitialFile({ fileName: 'clip.mp4', mimeType: '' })?.code,
    ).toBe('mime_not_allowed');
  });

  it('rejects generic video/* MIME types not in the allow-list', () => {
    expect(
      validateInitialFile({ fileName: 'clip.mp4', mimeType: 'video/x-some-codec' })?.code,
    ).toBe('mime_not_allowed');
  });

  it('rejects video/avi (removed from allow-list)', () => {
    expect(
      validateInitialFile({ fileName: 'clip.avi', mimeType: 'video/avi' })?.code,
    ).toBe('mime_not_allowed');
  });

  it('rejects video/mpeg (removed from allow-list)', () => {
    expect(
      validateInitialFile({ fileName: 'clip.mpeg', mimeType: 'video/mpeg' })?.code,
    ).toBe('mime_not_allowed');
  });

  // MIME check occurs before extension check — confirm error code priority.
  it('returns mime_not_allowed rather than extension_not_allowed when both would fail', () => {
    const result = validateInitialFile({ fileName: 'clip.exe', mimeType: 'image/png' });
    expect(result?.code).toBe('mime_not_allowed');
  });

  it('accepts file exactly at MAX_VIDEO_BYTES (boundary should pass)', () => {
    expect(
      validateInitialFile({ fileName: 'limit.mp4', mimeType: 'video/mp4', totalSize: MAX_VIDEO_BYTES }),
    ).toBeNull();
  });

  it('does not check size when totalSize is omitted', () => {
    // A very large implied size — no totalSize means no size gate.
    expect(
      validateInitialFile({ fileName: 'large.mp4', mimeType: 'video/mp4' }),
    ).toBeNull();
  });

  it('rejects extensions removed in this PR: .avi', () => {
    // video/x-msvideo is not in the MIME list so we need to check via the new
    // stricter MIME path; but let's also confirm that even with video/mp4 MIME
    // the extension gate catches it.
    // First, a real avi extension with a now-forbidden MIME will hit MIME gate.
    // Use video/mp4 MIME but .avi extension so we reach extension gate.
    expect(
      validateInitialFile({ fileName: 'clip.avi', mimeType: 'video/mp4' })?.code,
    ).toBe('extension_not_allowed');
  });

  it('rejects extension .ts (removed in this PR)', () => {
    expect(
      validateInitialFile({ fileName: 'clip.ts', mimeType: 'video/mp4' })?.code,
    ).toBe('extension_not_allowed');
  });

  it('rejects extension .flv (removed in this PR)', () => {
    expect(
      validateInitialFile({ fileName: 'clip.flv', mimeType: 'video/mp4' })?.code,
    ).toBe('extension_not_allowed');
  });

  it('rejects extension .m4v (removed in this PR)', () => {
    expect(
      validateInitialFile({ fileName: 'clip.m4v', mimeType: 'video/mp4' })?.code,
    ).toBe('extension_not_allowed');
  });

  it('rejects extension .3gp (removed in this PR)', () => {
    expect(
      validateInitialFile({ fileName: 'clip.3gp', mimeType: 'video/mp4' })?.code,
    ).toBe('extension_not_allowed');
  });

  it('rejects file with no extension', () => {
    expect(
      validateInitialFile({ fileName: 'videofile', mimeType: 'video/mp4' })?.code,
    ).toBe('extension_not_allowed');
  });
});
