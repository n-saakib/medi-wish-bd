import { expect, test, type Page } from '@playwright/test';
import {
  alertWith, auditCount, backupDialog, copy, countRequests, expireReplacementSessions, factorRows, factorStatuses,
  finishReplacement, noticeText, openBackupDialog, recoveringStaff, replaceThroughPages, signInToChallenge,
  signOutFromStaff, submitBackupCode, submitBackupCodeAndWait, throttleState, typedLoosely, redeemBackupCode,
  verifySetupKey, wrongBackupCode, wrongTotp, type Replacement,
} from './staffMfaRecoverySupport';
import { freshCode, readBackupCodes, readManualKey, registerThroughApi, signIn, signInWithCode } from './support';
import { apiUrl, frontendUrl } from './testApi';
import { totpCode, totpStep } from './totp';

/**
 * Ticket 09 in the browser against the real test API: a staff member who lost their phone uses a backup code from the
 * challenge page, sets up a new authenticator and gets new codes; a verified staff member regenerates their codes
 * (plan §4.6, §10.2). Tags: `@t09` plus `@t09-T5`, the integration sub-ticket; they need T2–T4's API and T3's pages.
 *
 * Run while developing: `npm run test:browser -- --grep "@t09-T5" --project chrome` (build the backend jar first).
 */

const t5 = { tag: ['@t09', '@t09-T5'] };

/** Signs the member out of `/staff` and back in with the password, ending on the code challenge. */
async function backToChallenge(page: Page, member: Parameters<typeof signInToChallenge>[1]): Promise<void> {
  await signOutFromStaff(page);
  await signInToChallenge(page, member);
}

test('E2E-09-01 a Moderator replaces a lost authenticator with a backup code', t5, async ({ page, browser }) => {
  test.setTimeout(240_000);
  const member = await recoveringStaff(page);
  const other = await browser.newContext({ baseURL: frontendUrl });
  const otherPage = await other.newPage();
  let replacement!: Replacement;

  await test.step('a second browser signs in with the authenticator', async () => {
    await signInWithCode(otherPage, member);
    await expect(otherPage.getByRole('heading', { name: copy.staffTitle })).toBeVisible();
  });

  await test.step('the main browser signs in with the password and uses a backup code from the challenge', async () => {
    await backToChallenge(page, member);
    await expect(page.getByRole('button', { name: copy.lostPhone })).toBeVisible();
    await redeemBackupCode(page, member.backupCodes[0]);
    await expect(page.getByText(copy.replaceIntro, { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: copy.firstEnrollTitle, exact: true })).toHaveCount(0);
  });

  await test.step('the new authenticator is verified: the notice and 10 fresh codes are shown, then /staff', async () => {
    replacement = await finishReplacement(page, 'SENT');
    expect(replacement.authenticator.key).not.toBe(member.authenticator.key);
    expect(replacement.backupCodes.filter((code) => member.backupCodes.includes(code))).toEqual([]);
    await expect(page).toHaveURL('/staff/mfa/enroll');
    await page.getByRole('button', { name: copy.saved }).click();
    await expect(page).toHaveURL('/staff');
    await expect(page.getByRole('heading', { name: copy.staffTitle })).toBeVisible();
    expect(factorStatuses(member.username)).toEqual(['REVOKED', 'ACTIVE']);
  });

  await test.step('the second browser was signed out by the replacement', async () => {
    await otherPage.reload();
    await expect(otherPage).toHaveURL('/sign-in');
    await other.close();
  });

  await test.step('signed in again, the old authenticator, the used code and an old unused code are refused', async () => {
    // Read before signing in: the fixture's access token lasts ten seconds, shorter than a wait for the next TOTP step.
    const oldCode = await freshCode(member.authenticator);
    await backToChallenge(page, member);
    const field = page.getByLabel(copy.challengeCodeLabel);
    await field.fill(oldCode);
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(alertWith(page, copy.codeInvalid)).toBeVisible();
    await expect(page).toHaveURL('/staff/mfa');

    for (const code of [member.backupCodes[0], member.backupCodes[1]]) {
      const dialog = await openBackupDialog(page);
      expect(await submitBackupCodeAndWait(page, code)).toBe(400);
      await expect(alertWith(dialog, copy.codeInvalid)).toBeVisible();
      await expect(dialog.getByLabel(copy.backupCodeLabel)).toHaveValue('');
      await expect(dialog.getByLabel(copy.backupCodeLabel)).toBeFocused();
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await expect(backupDialog(page)).toBeHidden();
    }
  });

  await test.step('the new authenticator signs in', async () => {
    const code = await freshCode(replacement.authenticator);
    // The refused attempts above may have outlasted the fixture's ten-second access token; reloading renews it.
    await page.reload();
    await expect(page).toHaveURL('/staff/mfa');
    await page.getByLabel(copy.challengeCodeLabel).fill(code);
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page).toHaveURL('/staff');
    await expect(page.getByRole('heading', { name: copy.staffTitle })).toBeVisible();
  });
});

