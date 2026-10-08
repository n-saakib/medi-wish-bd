import { expect, test, type Page } from '@playwright/test';
import { enroll, readBackupCodes, register, registeredAdmin, signIn, syntheticCustomer, watchPage, type Customer } from './support';
import { grantRole } from './testApi';
import { totpCode, totpStep } from './totp';

async function expectVerifiedAccess(page: Page, admin: Customer): Promise<void> {
  await expect(page).toHaveURL('/staff');
  const access = page.getByRole('region', { name: 'Staff access verified' });
  await expect(access.getByText(admin.username, { exact: true })).toBeVisible();
  await expect(access.getByText('Admin', { exact: true })).toBeVisible();
  // Only the provisioned first Admin is the Super Admin; a role granted in SQL is not.
  await expect(access.getByText('Super Admin')).toHaveCount(0);
}

test('@smoke an Admin sets up an authenticator and reaches the staff page', async ({ page }) => {
  const admin = await registeredAdmin(page);

  await signIn(page, admin.username, admin.password);
  await enroll(page);
  await page.getByRole('button', { name: 'I’ve saved them' }).click();
  await expectVerifiedAccess(page, admin);
});

test('a Customer opening /staff is sent to their account', async ({ page }) => {
  await register(page, syntheticCustomer());

  await page.goto('/staff');
  await expect(page).toHaveURL('/account');
  await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible();
});

test('an Admin enrolls, keeps the verified session, and verifies again after signing in', async ({ page }) => {
  const admin = syntheticCustomer();
  let enrolled!: { key: string; step: number };

  await test.step('register through the form, then an operator grants ADMIN', async () => {
    await register(page, admin);
    grantRole(admin.username, 'ADMIN');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL('/');
  });

  await test.step('a password sign-in lands on authenticator setup, not the account page', async () => {
    await signIn(page, admin.username, admin.password);
    await expect(page).toHaveURL('/staff/mfa/enroll');
    await expect(page.getByRole('img', { name: 'QR code to scan with your authenticator app' })).toBeVisible();
  });

  await test.step('the code from the manual key shows the backup codes, and saving them opens /staff', async () => {
    enrolled = await enroll(page);
    await readBackupCodes(page);
    await expect(page).toHaveURL('/staff/mfa/enroll');
    await page.getByRole('button', { name: 'I’ve saved them' }).click();
    await expectVerifiedAccess(page, admin);
  });

  await test.step('a reload restores the verified session', async () => {
    await page.reload();
    await expectVerifiedAccess(page, admin);
  });

  await test.step('signing out from the staff header ends the session', async () => {
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL('/sign-in');
  });

  await test.step('signing in again asks for a code; a wrong code is refused and the page stays', async () => {
    await signIn(page, admin.username, admin.password);
    await expect(page).toHaveURL('/staff/mfa');
    await expect(page.getByRole('heading', { name: 'Verify it’s you' })).toBeVisible();
    const watch = watchPage(page);

    // A later step than the enrollment's, so the code is not a replay of an accepted one.
    const code = totpCode(enrolled.key, Math.max(enrolled.step + 1, totpStep()));
    const wrong = String((Number(code) + 500_000) % 1_000_000).padStart(6, '0');
    await page.getByLabel('Authenticator code').fill(wrong);
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'The code is invalid or has already been used.' })).toBeVisible();
    await expect(page.getByLabel('Authenticator code')).toBeFocused();
    await expect(page.getByLabel('Authenticator code')).toHaveValue('');
    await expect(page).toHaveURL('/staff/mfa');
    await watch.expectSeen({
      consoleErrors: ['/api/auth/mfa/verify Failed to load resource: the server responded with a status of 400 ()'],
      responses: ['400 POST /api/auth/mfa/verify'],
    });

    await page.getByLabel('Authenticator code').fill(code);
    await page.getByRole('button', { name: 'Verify' }).click();
    await expectVerifiedAccess(page, admin);
    await watch.expectSeen({ consoleErrors: [], responses: ['200 POST /api/auth/mfa/verify', '200 GET /api/staff/me'] });
  });
});
