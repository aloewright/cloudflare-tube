import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import { handleEncodingMessage } from './encoding';

type User = {
  email: string;
  sub: string;
  name?: string;
};

type EnvBindings = Record<string, unknown> & {
  VIDEOS: R2Bucket;
  DB: D1Database;
  CACHE: KVNamespace;
  SESSIONS: KVNamespace;
  RATE_LIMITER: DurableObjectNamespace;
  VIDEO_ENCODING: Queue;
};

type Variables = {
  user: User | null;
};

const listVideosQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

const uploadMetadataSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().max(5000).optional().default(''),
});

const app = new Hono<{ Bindings: EnvBindings; Variables: Variables }>();

export function decodeJwtPayload(token: string): User | null {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }

  try {
    const base64Payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const paddedPayload = `${base64Payload}${'='.repeat((4 - (base64Payload.length % 4)) % 4)}`;
    const json = atob(paddedPayload);
    const payload = JSON.parse(json) as {
      email?: string;
      sub?: string;
      name?: string;
    };
    if (!payload.email || !payload.sub) {
      return null;
    }
    return {
      email: payload.email,
      sub: payload.sub,
      name: payload.name,
    };
  } catch {
    return null;
  }
}

app.use('*', cors());

app.use('/api/*', async (c, next) => {
  const assertion = c.req.header('CF-Access-Jwt-Assertion');
  const user = assertion ? decodeJwtPayload(assertion) : null;
  c.set('user', user);
  await next();
});

app.get('/api/videos', async (c) => {
  const env = c.env as EnvBindings;
  const parsed = listVideosQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'Invalid query parameters', details: parsed.error.flatten() }, 400);
  }

  const { page, limit } = parsed.data;
  const offset = (page - 1) * limit;

  const { results } = await env.DB.prepare(
    `SELECT id, user_id, title, description, r2_key, stream_video_id, status, view_count, created_at, updated_at
     FROM videos
     WHERE deleted_at IS NULL
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
  )
    .bind(limit, offset)
    .all();

  return c.json({
    page,
    limit,
    videos: results,
  });
});

app.get('/api/videos/:id', async (c) => {
  const env = c.env as EnvBindings;
  const id = c.req.param('id');
  const video = await env.DB.prepare(
    `SELECT v.id, v.user_id, v.title, v.description, v.r2_key, v.stream_video_id, v.status, v.view_count, v.created_at, v.updated_at, u.username AS channel_name
     FROM videos v
     LEFT JOIN users u ON u.id = v.user_id
     WHERE v.id = ? AND v.deleted_at IS NULL`,
  )
    .bind(id)
    .first();

  if (!video) {
    return c.json({ error: 'Video not found' }, 404);
  }

  await env.DB.prepare('UPDATE videos SET view_count = view_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .bind(id)
    .run();

  await env.DB.prepare('INSERT INTO views (video_id, user_id, viewed_at) VALUES (?, ?, CURRENT_TIMESTAMP)')
    .bind(id, c.get('user')?.sub ?? null)
    .run();

  return c.json({
    ...video,
    view_count: Number(video.view_count ?? 0) + 1,
  });
});

app.post('/api/videos/upload', async (c) => {
  const env = c.env as EnvBindings;
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

  if (chunkCount === 1) {
    const videoId = crypto.randomUUID();
    const r2Key = `${user.sub}/${videoId}/${rawFile.name}`;

    await env.VIDEOS.put(r2Key, rawFile.stream(), {
      httpMetadata: {
        contentType: rawFile.type,
      },
    });

    await env.DB.prepare(
      `INSERT INTO videos (id, user_id, title, description, r2_key, status, view_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    )
      .bind(
        videoId,
        user.sub,
        metadataParsed.data.title,
        metadataParsed.data.description,
        r2Key,
        'uploaded',
      )
      .run();

    await env.VIDEO_ENCODING.send({
      videoId,
      r2Key,
    });

    return c.json({
      id: videoId,
      status: 'uploaded',
    }, 201);
  }

  if (!uploadId) {
    return c.json({ error: 'uploadId is required for chunked uploads' }, 400);
  }

  const baseKvKey = `upload:${user.sub}:${uploadId}`;
  const mpidKey = `${baseKvKey}:mpid`;
  const metaKey = `${baseKvKey}:meta`;
  const partsKey = `${baseKvKey}:parts`;

  if (chunkIndex === 0) {
    const videoId = crypto.randomUUID();
    const r2Key = `${user.sub}/${videoId}/${rawFile.name}`;
    const multipart = await env.VIDEOS.createMultipartUpload(r2Key, {
      httpMetadata: {
        contentType: rawFile.type,
      },
    });

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
    await env.SESSIONS.put(partsKey, JSON.stringify({}), { expirationTtl: 86400 });
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

  const multipart = env.VIDEOS.resumeMultipartUpload(uploadMeta.r2Key, multipartUploadId);
  const uploadedPart = await multipart.uploadPart(chunkIndex + 1, rawFile.stream());

  const uploadedPartsMap = partsJson ? (JSON.parse(partsJson) as Record<string, string>) : {};
  uploadedPartsMap[String(chunkIndex + 1)] = uploadedPart.etag;
  await env.SESSIONS.put(partsKey, JSON.stringify(uploadedPartsMap), { expirationTtl: 86400 });

  if (chunkIndex < chunkCount - 1) {
    return c.json({ status: 'chunk_received', chunkIndex, chunkCount }, 202);
  }

  const completedParts = Object.entries(uploadedPartsMap)
    .map(([partNumber, etag]) => ({
      partNumber: Number(partNumber),
      etag,
    }))
    .sort((a, b) => a.partNumber - b.partNumber);

  if (completedParts.length !== chunkCount) {
    return c.json({ error: 'Missing one or more chunks before completion' }, 400);
  }

  await multipart.complete(completedParts);

  await env.DB.prepare(
    `INSERT INTO videos (id, user_id, title, description, r2_key, status, view_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  )
    .bind(uploadMeta.videoId, user.sub, uploadMeta.title, uploadMeta.description, uploadMeta.r2Key, 'uploaded')
    .run();

  await env.VIDEO_ENCODING.send({
    videoId: uploadMeta.videoId,
    r2Key: uploadMeta.r2Key,
  });

  await Promise.all([env.SESSIONS.delete(mpidKey), env.SESSIONS.delete(metaKey), env.SESSIONS.delete(partsKey)]);

  return c.json({ id: uploadMeta.videoId, status: 'uploaded' }, 201);
});

app.delete('/api/videos/:id', async (c) => {
  const env = c.env as EnvBindings;
  const user = c.get('user');
  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const id = c.req.param('id');
  const video = await env.DB.prepare('SELECT id, user_id, r2_key FROM videos WHERE id = ? AND deleted_at IS NULL')
    .bind(id)
    .first<{ id: string; user_id: string; r2_key: string }>();

  if (!video) {
    return c.json({ error: 'Video not found' }, 404);
  }

  if (video.user_id !== user.sub) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  await env.DB.prepare('UPDATE videos SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .bind(id)
    .run();

  await env.VIDEOS.delete(video.r2_key);

  return c.json({ success: true });
});

export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<unknown>, env: EnvBindings): Promise<void> {
    for (const message of batch.messages) {
      try {
        await handleEncodingMessage(env, message.body);
        message.ack();
      } catch {
        message.retry();
      }
    }
  },
};
