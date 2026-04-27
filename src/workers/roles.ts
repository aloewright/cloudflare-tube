import { Hono } from 'hono';
import { z } from 'zod';
import { parseAdminEmails } from './moderation';

export type Role = 'admin' | 'moderator';
export const ROLES: readonly Role[] = ['admin', 'moderator'] as const;

export interface RolesEnv {
  DB: D1Database;
  ADMIN_EMAILS?: string;
}

type SessionUser = { id: string; email: string; name: string } | null;
type RolesVariables = { user: SessionUser };

interface RoleRow {
  user_id: string;
  role: string;
}

export async function listRolesForUser(env: RolesEnv, userId: string): Promise<Role[]> {
  const { results } = await env.DB.prepare(
    'SELECT user_id, role FROM user_roles WHERE user_id = ?',
  )
    .bind(userId)
    .all<RoleRow>();
  return (results ?? []).map((r) => r.role).filter((r): r is Role => ROLES.includes(r as Role));
}

export async function hasRole(env: RolesEnv, userId: string, role: Role): Promise<boolean> {
  const row = await env.DB.prepare(
    'SELECT 1 FROM user_roles WHERE user_id = ? AND role = ?',
  )
    .bind(userId, role)
    .first<{ '1': number } | null>();
  return row != null;
}

// Bootstrap fallback: if the user_roles table has no admins yet, the
// ADMIN_EMAILS env var still elevates anyone whose email matches. Once a
// real admin exists in the table, the env var becomes a no-op so a leaked
// or stale deploy can't grant access by editing config alone.
async function adminTableHasAny(env: RolesEnv): Promise<boolean> {
  const row = await env.DB.prepare(
    "SELECT 1 FROM user_roles WHERE role = 'admin' LIMIT 1",
  ).first<{ '1': number } | null>();
  return row != null;
}

export async function isAdmin(env: RolesEnv, user: SessionUser): Promise<boolean> {
  if (!user) return false;
  if (await hasRole(env, user.id, 'admin')) return true;

  const bootstrapped = await adminTableHasAny(env);
  if (bootstrapped) return false;

  const allow = parseAdminEmails(env.ADMIN_EMAILS);
  if (allow.size === 0) return false;
  return allow.has(user.email.toLowerCase());
}

export async function grantRole(
  env: RolesEnv,
  targetUserId: string,
  role: Role,
  grantedByUserId: string,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO user_roles (user_id, role, granted_by_user_id)
     VALUES (?, ?, ?)
     ON CONFLICT(user_id, role) DO NOTHING`,
  )
    .bind(targetUserId, role, grantedByUserId)
    .run();
}

export async function revokeRole(env: RolesEnv, targetUserId: string, role: Role): Promise<void> {
  await env.DB.prepare('DELETE FROM user_roles WHERE user_id = ? AND role = ?')
    .bind(targetUserId, role)
    .run();
}

const roleSchema = z.object({
  email: z.string().email().max(254),
  role: z.enum(['admin', 'moderator']),
});

const revokeQuerySchema = z.object({
  email: z.string().email().max(254),
  role: z.enum(['admin', 'moderator']),
});

interface UserLookupRow {
  id: string;
  email: string;
}

export const rolesRoutes = new Hono<{
  Bindings: RolesEnv;
  Variables: RolesVariables;
}>();

rolesRoutes.use('/api/admin/roles', async (c, next) => {
  const user = c.get('user');
  if (!(await isAdmin(c.env, user))) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  await next();
});

rolesRoutes.get('/api/admin/roles', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT ur.user_id, ur.role, ur.created_at, ur.granted_by_user_id,
            u.email AS user_email,
            grantor.email AS granted_by_email
     FROM user_roles ur
     LEFT JOIN user u ON u.id = ur.user_id
     LEFT JOIN user grantor ON grantor.id = ur.granted_by_user_id
     ORDER BY ur.created_at DESC`,
  ).all<{
    user_id: string;
    role: string;
    created_at: string;
    granted_by_user_id: string | null;
    user_email: string | null;
    granted_by_email: string | null;
  }>();
  return c.json({
    roles: (results ?? []).map((r) => ({
      userId: r.user_id,
      email: r.user_email,
      role: r.role,
      grantedAt: r.created_at,
      grantedBy: r.granted_by_email,
    })),
  });
});

rolesRoutes.post('/api/admin/roles', async (c) => {
  const admin = c.get('user');
  if (!admin) return c.json({ error: 'Unauthorized' }, 401);

  const json = await c.req.json().catch(() => null);
  const parsed = roleSchema.safeParse(json);
  if (!parsed.success) {
    return c.json({ error: 'Invalid role grant', details: parsed.error.flatten() }, 400);
  }
  const { email, role } = parsed.data;

  const target = await c.env.DB.prepare('SELECT id, email FROM user WHERE email = ?')
    .bind(email)
    .first<UserLookupRow>();
  if (!target) return c.json({ error: 'User not found' }, 404);

  await grantRole(c.env, target.id, role, admin.id);
  return c.json({ userId: target.id, email: target.email, role }, 201);
});

rolesRoutes.delete('/api/admin/roles', async (c) => {
  const admin = c.get('user');
  if (!admin) return c.json({ error: 'Unauthorized' }, 401);

  const parsed = revokeQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'Invalid role revoke', details: parsed.error.flatten() }, 400);
  }
  const { email, role } = parsed.data;

  const target = await c.env.DB.prepare('SELECT id, email FROM user WHERE email = ?')
    .bind(email)
    .first<UserLookupRow>();
  if (!target) return c.json({ error: 'User not found' }, 404);

  // Self-protection: don't let an admin paint themselves into a corner by
  // removing the only remaining admin role from the table.
  if (role === 'admin' && target.id === admin.id) {
    const remaining = await c.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM user_roles WHERE role = 'admin'",
    ).first<{ n: number }>();
    if ((remaining?.n ?? 0) <= 1) {
      return c.json({ error: 'Cannot revoke the last admin role from yourself' }, 409);
    }
  }

  await revokeRole(c.env, target.id, role);
  return c.json({ userId: target.id, email: target.email, role, revoked: true });
});