test('E2E-09-02 a wrong backup code shows an error and the fifth failure locks the dialog', t5, async ({ page }) => {
  const member = await recoveringStaff(page);
  await backToChallenge(page, member);
  const dialog = await openBackupDialog(page);
  const field = dialog.getByLabel(copy.backupCodeLabel);
  const continueButton = dialog.getByRole('button', { name: 'Continue' });

  await test.step('four wrong codes each show the invalid-code error, clear the field and focus it', async () => {
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      expect(await submitBackupCodeAndWait(page, wrongBackupCode(member.backupCodes))).toBe(400);
      await expect(alertWith(dialog, copy.codeInvalid)).toBeVisible();
      await expect(field).toHaveValue('');
      await expect(field).toBeFocused();
    }
    expect(throttleState(member.username)).toEqual({ failedCount: 4, locked: false });
  });

  await test.step('the fifth shows the lockout: the field and Continue are disabled, Cancel still works', async () => {
    expect(await submitBackupCodeAndWait(page, wrongBackupCode(member.backupCodes))).toBe(429);
    await expect(alertWith(dialog, copy.tooManyAttempts)).toBeVisible();
    await expect(alertWith(dialog, copy.codeInvalid)).toHaveCount(0);
    await expect(field).toBeDisabled();
    await expect(continueButton).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeEnabled();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(backupDialog(page)).toBeHidden();
    await expect(page.getByRole('button', { name: copy.lostPhone })).toBeFocused();
  });

  await test.step('the lock is shared: a correct authenticator code is refused too, and no backup code was spent',
    async () => {
      const code = await freshCode(member.authenticator);
      // Slow code checks can outlast the fixture's ten-second access token.
      await page.reload();
      await expect(page).toHaveURL('/staff/mfa');
      await page.getByLabel(copy.challengeCodeLabel).fill(code);
      await page.getByRole('button', { name: 'Verify' }).click();
      await expect(alertWith(page, copy.tooManyAttempts)).toBeVisible();
      await expect(page).toHaveURL('/staff/mfa');
      expect(throttleState(member.username).locked).toBe(true);
      expect(factorRows(member.username)[0]).toMatchObject({ status: 'ACTIVE', unusedCodes: 10, usedCodes: 0 });
    });
});

test('E2E-09-03 reloading the setup page during a replacement starts a fresh setup', t5, async ({ page }) => {
  const member = await recoveringStaff(page);
  await backToChallenge(page, member);
  await redeemBackupCode(page, member.backupCodes[0]);
  const firstKey = await readManualKey(page);

  await page.reload();
  await expect(page).toHaveURL('/staff/mfa/enroll');
  await expect(page.getByRole('heading', { name: copy.replaceTitle })).toBeVisible();
  const secondKey = await readManualKey(page);
  expect(secondKey).not.toBe(firstKey);
  expect(secondKey).not.toBe(member.authenticator.key);
  expect(factorStatuses(member.username), 'the restart replaced the pending factor').toEqual(['ACTIVE', 'PENDING']);

  await verifySetupKey(page, secondKey);
  await expect(page.getByText(noticeText.SENT, { exact: true })).toBeVisible();
  expect(await readBackupCodes(page)).toHaveLength(10);
  await page.getByRole('button', { name: copy.saved }).click();
  await expect(page).toHaveURL('/staff');
  expect(factorStatuses(member.username)).toEqual(['REVOKED', 'ACTIVE']);
});

