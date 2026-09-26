// @vitest-environment jsdom

import { act, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RegistrationForm } from '../src/auth/RegistrationForm';
import { deferred } from './fakeApi';
import {
  createSessionSource,
  renderWithSession,
  requiredElement,
  setInputValue,
  settle,
  signedInResponse,
  submitForm,
  unmountAll,
} from './renderWithSession';

const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/register' }));

// Registration needs only the 201 status, so the API's response body is left out.
const created = () => new Response(null, { status: 201 });

beforeEach(() => router.replace.mockClear());
afterEach(() => {
  vi.unstubAllGlobals();
  return unmountAll();
});

function stubRegistration(response: Promise<Response>) {
  const fetch = vi.fn<typeof globalThis.fetch>(() => response);
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

function requestBody(fetch: ReturnType<typeof stubRegistration>): unknown {
  return JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
}

async function fillAndSubmit(form: HTMLElement, email = ''): Promise<void> {
  setInputValue(form, '#register-username', 'sana');
  setInputValue(form, '#register-mobile', '01700000000');
  setInputValue(form, '#register-email', email);
  setInputValue(form, '#register-password', 'synthetic-password');
  await submitForm(form);
}

describe('RegistrationForm', () => {
  it('shows the design fields, the 6–30 character hint and a sign-in link', async () => {
    const form = await renderWithSession(createElement(RegistrationForm));
    const password = requiredElement<HTMLInputElement>(form, '#register-password');

    expect(requiredElement(form, 'form').getAttribute('method')).toBe('post');
    expect(requiredElement(form, 'label[for="register-email"]').textContent).toBe('Email (optional)');
    expect(password.minLength).toBe(6);
    expect(password.maxLength).toBe(30);
    expect(requiredElement(form, `#${password.getAttribute('aria-describedby')}`).textContent).toBe('6–30 characters');
    expect(requiredElement(form, 'a[href="/sign-in"]').textContent).toBe('Sign in');
    expect(form.querySelector('[role="alert"]')).toBeNull();
  });

  it('omits a blank email, clears the password, stays busy and signs in with the new credentials', async () => {
    const registration = deferred<Response>();
    const fetch = stubRegistration(registration.promise);
    const signIn = deferred<typeof signedInResponse>();
    const source = createSessionSource({ signIn: vi.fn(() => signIn.promise) });
    const form = await renderWithSession(createElement(RegistrationForm), source);
    const submit = requiredElement<HTMLButtonElement>(form, 'button[type="submit"]');

    await fillAndSubmit(form);

    expect(String(fetch.mock.calls[0]?.[0])).toMatch(/\/api\/auth\/register$/);
    expect(requestBody(fetch)).toEqual({ username: 'sana', mobile: '01700000000', password: 'synthetic-password' });
    expect(requiredElement<HTMLInputElement>(form, '#register-password').value).toBe('');
    expect(submit.disabled).toBe(true);
    expect(submit.textContent).toBe('Creating account…');

    await act(async () => registration.resolve(created()));
    await settle();

    expect(source.signIn).toHaveBeenCalledWith('sana', 'synthetic-password');
    expect(submit.disabled).toBe(true);

    await act(async () => signIn.resolve(signedInResponse));
    await settle();

    expect(router.replace).toHaveBeenCalledWith('/account');
  });

  it('sends a filled-in email', async () => {
    const fetch = stubRegistration(Promise.resolve(created()));
    const form = await renderWithSession(createElement(RegistrationForm));

    await fillAndSubmit(form, 'sana@example.test');
    await settle();

    expect(requestBody(fetch)).toMatchObject({ email: 'sana@example.test' });
  });

  it('sends the visitor to sign-in with a notice when the automatic sign-in fails', async () => {
    stubRegistration(Promise.resolve(created()));
    const form = await renderWithSession(createElement(RegistrationForm), createSessionSource({
      signIn: vi.fn().mockRejectedValue(new Error('private failure detail')),
    }));

    await fillAndSubmit(form);
    await settle();

    expect(router.replace).toHaveBeenCalledWith('/sign-in');
    expect(router.replace).not.toHaveBeenCalledWith('/account');
    expect(JSON.stringify(router.replace.mock.calls)).not.toMatch(/sana|01700000000|synthetic-password/);
  });

  it('shows the duplicate-user copy whatever the API message says, and re-enables the form', async () => {
    stubRegistration(Promise.resolve(Response.json({ code: 'DUPLICATE_USER', message: 'different server text' }, { status: 409 })));
    const source = createSessionSource();
    const form = await renderWithSession(createElement(RegistrationForm), source);

    await fillAndSubmit(form);
    await settle();

    expect(requiredElement(form, '[role="alert"]').textContent).toBe('The username, mobile number or email is already in use.');
    expect(requiredElement<HTMLButtonElement>(form, 'button[type="submit"]').disabled).toBe(false);
    expect(requiredElement<HTMLInputElement>(form, '#register-password').value).toBe('');
    expect(source.signIn).not.toHaveBeenCalled();
  });

  it('explains the username rule when the request is rejected as invalid', async () => {
    stubRegistration(Promise.resolve(Response.json({ code: 'INVALID_REQUEST', message: 'The request is invalid.' }, { status: 400 })));
    const form = await renderWithSession(createElement(RegistrationForm));

    await fillAndSubmit(form);
    await settle();

    expect(requiredElement(form, '[role="alert"]').textContent)
      .toBe('Check your details. Usernames use 3–50 letters, numbers, dots, hyphens or underscores, with at least one letter.');
  });

  it('keeps transport details out of the alert', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('private transport detail')));
    const form = await renderWithSession(createElement(RegistrationForm));

    await fillAndSubmit(form);
    await settle();

    expect(requiredElement(form, '[role="alert"]').textContent).toBe('The request could not be completed.');
  });
});
