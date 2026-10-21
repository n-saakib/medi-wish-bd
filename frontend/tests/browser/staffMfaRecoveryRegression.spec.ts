import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { apiSuperAdmin, changeRole, findUser, readUserRoles } from './apiSession';
import {
  alertWith, auditCount, auditText, copy, factorStatuses, finishReplacement, noticeText, readStorage, recordSurfaces,
  recoveringStaff, roleOf, signInToChallenge, signOutFromStaff, redeemBackupCode, wrongBackupCode, type RecoveringMember,
} from './staffMfaRecoverySupport';
import { enroll, freshCode, readBackupCodes, readManualKey, registerThroughApi, signIn } from './support';
import { apiLogPath, apiUrl, grantRole, markMobileVerified, removeRole } from './testApi';
import { totpCode, totpStep } from './totp';

/**
 * Ticket 09 regressions in the browser: codes are shown exactly once, a role removed during recovery is never restored,
 * the notice line reflects the contact, a first enrollment is unchanged, and no secret reaches a URL, storage, the
 * console, the API log or the audit rows (plan §10.2, T6). Tags: `@t09` plus `@t09-T6`.
 *
 * Run while developing: `npm run test:browser -- --grep "@t09-T6" --project chrome`, never beside another browser run.
 */

const t6 = { tag: ['@t09', '@t09-T6', '@regression'] };
const security = { tag: ['@t09', '@t09-T6', '@regression', '@security'] };

/** Each code as shown and without its separator, so a scan finds either form. */
function bothForms(codes: readonly string[]): string[] {
  return codes.flatMap((code) => [code, code.replace('-', '')]);
}

/** Scan the live DOM immediately, including hidden text and form values restored by browser history. */
async function expectNoCodesShown(page: Page, codes: readonly string[], when: string): Promise<void> {
  const dom = await page.evaluate(() => [
    document.body.textContent ?? '',
    ...Array.from(document.querySelectorAll('input, textarea'), (field) => (field as HTMLInputElement).value),
  ].join('\n'));
  expect(codes.some((code) => dom.includes(code)), `codes retained in the DOM ${when}`).toBe(false);
  await expect(page.getByRole('list', { name: 'Backup codes' }), `the codes list ${when}`).toHaveCount(0);
}

async function startRecovery(page: Page, member: RecoveringMember): Promise<void> {
  await signOutFromStaff(page);
  await signInToChallenge(page, member);
  await redeemBackupCode(page, member.backupCodes[0]);
}

test('E2E-09-04 the replacement codes are never shown again after leaving or reloading', security, async ({ page }) => {
  test.setTimeout(180_000);
  const member = await recoveringStaff(page);
  const surfaces = recordSurfaces(page);
  await startRecovery(page, member);
  const replaced = await finishReplacement(page, 'SENT');
  const codes = bothForms(replaced.backupCodes);

  await test.step('while they are shown, neither storage nor the URL holds a code', async () => {
    const storage = await readStorage(page);
    expect(codes.filter((code) => storage.includes(code))).toEqual([]);
    expect(storage).not.toContain(replaced.authenticator.key);
  });

  await test.step('back, forward and reload never show them again', async () => {
    // Each navigation waits for the restored session to settle: a refresh still in flight when the next navigation starts
    // is aborted, and the rotated token it used then reads as a replay, which revokes the session.
    await page.goBack();
    await page.waitForLoadState('networkidle');
    await expectNoCodesShown(page, codes, 'after going back');
    await page.goForward();
    await page.waitForLoadState('networkidle');
    await expectNoCodesShown(page, codes, 'after going forward');
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expectNoCodesShown(page, codes, 'after a reload');
    await page.goto('/staff/mfa/enroll');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL('/staff');
    await expectNoCodesShown(page, codes, 'when opening the setup page again');
    const storageAfterLeaving = await readStorage(page);
    expect(codes.filter((code) => storageAfterLeaving.includes(code))).toEqual([]);
    expect(storageAfterLeaving).not.toContain(replaced.authenticator.key);
  });

  await test.step('no URL the browser loaded carries a code or the key; the staff pages are not cached', async () => {
    const secrets = [...codes, ...bothForms(member.backupCodes), replaced.authenticator.key];
    await surfaces.flushConsole();
    expect(surfaces.urls.filter((url) => secrets.some((secret) => url.includes(secret)))).toEqual([]);
    expect(surfaces.consoleText.filter((line) => secrets.some((secret) => line.includes(secret)))).toEqual([]);
    for (const path of ['/staff/mfa/enroll', '/staff/backup-codes', '/staff/mfa']) {
      const response = await page.request.get(path);
      expect(response.headers()['cache-control'], `${path} caching`).toContain('no-store');
    }
  });
});

