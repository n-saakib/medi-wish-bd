import { describe, expect, it } from 'vitest';
import { listUsers, loadUserRoles, projectUserRoles, projectUserSummary, saveRole } from '../src/lib/adminUsers';
import { ApiError, type ResponseReader } from '../src/lib/api';
import type { SessionClient } from '../src/lib/session';

const summary = {
  id: '3f6b2d1e-8a4c-4b7e-9d2f-0a1b2c3d4e5f', username: 'demo.mod', role: 'CUSTOMER',
  staffMfa: 'NOT_REQUIRED', superAdmin: false, createdAt: '2026-09-27T08:15:00Z',
};

function sessionFor(body: unknown, status = 200) {
  const calls: [string, RequestInit][] = [];
  const authenticatedFetch: SessionClient['authenticatedFetch'] = async <T>(path: string, init: RequestInit, read: ResponseReader<T>) => {
    calls.push([path, init]);
    return read(Response.json(body, { status }));
  };
  return { authenticatedFetch, calls };
}

describe('admin users client', () => {
  it('searches using a JSON body, keeping the username out of the URL', async () => {
    const session = sessionFor({ items: [summary], page: 0, size: 20, totalItems: 1 });
    expect(await listUsers(session, { username: 'demo.mod', role: 'CUSTOMER' })).toEqual({
      items: [summary], page: 0, size: 20, totalItems: 1,
    });
    expect(session.calls[0]?.slice(0, 2)).toEqual([
      '/api/admin/users/search', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'demo.mod', role: 'CUSTOMER' }) },
    ]);
  });
});


const detail = { ...summary, rolesVersion: 0, self: false,
  assignableRoles: ['CUSTOMER', 'DELIVERY_PERSON', 'MODERATOR'], roleChanges: [] };

describe('admin user projections', () => {
  it('keeps the bounded detail fields and a deleted actor without exposing profile fields', () => {
    const change = { occurredAt: '2026-09-27T09:02:11Z', actorUsername: null, oldRole: 'DELIVERY_PERSON', newRole: 'CUSTOMER' };
    expect(projectUserRoles({ ...detail, mobile: '01700000000', roleChanges: [{ ...change, requestId: 'private' }] }))
      .toEqual({ ...detail, roleChanges: [change] });
    expect(projectUserSummary({ ...summary, passwordHash: 'private' })).toEqual(summary);
  });
  it.each([
    ['invalid id', { ...detail, id: 'demo.mod' }],
    ['unknown role', { ...detail, role: 'SUPER_ADMIN' }],
    ['unknown MFA state', { ...detail, staffMfa: 'VERIFIED' }],
    ['Super Admin without Admin', { ...detail, superAdmin: true }],
    ['invalid creation time', { ...detail, createdAt: 'yesterday' }],
    ['fractional version', { ...detail, rolesVersion: 0.5 }],
    ['missing self', { ...detail, self: undefined }],
    ['too many choices', { ...detail, assignableRoles: Array(5).fill('CUSTOMER') }],
    ['duplicate choices', { ...detail, assignableRoles: ['CUSTOMER', 'CUSTOMER'] }],
    ['unknown choice', { ...detail, assignableRoles: ['ROOT'] }],
    ['too much history', { ...detail, roleChanges: Array(21).fill({}) }],
    ['unchanged history', { ...detail, roleChanges: [{ occurredAt: summary.createdAt, actorUsername: 'owner.admin',
      oldRole: 'CUSTOMER', newRole: 'CUSTOMER' }] }],
    ['oversized actor', { ...detail, roleChanges: [{ occurredAt: summary.createdAt, actorUsername: 'x'.repeat(51),
      oldRole: 'DELIVERY_PERSON', newRole: 'CUSTOMER' }] }],
  ])('rejects %s instead of rendering untrusted detail data', (_, body) => {
    expect(projectUserRoles(body)).toBeUndefined();
  });
});

describe('loading and saving a role', () => {
  it('loads by UUID and saves only the desired role with the version that was read', async () => {
    const session = sessionFor(detail);
    expect(await loadUserRoles(session, summary.id)).toEqual(detail);
    expect(await saveRole(session, summary.id, 'MODERATOR', 0)).toEqual(detail);
    expect(session.calls.map((call) => call.slice(0, 2))).toEqual([
      [`/api/admin/users/${summary.id}`, { method: 'GET' }],
      [`/api/admin/users/${summary.id}/roles`, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: '{"role":"MODERATOR","rolesVersion":0}' }],
    ]);
  });
  it('keeps the bounded error code and rejects malformed successful responses', async () => {
    await expect(saveRole(sessionFor({ code: 'STALE_UPDATE', message: 'private' }, 409), summary.id, 'MODERATOR', 0))
      .rejects.toMatchObject({ code: 'STALE_UPDATE', status: 409, message: '' });
    await expect(loadUserRoles(sessionFor({ ...detail, id: 'private' }), summary.id))
      .rejects.toMatchObject({ code: 'INVALID_RESPONSE', status: 200 });
  });
  it('does not send a malformed id to the API', async () => {
    const session = sessionFor(detail);
    await expect(loadUserRoles(session, 'demo.mod')).rejects.toBeInstanceOf(ApiError);
    expect(session.calls).toEqual([]);
  });
  it.each([
    { items: Array(51).fill(summary), page: 0, size: 50, totalItems: 51 },
    { items: [summary], page: -1, size: 20, totalItems: 1 },
    { items: [summary], page: 0, size: 20, totalItems: -1 },
    { items: [{ ...summary, role: 'ROOT' }], page: 0, size: 20, totalItems: 1 },
  ])('rejects a malformed or unbounded search page', async (body) => {
    await expect(listUsers(sessionFor(body))).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
