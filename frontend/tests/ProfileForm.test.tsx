// @vitest-environment jsdom

import { act, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfileForm } from '../src/account/ProfileForm';
import { useSession } from '../src/auth/SessionProvider';
import type { SessionClient } from '../src/lib/session';
import { deferred, restoredCustomer } from './fakeApi';
import { createSessionSource, renderWithSession, requiredElement, setInputValue, settle, signedInResponse, submitForm, unmountAll } from './renderWithSession';

const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/account/profile' }));

const profile = {
  username: 'sana', fullName: null, mobile: '01700000000', mobileVerified: false,
  pendingMobile: null, email: null, dateOfBirth: null, accountState: 'ACTIVE', version: 0,
};

beforeEach(() => {
  router.replace.mockClear();
  // jsdom does not implement native modal dialog methods.
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() {
    this.setAttribute('open', '');
    this.querySelector('input')?.focus();
  } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() {
    this.removeAttribute('open');
  } });
});
afterEach(async () => {
  await unmountAll();
  delete (HTMLDialogElement.prototype as { showModal?: () => void }).showModal;
  delete (HTMLDialogElement.prototype as { close?: () => void }).close;
});

function source(answer: (path: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { path: string; init: RequestInit }[] = [];
  const authenticatedFetch: SessionClient['authenticatedFetch'] = async (path, init, read) => {
    calls.push({ path, init });
    return read(await answer(path, init));
  };
  return { calls, source: createSessionSource({
    restoreSession: vi.fn().mockResolvedValue(restoredCustomer), authenticatedFetch,
  }) };
}

function SessionControls() {
  const state = useSession();
  return <>
    <button id="test-sign-out" onClick={() => void state.signOut()}>Sign out</button>
    <button id="test-sign-in" onClick={() => void state.signIn('sana', 'synthetic-password')}>Sign in</button>
  </>;
}
describe('ProfileForm', () => {
  it('loads once, keeps a draft and its version through mobile stage and cancel, then reports stale save', async () => {
    const pending = '01700000001';
    const { calls, source: session } = source((path, init) => {
      if (path.endsWith('/profile') && init.method === 'GET') return Response.json(profile);
      if (init.method === 'POST') return Response.json({ ...profile, fullName: 'Other tab', version: 1, pendingMobile: pending }, { status: 202 });
      if (init.method === 'DELETE') return new Response(null, { status: 204 });
      return Response.json({ code: 'STALE_UPDATE', message: 'server detail' }, { status: 409 });
    });
    const view = await renderWithSession(createElement(ProfileForm), session);
    expect(requiredElement<HTMLInputElement>(view, '#profile-full-name').value).toBe('');
    setInputValue(view, '#profile-full-name', 'Unsaved Draft');
    await act(async () => requiredElement<HTMLButtonElement>(view, 'button[type="button"].btn-ghost').click());
    expect(requiredElement<HTMLDialogElement>(view, 'dialog').open).toBe(true);
    setInputValue(view, '#new-mobile', pending);
    await act(async () => requiredElement<HTMLFormElement>(view, 'dialog form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await settle();
    expect(requiredElement<HTMLInputElement>(view, '#profile-full-name').value).toBe('Unsaved Draft');
    expect(view.textContent).toContain(`New number ${pending} is waiting for verification.`);
    await act(async () => [...view.querySelectorAll('button')].find((button) => button.textContent === 'Cancel change')?.click());
    await settle();
    expect(requiredElement<HTMLInputElement>(view, '#profile-full-name').value).toBe('Unsaved Draft');
    await submitForm(view);
    await settle();
    const save = calls.find(({ init }) => init.method === 'PUT');
    expect(JSON.parse(String(save?.init.body))).toMatchObject({ fullName: 'Unsaved Draft', version: 0 });
    expect(requiredElement(view, '[role="alert"]').textContent).toContain('This record changed after you opened it.');
  });

  it('holds one save request at a time and disables mobile commands and editable fields', async () => {
    const held = deferred<Response>();
    const { calls, source: session } = source((_path, init) => init.method === 'PUT' ? held.promise : Response.json(profile));
    const view = await renderWithSession(createElement(ProfileForm), session);
    setInputValue(view, '#profile-full-name', 'First Save');
    await submitForm(view);
    expect(requiredElement<HTMLInputElement>(view, '#profile-full-name').disabled).toBe(true);
    expect([...view.querySelectorAll('button')].find((button) => button.textContent === 'Change')?.disabled).toBe(true);
    await submitForm(view);
    expect(calls.filter(({ init }) => init.method === 'PUT')).toHaveLength(1);
    await act(async () => held.resolve(Response.json({ ...profile, fullName: 'First Save', version: 1 })));
    await settle();
    expect(requiredElement<HTMLInputElement>(view, '#profile-full-name').value).toBe('First Save');
    expect(view.querySelector('[role="status"]')?.textContent).toContain('Profile saved.');
  });

  it('keeps a native dialog open on API rejection and returns focus after Escape', async () => {
    const held = deferred<Response>();
    const { source: session } = source((_path, init) => init.method === 'POST' ? held.promise : Response.json(profile));
    const view = await renderWithSession(createElement(ProfileForm), session);
    const change = [...view.querySelectorAll('button')].find((button) => button.textContent === 'Change')!;
    await act(async () => change.click());
    expect(requiredElement<HTMLDialogElement>(view, 'dialog').open).toBe(true);
    expect(document.activeElement).toBe(requiredElement(view, '#new-mobile'));
    setInputValue(view, '#new-mobile', '01700000001');
    // A click on the submit button focuses it; it is disabled while the request is pending.
    requiredElement<HTMLButtonElement>(view, 'dialog button[type="submit"]').focus();
    await act(async () => {
      requiredElement<HTMLFormElement>(view, 'dialog form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    const input = requiredElement<HTMLInputElement>(view, '#new-mobile');
    expect(input.disabled).toBe(true);
    await act(async () => held.resolve(Response.json({ code: 'DUPLICATE_USER', message: 'private detail' }, { status: 409 })));
    await settle();
    expect(requiredElement(view, 'dialog [role="alert"]').textContent).toContain('already in use');
    expect(input.getAttribute('aria-describedby')).toContain('new-mobile-error');
    expect(requiredElement<HTMLDialogElement>(view, 'dialog').open).toBe(true);
    expect(document.activeElement).toBe(input);
    await act(async () => {
      requiredElement<HTMLDialogElement>(view, 'dialog').dispatchEvent(new Event('cancel', { bubbles: false, cancelable: true }));
    });
    expect(requiredElement<HTMLDialogElement>(view, 'dialog').open).toBe(false);
    expect(document.activeElement).toBe(change);
  });

  it('makes every input read-only after the server reports account closure, including the hidden mobile dialog', async () => {
    const { source: session } = source((_path, init) => init.method === 'PUT'
      ? Response.json({ code: 'ACCOUNT_CLOSING', message: 'private detail' }, { status: 409 })
      : Response.json(profile));
    const view = await renderWithSession(createElement(ProfileForm), session);
    setInputValue(view, '#profile-full-name', 'Too Late');
    await submitForm(view);
    await settle();
    expect(view.textContent).toContain('Your account is closing.');
    expect(document.activeElement?.textContent).toBe('Your account is closing.');
    for (const input of view.querySelectorAll('input')) expect(input.disabled).toBe(true);
    expect(requiredElement<HTMLButtonElement>(view, 'button[type="submit"]').disabled).toBe(true);
  });
  it('does not reveal a previous session profile or draft when the new session load fails', async () => {
    let reads = 0;
    const { source: base } = source(() => {
      reads += 1;
      return reads === 1 ? Response.json({ ...profile, fullName: 'Private Previous Name' })
        : Response.json({ code: 'INTERNAL_ERROR', message: 'private detail' }, { status: 500 });
    });
    const session = createSessionSource({ ...base,
      signIn: vi.fn().mockResolvedValue(signedInResponse), signOut: vi.fn().mockResolvedValue(undefined),
    });
    const view = await renderWithSession(<><ProfileForm /><SessionControls /></>, session);
    setInputValue(view, '#profile-full-name', 'Private Previous Draft');
    await act(async () => requiredElement<HTMLButtonElement>(view, '#test-sign-out').click());
    await settle();
    await act(async () => requiredElement<HTMLButtonElement>(view, '#test-sign-in').click());
    await settle();
    expect(view.textContent).toContain('The request could not be completed.');
    expect(view.textContent).not.toContain('Private Previous');
    expect(view.querySelector('#profile-full-name')).toBeNull();
  });

  it('drops an old mobile completion without closing the new session dialog or moving its focus', async () => {
    const held = deferred<Response>();
    const { source: base } = source((_path, init) => init.method === 'POST' ? held.promise : Response.json(profile));
    const session = createSessionSource({ ...base,
      signIn: vi.fn().mockResolvedValue(signedInResponse), signOut: vi.fn().mockResolvedValue(undefined),
    });
    const view = await renderWithSession(<><ProfileForm /><SessionControls /></>, session);
    await act(async () => [...view.querySelectorAll('button')].find((button) => button.textContent === 'Change')?.click());
    setInputValue(view, '#new-mobile', '01700000001');
    await act(async () => requiredElement<HTMLFormElement>(view, 'dialog form').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })));
    await act(async () => requiredElement<HTMLButtonElement>(view, '#test-sign-out').click());
    await settle();
    await act(async () => requiredElement<HTMLButtonElement>(view, '#test-sign-in').click());
    await settle();
    expect(requiredElement<HTMLDialogElement>(view, 'dialog').open).toBe(false);
    await act(async () => [...view.querySelectorAll('button')].find((button) => button.textContent === 'Change')?.click());
    setInputValue(view, '#new-mobile', '01700000002');
    const focused = document.activeElement;
    await act(async () => held.resolve(Response.json({ ...profile, pendingMobile: '01700000001' }, { status: 202 })));
    await settle();
    expect(requiredElement<HTMLDialogElement>(view, 'dialog').open).toBe(true);
    expect(requiredElement<HTMLInputElement>(view, '#new-mobile').value).toBe('01700000002');
    expect(document.activeElement).toBe(focused);
    expect(view.textContent).not.toContain('New number 01700000001');
  });
  it('drops a held answer after sign-out and a new sign-in, even when the same user object is reused', async () => {
    const held = deferred<Response>();
    let reads = 0;
    const { source: base } = source((_path, init) => {
      if (init.method === 'PUT') return held.promise;
      reads += 1;
      return Response.json(reads === 1 ? profile : { ...profile, fullName: 'New Session' });
    });
    const session = createSessionSource({
      ...base, signIn: vi.fn().mockResolvedValue(signedInResponse), signOut: vi.fn().mockResolvedValue(undefined),
    });
    const view = await renderWithSession(<><ProfileForm /><SessionControls /></>, session);
    setInputValue(view, '#profile-full-name', 'Old Draft');
    await submitForm(view);
    await act(async () => requiredElement<HTMLButtonElement>(view, '#test-sign-out').click());
    await settle();
    await act(async () => requiredElement<HTMLButtonElement>(view, '#test-sign-in').click());
    await settle();
    expect(requiredElement<HTMLInputElement>(view, '#profile-full-name').value).toBe('New Session');
    await act(async () => held.resolve(Response.json({ ...profile, fullName: 'Old Draft', version: 1 })));
    await settle();
    expect(requiredElement<HTMLInputElement>(view, '#profile-full-name').value).toBe('New Session');
  });

  it('shows a loading status until GET finishes, then an unchanged unverified profile cannot be saved', async () => {
    const held = deferred<Response>();
    const { calls, source: session } = source(() => held.promise);
    const view = await renderWithSession(createElement(ProfileForm), session);
    expect(requiredElement(view, '[role="status"]').textContent).toBe('Loading your profile…');
    expect(view.querySelector('#profile-full-name')).toBeNull();
    await act(async () => held.resolve(Response.json(profile)));
    await settle();
    expect(view.textContent).toContain('Not verified');
    expect(requiredElement<HTMLButtonElement>(view, 'button[type="submit"]').disabled).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('adopts normalized save fields and version as the next baseline and focuses the saved notice', async () => {
    let saves = 0;
    const { calls, source: session } = source((_path, init) => {
      if (init.method === 'GET') return Response.json(profile);
      saves += 1;
      return Response.json({ ...profile, fullName: saves === 1 ? 'Sana Akter' : 'Next Name',
        email: 'sana@example.test', dateOfBirth: '2000-01-02', version: saves });
    });
    const view = await renderWithSession(createElement(ProfileForm), session);
    setInputValue(view, '#profile-full-name', '  Sana  Akter  ');
    setInputValue(view, '#profile-email', 'SANA@example.test');
    setInputValue(view, '#profile-date-of-birth', '2000-01-02');
    await submitForm(view);
    await settle();
    expect(requiredElement<HTMLInputElement>(view, '#profile-full-name').value).toBe('Sana Akter');
    expect(requiredElement<HTMLInputElement>(view, '#profile-email').value).toBe('sana@example.test');
    expect(requiredElement<HTMLInputElement>(view, '#profile-date-of-birth').value).toBe('2000-01-02');
    expect(requiredElement<HTMLButtonElement>(view, 'button[type="submit"]').disabled).toBe(true);
    const saved = requiredElement(view, '[role="status"]');
    expect(saved.textContent).toBe('Profile saved.');
    expect(document.activeElement).toBe(saved);
    setInputValue(view, '#profile-full-name', 'Next Name');
    await submitForm(view);
    await settle();
    const puts = calls.filter(({ init }) => init.method === 'PUT');
    expect(JSON.parse(String(puts[0].init.body))).toEqual({ fullName: 'Sana  Akter',
      email: 'SANA@example.test', dateOfBirth: '2000-01-02', version: 0 });
    expect(JSON.parse(String(puts[1].init.body)).version).toBe(1);
  });

  it.each([
    ['DUPLICATE_USER', 409, 'The username, mobile number or email is already in use.'],
    ['INVALID_REQUEST', 400, 'Check your details and try again.'],
  ])('keeps the draft and displays bounded %s save copy', async (code, status, copy) => {
    const { source: session } = source((_path, init) => init.method === 'GET' ? Response.json(profile)
      : Response.json({ code, message: 'private server detail' }, { status }));
    const view = await renderWithSession(createElement(ProfileForm), session);
    setInputValue(view, '#profile-email', 'sana@example.test');
    await submitForm(view);
    await settle();
    expect(requiredElement(view, '[role="alert"]').textContent).toBe(copy);
    expect(view.textContent).not.toContain('private server detail');
    expect(requiredElement<HTMLInputElement>(view, '#profile-email').value).toBe('sana@example.test');
    expect(requiredElement<HTMLButtonElement>(view, 'button[type="submit"]').disabled).toBe(false);
  });

  it('offers Reload after a failed GET and replaces the error with the recovered profile', async () => {
    let reads = 0;
    const { source: session } = source(() => ++reads === 1
      ? Response.json({ code: 'INTERNAL_ERROR', message: 'private server detail' }, { status: 500 })
      : Response.json({ ...profile, fullName: 'Recovered Name' }));
    const view = await renderWithSession(createElement(ProfileForm), session);
    expect(requiredElement(view, '[role="alert"]').textContent).toBe('The request could not be completed.');
    expect(view.querySelector('#profile-full-name')).toBeNull();
    await act(async () => [...view.querySelectorAll('button')].find((button) => button.textContent === 'Reload')?.click());
    await settle();
    expect(reads).toBe(2);
    expect(view.querySelector('[role="alert"]')).toBeNull();
    expect(requiredElement<HTMLInputElement>(view, '#profile-full-name').value).toBe('Recovered Name');
  });

  it('reloads the newer profile after a stale save and submits a later edit with that version', async () => {
    let reads = 0;
    let saves = 0;
    const newer = { ...profile, fullName: 'Other Tab', version: 4 };
    const { calls, source: session } = source((_path, init) => {
      if (init.method === 'GET') return Response.json(++reads === 1 ? profile : newer);
      return ++saves === 1 ? Response.json({ code: 'STALE_UPDATE' }, { status: 409 })
        : Response.json({ ...newer, fullName: 'After Reload', version: 5 });
    });
    const view = await renderWithSession(createElement(ProfileForm), session);
    setInputValue(view, '#profile-full-name', 'Old Draft');
    await submitForm(view);
    await settle();
    expect(document.activeElement).toBe(requiredElement(view, '[role="alert"]'));
    await act(async () => [...view.querySelectorAll('button')].find((button) => button.textContent === 'Reload')?.click());
    await settle();
    expect(document.activeElement).toBe(requiredElement(view, 'h1'));
    expect(requiredElement<HTMLInputElement>(view, '#profile-full-name').value).toBe('Other Tab');
    expect(view.querySelector('[role="alert"]')).toBeNull();
    expect(requiredElement<HTMLButtonElement>(view, 'button[type="submit"]').disabled).toBe(true);
    setInputValue(view, '#profile-full-name', 'After Reload');
    await submitForm(view);
    await settle();
    expect(JSON.parse(String(calls.filter(({ init }) => init.method === 'PUT')[1].init.body)).version).toBe(4);
    expect(requiredElement(view, '[role="status"]').textContent).toBe('Profile saved.');
  });

  it.each([
    ['full-name', 'x'.repeat(101), 'Enter a name of up to 100 characters.'],
    ['full-name', 'A' + ' '.repeat(100) + 'B', 'Enter a name of up to 100 characters.'],
    ['email', 'not-an-email', 'Enter a valid email address, or leave it empty.'],
    ['date-of-birth', '1899-12-31', 'Enter a date from 1 January 1900 to today.'],
    ['date-of-birth', '9999-12-31', 'Enter a date from 1 January 1900 to today.'],
  ])('refuses invalid %s before sending a save and links its field error', async (field, value, copy) => {
    const { calls, source: session } = source(() => Response.json(profile));
    const view = await renderWithSession(createElement(ProfileForm), session);
    const selector = `#profile-${field}`;
    setInputValue(view, selector, value);
    await submitForm(view);
    await settle();
    const input = requiredElement<HTMLInputElement>(view, selector);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(requiredElement(view, `#${input.getAttribute('aria-describedby')}`).textContent).toBe(copy);
    expect(document.activeElement).toBe(input);
    expect(calls.filter(({ init }) => init.method === 'PUT')).toHaveLength(0);
  });

  it('focuses the first invalid field after its error is linked, and limits Full name to 100 characters', async () => {
    const { source: session } = source(() => Response.json(profile));
    const view = await renderWithSession(createElement(ProfileForm), session);
    expect(requiredElement<HTMLInputElement>(view, '#profile-full-name').maxLength).toBe(100);
    setInputValue(view, '#profile-email', 'bad@');
    setInputValue(view, '#profile-date-of-birth', '9999-12-31');
    const email = requiredElement<HTMLInputElement>(view, '#profile-email');
    let describedAtFocus: string | null = null;
    email.addEventListener('focus', () => { describedAtFocus = email.getAttribute('aria-describedby'); });
    await submitForm(view);
    await settle();
    expect(document.activeElement).toBe(email);
    expect(describedAtFocus).toBe('profile-email-error');
    expect(requiredElement(view, '#profile-date-of-birth').getAttribute('aria-invalid')).toBe('true');
  });

  it('announces a cancelled mobile change and focuses the notice; a failed cancel focuses its error', async () => {
    let deletes = 0;
    const { source: session } = source((_path, init) => init.method !== 'DELETE'
      ? Response.json({ ...profile, pendingMobile: '01700000001' })
      : ++deletes === 1 ? Response.json({ code: 'INTERNAL_ERROR', message: 'private detail' }, { status: 500 })
        : new Response(null, { status: 204 }));
    const view = await renderWithSession(createElement(ProfileForm), session);
    const cancelChange = () => [...view.querySelectorAll('button')].find((button) => button.textContent === 'Cancel change');
    await act(async () => cancelChange()?.click());
    await settle();
    expect(document.activeElement).toBe(requiredElement(view, '[role="alert"]'));
    expect(view.textContent).toContain('New number 01700000001 is waiting for verification.');
    await act(async () => cancelChange()?.click());
    await settle();
    expect(cancelChange()).toBeUndefined();
    const notice = requiredElement(view, '[role="status"]');
    expect(notice.textContent).toBe('Mobile change cancelled.');
    expect(document.activeElement).toBe(notice);
  });

  it('keeps the verified current and pending mobile visible when a loaded account is closing', async () => {
    const { source: session } = source(() => Response.json({ ...profile,
      mobileVerified: true, pendingMobile: '01700000001', accountState: 'CLOSURE_REQUESTED' }));
    const view = await renderWithSession(createElement(ProfileForm), session);
    expect(requiredElement(view, '.chip').textContent).toBe('Verified');
    expect(view.textContent).toContain('01700000000');
    expect(view.textContent).toContain('New number 01700000001 is waiting for verification.');
    expect(requiredElement(view, '[role="status"]').textContent).toBe('Your account is closing.');
    expect(document.activeElement?.textContent).not.toBe('Your account is closing.');
    for (const input of view.querySelectorAll('input')) expect(input.disabled).toBe(true);
    for (const button of view.querySelectorAll('button')) {
      if (!button.closest('dialog')) expect(button.disabled).toBe(true);
    }
  });

  it('keeps a reopened dialog open when the close event from the previous close arrives late', async () => {
    const { source: session } = source(() => Response.json(profile));
    const view = await renderWithSession(createElement(ProfileForm), session);
    const change = [...view.querySelectorAll('button')].find((button) => button.textContent === 'Change')!;
    const dialog = requiredElement<HTMLDialogElement>(view, 'dialog');
    await act(async () => change.click());
    await act(async () => requiredElement<HTMLButtonElement>(view, 'dialog button[type="button"]').click());
    expect(dialog.open).toBe(false);
    await act(async () => change.click());
    expect(dialog.open).toBe(true);
    // The native close event of the first close, delivered only now.
    await act(async () => dialog.dispatchEvent(new Event('close')));
    expect(dialog.open).toBe(true);
    expect(document.activeElement).toBe(requiredElement(view, '#new-mobile'));
  });

  it('cancels a dialog without POST, then closes a successful stage and returns focus to Change', async () => {
    const { calls, source: session } = source((_path, init) => init.method === 'POST'
      ? Response.json({ ...profile, pendingMobile: '01700000001' }, { status: 202 }) : Response.json(profile));
    const view = await renderWithSession(createElement(ProfileForm), session);
    const note = requiredElement(view, '.profile-pending-note');
    expect(note.getAttribute('role')).toBe('status');
    expect(note.textContent).toBe('');
    const change = [...view.querySelectorAll('button')].find((button) => button.textContent === 'Change')!;
    await act(async () => change.click());
    setInputValue(view, '#new-mobile', '01700000001');
    await act(async () => requiredElement<HTMLButtonElement>(view, 'dialog button[type="button"]').click());
    expect(requiredElement<HTMLDialogElement>(view, 'dialog').open).toBe(false);
    expect(document.activeElement).toBe(change);
    expect(calls.filter(({ init }) => init.method === 'POST')).toHaveLength(0);
    await act(async () => change.click());
    expect(requiredElement<HTMLInputElement>(view, '#new-mobile').value).toBe('');
    setInputValue(view, '#new-mobile', '01700000001');
    await act(async () => requiredElement<HTMLFormElement>(view, 'dialog form').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })));
    await settle();
    expect(requiredElement<HTMLDialogElement>(view, 'dialog').open).toBe(false);
    expect(document.activeElement).toBe(change);
    expect(view.textContent).toContain('New number 01700000001 is waiting for verification.');
    // The note's live region exists before staging, so the note is announced when it appears, without Cancel change.
    expect(note.textContent).toBe('New number 01700000001 is waiting for verification.');
    expect(note.closest('.profile-pending')).not.toBeNull();
    expect(note.querySelector('button')).toBeNull();
    expect(calls.filter(({ init }) => init.method === 'POST')).toHaveLength(1);
  });
});
