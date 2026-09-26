// @vitest-environment jsdom

import { act, createElement, Fragment } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountSummary } from '../src/account/AccountSummary';
import { SignOutNotice } from '../src/auth/SignOutNotice';
import {
  createSessionSource,
  deferred,
  renderWithSession,
  requiredElement,
  signedInUser,
  unmountAll,
} from './renderWithSession';

const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/account' }));

beforeEach(() => router.replace.mockClear());
afterEach(unmountAll);

// The home page's notice and the account page share one provider, as they do in the root layout.
const accountAndHome = createElement(Fragment, null, createElement(SignOutNotice), createElement(AccountSummary));

describe('AccountSummary', () => {
  it('shows the signed-in profile, leaving out a missing email', async () => {
    const page = await renderWithSession(createElement(AccountSummary), createSessionSource({
      restoreSession: vi.fn().mockResolvedValue(signedInUser),
    }));

    expect(requiredElement(page, 'h1').textContent).toBe('Your account');
    expect([...page.querySelectorAll('dt')].map((term) => term.textContent)).toEqual(['Username', 'Mobile']);
    expect([...page.querySelectorAll('dd')].map((value) => value.textContent)).toEqual(['sana', '01700000000']);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('shows an email when the profile has one', async () => {
    const page = await renderWithSession(createElement(AccountSummary), createSessionSource({
      restoreSession: vi.fn().mockResolvedValue({ ...signedInUser, email: 'sana@example.test' }),
    }));

    expect(page.querySelectorAll('dd')[2]?.textContent).toBe('sana@example.test');
  });

  it('shows a checking status during the restore, then sends signed-out visitors to sign-in', async () => {
    const restore = deferred<null>();
    const page = await renderWithSession(createElement(AccountSummary), createSessionSource({
      restoreSession: vi.fn(() => restore.promise),
    }));

    expect(requiredElement(page, '[role="status"]').textContent).toBe('Checking your session…');
    expect(router.replace).not.toHaveBeenCalled();

    await act(async () => restore.resolve(null));

    expect(page.querySelector('h1')).toBeNull();
    expect(router.replace).toHaveBeenCalledWith('/sign-in');
  });

  it('signs out, then returns home and announces it with focus', async () => {
    const signOut = deferred<void>();
    const source = createSessionSource({
      restoreSession: vi.fn().mockResolvedValue(signedInUser),
      signOut: vi.fn(() => signOut.promise),
    });
    const page = await renderWithSession(accountAndHome, source);
    const button = requiredElement<HTMLButtonElement>(page, 'button');

    await act(async () => button.click());

    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe('Signing out…');
    expect(router.replace).not.toHaveBeenCalled();

    await act(async () => signOut.resolve());

    const notice = requiredElement(page, '[role="status"]');
    expect(notice.textContent).toBe('You have been signed out.');
    expect(document.activeElement).toBe(notice);
    expect(router.replace).toHaveBeenCalledWith('/');
    expect(router.replace).not.toHaveBeenCalledWith('/sign-in');
  });

  it('returns home with a bounded alert when sign-out cannot be confirmed', async () => {
    const page = await renderWithSession(accountAndHome, createSessionSource({
      restoreSession: vi.fn().mockResolvedValue(signedInUser),
      signOut: vi.fn().mockRejectedValue(new Error('private failure detail')),
    }));

    await act(async () => requiredElement<HTMLButtonElement>(page, 'button').click());

    const alert = requiredElement(page, '[role="alert"]');
    expect(alert.textContent).toBe('Sign-out could not be completed. Please try again.');
    expect(document.activeElement).toBe(alert);
    expect(router.replace).toHaveBeenCalledWith('/');
  });
});
