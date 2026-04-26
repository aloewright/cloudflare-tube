import { describe, expect, it } from 'vitest';
import { isLikelySpam } from './spam-filter';

describe('isLikelySpam', () => {
  it('allows normal comments', () => {
    expect(isLikelySpam('Great video, thanks for sharing!')).toEqual({ blocked: false });
    expect(isLikelySpam('check this http://example.com it was useful')).toEqual({
      blocked: false,
    });
  });

  it('blocks empty/whitespace bodies', () => {
    expect(isLikelySpam('')).toEqual({ blocked: true, reason: 'too_short' });
    expect(isLikelySpam('   ')).toEqual({ blocked: true, reason: 'too_short' });
  });

  it('blocks comments with more than three URLs', () => {
    const body = 'a http://x.com b https://y.com c http://z.com d https://q.com';
    expect(isLikelySpam(body)).toEqual({ blocked: true, reason: 'link_spam' });
  });

  it('blocks long ALL-CAPS shouting', () => {
    expect(isLikelySpam('THIS IS COMPLETELY UNACCEPTABLE BEHAVIOR FROM EVERYONE')).toEqual({
      blocked: true,
      reason: 'all_caps',
    });
  });

  it('allows short emphatic caps', () => {
    expect(isLikelySpam('LOL nice')).toEqual({ blocked: false });
  });

  it('blocks long character floods', () => {
    expect(isLikelySpam('aaaaaaaaaaaaaaaaaa')).toEqual({
      blocked: true,
      reason: 'repeat_chars',
    });
  });
});
