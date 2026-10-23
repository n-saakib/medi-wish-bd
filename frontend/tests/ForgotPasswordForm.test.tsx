// @vitest-environment jsdom
import { act, createElement } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ForgotPasswordForm } from '../src/auth/ForgotPasswordForm';
import { apiRoutes, deferred, restoredCustomer } from './fakeApi';
import { createSessionSource, renderWithSession, requiredElement, setInputValue, settle, submitForm, unmountAll } from './renderWithSession';
const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/forgot-password' }));
beforeEach(() => router.replace.mockClear());
afterEach(async () => { await unmountAll(); vi.unstubAllGlobals(); });

it('validates email locally and moves to a private code step once for a double submit', async () => {
  const held = deferred<Response>();
  const api = apiRoutes({ '/api/auth/password-reset/request': () => held.promise });
  vi.stubGlobal('fetch', api.fetch);
  const view = await renderWithSession(createElement(ForgotPasswordForm));
  expect(requiredElement(view, 'h1').textContent).toBe('Reset password');
  expect(requiredElement(view, 'form').getAttribute('method')).toBe('post');
  expect(requiredElement(view, 'form').hasAttribute('novalidate')).toBe(true);
  expect(view.textContent).toContain('Need help? Contact Medi Wish support.');
  expect(view.querySelector('a, input[type=tel]')).toBeNull();
  setInputValue(view, '#reset-email', 'bad');
  await submitForm(view);
  expect(api.requests).toHaveLength(0);
  const email = requiredElement<HTMLInputElement>(view, '#reset-email');
  expect(email.getAttribute('aria-invalid')).toBe('true');
  expect(email.getAttribute('aria-describedby')).toBe('reset-email-error');
  expect(document.activeElement).toBe(email);
  setInputValue(view, '#reset-email', 'sana@example.test');
  await submitForm(view); await submitForm(view);
  expect(api.requests).toHaveLength(1);
  expect(requiredElement<HTMLButtonElement>(view, 'button[type=submit]').disabled).toBe(true);
  expect(view.textContent).toContain('Sending…');
  await act(async () => held.resolve(new Response(null, { status: 202 }))); await settle();
  expect(requiredElement(view, '[role=status]').textContent).toBe('If the details match an account, a code is on its way.');
  expect(document.activeElement).toBe(requiredElement(view, '[role=status]'));
  expect(view.querySelector('#reset-code')).not.toBeNull();
  for (const value of [window.location.href, JSON.stringify(history.state), JSON.stringify(localStorage), JSON.stringify(sessionStorage)]) expect(value).not.toContain('sana@example.test');
});

it('redirects a signed-in visitor to their account', async () => {
  await renderWithSession(createElement(ForgotPasswordForm), createSessionSource({ restoreSession: vi.fn().mockResolvedValue(restoredCustomer) }));
  expect(router.replace).toHaveBeenCalledWith('/account');
});

async function codeStep(confirm: () => Response | Promise<Response> = () => new Response(null, { status: 204 })) {
  const api = apiRoutes({
    '/api/auth/password-reset/request': () => new Response(null, { status: 202 }),
    '/api/auth/password-reset/confirm': confirm,
  });
  vi.stubGlobal('fetch', api.fetch);
  const view = await renderWithSession(createElement(ForgotPasswordForm));
  setInputValue(view, '#reset-email', 'sana@example.test'); await submitForm(view); await settle();
  return { view, api };
}

it('validates code and password, sends their intended values and navigates only on success', async () => {
  const { view, api } = await codeStep();
  setInputValue(view, '#reset-code', '12345'); setInputValue(view, '#reset-password', 'short');
  await submitForm(view);
  expect(api.requests).toHaveLength(1);
  expect(requiredElement(view, '#reset-code').getAttribute('aria-describedby')).toBe('reset-code-error');
  expect(document.activeElement).toBe(requiredElement(view, '#reset-code'));
  setInputValue(view, '#reset-code', '123 456'); setInputValue(view, '#reset-password', ' pass word ');
  await submitForm(view); await settle();
  expect(await api.requests[1].json()).toEqual({ email: 'sana@example.test', code: '123456', newPassword: ' pass word ' });
  expect(router.replace).toHaveBeenCalledWith('/sign-in');
  expect(requiredElement<HTMLInputElement>(view, '#reset-code').value).toBe('');
  expect(requiredElement<HTMLInputElement>(view, '#reset-password').value).toBe('');
});

it('retains the password, clears and focuses a rejected code and announces every rejection', async () => {
  const { view } = await codeStep(() => Response.json({ code: 'CODE_INVALID' }, { status: 400 }));
  setInputValue(view, '#reset-code', '123456'); setInputValue(view, '#reset-password', 'secret word');
  await submitForm(view); await settle();
  const first = requiredElement(view, '[role=alert]');
  expect(first.textContent).toBe('That code is wrong or has expired. Ask for a new code.');
  expect(requiredElement<HTMLInputElement>(view, '#reset-code').value).toBe('');
  expect(requiredElement<HTMLInputElement>(view, '#reset-password').value).toBe('secret word');
  expect(document.activeElement).toBe(requiredElement(view, '#reset-code'));
  setInputValue(view, '#reset-code', '123456'); await submitForm(view); await settle();
  expect(requiredElement(view, '[role=alert]')).not.toBe(first);
});

