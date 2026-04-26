import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import {
  analyticsRoutes,
  ensureSessionId,
  shouldCountView,
} from './analytics';
import { handleEncodingMessage } from './encoding';
import { createAuth, type AuthEnv } from '../auth';
import { channelRoutes } from './channels';
import { csrfProtection, parseAllowedOrigins } from './csrf';
import { likeRoutes } from './likes';
import { securityHeaders } from './security-headers';
import { searchRoutes } from './search';
import { handleStreamWebhook } from './stream-webhook';
import { thumbnailRoutes } from './thumbnails';
import { userRoutes } from './users';
import {
  MAX_VIDEO_BYTES,
  validateChunkShape,
  validateInitialFile,
} from './upload-validation';

type SessionUser = {
  id: string;
  email: string;
  name: string;
};

interface AnalyticsEngineDataset {
  writeDataPoint(point: { blobs?: string[]; doubles?: number[]; indexes?: string[] }): void;
}

type EnvBindings = AuthEnv & {
  VIDEOS: R2Bucket;
  DB: D1Database;
  CACHE: KVNamespace;
  SESSIONS: KVNamespace;
  RATE_LIMITER: DurableObjectNamespace;
  VIDEO_ENCODING: Queue;
  ANALYTICS?: AnalyticsEngineDataset;
  CF_STREAM_WEBHOOK_SECRET?: string;
  ALLOWED_ORIGINS?: string;
};

type Variables = {
  user: SessionUser | null;
};

const listVideosQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

const trendingQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(50).default(12),
});

const TRENDING_CACHE_TTL_SECONDS = 300;

const uploadMetadataSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().max(5000).optional().default(''),
});

const app = new Hono<{ Bindings: EnvBindings; Variables: Variables }>();

app.use('*', securityHeaders());
app.use('*', cors({ origin: (origin) => origin, credentials: true }));

app.use('/api/*', async (c, next) => {
  const allowedOrigins = parseAllowedOrigins(c.env.ALLOWED_ORIGINS);
  return csrfProtection({
    allowedOrigins,
    exemptPaths: ['/api/webhooks/*'],
  })(c, next);
});

app.post('/api/webhooks/stream', handleStreamWebhook());

app.all('/api/auth/*', async (c) => {
  const auth = createAuth(c.env);
  return auth.handler(c.req.raw);
});

app.use('/api/*', async (c, next) => {
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  c.set('user', session ? (session.user as SessionUser) : null);
  await next();
});

app.route('/', thumbnailRoutes);
app.route('/', userRoutes);
app.route('/', channelRoutes);
app.route('/', searchRoutes);
app.route('/', likeRoutes);
app.route('/', analyticsRoutes);

app.get('/api/videos/trending', async (c) => {
  const parsed = trendingQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'Invalid query parameters', details: parsed.error.flatten() }, 400);
  }

  const { limit } = parsed.data;
  const cacheKey = `trending:v1:limit=${limit}`;

  const cached = await c.env.CACHE.get(cacheKey, 'json');
  if (cached) {
    return c.json({ limit, videos: cached, cached: true });
  }

  const { results } = await c.env.DB.prepare(
    `SELECT v.id, v.user_id, v.title, v.description, v.stream_video_id, v.view_count,
            v.created_at, u.name AS channel_name,
            COUNT(views.id) AS recent_views
     FROM videos v
     LEFT JOIN user u ON u.id = v.user_id
     LEFT JOIN views ON views.video_id = v.id
       AND views.viewed_at >= datetime('now', '-7 days')
     WHERE v.deleted_at IS NULL
     GROUP BY v.id
     ORDER BY recent_views DESC, v.view_count DESC, v.created_at DESC
     LIMIT ?`,
  )
    .bind(limit)
    .all();

  await c.env.CACHE.put(cacheKey, JSON.stringify(results), {
    expirationTtl: TRENDING_CACHE_TTL_SECONDS,
  });

  return c.json({ limit, videos: results, cached: false });
});

