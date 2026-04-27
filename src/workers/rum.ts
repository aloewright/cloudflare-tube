import { Hono } from 'hono';
import { z } from 'zod';

interface AnalyticsEngineDataset {
  writeDataPoint(point: { blobs?: string[]; doubles?: number[]; indexes?: string[] }): void;
}

export interface RumEnv {
  ANALYTICS?: AnalyticsEngineDataset;
}

// Web Vitals values are bounded — caps protect Analytics Engine from runaway
// payloads if a client sends garbage. CLS is a unitless score; the rest are ms.
const rumPayloadSchema = z.object({
  name: z.enum(['CLS', 'FCP', 'INP', 'LCP', 'TTFB']),
  value: z.number().min(0).max(60_000),
  delta: z.number().min(-60_000).max(60_000),
  id: z.string().min(1).max(64),
  rating: z.enum(['good', 'needs-improvement', 'poor']),
  navigationType: z
    .enum(['navigate', 'reload', 'back-forward', 'back-forward-cache', 'prerender', 'restore'])
    .optional()
    .default('navigate'),
  path: z.string().min(1).max(512),
});

export const rumRoutes = new Hono<{ Bindings: RumEnv }>();

rumRoutes.post('/api/rum', async (c) => {
  let json: unknown;
  try {
    json = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const parsed = rumPayloadSchema.safeParse(json);
  if (!parsed.success) {
    return c.json({ error: 'Invalid RUM payload', details: parsed.error.flatten() }, 400);
  }

  const { name, value, delta, id, rating, navigationType, path } = parsed.data;
  const country = c.req.header('cf-ipcountry') ?? '';

  c.env.ANALYTICS?.writeDataPoint({
    indexes: [name],
    blobs: [path, navigationType, country, rating, id],
    doubles: [value, delta],
  });

  return c.body(null, 204);
});
