import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/lib/api';
import { cancelMobileChange, loadProfile, projectProfile, saveProfile, stageMobileChange } from '../src/lib/profile';
import type { SessionClient } from '../src/lib/session';

const body = {
  username: 'sana', fullName: null, mobile: '01700000000', mobileVerified: false,
  pendingMobile: null, email: null, dateOfBirth: null, accountState: 'ACTIVE', version: 0,
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