test('E2E-09-06 a verified Admin gets new backup codes and the old ones stop working', t5, async ({ page }) => {
  test.setTimeout(180_000);
  const member = await recoveringStaff(page, 'ADMIN');
  let fresh: string[] = [];

  await test.step('the staff home links to the regeneration page', async () => {
    await page.getByRole('navigation', { name: 'Staff pages' }).getByRole('link', { name: copy.regenerateTitle }).click();
    await expect(page).toHaveURL('/staff/backup-codes');
    await expect(page.getByRole('heading', { level: 1, name: copy.regenerateTitle })).toBeVisible();
    await expect(page.getByText(copy.regenerateIntro, { exact: true })).toBeVisible();
  });

  await test.step('a fresh authenticator code shows 10 new codes, held on the page until they are saved', async () => {
    await page.getByLabel(copy.regenerateCodeLabel).fill(await freshCode(member.authenticator));
    await page.getByRole('button', { name: copy.regenerateTitle }).click();
    await expect(page.getByRole('heading', { name: copy.backupTitle })).toBeVisible();
    fresh = await readBackupCodes(page);
    expect(fresh.filter((code) => member.backupCodes.includes(code))).toEqual([]);
    for (const text of Object.values(noticeText)) await expect(page.getByText(text, { exact: true })).toHaveCount(0);
    await expect(page).toHaveURL('/staff/backup-codes');
    await page.getByRole('button', { name: copy.saved }).click();
    await expect(page).toHaveURL('/staff');
    await expect(page.getByRole('heading', { name: copy.staffTitle }), 'the session was kept').toBeVisible();
    expect(factorRows(member.username)).toEqual([expect.objectContaining({ unusedCodes: 10, usedCodes: 0 })]);
    expect(auditCount(member.username, 'MFA_BACKUP_CODES_REGENERATED')).toBe(1);
  });

  await test.step('after signing in again, an old code is refused and a new one opens the setup', async () => {
    await backToChallenge(page, member);
    const dialog = await openBackupDialog(page);
    expect(await submitBackupCodeAndWait(page, member.backupCodes[0])).toBe(400);
    await expect(alertWith(dialog, copy.codeInvalid)).toBeVisible();
    expect(await submitBackupCodeAndWait(page, fresh[0])).toBe(200);
    await expect(page).toHaveURL('/staff/mfa/enroll');
    await expect(page.getByRole('heading', { name: copy.replaceTitle })).toBeVisible();
  });
});

test('E2E-09-09 the dialog closes three ways, keeps focus and checks the format before sending', t5, async ({ page }) => {
  const member = await recoveringStaff(page);
  await backToChallenge(page, member);
  const lostPhone = page.getByRole('button', { name: copy.lostPhone });
  const recoveryRequests = countRequests(page, '/api/auth/mfa/recovery');

  await test.step('the open dialog: heading, labelled field, hint, Cancel and Continue', async () => {
    const dialog = await openBackupDialog(page);
    await expect(dialog.getByRole('heading', { level: 2, name: copy.dialogTitle })).toBeVisible();
    await expect(dialog.getByText(copy.dialogHint, { exact: true })).toBeVisible();
    const field = dialog.getByRole('textbox', { name: copy.backupCodeLabel });
    await expect(field).toHaveAttribute('placeholder', 'XXXX-XXXX');
    await expect(field).toHaveAttribute('autocomplete', 'off');
    await expect(field).toHaveAttribute('spellcheck', 'false');
    for (const name of ['Close', 'Cancel', 'Continue']) await expect(dialog.getByRole('button', { name })).toBeVisible();
  });

  for (const close of ['Cancel', 'Close', 'Escape'] as const) {
    await test.step(`${close} closes it, clears the field and returns focus to "Lost your phone?"`, async () => {
      const dialog = await backupDialog(page).isVisible() ? backupDialog(page) : await openBackupDialog(page);
      await dialog.getByLabel(copy.backupCodeLabel).fill('ABCD');
      if (close === 'Escape') await page.keyboard.press('Escape');
      else await dialog.getByRole('button', { name: close, exact: true }).click();
      await expect(backupDialog(page)).toBeHidden();
      await expect(lostPhone).toBeFocused();
      const reopened = await openBackupDialog(page);
      await expect(reopened.getByLabel(copy.backupCodeLabel)).toHaveValue('');
      await page.keyboard.press('Escape');
      await expect(lostPhone).toBeFocused();
    });
  }

  await test.step('a malformed code shows the format error, linked to the field, and sends nothing', async () => {
    const dialog = await openBackupDialog(page);
    const field = dialog.getByLabel(copy.backupCodeLabel);
    for (const malformed of ['ABCD-234', 'ABCD-23456', 'ABCI-2345', 'ABC0-2345', 'ABCD--2345', 'ABCD_2345', 'ÄBCD-2345']) {
      await field.fill(malformed);
      await dialog.getByRole('button', { name: 'Continue' }).click();
      await expect(alertWith(dialog, copy.formatError)).toBeVisible();
      await expect(field).toHaveAccessibleDescription(new RegExp(copy.formatError.replace(/[.]/g, '\\.')));
      await expect(field).toBeFocused();
    }
    expect(recoveryRequests.count, 'no malformed code reached the API').toBe(0);
    expect(throttleState(member.username).failedCount).toBe(0);
  });

  await test.step('closing clears the error; the next opening starts clean', async () => {
    await page.keyboard.press('Escape');
    const dialog = await openBackupDialog(page);
    await expect(alertWith(dialog, copy.formatError)).toHaveCount(0);
    await expect(dialog.getByLabel(copy.backupCodeLabel)).toHaveValue('');
  });
});

