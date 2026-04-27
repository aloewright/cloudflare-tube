import { describe, expect, it } from 'vitest';
import { isAdmin, parseAdminEmails, moderationRoutes } from './moderation';

const stubUser = { id: 'u1', email: 'admin@spooool.com', name: 'Admin' };

describe('parseAdminEmails', () => {
  it('parses comma-separated list and lowercases', () => {
    const set = parseAdminEmails(' Admin@spooool.com, Other@x.com ');
    expect(set.has('admin@spooool.com')).toBe(true);
    expect(set.has('other@x.com')).toBe(true);
  });

  it('returns empty set for missing/empty input', () => {
    expect(parseAdminEmails(undefined).size).toBe(0);
    expect(parseAdminEmails('').size).toBe(0);
    expect(parseAdminEmails('   ').size).toBe(0);
  });
});

describe('isAdmin', () => {
  it('rejects null users', () => {
    expect(isAdmin(null, 'admin@spooool.com')).toBe(false);
  });

  it('rejects users not on the list', () => {
    expect(isAdmin({ ...stubUser, email: 'nobody@x.com' }, 'admin@spooool.com')).toBe(false);
  });

  it('accepts users on the list (case-insensitive)', () => {
    expect(isAdmin({ ...stubUser, email: 'Admin@SPOOOOL.com' }, 'admin@spooool.com')).toBe(true);
    expect(isAdmin({ ...stubUser, email: 'admin@spooool.com' }, 'ADMIN@spooool.com')).toBe(true);
    expect(isAdmin({ ...stubUser, email: 'other@x.com' }, 'admin@spooool.com')).toBe(false);
  });

  it('rejects when the list is empty', () => {
    expect(isAdmin(stubUser, '')).toBe(false);
    expect(isAdmin(stubUser, undefined)).toBe(false);
  });
});

interface PreparedStmt {
  bind(...values: unknown[]): PreparedStmt;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<{ success: boolean }>;
}

interface FakeStore {
  videos: Map<string, { id: string; user_id: string; hidden_at: string | null }>;
  comments: Map<string, { id: string; user_id: string; deleted_at: string | null; body: string }>;
  reports: Map<
    string,
    {
      id: string;
      target_type: string;
      target_id: string;
      reason: string;
      status: string;
    }
  >;
  banned: Set<string>;
  actions: unknown[];
  cacheDeletes: string[];
}

function fakeDB(store: FakeStore): D1Database {
  const stmt = (sql: string): PreparedStmt => {
    let bound: unknown[] = [];
    const api: PreparedStmt = {
      bind(...values: unknown[]) {
        bound = values;
        return api;
      },
      async first<T>() {
        const trimmed = sql.trim();
        if (trimmed.startsWith('SELECT id, target_type, target_id, status FROM reports')) {
          const r = store.reports.get(bound[0] as string);
          return (r ?? null) as T | null;
        }
        if (trimmed.startsWith('SELECT user_id FROM videos WHERE id = ?')) {
          const v = store.videos.get(bound[0] as string);
          return (v ? { user_id: v.user_id } : null) as T | null;
        }
        if (trimmed.startsWith('SELECT user_id FROM comments WHERE id = ?')) {
          const c = store.comments.get(bound[0] as string);
          return (c ? { user_id: c.user_id } : null) as T | null;
        }
        return null;
      },
      async all<T>() {
        return { results: [] as T[] };
      },
      async run() {
        const trimmed = sql.trim();
        if (trimmed.startsWith('UPDATE videos SET hidden_at')) {
          const id = bound[2] as string;
          const v = store.videos.get(id);
          if (v) v.hidden_at = bound[0] as string;
        } else if (trimmed.startsWith('UPDATE comments SET deleted_at')) {
          const id = bound[2] as string;
          const c = store.comments.get(id);
          if (c) {
            c.deleted_at = bound[0] as string;
            c.body = '';
          }
        } else if (trimmed.startsWith('UPDATE user SET banned_at')) {
          store.banned.add(bound[1] as string);
        } else if (trimmed.startsWith('UPDATE reports SET status')) {
          for (const r of store.reports.values()) {
            if (r.target_type === bound[2] && r.target_id === bound[3]) {
              r.status = bound[0] as string;
            }
          }
        } else if (trimmed.startsWith('INSERT INTO moderation_actions')) {
          store.actions.push(bound);
        }
        return { success: true };
      },
    };
    return api;
  };
  return { prepare: (sql: string) => stmt(sql) } as unknown as D1Database;
}

function fakeCache(deletes: string[]): KVNamespace {
  return {
    delete: async (k: string) => {
      deletes.push(k);
    },
    get: async () => null,
    put: async () => {},
  } as unknown as KVNamespace;
}

