import { describe, expect, it } from 'vitest';
import { parseRangeHeader } from './video-range';

describe('parseRangeHeader', () => {
  it('returns absent when no header', () => {
    expect(parseRangeHeader(null, 1000).kind).toBe('absent');
    expect(parseRangeHeader(undefined, 1000).kind).toBe('absent');
    expect(parseRangeHeader('', 1000).kind).toBe('absent');
  });

  it('parses bytes=0-99', () => {
    const result = parseRangeHeader('bytes=0-99', 1000);
    expect(result).toEqual({ kind: 'range', offset: 0, length: 100, start: 0, end: 99 });
  });

  it('parses open-ended bytes=500-', () => {
    const result = parseRangeHeader('bytes=500-', 1000);
    expect(result).toEqual({ kind: 'range', offset: 500, length: 500, start: 500, end: 999 });
  });

  it('parses suffix bytes=-200 (last 200)', () => {
    const result = parseRangeHeader('bytes=-200', 1000);
    expect(result).toEqual({ kind: 'range', offset: 800, length: 200, start: 800, end: 999 });
  });

  it('clamps end to totalSize-1', () => {
    const result = parseRangeHeader('bytes=0-9999', 1000);
    expect(result).toEqual({ kind: 'range', offset: 0, length: 1000, start: 0, end: 999 });
  });

  it('rejects ranges starting past EOF', () => {
    expect(parseRangeHeader('bytes=2000-', 1000).kind).toBe('invalid');
    expect(parseRangeHeader('bytes=1000-', 1000).kind).toBe('invalid');
  });

  it('rejects start > end', () => {
    expect(parseRangeHeader('bytes=500-100', 1000).kind).toBe('invalid');
  });

  it('rejects malformed headers', () => {
    expect(parseRangeHeader('lines=0-99', 1000).kind).toBe('invalid');
    expect(parseRangeHeader('bytes=', 1000).kind).toBe('invalid');
    expect(parseRangeHeader('bytes=abc-def', 1000).kind).toBe('invalid');
  });

  it('rejects bytes=-0 (zero-length suffix)', () => {
    expect(parseRangeHeader('bytes=-0', 1000).kind).toBe('invalid');
  });

  it('handles whitespace', () => {
    const result = parseRangeHeader('  bytes=0-9  ', 1000);
    expect(result).toEqual({ kind: 'range', offset: 0, length: 10, start: 0, end: 9 });
  });
});
