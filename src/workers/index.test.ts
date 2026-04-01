import { describe, expect, it } from 'vitest';
import { decodeJwtPayload } from './index';

function base64url(value: string): string {
  return Buffer.from(value).toString('base64url');
}

describe('decodeJwtPayload', () => {
  it('returns user for a valid JWT payload', () => {
    const header = base64url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
    const payload = base64url(JSON.stringify({ email: 'user@example.com', sub: 'user-123', name: 'User' }));
    const token = `${header}.${payload}.sig`;

    const user = decodeJwtPayload(token);

    expect(user).toEqual({
      email: 'user@example.com',
      sub: 'user-123',
      name: 'User',
    });
  });

  it('returns null for malformed token', () => {
    expect(decodeJwtPayload('bad-token')).toBeNull();
  });
});
