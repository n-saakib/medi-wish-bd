// @vitest-environment jsdom
import { act, createElement, useEffect, useReducer } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UserRolePage } from '../src/admin/UserRolePage';
import { UserRoleForm } from '../src/admin/UserRoleForm';
import { createSessionClient } from '../src/lib/session';
import { apiRoutes, deferred, installFakeLocks, sessionBody } from './fakeApi';
import { renderWithSession, requiredElement, settle, submitForm, unmountAll } from './renderWithSession';

installFakeLocks();
const router = vi.hoisted(() => ({ replace: vi.fn(), userId: '3f6b2d1e-8a4c-4b7e-9d2f-0a1b2c3d4e5f' }));
vi.mock('next/navigation', () => ({ useRouter: () => router, useParams: () => ({ userId: router.userId }), usePathname: () => '/admin/users/3f6b2d1e-8a4c-4b7e-9d2f-0a1b2c3d4e5f' }));
beforeEach(() => { router.replace.mockClear(); router.userId = '3f6b2d1e-8a4c-4b7e-9d2f-0a1b2c3d4e5f'; });
afterEach(unmountAll);
const detail = { id: '3f6b2d1e-8a4c-4b7e-9d2f-0a1b2c3d4e5f', username: 'demo.mod', role: 'CUSTOMER',
  staffMfa: 'NOT_REQUIRED', superAdmin: false, createdAt: '2026-09-27T08:15:00Z', rolesVersion: 0, self: false,
  assignableRoles: ['CUSTOMER', 'DELIVERY_PERSON', 'MODERATOR'], roleChanges: [] };
const saved = { ...detail, role: 'MODERATOR', staffMfa: 'SETUP_REQUIRED', rolesVersion: 1,
  roleChanges: [{ occurredAt: '2026-09-27T09:02:11Z', actorUsername: 'owner.admin', oldRole: 'CUSTOMER', newRole: 'MODERATOR' }] };
function roleApi(routes: Parameters<typeof apiRoutes>[0] = {}) {
  return apiRoutes({ '/api/auth/refresh': () => Response.json(sessionBody('verified', 'VERIFIED')),
    [`/api/admin/users/${detail.id}`]: () => Response.json(detail),
    [`/api/admin/users/${detail.id}/roles`]: () => Response.json(saved), ...routes });
}
async function choose(page: HTMLElement, role = 'MODERATOR') {
  await act(async () => requiredElement<HTMLInputElement>(page, `input[value="${role}"]`).click());
}
describe('UserRoleForm', () => {
  it('selects exactly one permitted role, sends the loaded version, then announces saved history', async () => {
    const answer = deferred<Response>();
    const api = roleApi({ [`/api/admin/users/${detail.id}/roles`]: () => answer.promise });
    const page = await renderWithSession(createElement(UserRoleForm, { userId: detail.id }), createSessionClient({ fetch: api.fetch }));
    await settle();
    expect(requiredElement<HTMLButtonElement>(page, 'button[type="submit"]').disabled).toBe(true);
    await choose(page);
    await submitForm(page);
    expect(requiredElement<HTMLButtonElement>(page, 'button[type="submit"]').disabled).toBe(true);
    expect(requiredElement<HTMLButtonElement>(page, 'button[type="submit"]').textContent).toBe('Saving…');
    expect(await api.requests.at(-1)?.json()).toEqual({ role: 'MODERATOR', rolesVersion: 0 });
    await act(async () => answer.resolve(Response.json(saved)));
    await settle();
    const status = requiredElement(page, '[role="status"]');
    expect(status.textContent).toBe('Role saved. demo.mod has been signed out everywhere.');
    expect(document.activeElement).toBe(status);
    expect([...page.querySelectorAll<HTMLInputElement>('input:checked')].map((input) => input.value)).toEqual(['MODERATOR']);
    expect(requiredElement(page, '[aria-label="Change history"]').textContent).toContain('Changed from Customer to Moderator by owner.admin');
  });
});


