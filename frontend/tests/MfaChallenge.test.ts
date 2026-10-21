// @vitest-environment jsdom

import { act, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MfaChallenge } from '../src/auth/MfaChallenge';
import type { SessionSource } from '../src/auth/SessionProvider';
import { ApiError } from '../src/lib/api';
import { createSessionClient, type SessionResponse } from '../src/lib/session';
import { apiRoutes, deferred, installFakeLocks, restoredStaff, sessionBody, signedInUser } from './fakeApi';
import {
  createSessionSource,
  renderWithSession,
  requiredElement,
  setInputValue,
  settle,
  submitForm,
  unmountAll,
} from './renderWithSession';

// jsdom has no Web Locks; the fake gives the real session client the cross-tab lock a secure context has.
installFakeLocks();

const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/staff/mfa' }));

beforeEach(() => {
  router.replace.mockClear();
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open'); } });
});
afterEach(async () => {
  await unmountAll();
  delete (HTMLDialogElement.prototype as { showModal?: () => void }).showModal;
  delete (HTMLDialogElement.prototype as { close?: () => void }).close;
});

const verified: SessionResponse = { accessToken: 'access-verified', user: signedInUser, mfa: 'VERIFIED' };

function challengeSource(overrides: Partial<SessionSource> = {}): SessionSource {
  return createSessionSource({
    restoreSession: vi.fn().mockResolvedValue(restoredStaff('VERIFICATION_REQUIRED')),
    verifyMfa: vi.fn().mockResolvedValue(verified),
    ...overrides,
  });
}

async function enterCode(page: HTMLElement, code: string): Promise<void> {
  setInputValue(page, '#mfa-challenge-code', code);
  await submitForm(page);
  await settle();
}

