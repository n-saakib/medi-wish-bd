// @vitest-environment jsdom

import { act, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSession, type SessionSource } from '../src/auth/SessionProvider';
import { BackupCodesRegeneration } from '../src/staff/BackupCodesRegeneration';
import { ApiError } from '../src/lib/api';
import { createSessionClient } from '../src/lib/session';
import { apiRoutes, deferred, installFakeLocks, restoredStaff, sessionBody, syntheticBackupCodes } from './fakeApi';
import { createSessionSource, renderWithSession, requiredElement, setInputValue, settle, submitForm, unmountAll } from './renderWithSession';

const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/staff/backup-codes' }));
beforeEach(() => router.replace.mockClear());
afterEach(unmountAll);
function source(overrides: Partial<SessionSource> = {}) {
  return createSessionSource({ restoreSession: vi.fn().mockResolvedValue(restoredStaff('VERIFIED')),
    regenerateBackupCodes: vi.fn().mockResolvedValue(syntheticBackupCodes), ...overrides });
}
async function enterCode(page: HTMLElement, value = '123 456') {
  setInputValue(page, '#backup-codes-code', value);
  await submitForm(page);
  await settle();
}

describe('BackupCodesRegeneration', () => {
  it('validates six digits locally without sending malformed input', async () => {
    const session = source();
    const page = await renderWithSession(createElement(BackupCodesRegeneration), session);
    await enterCode(page, '123');
    expect(session.regenerateBackupCodes).not.toHaveBeenCalled();
    expect(requiredElement(page, '[role="alert"]').textContent).toBe('Enter the 6 digits shown in your authenticator app.');
    expect(document.activeElement).toBe(requiredElement(page, 'input'));
    expect(requiredElement(page, 'a').getAttribute('href')).toBe('/staff');
  });

  it('posts normalized digits through the real client, shows codes without steps and leaves only when saved', async () => {
    const locks = installFakeLocks();
    try {
      const api = apiRoutes({
        '/api/auth/refresh': () => Response.json(sessionBody('verified', 'VERIFIED')),
        '/api/auth/mfa/backup-codes': () => Response.json({ backupCodes: syntheticBackupCodes }),
      });
      const page = await renderWithSession(createElement(BackupCodesRegeneration), createSessionClient({ fetch: api.fetch }));
      await enterCode(page);
      expect(await api.requests.at(-1)!.json()).toEqual({ code: '123456' });
      expect(page.querySelectorAll('li')).toHaveLength(10);
      expect(page.querySelector('.steps-mini')).toBeNull();
      expect(router.replace).not.toHaveBeenCalled();
      const saved = [...page.querySelectorAll('button')].find((button) => button.textContent === 'I’ve saved them')!;
      await act(async () => saved.click());
      expect(router.replace).toHaveBeenCalledWith('/staff');
      expect(page.querySelector('ul')).toBeNull();
    } finally { locks.restore(); }
  });

  it('disables submission while busy and clears codes on pagehide', async () => {
    const pending = deferred<string[]>();
    const page = await renderWithSession(createElement(BackupCodesRegeneration), source({
      regenerateBackupCodes: vi.fn(() => pending.promise),
    }));
    await enterCode(page);
    expect(requiredElement<HTMLButtonElement>(page, 'button[type="submit"]').disabled).toBe(true);
    expect(page.textContent).toContain('Getting codes…');
    await act(async () => pending.resolve(syntheticBackupCodes));
    expect(page.textContent).toContain(syntheticBackupCodes[0]);
    await act(async () => window.dispatchEvent(new Event('pagehide')));
    expect(page.textContent).not.toContain(syntheticBackupCodes[0]);
  });

  it('does not redisplay a response that finishes after pagehide', async () => {
    const pending = deferred<string[]>();
    const page = await renderWithSession(createElement(BackupCodesRegeneration), source({
      regenerateBackupCodes: vi.fn(() => pending.promise),
    }));
    await enterCode(page);
    await act(async () => window.dispatchEvent(new Event('pagehide')));
    await act(async () => pending.resolve(syntheticBackupCodes));
    expect(page.querySelector('ul')).toBeNull();
  });

  it.each([
    ['MFA_CODE_INVALID', 400, 'The code is invalid or has already been used.', false],
    ['TOO_MANY_ATTEMPTS', 429, 'Too many attempts. Try again later.', true],
    ['INTERNAL_ERROR', 500, 'The request could not be completed.', false],
  ] as const)('shows bounded %s feedback and the right retry state', async (code, status, text, locked) => {
    const page = await renderWithSession(createElement(BackupCodesRegeneration), source({
      regenerateBackupCodes: vi.fn().mockRejectedValue(new ApiError(code, status)),
    }));
    await enterCode(page);
    expect(requiredElement(page, '[role="alert"]').textContent).toBe(text);
    expect(requiredElement<HTMLInputElement>(page, 'input').disabled).toBe(locked);
    expect(requiredElement<HTMLInputElement>(page, 'input').value).toBe('');
    expect(requiredElement<HTMLButtonElement>(page, 'button[type="submit"]').disabled).toBe(locked);
    if (!locked) expect(document.activeElement).toBe(requiredElement(page, 'input'));
  });

  it.each([
    ['NOT_REQUIRED', '/account'], ['ENROLLMENT_REQUIRED', '/staff/mfa/enroll'],
    ['REPLACEMENT_REQUIRED', '/staff/mfa/enroll'], ['VERIFICATION_REQUIRED', '/staff/mfa'],
  ] as const)('redirects %s without displaying the regeneration form', async (mfa, target) => {
    const session = source({ restoreSession: vi.fn().mockResolvedValue(restoredStaff(mfa)) });
    const page = await renderWithSession(createElement(BackupCodesRegeneration), session);
    expect(router.replace).toHaveBeenCalledWith(target);
    expect(page.querySelector('form')).toBeNull();
    expect(session.regenerateBackupCodes).not.toHaveBeenCalled();
  });

  it('removes displayed codes when the session signs out', async () => {
    function Page() {
      const session = useSession();
      return <><button onClick={() => void session.signOut()}>Leave session</button><BackupCodesRegeneration /></>;
    }
    const page = await renderWithSession(createElement(Page), source());
    await enterCode(page);
    expect(page.textContent).toContain(syntheticBackupCodes[0]);
    await act(async () => requiredElement<HTMLButtonElement>(page, 'button').click());
    expect(page.querySelector('ul')).toBeNull();
    expect(router.replace).toHaveBeenCalledWith('/sign-in');
  });
});
