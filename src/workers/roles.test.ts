import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { hasRole, isAdmin, listRolesForUser, rolesRoutes } from './roles';

interface RoleEntry {
  user_id: string;
  role: string;
  granted_by_user_id: string | null;
  created_at: string;
}

interface UserEntry {
  id: string;
  email: string;
}

interface FakeStore {
  users: Map<string, UserEntry>;
  roles: RoleEntry[];
}

function makeStore(): FakeStore {
  return {
    users: new Map<string, UserEntry>([
      ['u-admin', { id: 'u-admin', email: 'admin@spooool.com' }],
      ['u-other', { id: 'u-other', email: 'other@spooool.com' }],
      ['u-mod', { id: 'u-mod', email: 'mod@spooool.com' }],
    ]),
    roles: [],
  };
}

interface PreparedStmt {
  bind(...values: unknown[]): PreparedStmt;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<{ success: boolean }>;
}

function fakeDB(store: FakeStore): D1Database {
  const stmt = (sql: string): PreparedStmt => {
    let bound: unknown[] = [];
    const trimmed = sql.replace(/\s+/g, ' ').trim();
    const api: PreparedStmt = {
      bind(...v: unknown[]) {
        bound = v;
        return api;
      },
      async first<T>(): Promise<T | null> {
        if (trimmed.startsWith('SELECT 1 FROM user_roles WHERE user_id = ? AND role = ?')) {
          const found = store.roles.find((r) => r.user_id === bound[0] && r.role === bound[1]);
          return (found ? ({ '1': 1 } as T) : null);
        }
        if (trimmed.startsWith("SELECT 1 FROM user_roles WHERE role = 'admin' LIMIT 1")) {
          const found = store.roles.find((r) => r.role === 'admin');
          return (found ? ({ '1': 1 } as T) : null);
        }
        if (trimmed.startsWith('SELECT id, email FROM user WHERE email = ?')) {
          for (const u of store.users.values()) {
            if (u.email === bound[0]) return { id: u.id, email: u.email } as T;
          }
          return null;
        }
        if (trimmed.startsWith("SELECT COUNT(*) AS n FROM user_roles WHERE role = 'admin'")) {
          return { n: store.roles.filter((r) => r.role === 'admin').length } as T;
        }
        return null;
      },
      async all<T>(): Promise<{ results: T[] }> {
        if (trimmed.startsWith('SELECT user_id, role FROM user_roles WHERE user_id = ?')) {
          return {
            results: store.roles
              .filter((r) => r.user_id === bound[0])
              .map((r) => ({ user_id: r.user_id, role: r.role })) as T[],
          };
        }
        if (trimmed.startsWith('SELECT ur.user_id, ur.role')) {
          return {
            results: store.roles.map((r) => ({
              user_id: r.user_id,
              role: r.role,
              created_at: r.created_at,
              granted_by_user_id: r.granted_by_user_id,
              user_email: store.users.get(r.user_id)?.email ?? null,
              granted_by_email: r.granted_by_user_id
                ? store.users.get(r.granted_by_user_id)?.email ?? null
                : null,
            })) as T[],
          };
        }
        return { results: [] as T[] };
      },
      async run() {
        if (trimmed.startsWith('INSERT INTO user_roles')) {
          const exists = store.roles.find(
            (r) => r.user_id === bound[0] && r.role === bound[1],
          );
          if (!exists) {
            store.roles.push({
              user_id: bound[0] as string,
              role: bound[1] as string,
              granted_by_user_id: bound[2] as string,
              created_at: new Date().toISOString(),
            });
          }
        } else if (trimmed.startsWith('DELETE FROM user_roles WHERE user_id = ? AND role = ?')) {
          store.roles = store.roles.filter(
            (r) => !(r.user_id === bound[0] && r.role === bound[1]),
          );
        }
        return { success: true };
      },
    };
    return api;
  };
  return { prepare: (sql: string) => stmt(sql) } as unknown as D1Database;
}

const stubUser = { id: 'u-admin', email: 'admin@spooool.com', name: 'A' };

describe('isAdmin', () => {
  it('returns false for null users', async () => {
    const store = makeStore();
    expect(await isAdmin({ DB: fakeDB(store) }, null)).toBe(false);
  });

  it('returns true via the user_roles table', async () => {
    const store = makeStore();
    store.roles.push({
      user_id: 'u-admin',
      role: 'admin',
      granted_by_user_id: null,
      created_at: '2026-01-01',
    });
    expect(await isAdmin({ DB: fakeDB(store) }, stubUser)).toBe(true);
  });

  it('falls back to ADMIN_EMAILS only when the table has no admin row', async () => {
    const store = makeStore();
    expect(
      await isAdmin({ DB: fakeDB(store), ADMIN_EMAILS: 'admin@spooool.com' }, stubUser),
    ).toBe(true);
  });

  it('ignores ADMIN_EMAILS once at least one admin exists in the table', async () => {
    const store = makeStore();
    store.roles.push({
      user_id: 'u-other',
      role: 'admin',
      granted_by_user_id: null,
      created_at: '2026-01-01',
    });
    expect(
      await isAdmin({ DB: fakeDB(store), ADMIN_EMAILS: 'admin@spooool.com' }, stubUser),
    ).toBe(false);
  });

  it('returns false when bootstrap email does not match', async () => {
    const store = makeStore();
    expect(
      await isAdmin({ DB: fakeDB(store), ADMIN_EMAILS: 'someone@else.com' }, stubUser),
    ).toBe(false);
  });
});