function makeStore(): FakeStore {
  return {
    videos: new Map([['v1', { id: 'v1', user_id: 'owner1', hidden_at: null }]]),
    comments: new Map([['c1', { id: 'c1', user_id: 'owner2', deleted_at: null, body: 'hi' }]]),
    reports: new Map([
      ['r1', { id: 'r1', target_type: 'video', target_id: 'v1', reason: 'spam', status: 'open' }],
      ['r2', { id: 'r2', target_type: 'comment', target_id: 'c1', reason: 'abuse', status: 'open' }],
    ]),
    banned: new Set(),
    actions: [],
    cacheDeletes: [],
  };
}

// Wrap moderationRoutes in a tiny app that pre-sets `c.get('user')` so the
// decision endpoint sees an admin (or non-admin) caller without having to
// stand up the full auth middleware.
import { Hono } from 'hono';
type AdminCtx = { Variables: { user: { id: string; email: string; name: string } | null } };
function adminApp(store: FakeStore, email = 'admin@spooool.com') {
  const app = new Hono<AdminCtx>();
  app.use('*', async (c, next) => {
    c.set('user', { id: 'admin1', email, name: 'A' });
    await next();
  });
  app.route('/', moderationRoutes);
  return {
    async post(path: string, body: unknown) {
      return app.fetch(
        new Request(`http://t${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
        {
          DB: fakeDB(store),
          CACHE: fakeCache(store.cacheDeletes),
          ADMIN_EMAILS: 'admin@spooool.com',
        } as never,
      );
    },
    async get(path: string) {
      return app.fetch(new Request(`http://t${path}`), {
        DB: fakeDB(store),
        CACHE: fakeCache(store.cacheDeletes),
        ADMIN_EMAILS: 'admin@spooool.com',
      } as never);
    },
  };
}

describe('moderation decision endpoint', () => {
  it('hide on a video sets hidden_at, updates report status, busts cache, audit logs', async () => {
    const store = makeStore();
    const app = adminApp(store);
    const res = await app.post('/api/admin/moderation/r1/decision', { action: 'hide' });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { action: string; status: string };
    expect(data.action).toBe('hide');
    expect(data.status).toBe('actioned');
    expect(store.videos.get('v1')?.hidden_at).toBeTruthy();
    expect(store.reports.get('r1')?.status).toBe('actioned');
    expect(store.cacheDeletes).toContain('video:v1:v1');
    expect(store.actions.length).toBe(1);
  });

  it('hide on a comment marks it deleted', async () => {
    const store = makeStore();
    const app = adminApp(store);
    const res = await app.post('/api/admin/moderation/r2/decision', { action: 'hide' });
    expect(res.status).toBe(200);
    expect(store.comments.get('c1')?.deleted_at).toBeTruthy();
    expect(store.comments.get('c1')?.body).toBe('');
  });

  it('ban marks owner banned and hides the video', async () => {
    const store = makeStore();
    const app = adminApp(store);
    const res = await app.post('/api/admin/moderation/r1/decision', { action: 'ban' });
    expect(res.status).toBe(200);
    expect(store.banned.has('owner1')).toBe(true);
    expect(store.videos.get('v1')?.hidden_at).toBeTruthy();
  });

  it('dismiss does not modify target, sets report dismissed', async () => {
    const store = makeStore();
    const app = adminApp(store);
    const res = await app.post('/api/admin/moderation/r1/decision', { action: 'dismiss' });
    expect(res.status).toBe(200);
    expect(store.videos.get('v1')?.hidden_at).toBeNull();
    expect(store.reports.get('r1')?.status).toBe('dismissed');
  });

  it('approve does not modify target, sets report dismissed', async () => {
    const store = makeStore();
    const app = adminApp(store);
    const res = await app.post('/api/admin/moderation/r1/decision', { action: 'approve' });
    expect(res.status).toBe(200);
    expect(store.videos.get('v1')?.hidden_at).toBeNull();
    expect(store.reports.get('r1')?.status).toBe('dismissed');
  });

  it('returns 404 when report does not exist', async () => {
    const store = makeStore();
    const app = adminApp(store);
    const res = await app.post('/api/admin/moderation/missing/decision', { action: 'hide' });
    expect(res.status).toBe(404);
  });

  it('rejects non-admin callers with 403', async () => {
    const store = makeStore();
    const app = adminApp(store, 'random@user.com');
    const res = await app.post('/api/admin/moderation/r1/decision', { action: 'hide' });
    expect(res.status).toBe(403);
  });

  it('rejects invalid action with 400', async () => {
    const store = makeStore();
    const app = adminApp(store);
    const res = await app.post('/api/admin/moderation/r1/decision', { action: 'nuke' });
    expect(res.status).toBe(400);
  });
});

