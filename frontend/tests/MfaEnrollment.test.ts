// @vitest-environment jsdom

import { act, createElement, StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MfaEnrollment } from '../src/auth/MfaEnrollment';
import { type SessionSource, useSession } from '../src/auth/SessionProvider';
import { ApiError } from '../src/lib/api';
import type { ContactNotice, EnrolledSession, MfaEnrollment as PendingEnrollment } from '../src/lib/session';
import { deferred, enrollmentBody, restoredStaff, signedInUser, syntheticBackupCodes } from './fakeApi';
import {
  createSessionSource,
  renderWithSession,
  requiredElement,
  setInputValue,
  settle,
  submitForm,
  unmountAll,
} from './renderWithSession';

const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/staff/mfa/enroll' }));

beforeEach(() => router.replace.mockClear());
afterEach(unmountAll);

const firstSecret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const secondSecret = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const firstEnrollment = enrollmentBody(firstSecret, '11111111-1111-4111-8111-111111111111');
const secondEnrollment = enrollmentBody(secondSecret, '22222222-2222-4222-8222-222222222222');
const enrolled: EnrolledSession = {
  accessToken: 'access-verified',
  user: signedInUser,
  mfa: 'VERIFIED',
  backupCodes: syntheticBackupCodes,
  contactNotice: null,
};

function enrollmentSource(overrides: Partial<SessionSource> = {}): SessionSource {
  return createSessionSource({
    restoreSession: vi.fn().mockResolvedValue(restoredStaff('ENROLLMENT_REQUIRED')),
    startMfaEnrollment: vi.fn().mockResolvedValue(firstEnrollment),
    verifyMfaEnrollment: vi.fn().mockResolvedValue(enrolled),
    ...overrides,
  });
}

async function renderEnrollment(source = enrollmentSource(), element = createElement(MfaEnrollment)): Promise<HTMLElement> {
  const page = await renderWithSession(element, source);
  await settle();
  return page;
}

async function enterCode(page: HTMLElement, code: string): Promise<void> {
  setInputValue(page, '#mfa-enroll-code', code);
  await submitForm(page);
  await settle();
}

async function click(button: HTMLButtonElement): Promise<void> {
  await act(async () => button.click());
  await settle();
}

function buttonNamed(page: ParentNode, name: string): HTMLButtonElement {
  const button = [...page.querySelectorAll('button')].find((candidate) => candidate.textContent === name);
  if (!button) throw new Error(`Expected a button named ${name}`);
  return button;
}

function pageTransition(type: 'pagehide' | 'pageshow', persisted: boolean): Event {
  const event = new Event(type);
  Object.defineProperty(event, 'persisted', { value: persisted });
  return event;
}

