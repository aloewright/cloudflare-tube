import { describe, expect, it } from 'vitest';
import {
  TRENDING_CACHE_TTL_SECONDS,
  bumpTrendingCacheVersion,
  getTrendingCacheVersion,
  trendingCacheKey,
} from './trending-cache';

function makeFakeKV(initial: Record<string, string> = {}): KVNamespace {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
  } as unknown as KVNamespace;
}

describe('trendingCacheKey', () => {
  it('encodes both version and limit', () => {
    expect(trendingCacheKey(3, 12)).toBe('trending:v3:limit=12');
  });

  it('produces distinct keys for different versions', () => {
    expect(trendingCacheKey(1, 12)).not.toBe(trendingCacheKey(2, 12));
  });
});

describe('getTrendingCacheVersion', () => {
  it('returns 1 when the version key has never been written', async () => {
    const cache = makeFakeKV();
    expect(await getTrendingCacheVersion(cache)).toBe(1);
  });

  it('returns the parsed integer when the key holds a positive number', async () => {
    const cache = makeFakeKV({ 'trending:version': '7' });
    expect(await getTrendingCacheVersion(cache)).toBe(7);
  });

  it('falls back to 1 when the stored value is malformed', async () => {
    const cache = makeFakeKV({ 'trending:version': 'not-a-number' });
    expect(await getTrendingCacheVersion(cache)).toBe(1);
  });

  it('falls back to 1 when the stored value is non-positive', async () => {
    const cache = makeFakeKV({ 'trending:version': '0' });
    expect(await getTrendingCacheVersion(cache)).toBe(1);
  });
});

describe('bumpTrendingCacheVersion', () => {
  it('writes 2 the first time it runs and returns the new version', async () => {
    const cache = makeFakeKV();
    const next = await bumpTrendingCacheVersion(cache);
    expect(next).toBe(2);
    expect(await getTrendingCacheVersion(cache)).toBe(2);
  });

  it('monotonically increments on every call', async () => {
    const cache = makeFakeKV({ 'trending:version': '5' });
    expect(await bumpTrendingCacheVersion(cache)).toBe(6);
    expect(await bumpTrendingCacheVersion(cache)).toBe(7);
    expect(await getTrendingCacheVersion(cache)).toBe(7);
  });

  it('invalidates the prior cache key by emitting a new one', async () => {
    const cache = makeFakeKV();
    const before = await getTrendingCacheVersion(cache);
    await bumpTrendingCacheVersion(cache);
    const after = await getTrendingCacheVersion(cache);
    expect(trendingCacheKey(before, 12)).not.toBe(trendingCacheKey(after, 12));
  });
});

describe('TRENDING_CACHE_TTL_SECONDS', () => {
  it('matches the documented 5-minute window', () => {
    expect(TRENDING_CACHE_TTL_SECONDS).toBe(300);
  });
});
