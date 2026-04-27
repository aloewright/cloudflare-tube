import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { rumRoutes } from './rum';

interface CapturedPoint {
  blobs?: string[];
  doubles?: number[];
  indexes?: string[];
}

function buildApp(): {
  fetch: (path: string, init?: RequestInit) => Promise<Response>;
  points: CapturedPoint[];
} {
  const points: CapturedPoint[] = [];
  const env = {
    ANALYTICS: {
      writeDataPoint(point: CapturedPoint) {
        points.push(point);
      },
    },
  };
  const app = new Hono();
  app.route('/', rumRoutes);
  return {
    fetch: (path, init) =>
      app.fetch(new Request(`https://test.local${path}`, init), env),
    points,
  };
}

describe('POST /api/rum', () => {
  it('writes one Analytics Engine datapoint per valid metric', async () => {
    const { fetch, points } = buildApp();
    const res = await fetch('/api/rum', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-ipcountry': 'US' },
      body: JSON.stringify({
        name: 'LCP',
        value: 1234.5,
        delta: 1234.5,
        id: 'v1-1700000000000-1234',
        rating: 'good',
        navigationType: 'navigate',
        path: '/watch/abc',
      }),
    });
    expect(res.status).toBe(204);
    expect(points).toHaveLength(1);
    expect(points[0]?.indexes).toEqual(['LCP']);
    expect(points[0]?.blobs?.[0]).toBe('/watch/abc');
    expect(points[0]?.blobs?.[2]).toBe('US');
    expect(points[0]?.doubles).toEqual([1234.5, 1234.5]);
  });

  it('rejects unknown metric names', async () => {
    const { fetch, points } = buildApp();
    const res = await fetch('/api/rum', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'BANANA',
        value: 1,
        delta: 0,
        id: 'x',
        rating: 'good',
        path: '/',
      }),
    });
    expect(res.status).toBe(400);
    expect(points).toHaveLength(0);
  });

  it('rejects malformed JSON', async () => {
    const { fetch } = buildApp();
    const res = await fetch('/api/rum', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not-json',
    });
    expect(res.status).toBe(400);
  });

  it('caps numeric values to a sane upper bound', async () => {
    const { fetch, points } = buildApp();
    const res = await fetch('/api/rum', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'INP',
        value: 1_000_000_000,
        delta: 0,
        id: 'x',
        rating: 'poor',
        path: '/',
      }),
    });
    expect(res.status).toBe(400);
    expect(points).toHaveLength(0);
  });
});
