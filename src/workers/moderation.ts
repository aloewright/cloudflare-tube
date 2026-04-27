import { Hono } from 'hono';
import { z } from 'zod';

export interface ModerationEnv {
  DB: D1Database;
  CACHE: KVNamespace;
  ADMIN_EMAILS?: string;
}

type SessionUser = { id: string; email: string; name: string } | null;
type ModerationVariables = { user: SessionUser };

export function parseAdminEmails(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0),
  );
}

export function isAdmin(user: SessionUser, adminEmailsRaw: string | undefined): boolean {
  if (!user) return false;
  const allow = parseAdminEmails(adminEmailsRaw);
  if (allow.size === 0) return false;
  return allow.has(user.email.toLowerCase());
}

const reportSchema = z.object({
  targetType: z.enum(['video', 'comment']),
  targetId: z.string().min(1).max(64),
  reason: z.string().min(1).max(120),
  details: z.string().max(2000).optional().default(''),
});

const decisionSchema = z.object({
  action: z.enum(['approve', 'hide', 'ban', 'dismiss']),
  notes: z.string().max(2000).optional().default(''),
});

const listQuerySchema = z.object({
  status: z.enum(['open', 'actioned', 'dismissed', 'all']).default('open'),
  limit: z.coerce.number().int().positive().max(100).default(50),
  page: z.coerce.number().int().positive().default(1),
});

interface ReportAggRow {
  target_type: string;
  target_id: string;
  reason: string;
  status: string;
  count: number;
  first_seen: string;
  last_seen: string;
  latest_report_id: string;
  latest_reporter_id: string | null;
  latest_reporter_email: string | null;
  target_owner_id: string | null;
  target_title: string | null;
}

export const moderationRoutes = new Hono<{
  Bindings: ModerationEnv;
  Variables: ModerationVariables;
}>();

moderationRoutes.use('/api/admin/*', async (c, next) => {
  const user = c.get('user');
  if (!isAdmin(user, c.env.ADMIN_EMAILS)) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  await next();
});

moderationRoutes.post('/api/reports', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const json = await c.req.json().catch(() => null);
  const parsed = reportSchema.safeParse(json);
  if (!parsed.success) {
    return c.json({ error: 'Invalid report', details: parsed.error.flatten() }, 400);
  }
  const { targetType, targetId, reason, details } = parsed.data;

  const exists =
    targetType === 'video'
      ? await c.env.DB.prepare('SELECT 1 FROM videos WHERE id = ? AND deleted_at IS NULL')
          .bind(targetId)
          .first()
      : await c.env.DB.prepare('SELECT 1 FROM comments WHERE id = ? AND deleted_at IS NULL')
          .bind(targetId)
          .first();
  if (!exists) return c.json({ error: 'Target not found' }, 404);

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO reports (id, reporter_user_id, target_type, target_id, reason, details)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, user.id, targetType, targetId, reason, details)
    .run();
  return c.json({ id, status: 'open' }, 201);
});

moderationRoutes.get('/api/admin/moderation', async (c) => {
  const parsed = listQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'Invalid query', details: parsed.error.flatten() }, 400);
  }
  const { status, limit, page } = parsed.data;
  const offset = (page - 1) * limit;

  const where = status === 'all' ? '' : 'WHERE r.status = ?';
  const bindings: unknown[] = status === 'all' ? [] : [status];
  bindings.push(limit, offset);

  const sql = `
    SELECT
      r.target_type AS target_type,
      r.target_id AS target_id,
      MAX(r.reason) AS reason,
      MAX(r.status) AS status,
      COUNT(*) AS count,
      MIN(r.created_at) AS first_seen,
      MAX(r.updated_at) AS last_seen,
      (SELECT id FROM reports r2 WHERE r2.target_type = r.target_type AND r2.target_id = r.target_id ORDER BY r2.created_at DESC LIMIT 1) AS latest_report_id,
      (SELECT reporter_user_id FROM reports r2 WHERE r2.target_type = r.target_type AND r2.target_id = r.target_id ORDER BY r2.created_at DESC LIMIT 1) AS latest_reporter_id,
      (SELECT u.email FROM reports r2 LEFT JOIN user u ON u.id = r2.reporter_user_id WHERE r2.target_type = r.target_type AND r2.target_id = r.target_id ORDER BY r2.created_at DESC LIMIT 1) AS latest_reporter_email,
      CASE WHEN r.target_type = 'video' THEN (SELECT user_id FROM videos WHERE id = r.target_id) ELSE (SELECT user_id FROM comments WHERE id = r.target_id) END AS target_owner_id,
      CASE WHEN r.target_type = 'video' THEN (SELECT title FROM videos WHERE id = r.target_id) ELSE (SELECT body FROM comments WHERE id = r.target_id) END AS target_title
    FROM reports r
    ${where}
    GROUP BY r.target_type, r.target_id
    ORDER BY last_seen DESC
    LIMIT ? OFFSET ?
  `;

  const { results } = await c.env.DB.prepare(sql)
    .bind(...bindings)
    .all<ReportAggRow>();

  return c.json({
    page,
    limit,
    status,
    reports: (results ?? []).map((r) => ({
      latestReportId: r.latest_report_id,
      targetType: r.target_type,
      targetId: r.target_id,
      reason: r.reason,
      status: r.status,
      count: Number(r.count ?? 0),
      firstSeen: r.first_seen,
      lastSeen: r.last_seen,
      reporter: r.latest_reporter_email ?? null,
      targetOwnerId: r.target_owner_id ?? null,
      targetPreview: r.target_title ?? null,
    })),
  });
});

