import { describe, expect, it } from 'vitest';
import { parseHlsMaster, pickVariantForBandwidth } from './hls-manifest';

const SAMPLE_MASTER = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=400000,RESOLUTION=426x240,CODECS="avc1.42e015,mp4a.40.2"
240p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=854x480,CODECS="avc1.4d401e,mp4a.40.2"
480p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2200000,RESOLUTION=1280x720,CODECS="avc1.4d401f,mp4a.40.2"
720p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=4500000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2"
1080p/index.m3u8
`;

describe('parseHlsMaster', () => {
  it('returns no variants for non-HLS input', () => {
    expect(parseHlsMaster('')).toEqual([]);
    expect(parseHlsMaster('not a manifest')).toEqual([]);
  });

  it('extracts every EXT-X-STREAM-INF entry with bandwidth/resolution/codecs', () => {
    const variants = parseHlsMaster(SAMPLE_MASTER);
    expect(variants).toHaveLength(4);
    expect(variants[0]).toEqual({
      bandwidth: 400000,
      resolution: { width: 426, height: 240 },
      codecs: 'avc1.42e015,mp4a.40.2',
      uri: '240p/index.m3u8',
    });
    expect(variants[3].resolution).toEqual({ width: 1920, height: 1080 });
  });

  it('confirms the manifest exposes multiple ABR variants (sanity check for ALO-142)', () => {
    // If Stream ever regresses to a single rendition, this test fails — we're
    // explicit about the contract our player relies on.
    const variants = parseHlsMaster(SAMPLE_MASTER);
    const bandwidths = variants.map((v) => v.bandwidth);
    expect(new Set(bandwidths).size).toBeGreaterThan(1);
    const sorted = [...bandwidths].sort((a, b) => a - b);
    expect(sorted).toEqual(bandwidths);
  });
});

describe('pickVariantForBandwidth (throttle simulation)', () => {
  const variants = parseHlsMaster(SAMPLE_MASTER);

  it('steps the variant down monotonically as the ceiling drops', () => {
    const heights = [10_000_000, 3_000_000, 1_500_000, 700_000, 250_000].map(
      (ceiling) => pickVariantForBandwidth(variants, ceiling)?.resolution?.height ?? null,
    );
    expect(heights).toEqual([1080, 720, 480, 240, 240]);
  });

  it('falls back to the lowest variant when nothing fits', () => {
    expect(pickVariantForBandwidth(variants, 100)?.resolution?.height).toBe(240);
  });

  it('returns null for empty variant lists', () => {
    expect(pickVariantForBandwidth([], 1000)).toBeNull();
  });
});