describe('MfaEnrollment', () => {
  it('shows the QR code, the grouped manual key and a labelled numeric code field', async () => {
    const source = enrollmentSource();
    const page = await renderEnrollment(source);

    expect(source.startMfaEnrollment).toHaveBeenCalledOnce();
    expect(requiredElement(page, 'h1').textContent).toBe('Set up your authenticator');
    const qr = requiredElement(page, '[role="img"]');
    expect(qr.getAttribute('aria-label')).toBe('QR code to scan with your authenticator app');
    expect(qr.querySelector('svg')).not.toBeNull();
    expect(requiredElement(page, 'summary').textContent).toBe('Can’t scan?');
    expect(requiredElement(page, 'details code').textContent).toBe('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP');
    const input = requiredElement<HTMLInputElement>(page, '#mfa-enroll-code');
    expect(requiredElement(page, 'label[for="mfa-enroll-code"]').textContent).toBe('Enter the 6-digit code');
    expect(input.inputMode).toBe('numeric');
    expect(input.autocomplete).toBe('one-time-code');
    expect(input.maxLength).toBe(7);
    expect(page.querySelector('[role="alert"]')).toBeNull();
  });

  it('shows a preparing status and keeps Verify disabled until the setup arrives', async () => {
    const start = deferred<PendingEnrollment>();
    const page = await renderEnrollment(enrollmentSource({ startMfaEnrollment: vi.fn(() => start.promise) }));

    expect(requiredElement(page, '[role="status"]').textContent).toBe('Preparing your setup…');
    expect(requiredElement<HTMLButtonElement>(page, 'button[type="submit"]').disabled).toBe(true);

    await act(async () => start.resolve(firstEnrollment));
    await settle();
    expect(requiredElement<HTMLButtonElement>(page, 'button[type="submit"]').disabled).toBe(false);
  });

  it('verifies the digits, then shows the backup codes without leaving until they are saved', async () => {
    const source = enrollmentSource();
    const page = await renderEnrollment(source);

    await enterCode(page, '287 082');

    expect(source.verifyMfaEnrollment).toHaveBeenCalledWith(firstEnrollment.enrollmentId, '287082');
    expect(requiredElement(page, 'h1').textContent).toBe('Backup codes (shown once)');
    expect(document.activeElement).toBe(requiredElement(page, 'h1'));
    expect([...page.querySelectorAll('li code')].map((code) => code.textContent)).toEqual(syntheticBackupCodes);
    expect(page.textContent).not.toContain(firstSecret);
    expect(router.replace).not.toHaveBeenCalled();

    await click(buttonNamed(page, 'I’ve saved them'));

    expect(router.replace).toHaveBeenCalledWith('/staff');
    expect(page.textContent).not.toContain(syntheticBackupCodes[0]);
  });

  it('asks for six digits without calling the API', async () => {
    const source = enrollmentSource();
    const page = await renderEnrollment(source);

    await enterCode(page, '12 34 5');

    expect(source.verifyMfaEnrollment).not.toHaveBeenCalled();
    expect(requiredElement(page, '[role="alert"]').textContent).toBe('Enter the 6 digits shown in your authenticator app.');
    expect(document.activeElement).toBe(requiredElement(page, '#mfa-enroll-code'));
  });

  it('reports an invalid code, clears the field and focuses it for another try', async () => {
    const page = await renderEnrollment(enrollmentSource({
      verifyMfaEnrollment: vi.fn().mockRejectedValue(new ApiError('MFA_CODE_INVALID', 400)),
    }));

    await enterCode(page, '000000');

    expect(requiredElement(page, '[role="alert"]').textContent).toBe('The code is invalid or has already been used.');
    const input = requiredElement<HTMLInputElement>(page, '#mfa-enroll-code');
    expect(input.value).toBe('');
    expect(input.disabled).toBe(false);
    expect(document.activeElement).toBe(input);
    expect(page.textContent).toContain('JBSW Y3DP');
  });

  it('starts a new setup when the old one expired and verifies against the new one', async () => {
    const verifyMfaEnrollment = vi.fn()
      .mockRejectedValueOnce(new ApiError('MFA_ENROLLMENT_STALE', 409))
      .mockResolvedValueOnce(enrolled);
    const source = enrollmentSource({
      startMfaEnrollment: vi.fn().mockResolvedValueOnce(firstEnrollment).mockResolvedValueOnce(secondEnrollment),
      verifyMfaEnrollment,
    });
    const page = await renderEnrollment(source);

    await enterCode(page, '287082');

    expect(source.startMfaEnrollment).toHaveBeenCalledTimes(2);
    const notice = requiredElement(page, '[role="status"]');
    expect(notice.textContent).toBe('That setup expired, so a new one has started. Scan the new QR code or enter the new key.');
    expect(requiredElement(page, 'details code').textContent).toBe('ABCD EFGH IJKL MNOP QRST UVWX YZ23 4567');
    expect(page.textContent).not.toContain('JBSW');

    await enterCode(page, '123456');
    expect(verifyMfaEnrollment).toHaveBeenLastCalledWith(secondEnrollment.enrollmentId, '123456');
  });

  it('disables the form and announces the lock after too many attempts', async () => {
    const page = await renderEnrollment(enrollmentSource({
      verifyMfaEnrollment: vi.fn().mockRejectedValue(new ApiError('TOO_MANY_ATTEMPTS', 429)),
    }));

    await enterCode(page, '000000');

    const alert = requiredElement(page, '[role="alert"]');
    expect(alert.textContent).toBe('Too many attempts. Try again later.');
    expect(document.activeElement).toBe(alert);
    expect(requiredElement<HTMLInputElement>(page, '#mfa-enroll-code').disabled).toBe(true);
    expect(requiredElement<HTMLButtonElement>(page, 'button[type="submit"]').disabled).toBe(true);
  });

  it('shows only the latest setup when an older start answers last', async () => {
    const first = deferred<PendingEnrollment>();
    const second = deferred<PendingEnrollment>();
    const page = await renderEnrollment(enrollmentSource({
      startMfaEnrollment: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise),
    }));

    await act(async () => window.dispatchEvent(pageTransition('pageshow', true)));
    await act(async () => second.resolve(secondEnrollment));
    await settle();
    await act(async () => first.resolve(firstEnrollment));
    await settle();

    expect(requiredElement(page, 'details code').textContent).toBe('ABCD EFGH IJKL MNOP QRST UVWX YZ23 4567');
    expect(page.textContent).not.toContain('JBSW');
  });

  it('offers a retry when the setup cannot start', async () => {
    const source = enrollmentSource({
      startMfaEnrollment: vi.fn().mockRejectedValueOnce(new ApiError('INTERNAL_ERROR', 500)).mockResolvedValueOnce(firstEnrollment),
    });
    const page = await renderEnrollment(source);

    expect(requiredElement(page, '[role="alert"]').textContent).toBe('The request could not be completed.');
    await click(buttonNamed(page, 'Try again'));

    expect(source.startMfaEnrollment).toHaveBeenCalledTimes(2);
    expect(page.querySelector('[role="alert"]')).toBeNull();
    expect(requiredElement(page, 'details code').textContent).toContain('JBSW');
    expect(document.activeElement).toBe(requiredElement(page, 'h1'));
  });

  it('starts one setup when StrictMode re-runs the mount effect, and verifies against it', async () => {
    const start = deferred<PendingEnrollment>();
    const source = enrollmentSource({
      startMfaEnrollment: vi.fn().mockReturnValueOnce(start.promise).mockResolvedValueOnce(secondEnrollment),
    });
    // Mounts only once the session is restored, as after a client-side sign-in, so the start runs on mount.
    function RestoredEnrollment() {
      return useSession().restoring ? null : createElement(StrictMode, null, createElement(MfaEnrollment));
    }
    const page = await renderEnrollment(source, createElement(RestoredEnrollment));
    await act(async () => start.resolve(firstEnrollment));
    await settle();

    expect(source.startMfaEnrollment).toHaveBeenCalledOnce();
    expect(requiredElement(page, 'details code').textContent).toContain('JBSW');
    await enterCode(page, '287082');
    expect(source.verifyMfaEnrollment).toHaveBeenCalledWith(firstEnrollment.enrollmentId, '287082');
  });

  it('drops the secret when the page is hidden and starts afresh when restored from the back/forward cache', async () => {
    const source = enrollmentSource({
      startMfaEnrollment: vi.fn().mockResolvedValueOnce(firstEnrollment).mockResolvedValueOnce(secondEnrollment),
    });
    const page = await renderEnrollment(source);

    await act(async () => window.dispatchEvent(pageTransition('pagehide', true)));
    expect(page.textContent).not.toContain('JBSW');
    expect(page.querySelector('[role="img"]')).toBeNull();

    await act(async () => window.dispatchEvent(pageTransition('pageshow', true)));
    await settle();
    expect(source.startMfaEnrollment).toHaveBeenCalledTimes(2);
    expect(requiredElement(page, 'details code').textContent).toContain('ABCD');
  });

  it('drops the backup codes when the page is hidden, then continues to the staff page', async () => {
    const page = await renderEnrollment();
    await enterCode(page, '287082');
    expect(page.textContent).toContain(syntheticBackupCodes[0]);

    await act(async () => window.dispatchEvent(pageTransition('pagehide', true)));
    await settle();

    expect(page.textContent).not.toContain(syntheticBackupCodes[0]);
    expect(router.replace).toHaveBeenCalledWith('/staff');
  });

  it('leaves no secret or code in the document after unmount', async () => {
    const page = await renderEnrollment();
    await enterCode(page, '287082');

    await unmountAll();

    expect(page.textContent).toBe('');
    expect(document.body.innerHTML).not.toContain(syntheticBackupCodes[0]);
    expect(document.body.innerHTML).not.toContain(firstSecret);
  });

  it('keeps the secret and codes out of browser storage, the URL and the console', async () => {
    const storageCalls: string[] = [];
    const storage = {
      getItem: (key: string) => { storageCalls.push(key); return null; },
      setItem: (key: string) => { storageCalls.push(key); },
      removeItem: (key: string) => { storageCalls.push(key); },
      clear: () => { storageCalls.push('clear'); },
    };
    const localStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const sessionStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
    const consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) => vi.spyOn(console, method));
    const historyWrites = [vi.spyOn(window.history, 'pushState'), vi.spyOn(window.history, 'replaceState')];
    const startUrl = window.location.href;
    try {
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
      Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: storage });

      const page = await renderEnrollment();
      await enterCode(page, '287082');
      await click(buttonNamed(page, 'I’ve saved them'));

      expect(storageCalls).toEqual([]);
      expect(window.location.href).toBe(startUrl);
      const observed = JSON.stringify([
        ...consoleSpies.map((spy) => spy.mock.calls),
        ...historyWrites.map((spy) => spy.mock.calls),
        router.replace.mock.calls,
      ]);
      expect(observed).not.toContain(firstSecret);
      expect(observed).not.toContain(syntheticBackupCodes[0]);
    } finally {
      for (const spy of [...consoleSpies, ...historyWrites]) spy.mockRestore();
      if (localStorageDescriptor) Object.defineProperty(globalThis, 'localStorage', localStorageDescriptor);
      else Reflect.deleteProperty(globalThis, 'localStorage');
      if (sessionStorageDescriptor) Object.defineProperty(globalThis, 'sessionStorage', sessionStorageDescriptor);
      else Reflect.deleteProperty(globalThis, 'sessionStorage');
    }
  });

  it('sends a session that no longer needs setup to its own page without starting one', async () => {
    const source = enrollmentSource({ restoreSession: vi.fn().mockResolvedValue(restoredStaff('VERIFICATION_REQUIRED')) });
    await renderEnrollment(source);

    expect(source.startMfaEnrollment).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith('/staff/mfa');
  });
});


