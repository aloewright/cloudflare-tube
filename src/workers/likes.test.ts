import { describe, expect, it } from 'vitest';
import { likeCountKey } from './likes';

describe('likeCountKey', () => {
  it('namespaces likes by video id', () => {
    expect(likeCountKey('abc')).toBe('likes:v1:abc');
  });
});
