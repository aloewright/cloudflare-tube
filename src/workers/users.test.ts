import { describe, expect, it } from 'vitest';
import { USERNAME_RE } from './users';

describe('USERNAME_RE', () => {
  it('accepts lowercase usernames with allowed characters', () => {
    expect(USERNAME_RE.test('alex')).toBe(true);
    expect(USERNAME_RE.test('alex_99')).toBe(true);
    expect(USERNAME_RE.test('alex-99')).toBe(true);
    expect(USERNAME_RE.test('a1')).toBe(true);
  });

  it('rejects too-short, too-long, or invalid usernames', () => {
    expect(USERNAME_RE.test('a')).toBe(false);
    expect(USERNAME_RE.test('a'.repeat(31))).toBe(false);
    expect(USERNAME_RE.test('Alex')).toBe(false);
    expect(USERNAME_RE.test('alex!')).toBe(false);
    expect(USERNAME_RE.test('-alex')).toBe(false);
    expect(USERNAME_RE.test('_alex')).toBe(false);
    expect(USERNAME_RE.test('')).toBe(false);
  });
});