it.each([
  ['SENT', 'We sent a notice to your verified contacts.'],
  ['FAILED', 'We couldn’t send a notice to your verified contacts. Your new authenticator is active.'],
  ['NO_VERIFIED_CONTACT', 'No verified contact to notify.'],
  ['NOT_CONFIGURED', 'Security notices aren’t set up, so none was sent.'],
] satisfies [ContactNotice, string][])('replaces an authenticator and holds the %s notice with its once-only codes', async (contactNotice, text) => {
  const source = enrollmentSource({
    restoreSession: vi.fn().mockResolvedValue(restoredStaff('REPLACEMENT_REQUIRED')),
    verifyMfaEnrollment: vi.fn().mockResolvedValue({ ...enrolled, contactNotice }),
  });
  const page = await renderEnrollment(source);
  expect(source.startMfaEnrollment).toHaveBeenCalledOnce();
  expect(requiredElement(page, 'h1').textContent).toBe('Set up your new authenticator');
  expect(page.textContent).toContain('Your old authenticator stops working once this one is verified.');
  await enterCode(page, '287082');
  expect(requiredElement(page, 'h1').textContent).toBe('Backup codes (shown once)');
  expect(page.textContent).toContain(text);
  expect(router.replace).not.toHaveBeenCalled();
  await act(async () => window.dispatchEvent(pageTransition('pagehide', true)));
  await settle();
  expect(page.textContent).not.toContain(syntheticBackupCodes[0]);
  expect(router.replace).toHaveBeenCalledWith('/staff');
});