test('E2E-09-05 a role removed by the Super Admin during recovery ends it and is never restored', t6,
  async ({ page }) => {
    test.setTimeout(180_000);
    const member = await recoveringStaff(page);
    const owner = await apiSuperAdmin(page.request);
    const visited: string[] = [];
    page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) visited.push(new URL(frame.url()).pathname); });
    await startRecovery(page, member);
    const key = await readManualKey(page);

    await test.step('the Super Admin makes the Moderator a Customer through the Ticket 08 API', async () => {
      const { id } = await findUser(owner.session, member.username);
      await changeRole(owner.session, id, 'CUSTOMER', (await readUserRoles(owner.session, id)).rolesVersion);
    });

    await test.step('submitting the new key’s code ends on the sign-in page, never on /staff', async () => {
      visited.length = 0;
      await page.getByLabel('Enter the 6-digit code').fill(totpCode(key, totpStep()));
      await page.getByRole('button', { name: 'Verify' }).click();
      await expect(page).toHaveURL('/sign-in');
      expect(visited).not.toContain('/staff');
      expect(factorStatuses(member.username).filter((status) => status === 'ACTIVE')).toHaveLength(1);
      expect(auditCount(member.username, 'MFA_FACTOR_REPLACED')).toBe(0);
    });

    await test.step('signing in again opens the Customer account; nothing restored the role', async () => {
      await signIn(page, member.username, member.password);
      await expect(page).toHaveURL('/account');
      await page.goto('/staff');
      await expect(page).toHaveURL('/account');
      expect(roleOf(member.username)).toBe('CUSTOMER');
    });
    await owner.session.dispose();
  });

test('E2E-09-05b a role removed with SQL during recovery never reaches /staff', t6, async ({ page }) => {
  test.setTimeout(180_000);
  const member = await recoveringStaff(page);
  const visited: string[] = [];
  page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) visited.push(new URL(frame.url()).pathname); });
  await startRecovery(page, member);
  const key = await readManualKey(page);

  removeRole(member.username, 'MODERATOR');
  visited.length = 0;
  await page.getByLabel('Enter the 6-digit code').fill(totpCode(key, totpStep()));
  const verify = page.waitForResponse((response) => response.url() === `${apiUrl}/api/auth/mfa/enrollment/verify`
    && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Verify' }).click();
  expect((await verify).status()).toBe(403);
  await expect(alertWith(page, copy.accessDenied)).toBeVisible();
  await expect(page).toHaveURL('/staff/mfa/enroll');
  await expect(page.getByRole('heading', { name: copy.backupTitle })).toHaveCount(0);
  await page.reload();
  await expect(page).toHaveURL('/account');
  expect(visited).not.toContain('/staff');
  expect(factorStatuses(member.username)).toEqual(['ACTIVE', 'PENDING']);
  expect(auditCount(member.username, 'MFA_FACTOR_REPLACED')).toBe(0);
});

test('E2E-09-08 a replacement without a verified mobile says no contact was notified', t6, async ({ page }) => {
  test.setTimeout(180_000);
  const member = await recoveringStaff(page, 'MODERATOR', { verifiedMobile: false });
  await startRecovery(page, member);
  await finishReplacement(page, 'NO_VERIFIED_CONTACT');
  for (const notice of ['SENT', 'FAILED', 'NOT_CONFIGURED'] as const) {
    await expect(page.getByText(noticeText[notice], { exact: true })).toHaveCount(0);
  }
  await page.getByRole('button', { name: copy.saved }).click();
  await expect(page).toHaveURL('/staff');
  expect(factorStatuses(member.username)).toEqual(['REVOKED', 'ACTIVE']);
  expect(auditCount(member.username, 'MFA_REPLACEMENT_NOTICE_NO_VERIFIED_CONTACT')).toBe(1);
});

test('E2E-09-17 regenerated codes are never shown again after leaving or reloading', security, async ({ page }) => {
  test.setTimeout(180_000);
  const member = await recoveringStaff(page);
  const surfaces = recordSurfaces(page);
  await page.goto('/staff/backup-codes');
  await page.getByLabel(copy.regenerateCodeLabel).fill(await freshCode(member.authenticator));
  await page.getByRole('button', { name: copy.regenerateTitle }).click();
  const codes = bothForms(await readBackupCodes(page));

  const storage = await readStorage(page);
  expect(codes.filter((code) => storage.includes(code))).toEqual([]);
  // As in E2E-09-04, each navigation waits for the restored session to settle before the next one starts.
  await page.goto('/staff');
  await page.waitForLoadState('networkidle');
  await page.goBack();
  await page.waitForLoadState('networkidle');
  await expectNoCodesShown(page, codes, 'after returning to the regeneration page');
  await page.goForward();
  await page.waitForLoadState('networkidle');
  await expectNoCodesShown(page, codes, 'after going forward to staff');
  await page.goBack();
  await page.waitForLoadState('networkidle');
  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { level: 1, name: copy.regenerateTitle })).toBeVisible();
  await expectNoCodesShown(page, codes, 'after reloading the regeneration page');
  const storageAfterLeaving = await readStorage(page);
  expect(codes.filter((code) => storageAfterLeaving.includes(code))).toEqual([]);
  expect(surfaces.urls.filter((url) => codes.some((code) => url.includes(code)))).toEqual([]);
});

