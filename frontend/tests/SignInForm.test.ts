// @vitest-environment jsdom

import { act, createElement, Fragment, useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessionClient } from '../src/lib/session';
import { useSession } from '../src/auth/SessionProvider';
import { SignInForm } from '../src/auth/SignInForm';
import {
  createSessionSource,
  deferred,
  renderWithSession,
  requiredElement,
  setInputValue,
  settle,
  signedInResponse,
  submitForm,
  unmountAll,
} from './renderWithSession';

const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/sign-in' }));

beforeEach(() => router.replace.mockClear());
afterEach(unmountAll);

async function fillAndSubmit(form: HTMLElement): Promise<void> {
  setInputValue(form, '#sign-in-identifier', 'sana');
  setInputValue(form, '#sign-in-password', 'synthetic-password');
  await submitForm(form);
}

describe('SignInForm', () => {
  it('posts by default and labels every field', async () => {
    const form = await renderWithSession(createElement(SignInForm));

    expect(requiredElement(form, 'form').getAttribute('method')).toBe('post');
    expect(requiredElement(form, 'label[for="sign-in-identifier"]').textContent).toBe('Mobile, email or username');
    expect(requiredElement(form, 'label[for="sign-in-password"]').textContent).toBe('Password');
    expect(form.querySelector('[role="alert"], [role="status"]')).toBeNull();
    expect(requiredElement(form, 'a[href="/register"]').textContent).toBe('Create an account');
  });

  it('signs in, disables the button while busy, clears the password and opens the account page', async () => {
    const signIn = deferred<typeof signedInResponse>();
    const source = createSessionSource({ signIn: vi.fn(() => signIn.promise) });
    const form = await renderWithSession(createElement(SignInForm), source);
    const submit = requiredElement<HTMLButtonElement>(form, 'button[type="submit"]');

    await fillAndSubmit(form);

    expect(source.signIn).toHaveBeenCalledWith('sana', 'synthetic-password');
    expect(submit.disabled).toBe(true);
    expect(submit.textContent).toBe('Signing in…');

    await act(async () => signIn.resolve(signedInResponse));
    await settle();

    expect(requiredElement<HTMLInputElement>(form, '#sign-in-password').value).toBe('');
    expect(router.replace).toHaveBeenCalledWith('/account');
  });

  it('shows one bounded alert, clears the password and refocuses the identifier on failure', async () => {
    const form = await renderWithSession(createElement(SignInForm), createSessionSource({
      signIn: vi.fn().mockRejectedValue(new Error('private failure detail')),
    }));

    await fillAndSubmit(form);
    await settle();

    const alerts = form.querySelectorAll('[role="alert"]');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.textContent).toBe('The request could not be completed.');
    expect(requiredElement<HTMLInputElement>(form, '#sign-in-password').value).toBe('');
    expect(document.activeElement).toBe(requiredElement(form, '#sign-in-identifier'));
    expect(router.replace).not.toHaveBeenCalled();

    setInputValue(form, '#sign-in-password', 'x');
    expect(form.querySelector('[role="alert"]')).toBeNull();
  });

  it('announces and focuses an expired session', async () => {
    const form = await renderWithSession(createElement(SignInForm), createSessionSource({
      isAuthenticated: vi.fn().mockReturnValue(true),
    }));
    const notice = requiredElement(form, '[role="status"]');

    expect(notice.textContent).toBe('Your session has expired. Please sign in again.');
    expect(document.activeElement).toBe(notice);
  });

  it('announces a restore failure as an alert', async () => {
    const form = await renderWithSession(createElement(SignInForm), createSessionSource({
      restoreSession: vi.fn().mockRejectedValue(new Error('private failure detail')),
    }));

    expect(requiredElement(form, '[role="alert"]').textContent)
      .toBe('Your session could not be restored. Please sign in again.');
  });

  it('announces and focuses the account-created notice set by registration', async () => {
    // Registration sets this notice when its automatic sign-in fails, then routes here.
    function AccountCreatedNotice() {
      const { showNotice } = useSession();
      useEffect(() => showNotice('accountCreated'), [showNotice]);
      return null;
    }
    const form = await renderWithSession(createElement(Fragment, null,
      createElement(AccountCreatedNotice), createElement(SignInForm)));
    const notice = requiredElement(form, '[role="status"]');

    expect(notice.textContent).toBe('Your account was created. Please sign in.');
    expect(document.activeElement).toBe(notice);
  });

  it('keeps the access token out of the URL and history after a real client sign-in', async () => {
    const accessToken = 'synthetic-private-access-token';
    const startUrl = window.location.href;
    const historyWrites = [
      vi.spyOn(window.history, 'pushState'),
      vi.spyOn(window.history, 'replaceState'),
    ];
    const source = createSessionClient({
      baseUrl: 'http://127.0.0.1:8080',
      fetch: async (input) => {
        const pathname = new URL(input instanceof Request ? input.url : input.toString()).pathname;
        if (pathname === '/api/auth/csrf') return Response.json({ csrfToken: 'synthetic-csrf-token' });
        if (pathname === '/api/auth/refresh') {
          return Response.json({ code: 'AUTHENTICATION_REQUIRED', message: 'Authentication is required.' }, { status: 401 });
        }
        if (pathname === '/api/auth/login') return Response.json({ ...signedInResponse, accessToken });
        throw new Error(`Unexpected session request: ${pathname}`);
      },
    });

    const form = await renderWithSession(createElement(SignInForm), source);
    await fillAndSubmit(form);
    await settle();

    expect(source.isAuthenticated()).toBe(true);
    expect(router.replace).toHaveBeenCalledWith('/account');
    expect(window.location.href).toBe(startUrl);
    for (const write of historyWrites) {
      expect(JSON.stringify(write.mock.calls)).not.toContain(accessToken);
      write.mockRestore();
    }
    expect(JSON.stringify(router.replace.mock.calls)).not.toContain(accessToken);
  });
});