it('keeps a first enrollment free of a replacement notice', async () => {
  const page = await renderEnrollment(enrollmentSource({
    verifyMfaEnrollment: vi.fn().mockResolvedValue({ ...enrolled, contactNotice: 'SENT' }),
  }));
  await enterCode(page, '287082');
  expect(page.textContent).toContain(syntheticBackupCodes[0]);
  expect(page.textContent).not.toContain('We sent a notice to your verified contacts.');
  expect(page.querySelector('.secret .alert')).toBeNull();
});


it('hides the once-only codes when the header signs out of the session', async () => {
  function Page() {
    const session = useSession();
    return createElement('div', null,
      createElement('button', { onClick: () => void session.signOut() }, 'Leave session'),
      createElement(MfaEnrollment));
  }
  const page = await renderEnrollment(enrollmentSource(), createElement(Page));
  await enterCode(page, '287082');
  expect(page.textContent).toContain(syntheticBackupCodes[0]);
  await click(buttonNamed(page, 'Leave session'));
  expect(page.querySelector('ul')).toBeNull();
  expect(router.replace).toHaveBeenCalledWith('/sign-in');
});


it('never redisplays codes when verification finishes after pagehide', async () => {
  const pending = deferred<EnrolledSession>();
  const page = await renderEnrollment(enrollmentSource({
    restoreSession: vi.fn().mockResolvedValue(restoredStaff('REPLACEMENT_REQUIRED')),
    verifyMfaEnrollment: vi.fn(() => pending.promise),
  }));
  await enterCode(page, '287082');
  await act(async () => window.dispatchEvent(pageTransition('pagehide', true)));
  await act(async () => pending.resolve({ ...enrolled, contactNotice: 'SENT' }));
  await settle();
  expect(page.querySelector('ul')).toBeNull();
  expect(page.textContent).not.toContain(syntheticBackupCodes[0]);
  expect(router.replace).toHaveBeenCalledWith('/staff');
});