it('clears secrets on pagehide and drops a completion after unmount', async () => {
  const held = deferred<Response>();
  const { view } = await codeStep(() => held.promise);
  setInputValue(view, '#reset-code', '123456'); setInputValue(view, '#reset-password', 'secret word');
  await act(async () => window.dispatchEvent(new Event('pagehide')));
  expect(requiredElement<HTMLInputElement>(view, '#reset-code').value).toBe('');
  expect(requiredElement<HTMLInputElement>(view, '#reset-password').value).toBe('');
  setInputValue(view, '#reset-code', '123456'); setInputValue(view, '#reset-password', 'secret word');
  await submitForm(view); await unmountAll();
  await act(async () => held.resolve(new Response(null, { status: 204 }))); await settle();
  expect(router.replace).not.toHaveBeenCalled();
});

it.each([
  [400, 'INVALID_REQUEST', 'Check your details and try again.'],
  [500, 'INTERNAL_ERROR', 'The request could not be completed.'],
])('keeps the email step after request status %s', async (status, code, copy) => {
  vi.stubGlobal('fetch', apiRoutes({ '/api/auth/password-reset/request': () => Response.json({ code }, { status }) }).fetch);
  const view = await renderWithSession(createElement(ForgotPasswordForm));
  setInputValue(view, '#reset-email', 'sana@example.test'); await submitForm(view); await settle();
  expect(requiredElement(view, '[role=alert]').textContent).toBe(copy);
  expect(view.querySelector('#reset-email')).not.toBeNull();
});

it.each(['', '12345', 'x'.repeat(31), '      '])('rejects invalid new password %j without sending confirmation', async (password) => {
  const { view, api } = await codeStep();
  setInputValue(view, '#reset-code', '123456'); setInputValue(view, '#reset-password', password);
  await submitForm(view);
  expect(api.requests).toHaveLength(1);
  expect(requiredElement(view, '#reset-password').getAttribute('aria-describedby')).toContain('reset-password-error');
  expect(document.activeElement).toBe(requiredElement(view, '#reset-password'));
});

it('resends once, prevents confirmation during resend and renews the uniform status', async () => {
  const held = deferred<Response>(); let requested = 0;
  const api = apiRoutes({ '/api/auth/password-reset/request': () => ++requested === 1 ? new Response(null, { status: 202 }) : held.promise });
  vi.stubGlobal('fetch', api.fetch);
  const view = await renderWithSession(createElement(ForgotPasswordForm));
  setInputValue(view, '#reset-email', 'sana@example.test'); await submitForm(view); await settle();
  const first = requiredElement(view, '[role=status]');
  setInputValue(view, '#reset-code', '123456'); setInputValue(view, '#reset-password', 'secret word');
  const resend = [...view.querySelectorAll('button')].find((button) => button.textContent === 'Send a new code')!;
  await act(async () => { resend.click(); resend.click(); }); await submitForm(view);
  expect(api.requests).toHaveLength(2);
  expect(requiredElement<HTMLButtonElement>(view, 'button[type=submit]').disabled).toBe(true);
  await act(async () => held.resolve(new Response(null, { status: 202 }))); await settle();
  expect(await api.requests[1].json()).toEqual({ email: 'sana@example.test' });
  expect(requiredElement(view, '[role=status]')).not.toBe(first);
  expect(requiredElement<HTMLInputElement>(view, '#reset-code').value).toBe('');
});

it.each([
  ['INVALID_REQUEST', 400, 'Check your details and try again.', ''],
  ['INTERNAL_ERROR', 500, 'The request could not be completed.', '123456'],
])('handles bounded confirm failure %s without navigating', async (code, status, copy, remainingCode) => {
  const { view } = await codeStep(() => Response.json({ code }, { status }));
  setInputValue(view, '#reset-code', '123456'); setInputValue(view, '#reset-password', 'secret word');
  await submitForm(view); await settle();
  expect(requiredElement(view, '[role=alert]').textContent).toBe(copy);
  expect(requiredElement<HTMLInputElement>(view, '#reset-code').value).toBe(remainingCode);
  expect(requiredElement<HTMLInputElement>(view, '#reset-password').value).toBe('secret word');
  expect(router.replace).not.toHaveBeenCalled();
});

it('confirms against the submitted address when the email draft changes during sending', async () => {
  const held = deferred<Response>();
  const api = apiRoutes({
    '/api/auth/password-reset/request': () => held.promise,
    '/api/auth/password-reset/confirm': () => new Response(null, { status: 204 }),
  });
  vi.stubGlobal('fetch', api.fetch);
  const view = await renderWithSession(createElement(ForgotPasswordForm));
  setInputValue(view, '#reset-email', 'original@example.test'); await submitForm(view);
  setInputValue(view, '#reset-email', 'changed@example.test');
  await act(async () => held.resolve(new Response(null, { status: 202 }))); await settle();
  setInputValue(view, '#reset-code', '123456'); setInputValue(view, '#reset-password', 'secret word');
  await submitForm(view); await settle();
  expect(await api.requests[1].json()).toEqual({ email: 'original@example.test', code: '123456', newPassword: 'secret word' });
});
