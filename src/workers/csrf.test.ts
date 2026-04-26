import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { csrfProtection, parseAllowedOrigins } from './csrf';

function buildApp(allowed: string[], exempt: string[] = []) {
  const app = new Hono();
  app.use('/api/*', csrfProtection({ allowedOrigins: allowed, exemptPaths: exempt }));
  app.all('/api/echo', (c) => c.json({ ok: true }));
  return app;
}

describe('parseAllowedOrigins', () => {
  it('splits and trims a comma list', () => {
    expect(parseAllowedOrigins('https://a.example, https://b.example,')).toEqual([
      'https://a.example',
      'https://b.example',
    ]);
  });
  it('returns [] for undefined', () => {
    expect(parseAllowedOrigins(undefined)).toEqual([]);
  });
});

describe('csrfProtection', () => {
  it('allows safe methods (GET/HEAD/OPTIONS) regardless of Origin', async () => {
    const app = buildApp(['https://spooool.app']);
    const res = await app.request('/api/echo', {
      method: 'GET',
      headers: { Origin: 'https://evil.example' },
    });
    expect(res.status).toBe(200);
  });

  it('allows POST when Origin matches the allow-list', async () => {
    const app = buildApp(['https://spooool.app']);
    const res = await app.request('/api/echo', {
      method: 'POST',
      headers: { Origin: 'https://spooool.app' },
    });
    expect(res.status).toBe(200);
  });

  it('allows POST when Origin matches the request origin (same-origin)', async () => {
    const app = buildApp([]);
    const res = await app.request('http://localhost/api/echo', {
      method: 'POST',
      headers: { Origin: 'http://localhost' },
    });
    expect(res.status).toBe(200);
  });

  it('rejects POST with a mismatched Origin', async () => {
    const app = buildApp(['https://spooool.app']);
    const res = await app.request('/api/echo', {
      method: 'POST',
      headers: { Origin: 'https://evil.example' },
    });
    expect(res.status).toBe(403);
  });

  it('rejects POST with no Origin and no Referer', async () => {
    const app = buildApp(['https://spooool.app']);
    const res = await app.request('/api/echo', { method: 'POST' });
    expect(res.status).toBe(403);
  });

  it('falls back to Referer when Origin is missing', async () => {
    const app = buildApp(['https://spooool.app']);
    const res = await app.request('/api/echo', {
      method: 'POST',
      headers: { Referer: 'https://spooool.app/upload' },
    });
    expect(res.status).toBe(200);
  });

  it('rejects PUT and DELETE with mismatched Origin', async () => {
    const app = buildApp(['https://spooool.app']);
    const put = await app.request('/api/echo', {
      method: 'PUT',
      headers: { Origin: 'https://evil.example' },
    });
    const del = await app.request('/api/echo', {
      method: 'DELETE',
      headers: { Origin: 'https://evil.example' },
    });
    expect(put.status).toBe(403);
    expect(del.status).toBe(403);
  });

  it('exempts wildcard paths', async () => {
    const app = new Hono();
    app.use(
      '/api/*',
      csrfProtection({
        allowedOrigins: ['https://spooool.app'],
        exemptPaths: ['/api/webhooks/*'],
      }),
    );
    app.post('/api/webhooks/stream', (c) => c.json({ ok: true }));
    const res = await app.request('/api/webhooks/stream', { method: 'POST' });
    expect(res.status).toBe(200);
  });
});