test('E2E-09-18 a first enrollment still shows its codes without a contact notice', {
  tag: ['@t09', '@t09-T6', '@regression', '@cross-06-09'],
}, async ({ page }) => {
  const admin = await registerThroughApi(page.request);
  markMobileVerified(admin.username);
  grantRole(admin.username, 'ADMIN');
  await signIn(page, admin.username, admin.password);
  await expect(page.getByRole('heading', { name: copy.firstEnrollTitle, exact: true })).toBeVisible();
  await expect(page.getByText(copy.replaceIntro)).toHaveCount(0);
  await enroll(page);
  expect(await readBackupCodes(page)).toHaveLength(10);
  for (const text of Object.values(noticeText)) await expect(page.getByText(text, { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: copy.saved }).click();
  await expect(page).toHaveURL('/staff');
  expect(auditCount(admin.username, 'MFA_FACTOR_REPLACED')).toBe(0);
});

test('E2E-09-19 codes, keys and contacts stay out of URLs, storage, the console, the API log and the audit', security,
  async ({ page }) => {
    test.setTimeout(240_000);
    const member = await recoveringStaff(page);
    const logStart = readFileSync(apiLogPath, 'utf8').length;
    const submittedTotps: { path: string; code: string }[] = [];
    page.on('request', (request) => {
      if (request.method() !== 'POST' || !request.url().startsWith(`${apiUrl}/api/auth/mfa/`)) return;
      const path = new URL(request.url()).pathname;
      if (!['/api/auth/mfa/enrollment/verify', '/api/auth/mfa/backup-codes'].includes(path)) return;
      const body = request.postDataJSON() as { code?: unknown } | null;
      if (typeof body?.code === 'string' && /^\d{6}$/.test(body.code)) submittedTotps.push({ path, code: body.code });
    });
    const surfaces = recordSurfaces(page);
    const wrong = wrongBackupCode(member.backupCodes);

    await signOutFromStaff(page);
    await signInToChallenge(page, member);
    await page.getByRole('button', { name: copy.lostPhone }).click();
    await page.getByRole('dialog', { name: copy.dialogTitle }).getByLabel(copy.backupCodeLabel).fill(wrong);
    await page.getByRole('dialog', { name: copy.dialogTitle }).getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('alert').filter({ hasText: copy.codeInvalid })).toBeVisible();
    await page.keyboard.press('Escape');
    await redeemBackupCode(page, member.backupCodes[0]);
    const replaced = await finishReplacement(page, 'SENT');
    const storageWhileShown = await readStorage(page);
    await page.getByRole('button', { name: copy.saved }).click();
    await expect(page).toHaveURL('/staff');
    const storageAfterReplacement = await readStorage(page);

    await page.goto('/staff/backup-codes');
    await page.getByLabel(copy.regenerateCodeLabel).fill(await freshCode(replaced.authenticator));
    await page.getByRole('button', { name: copy.regenerateTitle }).click();
    const regenerated = await readBackupCodes(page);
    const storageAfter = await readStorage(page);
    await page.reload();
    const storageAfterReload = await readStorage(page);

    const secrets = [
      ...bothForms([...member.backupCodes, ...replaced.backupCodes, ...regenerated, wrong]),
      member.authenticator.key, replaced.authenticator.key, member.password,
    ];
    const contacts = [member.mobile, member.email];
    const found = (text: string, values: readonly string[]) => values.filter((value) => text.includes(value));

    await surfaces.flushConsole();
    expect(found(surfaces.urls.join('\n'), [...secrets, ...contacts]), 'URLs').toEqual([]);
    expect(found(surfaces.consoleText.join('\n'), [...secrets, ...contacts]), 'console').toEqual([]);
    expect(found([storageWhileShown, storageAfterReplacement, storageAfter, storageAfterReload].join('\n'),
      [...secrets, ...contacts]), 'browser storage').toEqual([]);
    expect(found(surfaces.payloads.join('\n'), [...secrets, ...contacts]), 'non-auth request bodies').toEqual([]);
    expect(found(surfaces.pageErrors.join('\n'), [...secrets, ...contacts]), 'page errors').toEqual([]);
    const apiLog = readFileSync(apiLogPath, 'utf8').slice(logStart);
    expect(apiLog).toContain('"message":"HTTP response status=');
    expect(submittedTotps.map(({ path }) => path), 'replacement and regeneration TOTP submissions captured')
      .toEqual(['/api/auth/mfa/enrollment/verify', '/api/auth/mfa/backup-codes']);
    expect(found(apiLog, [...secrets, ...contacts, member.username]), 'API log').toEqual([]);
    const audit = auditText(member.username);
    expect(found(audit, [...secrets, ...contacts, member.username]), 'audit rows').toEqual([]);
    for (const { code } of submittedTotps) {
      const codeAsToken = new RegExp(`(^|[^0-9A-Za-z])${code}($|[^0-9A-Za-z])`);
      expect(codeAsToken.test(apiLog), 'submitted TOTP in API log')
        .toBe(false);
      expect(codeAsToken.test(audit), 'submitted TOTP in audit rows')
        .toBe(false);
    }
  });
