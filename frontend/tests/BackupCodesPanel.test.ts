// @vitest-environment jsdom

import { act, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackupCodesPanel } from '../src/auth/BackupCodesPanel';
import { syntheticBackupCodes } from './fakeApi';
import { renderWithSession, requiredElement, settle, unmountAll } from './renderWithSession';

const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/staff/mfa/enroll' }));

const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

beforeEach(() => router.replace.mockClear());
afterEach(async () => {
  await unmountAll();
  if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
  else Reflect.deleteProperty(navigator, 'clipboard');
});

function useClipboard(writeText: ((text: string) => Promise<void>) | undefined): void {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: writeText && { writeText } });
}

async function renderPanel(onSaved = vi.fn()): Promise<HTMLElement> {
  return renderWithSession(createElement(BackupCodesPanel, { codes: syntheticBackupCodes, onSaved }));
}

async function clickButton(page: HTMLElement, name: string): Promise<void> {
  const button = [...page.querySelectorAll('button')].find((candidate) => candidate.textContent === name);
  if (!button) throw new Error(`Expected a button named ${name}`);
  await act(async () => button.click());
  await settle();
}

describe('BackupCodesPanel', () => {
  it('lists every code once under the once-only heading and warning', async () => {
    const page = await renderPanel();

    expect(requiredElement(page, 'h1').textContent).toBe('Backup codes (shown once)');
    expect(requiredElement(page, '.secret p').textContent).toBe('Save these now. Each works once if you lose your phone.');
    expect(requiredElement(page, 'ul').getAttribute('aria-label')).toBe('Backup codes');
    expect([...page.querySelectorAll('li')].map((item) => item.textContent)).toEqual(syntheticBackupCodes);
    expect(page.querySelector('[role="status"], [role="alert"]')).toBeNull();
  });

  it('copies all codes, one per line, and confirms it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    useClipboard(writeText);
    const page = await renderPanel();

    await clickButton(page, 'Copy all');

    expect(writeText).toHaveBeenCalledWith(syntheticBackupCodes.join('\n'));
    expect(requiredElement(page, '[role="status"]').textContent).toBe('Copied');
    expect(page.querySelector('[role="alert"]')).toBeNull();
  });

  it.each([
    ['the browser denies clipboard access', vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError'))],
    ['the clipboard is unavailable', undefined],
  ])('asks the user to copy the codes themselves when %s', async (_, writeText) => {
    useClipboard(writeText);
    const page = await renderPanel();

    await clickButton(page, 'Copy all');

    expect(requiredElement(page, '[role="alert"]').textContent)
      .toBe('The codes could not be copied. Select them and copy them yourself.');
    expect(page.querySelector('[role="status"]')).toBeNull();
    expect(page.querySelectorAll('li')).toHaveLength(10);
  });

  it('forgets the codes and opens the staff page once they are saved', async () => {
    const onSaved = vi.fn();
    const page = await renderPanel(onSaved);

    await clickButton(page, 'I’ve saved them');

    expect(onSaved).toHaveBeenCalledOnce();
    expect(router.replace).toHaveBeenCalledWith('/staff');
  });
});


it.each([
  ['SENT', 'success', 'We sent a notice to your verified contacts.'],
  ['FAILED', 'warn', 'We couldn’t send a notice to your verified contacts. Your new authenticator is active.'],
  ['NO_VERIFIED_CONTACT', 'warn', 'No verified contact to notify.'],
  ['NOT_CONFIGURED', 'warn', 'Security notices aren’t set up, so none was sent.'],
] as const)('shows %s as a %s notice', async (notice, tone, text) => {
  const page = await renderWithSession(createElement(BackupCodesPanel, {
    codes: syntheticBackupCodes, onSaved: vi.fn(), notice,
  }));
  expect(requiredElement(page, `.alert-${tone}`).textContent).toBe(text);
});

it('omits setup steps on a regeneration panel', async () => {
  const page = await renderWithSession(createElement(BackupCodesPanel, {
    codes: syntheticBackupCodes, onSaved: vi.fn(), steps: false,
  }));
  expect(page.querySelector('.steps-mini')).toBeNull();
});
