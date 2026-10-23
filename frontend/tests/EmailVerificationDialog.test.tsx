// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EmailVerificationDialog } from '../src/account/EmailVerificationDialog';
import { ApiError } from '../src/lib/api';
import { renderWithSession, requiredElement, setInputValue, settle, submitForm, unmountAll } from './renderWithSession';
vi.mock('next/navigation', () => ({ usePathname: () => '/account/profile' }));
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', ''); this.querySelector('input')?.focus(); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open'); } });
});
afterEach(async () => {
  await unmountAll();
  delete (HTMLDialogElement.prototype as { showModal?: () => void }).showModal;
  delete (HTMLDialogElement.prototype as { close?: () => void }).close;
});
it('validates, resends, displays bounded errors and clears secrets after cancel', async () => {
  const confirm = vi.fn().mockRejectedValue(new ApiError('CODE_INVALID', 400));
  const resend = vi.fn().mockResolvedValue(true);
  const returned = vi.fn();
  function Harness() {
    const [open, setOpen] = useState(true);
    return <><button id="reopen" onClick={() => setOpen(true)}>Reopen</button>
      <EmailVerificationDialog open={open} email="sana@example.test" disabled={false}
        returnFocus={returned} onClose={() => setOpen(false)} onConfirm={confirm} onResend={resend} /></>;
  }
  const view = await renderWithSession(createElement(Harness));
  await submitForm(view); expect(confirm).not.toHaveBeenCalled();
  expect(view.textContent).toContain('Enter the 6-digit code from your email.');
  setInputValue(view, '#email-verification-code', '123 456'); await submitForm(view); await settle();
  expect(confirm).toHaveBeenCalledWith('123456');
  expect(requiredElement(view, 'dialog [role=alert]').textContent).toBe('That code is wrong or has expired. Ask for a new code.');
  expect(document.activeElement).toBe(requiredElement(view, '#email-verification-code'));
  const sendNewCode = [...view.querySelectorAll('button')].find((button) => button.textContent === 'Send a new code')!;
  sendNewCode.focus();
  await act(async () => sendNewCode.click()); await settle();
  expect(resend).toHaveBeenCalledOnce(); expect(requiredElement(view, '[role=status]').textContent).toBe('A new code is on its way.');
  expect(document.activeElement).toBe(requiredElement(view, '#email-verification-code'));
  setInputValue(view, '#email-verification-code', '654321');
  await act(async () => requiredElement(view, 'dialog').dispatchEvent(new Event('cancel', { cancelable: true })));
  expect(returned).toHaveBeenCalled();
  await act(async () => requiredElement<HTMLButtonElement>(view, '#reopen').click());
  expect(requiredElement<HTMLInputElement>(view, '#email-verification-code').value).toBe('');
  expect(view.querySelector('[role=status], [role=alert]')).toBeNull();
  await act(async () => requiredElement(view, 'dialog').dispatchEvent(new Event('close')));
  expect(requiredElement<HTMLDialogElement>(view, 'dialog').open).toBe(true);
});
