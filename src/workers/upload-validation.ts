import { z } from 'zod';

// Cloudflare Stream accepts every format we list (and more); the gating signal
// is the file extension, not the MIME — browsers report inconsistent MIME types
// for the same file (e.g. .mov as video/quicktime on Safari, video/mp4 on some
// versions of Chrome, application/octet-stream when the OS has no handler).
export const ALLOWED_VIDEO_MIME_TYPES = new Set<string>([
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-matroska',
  'video/x-msvideo',
  'video/avi',
  'video/mpeg',
  'video/x-m4v',
  'video/3gpp',
  'video/3gpp2',
  'video/ogg',
  'video/x-flv',
  'video/mp2t',
]);

export const MAX_VIDEO_BYTES = 50 * 1024 * 1024 * 1024;
export const MAX_CHUNK_BYTES = 50 * 1024 * 1024;
// R2 multipart caps at 10,000 parts. Frontend uses 10MB chunks
// (CHUNK_SIZE in Upload.tsx), so 50GB / 10MB = 5,120 parts — well under.
// Keep this calculation in sync with CHUNK_SIZE on the frontend.
export const MAX_CHUNK_COUNT = Math.ceil(MAX_VIDEO_BYTES / (10 * 1024 * 1024));

const ALLOWED_EXTENSIONS = new Set<string>([
  'mp4',
  'm4v',
  'webm',
  'mov',
  'mkv',
  'avi',
  'mpeg',
  'mpg',
  'ogv',
  '3gp',
  'flv',
  'ts',
]);

export type UploadValidationError = {
  code:
    | 'mime_not_allowed'
    | 'extension_not_allowed'
    | 'file_too_large'
    | 'chunk_too_large'
    | 'chunk_count_invalid'
    | 'chunk_index_out_of_range'
    | 'empty_file';
  message: string;
};

function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot < 0 || dot === name.length - 1) {
    return '';
  }
  return name.slice(dot + 1).toLowerCase();
}

export function validateChunkShape(params: {
  chunkSize: number;
  chunkIndex: number;
  chunkCount: number;
}): UploadValidationError | null {
  if (params.chunkSize <= 0) {
    return { code: 'empty_file', message: 'Chunk is empty' };
  }
  if (params.chunkSize > MAX_CHUNK_BYTES) {
    return {
      code: 'chunk_too_large',
      message: `Chunk exceeds ${MAX_CHUNK_BYTES} bytes`,
    };
  }
  if (params.chunkCount < 1 || params.chunkCount > MAX_CHUNK_COUNT) {
    return {
      code: 'chunk_count_invalid',
      message: `chunkCount must be between 1 and ${MAX_CHUNK_COUNT}`,
    };
  }
  if (params.chunkIndex < 0 || params.chunkIndex >= params.chunkCount) {
    return {
      code: 'chunk_index_out_of_range',
      message: 'chunkIndex is out of range for chunkCount',
    };
  }
  return null;
}

const chunkMetadataSchema = z.object({
  uploadId: z.string().optional(),
  chunkIndex: z.coerce.number().int().min(0).default(0),
  chunkCount: z.coerce.number().int().positive().default(1),
});

export type ChunkMetadata = z.infer<typeof chunkMetadataSchema>;

export type ChunkMetadataParseResult =
  | { success: true; data: ChunkMetadata }
  | { success: false; error: z.ZodError };

// FormData.get returns `null` for missing keys; zod's .optional() only accepts
// `undefined`. This wrapper bridges that gap so single-chunk uploads (which
// omit uploadId) parse correctly. Regression coverage in upload-validation.test.ts.
export function parseChunkMetadataFromFormData(formData: FormData): ChunkMetadataParseResult {
  const result = chunkMetadataSchema.safeParse({
    uploadId: formData.get('uploadId') ?? undefined,
    chunkIndex: formData.get('chunkIndex') ?? '0',
    chunkCount: formData.get('chunkCount') ?? '1',
  });
  return result.success
    ? { success: true, data: result.data }
    : { success: false, error: result.error };
}

function isAcceptableMime(mime: string): boolean {
  if (!mime) return true; // Browser couldn't detect — defer to extension check.
  if (ALLOWED_VIDEO_MIME_TYPES.has(mime)) return true;
  if (mime.startsWith('video/')) return true;
  // Browsers report this for files the OS has no handler for (common with .mkv,
  // .ts, less common containers). Stream validates the actual bytes anyway.
  if (mime === 'application/octet-stream') return true;
  return false;
}

export function validateInitialFile(params: {
  fileName: string;
  mimeType: string;
  totalSize?: number;
}): UploadValidationError | null {
  const ext = fileExtension(params.fileName);
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return {
      code: 'extension_not_allowed',
      message: `Unsupported file extension: .${ext || 'unknown'}`,
    };
  }
  if (!isAcceptableMime(params.mimeType)) {
    return {
      code: 'mime_not_allowed',
      message: `Unsupported MIME type: ${params.mimeType || 'unknown'}`,
    };
  }
  if (typeof params.totalSize === 'number' && params.totalSize > MAX_VIDEO_BYTES) {
    return {
      code: 'file_too_large',
      message: `File exceeds ${MAX_VIDEO_BYTES} bytes`,
    };
  }
  return null;
}
