import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/lib/api';
import { cancelMobileChange, confirmEmailVerification, requestEmailVerification, loadProfile, projectProfile, saveProfile, stageMobileChange } from '../src/lib/profile';
import type { SessionClient } from '../src/lib/session';

const body = {
  username: 'sana', fullName: null, mobile: '01700000000', mobileVerified: false,
  pendingMobile: null, email: null, emailVerified: false, dateOfBirth: null, accountState: 'ACTIVE', version: 0,
};

function session(answer: (path: string, init: RequestInit) => Response) {
  const calls: { path: string; init: RequestInit }[] = [];
  const authenticatedFetch: SessionClient['authenticatedFetch'] = async (path, init, reader) => {
    calls.push({ path, init });
    return reader(answer(path, init));
  };
  return { client: { authenticatedFetch }, calls };
}

describe('profile API client', () => {
  it('reads, saves, stages and cancels through only /me with the specified bodies and statuses', async () => {
    const { client, calls } = session((path, init) => path.endsWith('/mobile-change') && init.method === 'DELETE'
      ? new Response(null, { status: 204 })
      : Response.json(body, { status: init.method === 'POST' ? 202 : 200 }));
    expect(await loadProfile(client)).toEqual(body);
    await saveProfile(client, { fullName: 'Sana', email: null, dateOfBirth: null, version: 0 });
    await stageMobileChange(client, '01700000001');
    await cancelMobileChange(client);
    expect(calls.map(({ path, init }) => `${init.method} ${path}`)).toEqual([
      'GET /api/user/me/profile', 'PUT /api/user/me/profile',
      'POST /api/user/me/mobile-change', 'DELETE /api/user/me/mobile-change',
    ]);
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ fullName: 'Sana', email: null, dateOfBirth: null, version: 0 });
    expect(JSON.parse(String(calls[2].init.body))).toEqual({ mobile: '01700000001' });
  });

  it('requires consistent email verification and preserves a supplied current password', async () => {
    expect(projectProfile({ ...body, emailVerified: undefined })).toBeUndefined();
    expect(projectProfile({ ...body, emailVerified: 'false' })).toBeUndefined();
    expect(projectProfile({ ...body, emailVerified: true })).toBeUndefined();
    const { client, calls } = session(() => Response.json(body));
    await saveProfile(client, { fullName: null, email: 'new@example.test', dateOfBirth: null, version: 0, currentPassword: ' secret ' });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ fullName: null, email: 'new@example.test', dateOfBirth: null, version: 0, currentPassword: ' secret ' });
  });

  it('rejects malformed profile fields, including an impossible calendar date', () => {
    expect(projectProfile({ ...body, dateOfBirth: '1990-02-30' })).toBeUndefined();
    expect(projectProfile({ ...body, version: 1.5 })).toBeUndefined();
    expect(projectProfile({ ...body, version: '0' })).toBeUndefined();
    expect(projectProfile({ ...body, accountState: 'UNKNOWN' })).toBeUndefined();
    expect(projectProfile({ ...body, dateOfBirth: '2000-02-29' })).toMatchObject({ dateOfBirth: '2000-02-29' });
  });

  it('returns a bounded error code without leaking server text', async () => {
    const { client } = session(() => Response.json({ code: 'STALE_UPDATE', message: 'private server text' }, { status: 409 }));
    await expect(saveProfile(client, { fullName: null, email: null, dateOfBirth: null, version: 0 }))
      .rejects.toMatchObject({ code: 'STALE_UPDATE', status: 409, message: '' } satisfies Partial<ApiError>);
  });
});

it('requests verification without a body and projects only the confirmed profile', async () => {
  const { client, calls } = session((path) => path.endsWith('/confirm')
    ? Response.json({ ...body, email: 'sana@example.test', emailVerified: true, privateField: 'discarded' })
    : new Response(null, { status: 204 }));
  await requestEmailVerification(client);
  expect(calls[0]).toEqual({ path: '/api/user/me/email-verification', init: { method: 'POST' } });
  expect(await confirmEmailVerification(client, '123456')).toEqual({ ...body, email: 'sana@example.test', emailVerified: true });
  expect(calls[1].path).toBe('/api/user/me/email-verification/confirm');
  expect(calls[1].init.method).toBe('POST');
  expect(JSON.parse(String(calls[1].init.body))).toEqual({ code: '123456' });
});

it.each([['ACCOUNT_CLOSING', 409], ['EMAIL_REQUIRED', 409], ['TOO_MANY_ATTEMPTS', 429]] as const)(
  'keeps request verification failure %s bounded', async (code, status) => {
    const { client } = session(() => Response.json({ code, message: 'private' }, { status }));
    await expect(requestEmailVerification(client)).rejects.toMatchObject({ code, status, message: '' });
  });

it('rejects a refused code and a malformed successful verification response', async () => {
  const invalid = session(() => Response.json({ code: 'CODE_INVALID', message: 'private' }, { status: 400 }));
  await expect(confirmEmailVerification(invalid.client, '123456')).rejects.toMatchObject({ code: 'CODE_INVALID', status: 400, message: '' });
  const malformed = session(() => Response.json({ ...body, emailVerified: true }));
  await expect(confirmEmailVerification(malformed.client, '123456')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
});
