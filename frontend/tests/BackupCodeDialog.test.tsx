// @vitest-environment jsdom

import { act, createElement, useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackupCodeDialog } from '../src/auth/BackupCodeDialog';
import type { SessionSource } from '../src/auth/SessionProvider';
import { ApiError } from '../src/lib/api';
import { createSessionClient, type SessionResponse } from '../src/lib/session';
import { apiRoutes, deferred, installFakeLocks, restoredStaff, sessionBody } from './fakeApi';
import { createSessionSource, renderWithSession, requiredElement, setInputValue, settle, submitForm, unmountAll } from './renderWithSession';

const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/staff/mfa' }));
beforeEach(() => {
  router.replace.mockClear();
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open'); } });
});
afterEach(async () => {
  await unmountAll();
  vi.restoreAllMocks();
  delete (HTMLDialogElement.prototype as { showModal?: () => void }).showModal;
  delete (HTMLDialogElement.prototype as { close?: () => void }).close;
});
function source(overrides: Partial<SessionSource> = {}) {
  return createSessionSource({ restoreSession: vi.fn().mockResolvedValue(restoredStaff('VERIFICATION_REQUIRED')), ...overrides });
}
async function mount(session = source()) {
  const returned = vi.fn();
  function Host() {
    const [open, setOpen] = useState(false);
    const trigger = useRef<HTMLButtonElement>(null);
    return <><button ref={trigger} onClick={() => setOpen(true)}>Lost your phone?</button>
      <BackupCodeDialog open={open} onClose={() => setOpen(false)} returnFocus={() => { returned(); trigger.current?.focus(); }} /></>;
  }
  const page = await renderWithSession(createElement(Host), session);
  const trigger = requiredElement<HTMLButtonElement>(page, 'button');
  await act(async () => trigger.click());
  return { page, trigger, returned, dialog: requiredElement<HTMLDialogElement>(page, 'dialog') };
}
function button(dialog: ParentNode, name: string) {
  return [...dialog.querySelectorAll('button')].find((item) => (item.getAttribute('aria-label') ?? item.textContent) === name)!;
}
async function submit(dialog: HTMLDialogElement, code = 'ABCD-2345') {
  setInputValue(dialog, '#backup-code', code);
  await submitForm(dialog);
  await settle();
}