test('E2E-09-10 a code typed in lower case with a space is sent in the D4 form and accepted', t5, async ({ page }) => {
  const member = await recoveringStaff(page);
  await backToChallenge(page, member);
  await openBackupDialog(page);
  const sent = page.waitForRequest((request) => request.url() === `${apiUrl}/api/auth/mfa/recovery`
    && request.method() === 'POST');
  await submitBackupCode(page, typedLoosely(member.backupCodes[0]));
  expect((await sent).postDataJSON()).toEqual({ backupCode: member.backupCodes[0] });
  await expect(page).toHaveURL('/staff/mfa/enroll');
  await expect(page.getByRole('heading', { name: copy.replaceTitle })).toBeVisible();
  expect(factorRows(member.username)[0]).toMatchObject({ unusedCodes: 9, usedCodes: 1 });
});

test('E2E-09-11 the Super Admin recovers with their own backup code and stays Super Admin', t5, async ({ page }) => {
  test.setTimeout(180_000);
  const owner = await recoveringStaff(page, 'SUPER_ADMIN');
  await signOutFromStaff(page);
  await replaceThroughPages(page, owner);
  const access = page.getByRole('region', { name: copy.staffTitle });
  await expect(access.getByText(owner.username, { exact: true })).toBeVisible();
  await expect(access.getByText('Super Admin', { exact: true })).toBeVisible();
  expect(factorStatuses(owner.username)).toEqual(['REVOKED', 'ACTIVE']);
});

test('E2E-09-12 a replacement session is sent back to the setup from every other page', t5, async ({ page }) => {
  test.setTimeout(180_000);
  const member = await recoveringStaff(page, 'ADMIN');
  await backToChallenge(page, member);
  await redeemBackupCode(page, member.backupCodes[0]);

  for (const path of ['/staff', '/admin/users', '/staff/backup-codes', '/staff/products', '/staff/mfa', '/account',
    '/sign-in']) {
    await test.step(`${path} redirects to /staff/mfa/enroll`, async () => {
      await page.goto(path);
      await expect(page).toHaveURL('/staff/mfa/enroll');
      await expect(page.getByRole('heading', { name: copy.replaceTitle })).toBeVisible();
      await expect(page.getByRole('heading', { name: copy.staffTitle })).toHaveCount(0);
    });
  }

  await test.step('the setup still completes after all that', async () => {
    await finishReplacement(page, 'SENT');
    await page.getByRole('button', { name: copy.saved }).click();
    await expect(page).toHaveURL('/staff');
  });
});

test('E2E-09-13 a phone found mid-recovery still works, and an expired replacement cannot be verified', t5,
  async ({ page, browser }) => {
    test.setTimeout(180_000);
    const member = await recoveringStaff(page);
    await backToChallenge(page, member);
    await redeemBackupCode(page, member.backupCodes[0]);
    const key = await readManualKey(page);

    await test.step('another browser signs in with the old authenticator while the setup waits (P3)', async () => {
      const other = await browser.newContext({ baseURL: frontendUrl });
      const otherPage = await other.newPage();
      await signInWithCode(otherPage, member);
      await expect(otherPage.getByRole('heading', { name: copy.staffTitle })).toBeVisible();
      await other.close();
    });

    await test.step('once the 10 minutes have passed, verifying the new key ends on the sign-in page', async () => {
      expect(expireReplacementSessions(member.username)).toBe(1);
      await page.getByLabel('Enter the 6-digit code').fill(totpCode(key, totpStep()));
      await page.getByRole('button', { name: 'Verify' }).click();
      await expect(page).toHaveURL('/sign-in');
      await expect(page.getByRole('heading', { name: copy.backupTitle })).toHaveCount(0);
    });

    await test.step('nothing was replaced: the old authenticator still signs in and the used code stays used', async () => {
      expect(factorRows(member.username)[0]).toMatchObject({ status: 'ACTIVE', unusedCodes: 9, usedCodes: 1 });
      await signInWithCode(page, member);
      await expect(page.getByRole('heading', { name: copy.staffTitle })).toBeVisible();
    });
  });

