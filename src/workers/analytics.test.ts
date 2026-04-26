import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildSessionCookie,
  dedupKey,
  ensureSessionId,
  readSessionCookie,
  shouldCountView,
} from './analytics';

describe('readSessionCookie', () => {
  it('returns null for missing/empty cookie headers', () => {
    expect(readSessionCookie(null)).toBeNull();
    expect(readSessionCookie('')).toBeNull();
    expect(readSessionCookie('foo=bar; baz=qux')).toBeNull();
  });

  it('extracts the session cookie value', () => {
    expect(readSessionCookie('spool_view_sid=abc')).toBe('abc');
    expect(readSessionCookie('foo=bar; spool_view_sid=xyz; baz=qux')).toBe('xyz');
  });

  it('returns null when the cookie is empty', () => {
    expect(readSessionCookie('spool_view_sid=')).toBeNull();
  });
});

describe('ensureSessionId', () => {
  it('returns the existing sid without a Set-Cookie header', () => {
    const { sid, setCookie } = ensureSessionId('spool_view_sid=existing-sid');
    expect(sid).toBe('existing-sid');
    expect(setCookie).toBeNull();
  });

  it('mints a new sid and Set-Cookie header when missing', () => {
    const { sid, setCookie } = ensureSessionId(null);
    expect(sid).toMatch(/^[0-9a-f-]{36}$/);
    expect(setCookie).toContain(`spool_view_sid=${sid}`);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
  });
});

describe('buildSessionCookie', () => {
  it('produces an http-only, secure-default cookie', () => {
    const cookie = buildSessionCookie('abc');
    expect(cookie).toBe(
      'spool_view_sid=abc; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly',
    );
  });
});

describe('dedupKey', () => {
  it('returns a stable namespaced key', () => {
    expect(dedupKey('vid1', 'sid1')).toBe('view:vid1:sid1');
  });
});

class FakeKV {
  store = new Map<string, { value: string; expiresAt: number }>();
  ttls: number[] = [];

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void> {
    if (opts?.expirationTtl) this.ttls.push(opts.expirationTtl);
    this.store.set(key, {
      value,
      expiresAt: Date.now() + (opts?.expirationTtl ?? 60) * 1000,
    });
  }
}

describe('shouldCountView', () => {
  let kv: FakeKV;
  beforeEach(() => {
    kv = new FakeKV();
  });

  it('returns true the first time and writes a marker with TTL', async () => {
    const fresh = await shouldCountView(kv as unknown as KVNamespace, 'vid', 'sid');
    expect(fresh).toBe(true);
    expect(kv.store.has('view:vid:sid')).toBe(true);
    expect(kv.ttls[0]).toBe(12 * 60 * 60);
  });

  it('returns false on subsequent calls within the TTL window', async () => {
    await shouldCountView(kv as unknown as KVNamespace, 'vid', 'sid');
    const second = await shouldCountView(kv as unknown as KVNamespace, 'vid', 'sid');
    expect(second).toBe(false);
  });

  it('treats different identities/videos independently', async () => {
    await shouldCountView(kv as unknown as KVNamespace, 'vid', 'sid');
    expect(await shouldCountView(kv as unknown as KVNamespace, 'vid', 'other')).toBe(true);
    expect(await shouldCountView(kv as unknown as KVNamespace, 'other', 'sid')).toBe(true);
  });
});
