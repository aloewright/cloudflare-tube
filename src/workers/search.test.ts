import { describe, expect, it } from 'vitest';
import { buildFtsQuery } from './search';

describe('buildFtsQuery', () => {
  it('returns null for empty or whitespace-only input', () => {
    expect(buildFtsQuery('')).toBeNull();
    expect(buildFtsQuery('   ')).toBeNull();
  });

  it('wraps tokens in quotes with prefix wildcard', () => {
    expect(buildFtsQuery('hello world')).toBe('"hello"* "world"*');
  });

  it('strips fts5 syntax characters from tokens', () => {
    expect(buildFtsQuery('hel"lo* world(ish)')).toBe('"hello"* "worldish"*');
    expect(buildFtsQuery('title:foo')).toBe('"titlefoo"*');
  });

  it('drops tokens that become empty after sanitisation', () => {
    expect(buildFtsQuery('"" hello')).toBe('"hello"*');
    expect(buildFtsQuery('***')).toBeNull();
  });

  it('caps token count to limit pathological inputs', () => {
    const huge = Array.from({ length: 30 }, (_, i) => `t${i}`).join(' ');
    const out = buildFtsQuery(huge);
    expect(out).not.toBeNull();
    expect(out?.split(' ')).toHaveLength(8);
  });
});
