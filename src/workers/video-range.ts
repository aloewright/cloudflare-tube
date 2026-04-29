// Parses an HTTP Range header into the offset/length form R2.get() expects.
// Spec: RFC 7233. We only support a single byte range — multipart Range is
// vanishingly rare for video and would force us to wrap multiple R2 reads.

export type ParsedRange =
  | { kind: 'range'; offset: number; length: number; start: number; end: number }
  | { kind: 'invalid' }
  | { kind: 'absent' };

export function parseRangeHeader(
  rangeHeader: string | null | undefined,
  totalSize: number,
): ParsedRange {
  if (!rangeHeader) return { kind: 'absent' };

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) return { kind: 'invalid' };

  const [, rawStart, rawEnd] = match;
  const hasStart = rawStart !== '';
  const hasEnd = rawEnd !== '';

  if (!hasStart && !hasEnd) return { kind: 'invalid' };

  let start: number;
  let end: number;

  if (!hasStart) {
    // Suffix form: "bytes=-N" → last N bytes.
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return { kind: 'invalid' };
    start = Math.max(0, totalSize - suffix);
    end = totalSize - 1;
  } else {
    start = Number(rawStart);
    if (!Number.isFinite(start) || start < 0) return { kind: 'invalid' };
    if (hasEnd) {
      end = Number(rawEnd);
      if (!Number.isFinite(end) || end < start) return { kind: 'invalid' };
      end = Math.min(end, totalSize - 1);
    } else {
      end = totalSize - 1;
    }
  }

  if (start >= totalSize) return { kind: 'invalid' };

  return {
    kind: 'range',
    offset: start,
    length: end - start + 1,
    start,
    end,
  };
}
