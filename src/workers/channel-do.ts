// ALO-156: ChannelSubscriberDO — one DO per channel user id. Serialises
// fan-out of new uploads so concurrent uploads from a single creator don't
// stampede the subscriptions table, and it's the right shape to later push
// real-time pub/sub notifications.

interface ChannelDOEnv {
  DB: D1Database;
}

interface FanOutPayload {
  videoId: string;
  channelUserId: string;
}

const FAN_OUT_BATCH_SIZE = 200;

export class ChannelSubscriberDO {
  private state: DurableObjectState;
  private env: ChannelDOEnv;

  constructor(state: DurableObjectState, env: ChannelDOEnv) {
    this.state = state;
    this.env = env;
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'POST' && url.pathname === '/fan-out') {
      const body = (await req.json().catch(() => null)) as FanOutPayload | null;
      if (!body || typeof body.videoId !== 'string' || typeof body.channelUserId !== 'string') {
        return new Response('bad request', { status: 400 });
      }
      const inserted = await this.fanOut(body);
      return Response.json({ inserted });
    }
    return new Response('not found', { status: 404 });
  }

  // Reads subscribers from D1 in pages and writes one inbox row per subscriber.
  // ON CONFLICT keeps fan-out idempotent in case the DO is invoked twice.
  private async fanOut({ videoId, channelUserId }: FanOutPayload): Promise<number> {
    return this.state.blockConcurrencyWhile(async () => {
      let cursor = '';
      let inserted = 0;

      // Page through subscribers using rowid-style pagination over a TEXT id.
      // We use lexicographic > on subscriber_user_id; the unique index on
      // subscriptions(subscriber_user_id) keeps this stable.
      while (true) {
        const { results } = await this.env.DB.prepare(
          `SELECT subscriber_user_id FROM subscriptions
           WHERE channel_user_id = ? AND subscriber_user_id > ?
           ORDER BY subscriber_user_id ASC
           LIMIT ?`,
        )
          .bind(channelUserId, cursor, FAN_OUT_BATCH_SIZE)
          .all<{ subscriber_user_id: string }>();

        const rows = results ?? [];
        if (rows.length === 0) break;

        const stmt = this.env.DB.prepare(
          `INSERT INTO subscription_inbox (subscriber_user_id, video_id, channel_user_id)
           VALUES (?, ?, ?)
           ON CONFLICT(subscriber_user_id, video_id) DO NOTHING`,
        );
        const batch = rows.map((r) => stmt.bind(r.subscriber_user_id, videoId, channelUserId));
        await this.env.DB.batch(batch);
        inserted += rows.length;
        cursor = rows[rows.length - 1].subscriber_user_id;

        if (rows.length < FAN_OUT_BATCH_SIZE) break;
      }
      return inserted;
    });
  }
}

interface SubscriberDOBinding {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}

// Best-effort fan-out trigger: any failure here just gets logged so it never
// blocks the upload response. The DO can later be re-triggered manually.
export async function triggerFanOut(
  ns: SubscriberDOBinding | undefined,
  payload: FanOutPayload,
): Promise<void> {
  if (!ns) return;
  try {
    const id = ns.idFromName(`channel:${payload.channelUserId}`);
    const stub = ns.get(id);
    await stub.fetch('https://channel-do/fan-out', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.warn('channel fan-out failed', {
      videoId: payload.videoId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
