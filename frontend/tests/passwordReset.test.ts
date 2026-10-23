import { describe, expect, it, vi } from 'vitest';
import { requestPasswordReset, confirmPasswordReset } from '../src/lib/passwordReset';
import { apiRoutes, stalledRoute } from './fakeApi';

describe('password reset HTTP boundary', () => {
  it('posts only the accepted fields, trims email and preserves the new password', async () => {
    const api = apiRoutes({
      '/api/auth/password-reset/request': () => new Response(null, { status: 202 }),
      '/api/auth/password-reset/confirm': () => new Response(null, { status: 204 }),
    });
    await requestPasswordReset(' sana@example.test ', { fetch: api.fetch });
    await confirmPasswordReset({ email: ' sana@example.test ', code: '123456', newPassword: ' pass word ' }, { fetch: api.fetch });
    expect(api.paths()).toEqual(['/api/auth/password-reset/request', '/api/auth/password-reset/confirm']);
    expect(await api.requests[0].json()).toEqual({ email: 'sana@example.test' });
    expect(await api.requests[1].json()).toEqual({ email: 'sana@example.test', code: '123456', newPassword: ' pass word ' });
    for (const request of api.requests) {
      expect(request.method).toBe('POST');
      expect(request.headers.get('Content-Type')).toBe('application/json');
      expect(request.headers.has('Authorization')).toBe(false);
      expect(request.cache).toBe('no-store');
      expect(request.redirect).toBe('error');
    }
  });
  it.each([200, 201, 400])('refuses an unexpected request status %s without exposing server text', async (status) => {
    const api = apiRoutes({ '/api/auth/password-reset/request': () => Response.json({ code: 'INVALID_REQUEST', message: 'private' }, { status }) });
    await expect(requestPasswordReset('sana@example.test', { fetch: api.fetch })).rejects.toMatchObject({ code: 'INVALID_REQUEST', status, message: '' });
  });
});

it.each([200, 201, 400])('refuses unexpected confirm status %s and preserves only bounded failures', async (status) => {
  const api = apiRoutes({ '/api/auth/password-reset/confirm': () => Response.json({ code: 'CODE_INVALID', message: 'private' }, { status }) });
  await expect(confirmPasswordReset({ email: 'sana@example.test', code: '123456', newPassword: 'secret word' }, { fetch: api.fetch }))
    .rejects.toMatchObject({ code: 'CODE_INVALID', status, message: '' });
});

it('bounds unreadable errors and network failures', async () => {
  const large = apiRoutes({ '/api/auth/password-reset/request': () => Response.json({ code: 'INVALID_REQUEST', padding: 'x'.repeat(17000) }, { status: 400 }) });
  await expect(requestPasswordReset('sana@example.test', { fetch: large.fetch })).rejects.toMatchObject({ code: 'REQUEST_FAILED', status: 400, message: '' });
  await expect(requestPasswordReset('sana@example.test', { fetch: async () => { throw new Error('private network text'); } }))
    .rejects.toMatchObject({ code: 'REQUEST_FAILED', status: 0, message: '' });
});

it('times out a stalled reset request', async () => {
  vi.useFakeTimers();
  try {
    const api = apiRoutes({ '/api/auth/password-reset/request': stalledRoute });
    const pending = requestPasswordReset('sana@example.test', { fetch: api.fetch });
    const rejected = expect(pending).rejects.toMatchObject({ code: 'REQUEST_FAILED', status: 0 });
    await vi.advanceTimersByTimeAsync(10000); await rejected;
  } finally { vi.useRealTimers(); }
});