app.get('/api/videos', async (c) => {
  const parsed = listVideosQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'Invalid query parameters', details: parsed.error.flatten() }, 400);
  }

  const { page, limit } = parsed.data;
  const offset = (page - 1) * limit;

  const { results } = await c.env.DB.prepare(
    `SELECT id, user_id, title, description, r2_key, stream_video_id, status, view_count, created_at, updated_at
     FROM videos
     WHERE deleted_at IS NULL
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
  )
    .bind(limit, offset)
    .all();

  return c.json({ page, limit, videos: results });
});

app.get('/api/videos/:id', async (c) => {
  const id = c.req.param('id');
  const video = await c.env.DB.prepare(
    `SELECT v.id, v.user_id, v.title, v.description, v.r2_key, v.stream_video_id, v.status, v.view_count, v.created_at, v.updated_at, u.name AS channel_name
     FROM videos v
     LEFT JOIN user u ON u.id = v.user_id
     WHERE v.id = ? AND v.deleted_at IS NULL`,
  )
    .bind(id)
    .first();

  if (!video) {
    return c.json({ error: 'Video not found' }, 404);
  }

  const user = c.get('user');
  const { sid, setCookie } = ensureSessionId(c.req.header('cookie') ?? null);
  // Dedup by user id when authenticated, else by anon session id, so opening
  // the same tab twice in 12h doesn't double-count.
  const identity = user ? `u:${user.id}` : `s:${sid}`;
  const fresh = await shouldCountView(c.env.CACHE, id, identity);

  let viewCount = Number(video.view_count ?? 0);
  if (fresh) {
    await c.env.DB.prepare('UPDATE videos SET view_count = view_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(id)
      .run();
    await c.env.DB.prepare('INSERT INTO views (video_id, user_id, viewed_at) VALUES (?, ?, CURRENT_TIMESTAMP)')
      .bind(id, user?.id ?? null)
      .run();
    viewCount += 1;

    c.env.ANALYTICS?.writeDataPoint({
      indexes: [id],
      blobs: ['view', user?.id ?? '', sid],
      doubles: [1],
    });
  }

  if (setCookie) c.header('Set-Cookie', setCookie, { append: true });

  return c.json({
    ...video,
    view_count: viewCount,
  });
});

app.post('/api/videos/upload', async (c) => {
  const env = c.env;
  const user = c.get('user');
  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const formData = await c.req.formData();
  const rawTitle = formData.get('title');
  const rawDescription = formData.get('description');
  const rawFile = formData.get('file');

  const metadataParsed = uploadMetadataSchema.safeParse({
    title: rawTitle,
    description: rawDescription ?? '',
  });

  if (!metadataParsed.success) {
    return c.json({ error: 'Invalid upload metadata', details: metadataParsed.error.flatten() }, 400);
  }

  if (!(rawFile instanceof File)) {
    return c.json({ error: 'File is required' }, 400);
  }

  const chunkSchema = z.object({
    uploadId: z.string().optional(),
    chunkIndex: z.coerce.number().int().min(0).default(0),
    chunkCount: z.coerce.number().int().positive().default(1),
  });

  const chunkParsed = chunkSchema.safeParse({
    uploadId: formData.get('uploadId'),
    chunkIndex: formData.get('chunkIndex') ?? '0',
    chunkCount: formData.get('chunkCount') ?? '1',
  });

  if (!chunkParsed.success) {
    return c.json({ error: 'Invalid chunk metadata', details: chunkParsed.error.flatten() }, 400);
  }

  const { uploadId, chunkIndex, chunkCount } = chunkParsed.data;

  const chunkError = validateChunkShape({
    chunkSize: rawFile.size,
    chunkIndex,
    chunkCount,
  });
  if (chunkError) {
    return c.json({ error: chunkError.message, code: chunkError.code }, 400);
  }

  if (chunkIndex === 0) {
    const initialError = validateInitialFile({
      fileName: rawFile.name,
      mimeType: rawFile.type,
      totalSize: chunkCount === 1 ? rawFile.size : undefined,
    });
    if (initialError) {
      return c.json({ error: initialError.message, code: initialError.code }, 400);
    }
  }

  if (chunkCount === 1) {
    const videoId = crypto.randomUUID();
    const r2Key = `${user.id}/${videoId}/${rawFile.name}`;

    await env.VIDEOS.put(r2Key, rawFile.stream(), {
      httpMetadata: { contentType: rawFile.type },
    });

    await env.DB.prepare(
      `INSERT INTO videos (id, user_id, title, description, r2_key, status, view_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    )
      .bind(videoId, user.id, metadataParsed.data.title, metadataParsed.data.description, r2Key, 'uploaded')
      .run();

    await env.VIDEO_ENCODING.send({ videoId, r2Key });

    return c.json({ id: videoId, status: 'uploaded' }, 201);
  }

  const resolvedUploadId = uploadId ?? crypto.randomUUID();

  const baseKvKey = `upload:${user.id}:${resolvedUploadId}`;
  const mpidKey = `${baseKvKey}:mpid`;
  const metaKey = `${baseKvKey}:meta`;
  const partsKey = `${baseKvKey}:parts`;

  if (chunkIndex === 0) {
    const videoId = crypto.randomUUID();
    const r2Key = `${user.id}/${videoId}/${rawFile.name}`;
    const multipart = await env.VIDEOS.createMultipartUpload(r2Key, {
      httpMetadata: { contentType: rawFile.type },
    });

    const firstPart = await multipart.uploadPart(1, rawFile.stream());

    await env.SESSIONS.put(mpidKey, multipart.uploadId, { expirationTtl: 86400 });
    await env.SESSIONS.put(
      metaKey,
      JSON.stringify({
        videoId,
        r2Key,
        title: metadataParsed.data.title,
        description: metadataParsed.data.description,
        chunkCount,
      }),
      { expirationTtl: 86400 },
    );
    await env.SESSIONS.put(
      partsKey,
      JSON.stringify({ '1': { etag: firstPart.etag, size: rawFile.size } } as Record<
        string,
        { etag: string; size: number }
      >),
      { expirationTtl: 86400 },
    );
    return c.json({ status: 'chunk_received', chunkIndex, chunkCount, uploadId: resolvedUploadId }, 202);
  }

  const [multipartUploadId, uploadMetaJson, partsJson] = await Promise.all([
    env.SESSIONS.get(mpidKey),
    env.SESSIONS.get(metaKey),
    env.SESSIONS.get(partsKey),
  ]);

  if (!multipartUploadId || !uploadMetaJson) {
    return c.json({ error: 'Missing upload session. Start with chunkIndex=0.' }, 400);
  }

  const uploadMeta = z
    .object({
      videoId: z.string(),
      r2Key: z.string(),
      title: z.string(),
      description: z.string(),
      chunkCount: z.number().int().positive(),
    })
    .parse(JSON.parse(uploadMetaJson));

  const uploadedPartsMap = partsJson
    ? (JSON.parse(partsJson) as Record<string, { etag: string; size: number }>)
    : {};

  const priorBytes = Object.values(uploadedPartsMap).reduce((sum, part) => sum + part.size, 0);
  if (priorBytes + rawFile.size > MAX_VIDEO_BYTES) {
    return c.json(
      { error: `Upload exceeds ${MAX_VIDEO_BYTES} bytes`, code: 'file_too_large' },
      400,
    );
  }

  const multipart = env.VIDEOS.resumeMultipartUpload(uploadMeta.r2Key, multipartUploadId);
  const uploadedPart = await multipart.uploadPart(chunkIndex + 1, rawFile.stream());

  uploadedPartsMap[String(chunkIndex + 1)] = { etag: uploadedPart.etag, size: rawFile.size };
  await env.SESSIONS.put(partsKey, JSON.stringify(uploadedPartsMap), { expirationTtl: 86400 });

  if (chunkIndex < chunkCount - 1) {
    return c.json({ status: 'chunk_received', chunkIndex, chunkCount }, 202);
  }

  const completedParts = Object.entries(uploadedPartsMap)
    .map(([partNumber, part]) => ({ partNumber: Number(partNumber), etag: part.etag }))
    .sort((a, b) => a.partNumber - b.partNumber);

  if (completedParts.length !== chunkCount) {
    return c.json({ error: 'Missing one or more chunks before completion' }, 400);
  }

  await multipart.complete(completedParts);

  await env.DB.prepare(
    `INSERT INTO videos (id, user_id, title, description, r2_key, status, view_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  )
    .bind(uploadMeta.videoId, user.id, uploadMeta.title, uploadMeta.description, uploadMeta.r2Key, 'uploaded')
    .run();

  await env.VIDEO_ENCODING.send({ videoId: uploadMeta.videoId, r2Key: uploadMeta.r2Key });

  await Promise.all([env.SESSIONS.delete(mpidKey), env.SESSIONS.delete(metaKey), env.SESSIONS.delete(partsKey)]);

  return c.json({ id: uploadMeta.videoId, status: 'uploaded' }, 201);
});

app.delete('/api/videos/:id', async (c) => {
  const user = c.get('user');
  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const id = c.req.param('id');
  const video = await c.env.DB.prepare('SELECT id, user_id, r2_key FROM videos WHERE id = ? AND deleted_at IS NULL')
    .bind(id)
    .first<{ id: string; user_id: string; r2_key: string }>();

  if (!video) {
    return c.json({ error: 'Video not found' }, 404);
  }

  if (video.user_id !== user.id) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  await c.env.DB.prepare('UPDATE videos SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .bind(id)
    .run();

  await c.env.VIDEOS.delete(video.r2_key);

  return c.json({ success: true });
});

export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<unknown>, env: EnvBindings): Promise<void> {
    for (const message of batch.messages) {
      try {
        await handleEncodingMessage(env, message.body);
        message.ack();
      } catch (error) {
        console.error('video-encoding queue message failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        message.retry();
      }
    }
  },
};
