// @vitest-environment jsdom

import { act, createElement, Fragment, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountSummary } from '../src/account/AccountSummary';
import { SignInForm } from '../src/auth/SignInForm';
import { SignOutNotice } from '../src/auth/SignOutNotice';
import { createSessionClient } from '../src/lib/session';
import { apiRoutes, deferred, sessionBody, signedInUser, installFakeLocks } from './fakeApi';
import { renderWithSession, requiredElement, settle, unmountAll } from './renderWithSession';

// jsdom has no Web Locks; the fake gives the real session client the cross-tab lock a secure context has.
installFakeLocks();

const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/account' }));

beforeEach(() => router.replace.mockClear());
afterEach(unmountAll);

// The home page's notice and the account page share one provider, as they do in the root layout.
const accountAndHome = createElement(Fragment, null, createElement(SignOutNotice), createElement(AccountSummary));

/** Mounts the element with a real session client whose refresh cookie is accepted and whose profile loads. */
async function renderAccount(routes: Parameters<typeof apiRoutes>[0], element: ReactElement = createElement(AccountSummary)) {
  const api = apiRoutes({
    '/api/auth/refresh': () => Response.json(sessionBody()),
    '/api/user/me': () => Response.json(signedInUser),
    ...routes,
  });
  const page = await renderWithSession(element, createSessionClient({ fetch: api.fetch }));
  await settle();
  return { api, page };
}

function countRequests(api: ReturnType<typeof apiRoutes>, path: string): number {
  return api.paths().filter((requested) => requested === path).length;
}

describe('AccountSummary', () => {
  it('shows a checking status until the profile arrives, then the profile from the API', async () => {
    const profile = deferred<Response>();
    const { api, page } = await renderAccount({ '/api/user/me': () => profile.promise });

    expect(requiredElement(page, '[role="status"]').textContent).toBe('Checking your session…');
    expect(page.querySelector('h1')).toBeNull();

    await act(async () => profile.resolve(Response.json({ ...signedInUser, username: 'sana.updated', email: 'sana@example.test' })));
    await settle();

    expect(requiredElement(page, 'h1').textContent).toBe('Your account');
    expect([...page.querySelectorAll('dt')].map((term) => term.textContent)).toEqual(['Username', 'Mobile', 'Email']);
    expect([...page.querySelectorAll('dd')].map((value) => value.textContent))
      .toEqual(['sana.updated', '01700000000', 'sana@example.test']);
    expect(api.requests.at(-1)?.headers.get('Authorization')).toBe('Bearer synthetic-access-token');
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('leaves out a missing email', async () => {
    const { page } = await renderAccount({});

    expect([...page.querySelectorAll('dt')].map((term) => term.textContent)).toEqual(['Username', 'Mobile']);
  });

  it('shows a checking status during the restore, then sends signed-out visitors to sign-in', async () => {
    const refresh = deferred<Response>();
    const { api, page } = await renderAccount({ '/api/auth/refresh': () => refresh.promise });

    expect(requiredElement(page, '[role="status"]').textContent).toBe('Checking your session…');
    expect(router.replace).not.toHaveBeenCalled();

    await act(async () => refresh.resolve(new Response(null, { status: 204 })));
    await settle();

    expect(page.querySelector('h1')).toBeNull();
    expect(router.replace).toHaveBeenCalledWith('/sign-in');
    expect(countRequests(api, '/api/user/me')).toBe(0);
  });

  it('expires the session when the profile is still unauthorized after one refresh', async () => {
    const { api, page } = await renderAccount(
      { '/api/user/me': () => Response.json({ code: 'AUTHENTICATION_REQUIRED' }, { status: 401 }) },
      createElement(Fragment, null, createElement(AccountSummary), createElement(SignInForm)),
    );

    expect(countRequests(api, '/api/user/me')).toBe(2);
    expect(countRequests(api, '/api/auth/refresh')).toBe(2);
    expect(page.querySelector('#account-title')).toBeNull();
    expect(router.replace).toHaveBeenLastCalledWith('/sign-in');
    expect(requiredElement(page, '[role="status"]').textContent).toBe('Your session has expired. Please sign in again.');
  });

  it('shows a generic error but keeps sign-out when the profile cannot be loaded', async () => {
    const { page } = await renderAccount({
      '/api/user/me': () => Response.json({ code: 'INTERNAL_ERROR', message: 'private detail' }, { status: 500 }),
    });

    expect(requiredElement(page, 'h1').textContent).toBe('Your account');
    expect(requiredElement(page, '[role="alert"]').textContent).toBe('The request could not be completed.');
    expect(requiredElement(page, 'button').textContent).toBe('Sign out');
    expect(page.querySelector('dl')).toBeNull();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('signs out, then returns home and announces it with focus', async () => {
    const logout = deferred<Response>();
    const { page } = await renderAccount({ '/api/auth/logout': () => logout.promise }, accountAndHome);
    const button = requiredElement<HTMLButtonElement>(page, 'button');

    await act(async () => button.click());

    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe('Signing out…');
    expect(router.replace).not.toHaveBeenCalled();

    await act(async () => logout.resolve(new Response(null, { status: 204 })));
    await settle();

    const notice = requiredElement(page, '[role="status"]');
    expect(notice.textContent).toBe('You have been signed out.');
    expect(document.activeElement).toBe(notice);
    expect(router.replace).toHaveBeenCalledWith('/');
    expect(router.replace).not.toHaveBeenCalledWith('/sign-in');
  });

  it('returns home with a retry when sign-out cannot be confirmed, keeps it busy, and announces a successful retry', async () => {
    let logouts = 0;
    const retry = deferred<Response>();
    const { api, page } = await renderAccount({
      '/api/auth/logout': () => (logouts += 1) === 1
        ? Response.json({ code: 'INTERNAL_ERROR' }, { status: 500 })
        : retry.promise,
    }, accountAndHome);

    await act(async () => requiredElement<HTMLButtonElement>(page, 'button').click());
    await settle();

    const alert = requiredElement(page, '[role="alert"]');
    expect(alert.textContent).toBe('Sign-out could not be completed. Try again');
    expect(document.activeElement).toBe(alert);
    expect(router.replace).toHaveBeenCalledWith('/');

    const tryAgain = requiredElement<HTMLButtonElement>(alert, 'button');
    await act(async () => tryAgain.click());

    expect(alert.isConnected).toBe(true);
    expect(tryAgain.disabled).toBe(true);
    expect(tryAgain.textContent).toBe('Signing out…');

    await act(async () => retry.resolve(new Response(null, { status: 204 })));
    await settle();

    const notice = requiredElement(page, '[role="status"]');
    expect(notice.textContent).toBe('You have been signed out.');
    expect(document.activeElement).toBe(notice);
    expect(countRequests(api, '/api/auth/logout')).toBe(2);
  });
});
