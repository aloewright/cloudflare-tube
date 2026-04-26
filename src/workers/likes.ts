import { Hono } from 'hono';

export interface LikesEnv {
  DB: D1Database;
  CACHE: KVNamespace;
}

type SessionUser = { id: string } | null;
type LikesVariables = { user: SessionUser };

const LIKES_CACHE_TTL_SECONDS = 300;

export function likeCountKey(videoId: string): string {
  return `likes:v1:${videoId}`;
}

async function getCachedCount(cache: KVNamespace, videoId: string): Promise<number | null> {
  const raw = await cache.get(likeCountKey(videoId));
  if (raw === null) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

async function readCount(db: D1Database, videoId: string): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS c FROM video_likes WHERE video_id = ?')
    .bind(videoId)
    .first<{ c: number }>();
  return Number(row?.c ?? 0);
}

async function setCachedCount(
  cache: KVNamespace,
  videoId: string,
  count: number,
): Promise<void> {
  await cache.put(likeCountKey(videoId), String(count), {
    expirationTtl: LIKES_CACHE_TTL_SECONDS,
  });
}

async function videoExists(db: D1Database, videoId: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 FROM videos WHERE id = ? AND deleted_at IS NULL')
    .bind(videoId)
    .first();
  return row !== null;
}

export const likeRoutes = new Hono<{
  Bindings: LikesEnv;
  Variables: LikesVariables;
}>();

likeRoutes.get('/api/videos/:id/like', async (c) => {
  const id = c.req.param('id');
  if (!(await videoExists(c.env.DB, id))) return c.json({ error: 'Video not found' }, 404);

  let count = await getCachedCount(c.env.CACHE, id);
  if (count === null) {
    count = await readCount(c.env.DB, id);
    await setCachedCount(c.env.CACHE, id, count);
  }

  const user = c.get('user');
  let liked = false;
  if (user) {
    const row = await c.env.DB.prepare(
      'SELECT 1 FROM video_likes WHERE video_id = ? AND user_id = ?',
    )
      .bind(id, user.id)
      .first();
    liked = row !== null;
  }
  return c.json({ likes: count, liked });
});

likeRoutes.post('/api/videos/:id/like', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const id = c.req.param('id');
  if (!(await videoExists(c.env.DB, id))) return c.json({ error: 'Video not found' }, 404);

  const existing = await c.env.DB.prepare(
    'SELECT 1 FROM video_likes WHERE video_id = ? AND user_id = ?',
  )
    .bind(id, user.id)
    .first();

  let liked: boolean;
  if (existing) {
    await c.env.DB.prepare('DELETE FROM video_likes WHERE video_id = ? AND user_id = ?')
      .bind(id, user.id)
      .run();
    liked = false;
  } else {
    await c.env.DB.prepare(
      'INSERT INTO video_likes (video_id, user_id) VALUES (?, ?)',
    )
      .bind(id, user.id)
      .run();
    liked = true;
  }

  // Recompute from D1 (cheaper than tracking deltas with concurrent writers)
  // and refresh the cache.
  const count = await readCount(c.env.DB, id);
  await setCachedCount(c.env.CACHE, id, count);

  return c.json({ likes: count, liked });
});
