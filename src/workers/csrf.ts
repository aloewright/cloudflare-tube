import type { MiddlewareHandler } from 'hono';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface CsrfOptions {
  allowedOrigins: string[];
  exemptPaths?: string[];
}

export interface CsrfEnv {
  ALLOWED_ORIGINS?: string;
}

export function parseAllowedOrigins(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function isExempt(pathname: string, exemptPaths: string[]): boolean {
  for (const pattern of exemptPaths) {
    if (pattern.endsWith('/*')) {
      const prefix = pattern.slice(0, -2);
      if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return true;
    } else if (pathname === pattern) {
      return true;
    }
  }
  return false;
}

export const csrfProtection =
  (options: CsrfOptions): MiddlewareHandler =>
  async (c, next) => {
    if (!UNSAFE_METHODS.has(c.req.method)) {
      return next();
    }

    const url = new URL(c.req.url);
    if (options.exemptPaths && isExempt(url.pathname, options.exemptPaths)) {
      return next();
    }

    const sameOrigin = url.origin;
    const allowed = new Set([sameOrigin, ...options.allowedOrigins.map(normalizeOrigin).filter(
      (o): o is string => o !== null,
    )]);

    const originHeader = c.req.header('Origin');
    const referer = c.req.header('Referer');

    const candidates: (string | null)[] = [
      originHeader ? normalizeOrigin(originHeader) : null,
      referer ? normalizeOrigin(referer) : null,
    ];

    if (!originHeader && !referer) {
      return c.json({ error: 'CSRF: Origin or Referer header required' }, 403);
    }

    for (const candidate of candidates) {
      if (candidate && allowed.has(candidate)) {
        return next();
      }
    }

    return c.json({ error: 'CSRF: Origin not allowed' }, 403);
  };
