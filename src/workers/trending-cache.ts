// Trending list is cached in KV with a 5-minute TTL keyed by limit. Without a
// versioning step, an upload or delete is invisible from /trending until the
// TTL elapses. KV has no prefix/pattern delete, so we use a bumpable version
// key (trending:version) as a soft cache buster: write paths increment it,
// read paths fold it into the cache key. Old entries become unreachable and
// expire on their own TTL.

const TRENDING_VERSION_KEY = 'trending:version';

export const TRENDING_CACHE_TTL_SECONDS = 300;

export function trendingCacheKey(version: number, limit: number): string {
  return `trending:v${version}:limit=${limit}`;
}

export async function getTrendingCacheVersion(cache: KVNamespace): Promise<number> {
  const raw = await cache.get(TRENDING_VERSION_KEY);
  if (!raw) return 1;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export async function bumpTrendingCacheVersion(cache: KVNamespace): Promise<number> {
  const current = await getTrendingCacheVersion(cache);
  const next = current + 1;
  await cache.put(TRENDING_VERSION_KEY, String(next));
  return next;
}