describe('UserRoleForm permissions and failures', () => {
  it('enables only assignable roles and describes the disabled Admin option', async () => {
    const api = roleApi();
    const page = await renderWithSession(createElement(UserRoleForm, { userId: detail.id }), createSessionClient({ fetch: api.fetch }));
    await settle();
    const radios = [...page.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(radios.map((radio) => [radio.value, radio.disabled])).toEqual([
      ['CUSTOMER', false], ['DELIVERY_PERSON', false], ['MODERATOR', false], ['ADMIN', true],
    ]);
    expect(radios.filter((radio) => radio.checked).map((radio) => radio.value)).toEqual(['CUSTOMER']);
    const admin = requiredElement(page, 'input[value="ADMIN"]');
    expect(requiredElement(page, `#${admin.getAttribute('aria-describedby')}`).textContent).toBe('Only the Super Admin can change the Admin role.');
    await submitForm(page);
    expect(api.paths().filter((path) => path.endsWith('/roles'))).toEqual([]);
  });
  it.each([
    ['self', true, true, 'You can’t change your own role.'],
    ['Super Admin', false, true, 'The Super Admin’s role can’t be changed.'],
    ['another Admin', false, false, 'Only the Super Admin can change the Admin role.'],
  ])('locks the %s record and shows the appropriate reason', async (_, self, superAdmin, note) => {
    const api = roleApi({ [`/api/admin/users/${detail.id}`]: () => Response.json({ ...detail,
      role: 'ADMIN', staffMfa: 'ENROLLED', self, superAdmin, assignableRoles: [] }) });
    const page = await renderWithSession(createElement(UserRoleForm, { userId: detail.id }), createSessionClient({ fetch: api.fetch }));
    await settle();
    expect([...page.querySelectorAll<HTMLInputElement>('input[type="radio"]')].every((radio) => radio.disabled)).toBe(true);
    expect(requiredElement<HTMLButtonElement>(page, 'button[type="submit"]').disabled).toBe(true);
    expect(page.textContent).toContain(note);
    if (self) expect(page.textContent).not.toContain('The Super Admin’s role can’t be changed.');
  });
  it.each([
    ['ROLE_CHANGE_REFUSED', 409, 'This role change is not allowed.'],
    ['ACCESS_DENIED', 403, 'Only Admins can manage users.'],
  ])('announces %s without changing the loaded role or displaying server text', async (code, status, copy) => {
    const api = roleApi({ [`/api/admin/users/${detail.id}/roles`]: () => Response.json({ code, message: 'private-server-text' }, { status }) });
    const page = await renderWithSession(createElement(UserRoleForm, { userId: detail.id }), createSessionClient({ fetch: api.fetch }));
    await settle();
    await choose(page);
    await submitForm(page);
    await settle();
    const alert = requiredElement(page, '[role="alert"]');
    expect(alert.textContent).toBe(copy);
    expect(document.activeElement).toBe(alert);
    expect(page.textContent).not.toContain('private-server-text');
    expect(page.textContent).toContain('No role changes yet.');
    expect(requiredElement<HTMLButtonElement>(page, 'button[type="submit"]').disabled).toBe(false);
  });
  it('reloads a stale record, resets its selection, then saves using the new version', async () => {
    let reads = 0;
    let writes = 0;
    const refreshed = { ...detail, role: 'DELIVERY_PERSON', rolesVersion: 1 };
    const api = roleApi({
      [`/api/admin/users/${detail.id}`]: () => Response.json(reads++ === 0 ? detail : refreshed),
      [`/api/admin/users/${detail.id}/roles`]: () => writes++ === 0
        ? Response.json({ code: 'STALE_UPDATE' }, { status: 409 }) : Response.json({ ...saved, rolesVersion: 2 }),
    });
    const page = await renderWithSession(createElement(UserRoleForm, { userId: detail.id }), createSessionClient({ fetch: api.fetch }));
    await settle();
    await choose(page);
    await submitForm(page);
    await settle();
    expect(requiredElement(page, '[role="alert"]').textContent).toContain('This record changed after you opened it. Reload and try again.');
    await act(async () => requiredElement<HTMLButtonElement>(page, '[role="alert"] button').click());
    await settle();
    expect(document.activeElement).toBe(requiredElement(page, 'h1'));
    expect(requiredElement<HTMLInputElement>(page, 'input[value="DELIVERY_PERSON"]').checked).toBe(true);
    expect(page.querySelector('[role="alert"]')).toBeNull();
    await choose(page);
    await submitForm(page);
    await settle();
    expect(await api.requests.filter((request) => request.method === 'PUT').at(-1)?.clone().json())
      .toEqual({ role: 'MODERATOR', rolesVersion: 1 });
  });
  it('clears a failed save and retries the same intended role and original version', async () => {
    let writes = 0;
    const api = roleApi({ [`/api/admin/users/${detail.id}/roles`]: () => {
      if (writes++ === 0) throw new TypeError('private-network-text');
      return Response.json(saved);
    } });
    const page = await renderWithSession(createElement(UserRoleForm, { userId: detail.id }), createSessionClient({ fetch: api.fetch }));
    await settle();
    await choose(page);
    await submitForm(page);
    await settle();
    const alert = requiredElement(page, '[role="alert"]');
    expect(alert.textContent).toBe('The request could not be completed.');
    expect(document.activeElement).toBe(alert);
    expect(requiredElement<HTMLButtonElement>(page, 'button[type="submit"]').textContent).toBe('Save role');
    expect(requiredElement<HTMLButtonElement>(page, 'button[type="submit"]').disabled).toBe(false);
    await submitForm(page);
    await settle();
    expect(await Promise.all(api.requests.filter((request) => request.method === 'PUT').map((request) => request.clone().json())))
      .toEqual([{ role: 'MODERATOR', rolesVersion: 0 }, { role: 'MODERATOR', rolesVersion: 0 }]);
    expect(requiredElement(page, '[role="status"]').textContent).toContain('Role saved.');
    expect(page.querySelector('[role="alert"]')).toBeNull();
  });
  it('blocks a second submit while the first save is pending', async () => {
    const answer = deferred<Response>();
    const api = roleApi({ [`/api/admin/users/${detail.id}/roles`]: () => answer.promise });
    const page = await renderWithSession(createElement(UserRoleForm, { userId: detail.id }), createSessionClient({ fetch: api.fetch }));
    await settle();
    await choose(page);
    await submitForm(page);
    await submitForm(page);
    expect(api.requests.filter((request) => request.method === 'PUT')).toHaveLength(1);
    await act(async () => answer.resolve(Response.json(saved)));
    await settle();
  });
  it('renders a change whose actor was deleted with the agreed fallback', async () => {
    const api = roleApi({ [`/api/admin/users/${detail.id}`]: () => Response.json({ ...saved,
      roleChanges: [{ ...saved.roleChanges[0], actorUsername: null }] }) });
    const page = await renderWithSession(createElement(UserRoleForm, { userId: detail.id }), createSessionClient({ fetch: api.fetch }));
    await settle();
    expect(requiredElement(page, '[aria-label="Change history"]').textContent)
      .toMatch(/^Changed from Customer to Moderator by a deleted account · \d{1,2} [A-Z][a-z]{2} \d{4}, \d{1,2}:\d{2}$/);
  });
  it.each([
    ['NOT_FOUND', 404, 'This user could not be found.'],
    ['ACCESS_DENIED', 403, 'Only Admins can manage users.'],
    ['INTERNAL_ERROR', 500, 'The request could not be completed.'],
    ['MFA_REQUIRED', 403, 'The request could not be completed.'],
  ])('shows a focused %s detail error without a role form', async (code, status, copy) => {
    const api = roleApi({ [`/api/admin/users/${detail.id}`]: () => Response.json({ code, message: 'private' }, { status }) });
    const page = await renderWithSession(createElement(UserRoleForm, { userId: detail.id }), createSessionClient({ fetch: api.fetch }));
    await settle();
    const alert = requiredElement(page, '[role="alert"]');
    expect(alert.textContent).toBe(copy);
    expect(document.activeElement).toBe(alert);
    expect(page.querySelector('form')).toBeNull();
  });
  it('shows not-found for a malformed id without sending it to the API', async () => {
    const api = roleApi();
    const page = await renderWithSession(createElement(UserRoleForm, { userId: 'demo.mod' }), createSessionClient({ fetch: api.fetch }));
    await settle();
    expect(requiredElement(page, '[role="alert"]').textContent).toBe('This user could not be found.');
    expect(api.paths().filter((path) => path.startsWith('/api/admin/'))).toEqual([]);
  });
  it.each([
    ['NOT_REQUIRED', '/account'], ['ENROLLMENT_REQUIRED', '/staff/mfa/enroll'], ['VERIFICATION_REQUIRED', '/staff/mfa'],
  ] as const)('redirects a %s session to %s before loading detail', async (mfa, target) => {
    const api = apiRoutes({ '/api/auth/refresh': () => Response.json(sessionBody('restricted', mfa)) });
    const page = await renderWithSession(createElement(UserRoleForm, { userId: detail.id }), createSessionClient({ fetch: api.fetch }));
    expect(router.replace).toHaveBeenCalledWith(target);
    expect(page.querySelector('form')).toBeNull();
    expect(api.paths().filter((path) => path.startsWith('/api/admin/'))).toEqual([]);
  });
});


let redrawRoute: () => void;
function NavigationHarness() {
  const [, redraw] = useReducer((value: number) => value + 1, 0);
  useEffect(() => { redrawRoute = redraw; }, [redraw]);
  return createElement(UserRolePage);
}
const nextUser = { ...detail, id: '3f6b2d1e-8a4c-4b7e-9d2f-0a1b2c3d4e60', username: 'other.user' };
async function navigateToNextUser() {
  await act(async () => { router.userId = nextUser.id; redrawRoute(); });
  await settle();
}
describe('UserRolePage navigation', () => {
  it('shows loading and ignores a previous User’s detail after navigation', async () => {
    const old = deferred<Response>();
    const api = roleApi({ [`/api/admin/users/${detail.id}`]: () => old.promise,
      [`/api/admin/users/${nextUser.id}`]: () => Response.json(nextUser) });
    const page = await renderWithSession(createElement(NavigationHarness), createSessionClient({ fetch: api.fetch }));
    expect(requiredElement(page, '[role="status"]').textContent).toBe('Loading this user…');
    await navigateToNextUser();
    expect(requiredElement(page, 'h1').textContent).toBe('other.user');
    await act(async () => old.resolve(Response.json(detail)));
    await settle();
    expect(requiredElement(page, 'h1').textContent).toBe('other.user');
  });
  it('does not overwrite the next User when an earlier save finishes late', async () => {
    const oldSave = deferred<Response>();
    const api = roleApi({ [`/api/admin/users/${detail.id}/roles`]: () => oldSave.promise,
      [`/api/admin/users/${nextUser.id}`]: () => Response.json(nextUser) });
    const page = await renderWithSession(createElement(NavigationHarness), createSessionClient({ fetch: api.fetch }));
    await settle();
    await choose(page);
    await submitForm(page);
    await navigateToNextUser();
    await act(async () => oldSave.resolve(Response.json(saved)));
    await settle();
    expect(requiredElement(page, 'h1').textContent).toBe('other.user');
    expect(requiredElement<HTMLInputElement>(page, 'input[value="CUSTOMER"]').checked).toBe(true);
    expect(page.querySelector('[role="status"]')).toBeNull();
  });
});
