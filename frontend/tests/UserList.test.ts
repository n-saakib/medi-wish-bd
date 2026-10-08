// @vitest-environment jsdom
import { act, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UserList } from '../src/admin/UserList';
import { createSessionClient } from '../src/lib/session';
import { apiRoutes, deferred, installFakeLocks, sessionBody } from './fakeApi';
import { renderWithSession, requiredElement, settle, setInputValue, submitForm, unmountAll } from './renderWithSession';

installFakeLocks();
const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/admin/users' }));
beforeEach(() => router.replace.mockClear());
afterEach(unmountAll);
const user = { id: '3f6b2d1e-8a4c-4b7e-9d2f-0a1b2c3d4e5f', username: 'demo.mod', role: 'CUSTOMER',
  staffMfa: 'NOT_REQUIRED', superAdmin: false, createdAt: '2026-09-27T08:15:00Z' };
const firstPage = { items: [user], page: 0, size: 20, totalItems: 1 };
function listApi(search: Parameters<typeof apiRoutes>[0][string]) {
  return apiRoutes({ '/api/auth/refresh': () => Response.json(sessionBody('verified', 'VERIFIED')),
    '/api/admin/users/search': search });
}
describe('UserList', () => {
  it('loads bounded rows with one role and UUID links, without rendering profile data', async () => {
    const api = listApi(() => Response.json({ ...firstPage, items: [{ ...user, mobile: 'private-mobile' }] }));
    const page = await renderWithSession(createElement(UserList), createSessionClient({ fetch: api.fetch }));
    await settle();
    expect(requiredElement(page, 'h1').textContent).toBe('Users and roles');
    expect([...page.querySelectorAll('th')].map((cell) => cell.textContent)).toEqual(['User', 'Role', 'Staff MFA', 'Joined', 'Open']);
    expect(requiredElement(page, 'table').getAttribute('aria-label')).toBe('Users');
    expect(requiredElement(page, 'tbody').textContent).toContain('demo.mod');
    expect(requiredElement(page, 'tbody a').getAttribute('href')).toBe(`/admin/users/${user.id}`);
    expect(page.textContent).not.toContain('private-mobile');
    expect([...page.querySelectorAll('button')].find((button) => button.textContent === 'Next')?.disabled).toBe(true);
  });
});