describe('BackupCodeDialog', () => {
  it('opens with field focus, accessible labels and accepted document control order', async () => {
    const { dialog } = await mount();
    expect(dialog.open).toBe(true);
    expect(dialog.getAttribute('aria-labelledby')).toBe('backup-dialog-title');
    expect(requiredElement(dialog, 'h2').textContent).toBe('Use a backup code');
    const field = requiredElement<HTMLInputElement>(dialog, '#backup-code');
    expect(document.activeElement).toBe(field);
    expect(requiredElement(dialog, 'label').getAttribute('for')).toBe('backup-code');
    expect(field.autocomplete).toBe('off');
    expect(field.getAttribute('spellcheck')).toBe('false');
    expect(field.getAttribute('autocapitalize')).toBe('characters');
    expect(field.placeholder).toBe('XXXX-XXXX');
    expect([...dialog.querySelectorAll('button,input')].map((control) => control.tagName === 'INPUT'
      ? 'field' : control.getAttribute('aria-label') ?? control.textContent)).toEqual(['Close', 'field', 'Cancel', 'Continue']);
  });

  it('rejects malformed input locally and links the announced error to the focused field', async () => {
    const session = source();
    const { dialog } = await mount(session);
    await submit(dialog, 'ABC0-2345');
    expect(session.redeemBackupCode).not.toHaveBeenCalled();
    expect(requiredElement(dialog, '[role="alert"]').textContent).toBe('Enter the 8-character code, like ABCD-2345.');
    const field = requiredElement(dialog, '#backup-code');
    expect(field.getAttribute('aria-describedby')).toContain('backup-code-error');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(field);
  });

  it('normalizes the request through the real session client without writing secrets to storage, history or navigation', async () => {
    const locks = installFakeLocks();
    const storage = vi.spyOn(Storage.prototype, 'setItem');
    const history = [vi.spyOn(window.history, 'pushState'), vi.spyOn(window.history, 'replaceState')];
    try {
      const api = apiRoutes({
        '/api/auth/refresh': () => Response.json(sessionBody('restricted', 'VERIFICATION_REQUIRED')),
        '/api/auth/mfa/recovery': () => Response.json(sessionBody('replacement', 'REPLACEMENT_REQUIRED')),
      });
      const { dialog } = await mount(createSessionClient({ fetch: api.fetch }));
      await submit(dialog, ' abcd 2345 ');
      expect(await api.requests.at(-1)!.json()).toEqual({ backupCode: 'ABCD-2345' });
      expect(storage).not.toHaveBeenCalled();
      for (const write of history) expect(write).not.toHaveBeenCalled();
      expect(JSON.stringify(router.replace.mock.calls)).not.toContain('ABCD');
      expect(requiredElement<HTMLInputElement>(dialog, 'input').value).toBe('');
    } finally { locks.restore(); }
  });

  it('disables every control while checking and ignores Escape and duplicate submits', async () => {
    const pending = deferred<SessionResponse>();
    const session = source({ redeemBackupCode: vi.fn(() => pending.promise) });
    const { dialog } = await mount(session);
    await submit(dialog);
    expect(button(dialog, 'Checking…').disabled).toBe(true);
    for (const control of dialog.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,button')) expect(control.disabled).toBe(true);
    const cancel = new Event('cancel', { cancelable: true });
    await act(async () => dialog.dispatchEvent(cancel));
    expect(cancel.defaultPrevented).toBe(true);
    expect(dialog.open).toBe(true);
    await submitForm(dialog);
    expect(session.redeemBackupCode).toHaveBeenCalledOnce();
    await act(async () => pending.reject(new ApiError('MFA_CODE_INVALID', 400)));
    expect(requiredElement<HTMLInputElement>(dialog, 'input').disabled).toBe(false);
    expect(document.activeElement).toBe(requiredElement(dialog, 'input'));
  });

  it.each([
    ['MFA_CODE_INVALID', 400, 'The code is invalid or has already been used.', false],
    ['TOO_MANY_ATTEMPTS', 429, 'Too many attempts. Try again later.', true],
    ['INTERNAL_ERROR', 500, 'The request could not be completed.', false],
  ] as const)('renders bounded %s feedback and its retry state', async (code, status, text, locked) => {
    const { dialog } = await mount(source({ redeemBackupCode: vi.fn().mockRejectedValue(new ApiError(code, status)) }));
    await submit(dialog);
    expect(requiredElement(dialog, '[role="alert"]').textContent).toBe(text);
    const field = requiredElement<HTMLInputElement>(dialog, 'input');
    expect(field.value).toBe('');
    expect(field.disabled).toBe(locked);
    expect(button(dialog, 'Continue').disabled).toBe(locked);
    expect(button(dialog, 'Cancel').disabled).toBe(false);
    expect(button(dialog, 'Close').disabled).toBe(false);
    if (!locked) expect(document.activeElement).toBe(field);
  });

  it.each(['Cancel', 'Close', 'Escape'])('%s clears the field/error and returns focus to the opening button', async (method) => {
    const { dialog, trigger, returned } = await mount();
    await submit(dialog, 'abc');
    if (method === 'Escape') await act(async () => dialog.dispatchEvent(new Event('cancel', { cancelable: true })));
    else await act(async () => button(dialog, method).click());
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(trigger);
    expect(returned).toHaveBeenCalledOnce();
    await act(async () => trigger.click());
    expect(requiredElement<HTMLInputElement>(dialog, 'input').value).toBe('');
    expect(dialog.querySelector('[role="alert"]')).toBeNull();
  });

  it('wraps keyboard focus within the dialog in both directions', async () => {
    const { dialog } = await mount();
    const first = button(dialog, 'Close');
    const last = button(dialog, 'Continue');
    last.focus();
    await act(async () => last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(first);
    await act(async () => first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(last);
  });

  it('ignores a native close event queued before the dialog reopened', async () => {
    const { dialog, trigger } = await mount();
    await act(async () => button(dialog, 'Cancel').click());
    await act(async () => trigger.click());
    await act(async () => dialog.dispatchEvent(new Event('close')));
    expect(dialog.open).toBe(true);
    expect(document.activeElement).toBe(requiredElement(dialog, 'input'));
  });
});