moderationRoutes.post('/api/admin/moderation/:reportId/decision', async (c) => {
  const admin = c.get('user');
  if (!admin) return c.json({ error: 'Unauthorized' }, 401);

  const reportId = c.req.param('reportId');
  const json = await c.req.json().catch(() => null);
  const parsed = decisionSchema.safeParse(json);
  if (!parsed.success) {
    return c.json({ error: 'Invalid decision', details: parsed.error.flatten() }, 400);
  }
  const { action, notes } = parsed.data;

  const report = await c.env.DB.prepare(
    'SELECT id, target_type, target_id, status FROM reports WHERE id = ?',
  )
    .bind(reportId)
    .first<{ id: string; target_type: string; target_id: string; status: string }>();
  if (!report) return c.json({ error: 'Report not found' }, 404);

  const now = new Date().toISOString();

  if (action === 'hide') {
    if (report.target_type === 'video') {
      await c.env.DB.prepare('UPDATE videos SET hidden_at = ?, updated_at = ? WHERE id = ?')
        .bind(now, now, report.target_id)
        .run();
      await c.env.CACHE.delete(`video:v1:${report.target_id}`);
    } else {
      await c.env.DB.prepare(
        `UPDATE comments SET deleted_at = ?, body = '', updated_at = ? WHERE id = ?`,
      )
        .bind(now, now, report.target_id)
        .run();
    }
  } else if (action === 'ban') {
    const ownerId =
      report.target_type === 'video'
        ? (
            await c.env.DB.prepare('SELECT user_id FROM videos WHERE id = ?')
              .bind(report.target_id)
              .first<{ user_id: string }>()
          )?.user_id
        : (
            await c.env.DB.prepare('SELECT user_id FROM comments WHERE id = ?')
              .bind(report.target_id)
              .first<{ user_id: string }>()
          )?.user_id;
    if (!ownerId) return c.json({ error: 'Cannot resolve target owner' }, 404);
    await c.env.DB.prepare('UPDATE user SET banned_at = ? WHERE id = ?')
      .bind(Date.now(), ownerId)
      .run();
    if (report.target_type === 'video') {
      await c.env.DB.prepare('UPDATE videos SET hidden_at = ?, updated_at = ? WHERE id = ?')
        .bind(now, now, report.target_id)
        .run();
      await c.env.CACHE.delete(`video:v1:${report.target_id}`);
    }
  }

  // approve and dismiss are no-ops on the target itself.
  const newStatus = action === 'approve' || action === 'dismiss' ? 'dismissed' : 'actioned';
  await c.env.DB.prepare(
    `UPDATE reports SET status = ?, updated_at = ?
     WHERE target_type = ? AND target_id = ?`,
  )
    .bind(newStatus, now, report.target_type, report.target_id)
    .run();

  const actionId = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO moderation_actions
       (id, report_id, admin_user_id, target_type, target_id, action, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(actionId, reportId, admin.id, report.target_type, report.target_id, action, notes)
    .run();

  return c.json({ id: actionId, action, status: newStatus });
});