describe('UserList states and filters', () => {
  it('shows loading, then an empty state without a table', async () => {
    const answer = deferred<Response>();
    const api = listApi(() => answer.promise);
    const page = await renderWithSession(createElement(UserList), createSessionClient({ fetch: api.fetch }));
    expect(requiredElement(page, '[role="status"]').textContent).toBe('Loading users…');
    await act(async () => answer.resolve(Response.json({ ...firstPage, items: [], totalItems: 0 })));
    await settle();
    expect(page.textContent).toContain('No users match.');
    expect(page.querySelector('table')).toBeNull();
  });
  it('shows a refused list only the focused denial, without the search form or a table', async () => {
    const api = listApi(() => Response.json({ code: 'ACCESS_DENIED', message: 'private-server-text' }, { status: 403 }));
    const page = await renderWithSession(createElement(UserList), createSessionClient({ fetch: api.fetch }));
    await settle();
    const alert = requiredElement(page, '[role="alert"]');
    expect(alert.textContent).toBe('Only Admins can manage users.');
    expect(document.activeElement).toBe(alert);
    expect(requiredElement(page, 'h1').textContent).toBe('Users and roles');
    expect(page.querySelector('form')).toBeNull();
    expect(page.querySelector('#admin-user-search')).toBeNull();
    expect(page.querySelector('table')).toBeNull();
    expect(page.textContent).not.toContain('private-server-text');
  });
  it.each([
    ['INTERNAL_ERROR', 500, 'The request could not be completed.'],
  ])('announces %s without rendering backend text, and recovers on another search', async (code, status, copy) => {
    let fails = true;
    const api = listApi(() => fails ? Response.json({ code, message: 'private-server-text' }, { status }) : Response.json(firstPage));
    const page = await renderWithSession(createElement(UserList), createSessionClient({ fetch: api.fetch }));
    await settle();
    const alert = requiredElement(page, '[role="alert"]');
    expect(alert.textContent).toBe(copy);
    expect(document.activeElement).toBe(alert);
    expect(page.textContent).not.toContain('private-server-text');
    fails = false;
    await submitForm(page);
    await settle();
    expect(page.querySelector('[role="alert"]')).toBeNull();
    expect(requiredElement(page, 'table').textContent).toContain(user.username);
  });
  it('submits filters in the body, pages with applied filters, and resets pagination on a new search', async () => {
    const api = listApi(async (request) => {
      const body = await request.clone().json() as { page?: number };
      return Response.json({ ...firstPage, page: body.page ?? 0, totalItems: 21 });
    });
    const page = await renderWithSession(createElement(UserList), createSessionClient({ fetch: api.fetch }));
    await settle();
    setInputValue(page, '#admin-user-search', '  demo  ');
    await act(async () => {
      const select = requiredElement<HTMLSelectElement>(page, '#admin-user-role');
      select.value = 'MODERATOR';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await submitForm(page);
    await settle();
    expect(await api.requests.at(-1)?.clone().json()).toEqual({ username: 'demo', role: 'MODERATOR', page: 0 });
    setInputValue(page, '#admin-user-search', 'other');
    await act(async () => [...page.querySelectorAll('button')].find((button) => button.textContent === 'Next')?.click());
    await settle();
    expect(await api.requests.at(-1)?.clone().json()).toEqual({ username: 'demo', role: 'MODERATOR', page: 1 });
    await submitForm(page);
    await settle();
    expect(await api.requests.at(-1)?.clone().json()).toEqual({ username: 'other', role: 'MODERATOR', page: 0 });
    expect(api.requests.every((request) => !request.url.includes('demo'))).toBe(true);
  });
  it('keeps the page and keyboard focus in the pager while Next loads the last page', async () => {
    const next = deferred<Response>();
    const api = listApi(async (request) => {
      const body = await request.clone().json() as { page?: number };
      return body.page ? next.promise : Response.json({ ...firstPage, totalItems: 21 });
    });
    const page = await renderWithSession(createElement(UserList), createSessionClient({ fetch: api.fetch }));
    await settle();
    const button = (label: string) => [...page.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent === label)!;
    button('Next').focus();
    await act(async () => button('Next').click());
    await settle();
    expect(requiredElement(page, 'tbody').textContent).toContain(user.username);
    await act(async () => next.resolve(Response.json({ ...firstPage, page: 1, totalItems: 21 })));
    await settle();
    const range = [...page.querySelectorAll('span')].find((item) => item.textContent === 'Showing 21–21 of 21')!;
    expect(range.getAttribute('aria-live')).toBe('polite');
    expect(button('Next').disabled).toBe(true);
    expect(document.activeElement).toBe(button('Previous'));
  });
  it('ignores an old search response once a newer search finished', async () => {
    const old = deferred<Response>();
    const api = listApi(async (request) => {
      const body = await request.clone().json() as { username?: string };
      return body.username === 'old' ? old.promise : Response.json({ ...firstPage, items: [{ ...user, username: body.username ?? user.username }] });
    });
    const page = await renderWithSession(createElement(UserList), createSessionClient({ fetch: api.fetch }));
    await settle();
    setInputValue(page, '#admin-user-search', 'old');
    await submitForm(page);
    setInputValue(page, '#admin-user-search', 'fresh');
    await submitForm(page);
    await settle();
    expect(requiredElement(page, 'tbody').textContent).toContain('fresh');
    await act(async () => old.resolve(Response.json({ ...firstPage, items: [{ ...user, username: 'old' }] })));
    await settle();
    expect(requiredElement(page, 'tbody').textContent).toContain('fresh');
    expect(requiredElement(page, 'tbody').textContent).not.toContain('old');
  });
  it.each([
    ['NOT_REQUIRED', '/account'], ['ENROLLMENT_REQUIRED', '/staff/mfa/enroll'], ['VERIFICATION_REQUIRED', '/staff/mfa'],
  ] as const)('redirects a %s session to %s without requesting user data', async (mfa, target) => {
    const api = apiRoutes({ '/api/auth/refresh': () => Response.json(sessionBody('restricted', mfa)) });
    const page = await renderWithSession(createElement(UserList), createSessionClient({ fetch: api.fetch }));
    expect(router.replace).toHaveBeenCalledWith(target);
    expect(api.paths()).not.toContain('/api/admin/users/search');
    expect(page.querySelector('table')).toBeNull();
  });
});