test('E2E-09-14 the regeneration page is linked for every staff role and guarded like the staff pages', t5,
  async ({ page, browser }) => {
    test.setTimeout(240_000);
    const regenerateLink = page.getByRole('navigation', { name: 'Staff pages' })
      .getByRole('link', { name: copy.regenerateTitle });

    await test.step('a Moderator sees the link; "Back to staff pages" returns to /staff', async () => {
      await recoveringStaff(page, 'MODERATOR');
      await expect(regenerateLink).toHaveAttribute('href', '/staff/backup-codes');
      await regenerateLink.click();
      await expect(page).toHaveURL('/staff/backup-codes');
      await page.getByRole('link', { name: copy.regenerateBack }).click();
      await expect(page).toHaveURL('/staff');
      await signOutFromStaff(page);
    });

    await test.step('a Super Admin sees the link too', async () => {
      await recoveringStaff(page, 'SUPER_ADMIN');
      await expect(regenerateLink).toBeVisible();
      await expect(regenerateLink).toHaveAttribute('href', '/staff/backup-codes');
      await regenerateLink.click();
      await expect(page).toHaveURL('/staff/backup-codes');
      await expect(page.getByRole('heading', { level: 1, name: copy.regenerateTitle })).toBeVisible();
      await signOutFromStaff(page);
    });

    const admin = await test.step('an Admin sees the link too', async () => {
      const member = await recoveringStaff(page, 'ADMIN');
      await expect(regenerateLink).toBeVisible();
      return member;
    });

    await test.step('a session that still needs its code is sent to the challenge', async () => {
      await backToChallenge(page, admin);
      await page.goto('/staff/backup-codes');
      await expect(page).toHaveURL('/staff/mfa');
      await expect(page.getByRole('heading', { name: copy.regenerateTitle })).toHaveCount(0);
    });

    await test.step('a Customer is sent to their account', async () => {
      const context = await browser.newContext({ baseURL: frontendUrl });
      const customerPage = await context.newPage();
      const customer = await registerThroughApi(customerPage.request);
      await signIn(customerPage, customer.username, customer.password);
      await expect(customerPage).toHaveURL('/account');
      await customerPage.goto('/staff/backup-codes');
      await expect(customerPage).toHaveURL('/account');
      await context.close();
    });

    await test.step('signed out, it goes to the sign-in page', async () => {
      const context = await browser.newContext({ baseURL: frontendUrl });
      const anonymous = await context.newPage();
      await anonymous.goto('/staff/backup-codes');
      await expect(anonymous).toHaveURL('/sign-in');
      await context.close();
    });
  });

test('E2E-09-15 a challenge locked by wrong authenticator codes hides "Lost your phone?"', t5, async ({ page }) => {
  const member = await recoveringStaff(page);
  await backToChallenge(page, member);
  const lostPhone = page.getByRole('button', { name: copy.lostPhone });
  await expect(lostPhone).toBeVisible();
  const field = page.getByLabel(copy.challengeCodeLabel);
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    await field.fill(wrongTotp(member.authenticator));
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(alertWith(page, copy.codeInvalid)).toBeVisible();
    await expect(field).toHaveValue('');
  }
  await field.fill(wrongTotp(member.authenticator));
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(alertWith(page, copy.tooManyAttempts)).toBeVisible();
  await expect(lostPhone).toHaveCount(0);
  expect(throttleState(member.username).locked).toBe(true);
});

test('E2E-09-16 while a code is being checked the dialog is busy and cannot be closed', t5, async ({ page }) => {
  const member = await recoveringStaff(page);
  await backToChallenge(page, member);
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const recoveryUrl = `${apiUrl}/api/auth/mfa/recovery`;
  await page.route(recoveryUrl, async (route) => {
    await held;
    await route.continue();
  });

  const dialog = await openBackupDialog(page);
  await submitBackupCode(page, member.backupCodes[0]);
  await expect(dialog.getByRole('button', { name: 'Checking…' })).toBeDisabled();
  await expect(dialog.getByLabel(copy.backupCodeLabel)).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog, 'Escape is ignored while checking').toBeVisible();

  release();
  await expect(page).toHaveURL('/staff/mfa/enroll');
  await expect(page.getByRole('heading', { name: copy.replaceTitle })).toBeVisible();
  await page.unroute(recoveryUrl);
});
