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
    // The browser's own checks would stop at the first field before the form could name each one.
    expect(requiredElement<HTMLFormElement>(form, 'form').noValidate).toBe(true);
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

  it('shows the general check-your-details copy, focused, when the server refuses the request as invalid', async () => {
    stubRegistration(Promise.resolve(Response.json({ code: 'INVALID_REQUEST', message: 'The request is invalid.' }, { status: 400 })));
    const form = await renderWithSession(createElement(RegistrationForm));

    await fillAndSubmit(form);
    await settle();

    const alert = requiredElement(form, '[role="alert"]');
    expect(alert.textContent).toBe('Check your details and try again.');
    expect(document.activeElement).toBe(alert);
  });

  it.each([
    ['username', 'username', 'ab', 'Use 3–20 letters, numbers, dots, hyphens or underscores, with at least one letter.'],
    ['digits-only username', 'username', '12345', 'Use 3–20 letters, numbers, dots, hyphens or underscores, with at least one letter.'],
    ['mobile', 'mobile', '0170000', 'Enter an 11-digit mobile number.'],
    ['email', 'email', 'not-an-email', 'Enter a valid email address, or leave it empty.'],
    ['password', 'password', 'short', 'Enter a password of 6–30 characters.'],
    ['blank password', 'password', '       ', 'Enter a password of 6–30 characters.'],
  ])('names an invalid %s next to its field, focuses it and sends nothing', async (_, field, value, copy) => {
    const fetch = stubRegistration(Promise.resolve(created()));
    const form = await renderWithSession(createElement(RegistrationForm));

    setInputValue(form, '#register-username', 'sana');
    setInputValue(form, '#register-mobile', '01700000000');
    setInputValue(form, '#register-password', 'synthetic-password');
    setInputValue(form, `#register-${field}`, value);
    await submitForm(form);
    await settle();

    const input = requiredElement(form, `#register-${field}`);
    expect(requiredElement(form, `#register-${field}-error`).textContent).toBe(copy);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')?.split(' ')[0]).toBe(`register-${field}-error`);
    expect(document.activeElement).toBe(input);
    expect(fetch).not.toHaveBeenCalled();
    expect(form.querySelector('[role="alert"]')).toBeNull();
  });

  it('accepts details the API normalizes: mixed-case username and email with surrounding spaces', async () => {
    const fetch = stubRegistration(Promise.resolve(created()));
    const form = await renderWithSession(createElement(RegistrationForm));

    setInputValue(form, '#register-username', ' Sana.K ');
    setInputValue(form, '#register-mobile', '01700000000');
    setInputValue(form, '#register-email', ' Sana@Example.test ');
    setInputValue(form, '#register-password', 'synthetic-password');
    await submitForm(form);
    await settle();

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(form.querySelector('.field-error')).toBeNull();
  });

  it('focuses the first of several invalid fields and clears a field error once it is edited', async () => {
    const fetch = stubRegistration(Promise.resolve(created()));
    const form = await renderWithSession(createElement(RegistrationForm));

    setInputValue(form, '#register-mobile', '123');
    await submitForm(form);
    await settle();

    expect(document.activeElement).toBe(requiredElement(form, '#register-username'));
    expect(form.querySelectorAll('.field-error')).toHaveLength(3);
    expect(requiredElement(form, '#register-password').getAttribute('aria-describedby')).toBe('register-password-error');
    expect(form.querySelector('#register-password-hint')).toBeNull();
    setInputValue(form, '#register-mobile', '01700000000');
    expect(form.querySelector('#register-mobile-error')).toBeNull();
    expect(requiredElement(form, '#register-mobile').getAttribute('aria-invalid')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps transport details out of the alert', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('private transport detail')));
    const form = await renderWithSession(createElement(RegistrationForm));

    await fillAndSubmit(form);
    await settle();

    expect(requiredElement(form, '[role="alert"]').textContent).toBe('The request could not be completed.');
  });
});
