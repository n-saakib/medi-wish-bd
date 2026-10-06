// @vitest-environment jsdom

import { act, createElement, Fragment } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessionClient } from '../src/lib/session';
import type { MfaStatus } from '../src/lib/session';
import { projectStaffAccess } from '../src/lib/staff';
import { StaffHeader } from '../src/shell/StaffHeader';
import { StaffHome } from '../src/staff/StaffHome';
import { apiRoutes, deferred, installFakeLocks, sessionBody } from './fakeApi';
import { renderWithSession, requiredElement, settle, unmountAll } from './renderWithSession';

// jsdom has no Web Locks; the fake gives the real session client the cross-tab lock a secure context has.
installFakeLocks();

const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/staff' }));

beforeEach(() => router.replace.mockClear());
afterEach(unmountAll);

const adminAccess = { username: 'owner.admin', roles: ['ADMIN'], superAdmin: true };

/** Mounts the staff page with a real session client whose refresh cookie restores a session with `mfa`. */
async function renderStaffHome(routes: Parameters<typeof apiRoutes>[0], mfa: MfaStatus = 'VERIFIED') {
  const api = apiRoutes({
    '/api/auth/refresh': () => Response.json(sessionBody('access-verified', mfa)),
    '/api/staff/me': () => Response.json(adminAccess),
    '/api/auth/logout': () => new Response(null, { status: 204 }),
    ...routes,
  });
  const page = await renderWithSession(createElement(Fragment, null, createElement(StaffHeader), createElement(StaffHome)),
    createSessionClient({ fetch: api.fetch }));
  await settle();
  return { api, page };
}

describe('StaffHome', () => {
  it('shows a checking status until staff access loads, then the verified access', async () => {
    const access = deferred<Response>();
    const { api, page } = await renderStaffHome({ '/api/staff/me': () => access.promise });

    expect(requiredElement(page, '[role="status"]').textContent).toBe('Checking your staff access…');
    expect(page.querySelector('h1')).toBeNull();

    await act(async () => access.resolve(Response.json(adminAccess)));
    await settle();

    expect(requiredElement(page, 'h1').textContent).toBe('Staff access verified');
    expect([...page.querySelectorAll('dt')].map((term) => term.textContent)).toEqual(['Username', 'Roles']);
    expect([...page.querySelectorAll('dd')].map((value) => value.textContent)).toEqual(['owner.admin', 'Admin']);
    expect(requiredElement(page, '.chip').textContent).toBe('Super Admin');
    expect(api.requests.at(-1)?.headers.get('Authorization')).toBe('Bearer access-verified');
    expect(router.replace).not.toHaveBeenCalled();
    expect(requiredElement(page, 'a[href="/admin/users"]').textContent).toBe('Users and roles');
  });

  it('shows no Super Admin label for another staff member', async () => {
    const { page } = await renderStaffHome({
      '/api/staff/me': () => Response.json({ username: 'mod.one', roles: ['MODERATOR'], superAdmin: false }),
    });

    expect(requiredElement(page, 'dd:last-of-type').textContent).toBe('Moderator');
    expect(page.textContent).not.toContain('Super Admin');
  });

  it.each([
    ['a restricted session', { code: 'MFA_REQUIRED' }, 403, 'Authenticator verification is required.'],
    ['a server failure', { code: 'INTERNAL_ERROR', message: 'server text' }, 500, 'The request could not be completed.'],
    ['a malformed body', { username: 'owner.admin', roles: 'ADMIN', superAdmin: true }, 200, 'The service returned an invalid response.'],
  ])('shows one focused alert for %s', async (_, body, status, copy) => {
    const { page } = await renderStaffHome({ '/api/staff/me': () => Response.json(body, { status }) });

    const alert = requiredElement(page, '[role="alert"]');
    expect(alert.textContent).toBe(copy);
    expect(document.activeElement).toBe(alert);
    expect(page.querySelector('h1')).toBeNull();
  });

  it.each([
    ['ENROLLMENT_REQUIRED', '/staff/mfa/enroll'],
    ['VERIFICATION_REQUIRED', '/staff/mfa'],
    ['NOT_REQUIRED', '/account'],
  ] as const)('sends a %s session to %s without asking for staff access', async (mfa, target) => {
    const { api } = await renderStaffHome({}, mfa);

    expect(router.replace).toHaveBeenCalledWith(target);
    expect(api.paths()).not.toContain('/api/staff/me');
  });

  it('signs out from the staff header and returns to sign-in', async () => {
    const { api, page } = await renderStaffHome({});
    const signOut = requiredElement<HTMLButtonElement>(page, 'header button');
    expect(signOut.getAttribute('aria-label')).toBe('Sign out');

    await act(async () => signOut.click());
    await settle();

    expect(api.paths()).toContain('/api/auth/logout');
    expect(router.replace).toHaveBeenCalledWith('/sign-in');
    expect(page.querySelector('header button')).toBeNull();
  });
});

describe('projectStaffAccess', () => {
  it('keeps only the username, roles and Super Admin flag', () => {
    expect(projectStaffAccess({ ...adminAccess, mobile: '01700000000' })).toEqual(adminAccess);
  });

  it.each([
    ['no roles', { ...adminAccess, roles: [] }],
    ['multiple roles', { ...adminAccess, roles: ['ADMIN', 'CUSTOMER'] }],
    ['Super Admin without Admin', { ...adminAccess, roles: ['MODERATOR'] }],
    ['unknown role', { ...adminAccess, roles: ['ROOT'] }],
    ['a malformed role', { ...adminAccess, roles: ['admin'] }],
    ['a non-boolean Super Admin flag', { ...adminAccess, superAdmin: 'true' }],
    ['an oversized username', { ...adminAccess, username: 'x'.repeat(51) }],
    ['no body', null],
  ])('rejects a body with %s', (_, body) => {
    expect(projectStaffAccess(body)).toBeUndefined();
  });
});
