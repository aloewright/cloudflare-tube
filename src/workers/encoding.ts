import { z } from 'zod';

interface Env {
  DB: D1Database;
  STREAM_ENABLED?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CF_STREAM_API_TOKEN?: string;
}

const queueMessageSchema = z.object({
  videoId: z.string().min(1),
  r2Key: z.string().min(1),
});

async function updateStatus(env: Env, videoId: string, status: string, streamVideoId?: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE videos
     SET status = ?, stream_video_id = COALESCE(?, stream_video_id), updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  )
    .bind(status, streamVideoId ?? null, videoId)
    .run();
}

async function sendToStream(env: Env, r2Key: string): Promise<string> {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = env.CF_STREAM_API_TOKEN;
  if (!accountId || !apiToken) {
    throw new Error('Stream is enabled but missing account/token configuration');
  }

  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/stream`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: `r2://${r2Key}`,
      requireSignedURLs: false,
    }),
  });

  if (!response.ok) {
    throw new Error(`Stream API failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    result?: { uid?: string };
  };
  const streamId = data.result?.uid;
  if (!streamId) {
    throw new Error('Stream API response missing video uid');
  }
  return streamId;
}

export async function handleEncodingMessage(env: Env, body: unknown): Promise<void> {
  const parsed = queueMessageSchema.safeParse(body);
  if (!parsed.success) {
    return;
  }

  const { videoId, r2Key } = parsed.data;

  try {
    if (env.STREAM_ENABLED === 'true') {
      await updateStatus(env, videoId, 'encoding');
      const streamVideoId = await sendToStream(env, r2Key);
      await updateStatus(env, videoId, 'stream_submitted', streamVideoId);
      return;
    }

    await updateStatus(env, videoId, 'pending_encode');
  } catch {
    await updateStatus(env, videoId, 'encode_failed');
    throw new Error(`Encoding failed for video ${videoId}`);
  }
}