describe('MfaChallenge', () => {
  it('asks for the authenticator code in one labelled numeric field', async () => {
    const page = await renderWithSession(createElement(MfaChallenge), challengeSource());

    expect(requiredElement(page, 'h1').textContent).toBe('Verify it’s you');
    expect(requiredElement(page, 'label[for="mfa-challenge-code"]').textContent).toBe('Authenticator code');
    const input = requiredElement<HTMLInputElement>(page, '#mfa-challenge-code');
    expect(input.inputMode).toBe('numeric');
    expect(input.autocomplete).toBe('one-time-code');
    expect(input.maxLength).toBe(7);
    expect(requiredElement(page, 'form').getAttribute('method')).toBe('post');
    expect(page.querySelector('[role="alert"]')).toBeNull();
    expect([...page.querySelectorAll('button')].some((button) => button.textContent === 'Lost your phone?')).toBe(true);
  });

  it('verifies the digits, disables Verify while busy and lands on the staff page', async () => {
    const answer = deferred<SessionResponse>();
    const source = challengeSource({ verifyMfa: vi.fn(() => answer.promise) });
    const page = await renderWithSession(createElement(MfaChallenge), source);

    setInputValue(page, '#mfa-challenge-code', ' 287 082 ');
    await submitForm(page);

    expect(source.verifyMfa).toHaveBeenCalledWith('287082');
    const submit = requiredElement<HTMLButtonElement>(page, 'button[type="submit"]');
    expect(submit.disabled).toBe(true);
    expect(submit.textContent).toBe('Verifying…');

    await act(async () => answer.resolve(verified));
    await settle();
    expect(router.replace).toHaveBeenCalledWith('/staff');
  });

  it('lands on the staff page through the real session client', async () => {
    const api = apiRoutes({
      '/api/auth/refresh': () => Response.json(sessionBody('access-restricted', 'VERIFICATION_REQUIRED')),
      '/api/auth/mfa/verify': () => Response.json(sessionBody('access-verified', 'VERIFIED')),
    });
    const page = await renderWithSession(createElement(MfaChallenge), createSessionClient({ fetch: api.fetch }));

    await enterCode(page, '287082');

    expect(api.requests.at(-1)?.headers.get('Authorization')).toBe('Bearer access-restricted');
    expect(router.replace).toHaveBeenCalledWith('/staff');
  });

  it('reports an invalid code, clears the field and focuses it for another try', async () => {
    const page = await renderWithSession(createElement(MfaChallenge), challengeSource({
      verifyMfa: vi.fn().mockRejectedValue(new ApiError('MFA_CODE_INVALID', 400)),
    }));

    await enterCode(page, '000000');

    expect(requiredElement(page, '[role="alert"]').textContent).toBe('The code is invalid or has already been used.');
    const input = requiredElement<HTMLInputElement>(page, '#mfa-challenge-code');
    expect(input.value).toBe('');
    expect(input.disabled).toBe(false);
    expect(document.activeElement).toBe(input);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('disables the form and announces the lock after too many attempts', async () => {
    const page = await renderWithSession(createElement(MfaChallenge), challengeSource({
      verifyMfa: vi.fn().mockRejectedValue(new ApiError('TOO_MANY_ATTEMPTS', 429)),
    }));

    await enterCode(page, '000000');

    const alert = requiredElement(page, '[role="alert"]');
    expect(alert.textContent).toBe('Too many attempts. Try again later.');
    expect([...page.querySelectorAll('button')].some((button) => button.textContent === 'Lost your phone?')).toBe(false);
    expect(document.activeElement).toBe(alert);
    expect(requiredElement<HTMLInputElement>(page, '#mfa-challenge-code').disabled).toBe(true);
    expect(requiredElement<HTMLButtonElement>(page, 'button[type="submit"]').disabled).toBe(true);
  });

  it.each([
    ['MFA_REQUIRED', 403, 'Authenticator verification is required.'],
    ['INVALID_REQUEST', 400, 'Check your details and try again.'],
    ['INVALID_RESPONSE', 200, 'The service returned an invalid response.'],
  ])('shows the copy for %s, never the API message', async (code, status, copy) => {
    const page = await renderWithSession(createElement(MfaChallenge), challengeSource({
      verifyMfa: vi.fn().mockRejectedValue(new ApiError(code, status)),
    }));

    await enterCode(page, '123456');

    expect(requiredElement(page, '[role="alert"]').textContent).toBe(copy);
  });

  it('asks for six digits without calling the API', async () => {
    const source = challengeSource();
    const page = await renderWithSession(createElement(MfaChallenge), source);

    await enterCode(page, 'abc123');

    expect(source.verifyMfa).not.toHaveBeenCalled();
    expect(requiredElement(page, '[role="alert"]').textContent).toBe('Enter the 6 digits shown in your authenticator app.');
  });

  it('signs out and returns to sign-in', async () => {
    const source = challengeSource();
    const page = await renderWithSession(createElement(MfaChallenge), source);
    const signOut = [...page.querySelectorAll('button')].find((button) => button.textContent === 'Sign out');

    await act(async () => signOut?.click());
    await settle();

    expect(source.signOut).toHaveBeenCalledOnce();
    expect(router.replace).toHaveBeenCalledWith('/sign-in');
  });

  it('sends a session that must set up an authenticator to the setup page', async () => {
    await renderWithSession(createElement(MfaChallenge), challengeSource({
      restoreSession: vi.fn().mockResolvedValue(restoredStaff('ENROLLMENT_REQUIRED')),
    }));

    expect(router.replace).toHaveBeenCalledWith('/staff/mfa/enroll');
  });
});

it('opens the backup dialog and goes to replacement enrollment after a real-client exchange', async () => {
  const api = apiRoutes({
    '/api/auth/refresh': () => Response.json(sessionBody('restricted', 'VERIFICATION_REQUIRED')),
    '/api/auth/mfa/recovery': () => Response.json(sessionBody('replacement', 'REPLACEMENT_REQUIRED')),
  });
  const page = await renderWithSession(createElement(MfaChallenge), createSessionClient({ fetch: api.fetch }));
  const lost = [...page.querySelectorAll('button')].find((button) => button.textContent === 'Lost your phone?')!;
  expect(lost).toBeDefined();
  await act(async () => lost.click());
  const dialog = requiredElement<HTMLDialogElement>(page, 'dialog');
  expect(dialog.open).toBe(true);
  expect(document.activeElement).toBe(requiredElement(dialog, '#backup-code'));
  setInputValue(dialog, '#backup-code', 'abcd 2345');
  await submitForm(dialog);
  await settle();
  expect(await api.requests.at(-1)!.json()).toEqual({ backupCode: 'ABCD-2345' });
  expect(router.replace).toHaveBeenCalledWith('/staff/mfa/enroll');
});