describe('hasRole + listRolesForUser', () => {
  it('returns the roles a user has', async () => {
    const store = makeStore();
    store.roles.push(
      { user_id: 'u-mod', role: 'moderator', granted_by_user_id: 'u-admin', created_at: 'x' },
      { user_id: 'u-mod', role: 'admin', granted_by_user_id: 'u-admin', created_at: 'x' },
    );
    const env = { DB: fakeDB(store) };
    expect(await hasRole(env, 'u-mod', 'admin')).toBe(true);
    expect(await hasRole(env, 'u-mod', 'moderator')).toBe(true);
    expect(await hasRole(env, 'u-other', 'admin')).toBe(false);
    expect((await listRolesForUser(env, 'u-mod')).sort()).toEqual(['admin', 'moderator']);
  });
});

type RolesCtx = { Variables: { user: { id: string; email: string; name: string } | null } };

function adminApp(store: FakeStore, asUserId = 'u-admin') {
  const app = new Hono<RolesCtx>();
  app.use('*', async (c, next) => {
    const u = store.users.get(asUserId);
    c.set('user', u ? { id: u.id, email: u.email, name: 'A' } : null);
    await next();
  });
  app.route('/', rolesRoutes);
  return {
    async post(path: string, body: unknown) {
      return app.fetch(
        new Request(`http://t${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
        { DB: fakeDB(store), ADMIN_EMAILS: 'admin@spooool.com' } as never,
      );
    },
    async del(path: string) {
      return app.fetch(new Request(`http://t${path}`, { method: 'DELETE' }), {
        DB: fakeDB(store),
        ADMIN_EMAILS: 'admin@spooool.com',
      } as never);
    },
    async get(path: string) {
      return app.fetch(new Request(`http://t${path}`), {
        DB: fakeDB(store),
        ADMIN_EMAILS: 'admin@spooool.com',
      } as never);
    },
  };
}

describe('roles routes', () => {
  it('grants a role and returns it from list', async () => {
    const store = makeStore();
    const app = adminApp(store);
    const grant = await app.post('/api/admin/roles', {
      email: 'mod@spooool.com',
      role: 'moderator',
    });
    expect(grant.status).toBe(201);
    expect(store.roles.length).toBe(1);

    const list = await app.get('/api/admin/roles');
    expect(list.status).toBe(200);
    const data = (await list.json()) as { roles: { email: string; role: string }[] };
    expect(data.roles[0]?.email).toBe('mod@spooool.com');
    expect(data.roles[0]?.role).toBe('moderator');
  });

  it('grant is idempotent', async () => {
    const store = makeStore();
    const app = adminApp(store);
    await app.post('/api/admin/roles', { email: 'mod@spooool.com', role: 'admin' });
    await app.post('/api/admin/roles', { email: 'mod@spooool.com', role: 'admin' });
    expect(store.roles.length).toBe(1);
  });

  it('revoke removes the role', async () => {
    const store = makeStore();
    const app = adminApp(store);
    await app.post('/api/admin/roles', { email: 'mod@spooool.com', role: 'moderator' });
    const r = await app.del('/api/admin/roles?email=mod%40spooool.com&role=moderator');
    expect(r.status).toBe(200);
    expect(store.roles.length).toBe(0);
  });

  it('refuses to revoke the last admin from yourself', async () => {
    const store = makeStore();
    const app = adminApp(store);
    // Self-grant admin (bootstrap path lets the call through)
    await app.post('/api/admin/roles', { email: 'admin@spooool.com', role: 'admin' });
    const r = await app.del('/api/admin/roles?email=admin%40spooool.com&role=admin');
    expect(r.status).toBe(409);
    expect(store.roles.length).toBe(1);
  });

  it('rejects non-admins with 403', async () => {
    const store = makeStore();
    // Seed a different admin so bootstrap fallback is disabled
    store.roles.push({
      user_id: 'u-other',
      role: 'admin',
      granted_by_user_id: null,
      created_at: '2026-01-01',
    });
    const app = adminApp(store, 'u-mod');
    const r = await app.post('/api/admin/roles', { email: 'mod@spooool.com', role: 'admin' });
    expect(r.status).toBe(403);
  });

  it('returns 404 when granting to an unknown email', async () => {
    const store = makeStore();
    const app = adminApp(store);
    const r = await app.post('/api/admin/roles', { email: 'nobody@x.com', role: 'admin' });
    expect(r.status).toBe(404);
  });

  it('rejects invalid roles with 400', async () => {
    const store = makeStore();
    const app = adminApp(store);
    const r = await app.post('/api/admin/roles', { email: 'mod@spooool.com', role: 'superuser' });
    expect(r.status).toBe(400);
  });
});
