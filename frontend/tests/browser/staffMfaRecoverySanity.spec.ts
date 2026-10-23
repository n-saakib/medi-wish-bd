import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  backupDialog, copy, factorStatuses, finishReplacement, openBackupDialog, recoveringStaff, replaceThroughPages,
  signInToChallenge, signOutFromStaff, redeemBackupCode,
} from './staffMfaRecoverySupport';
import { freshCode, readBackupCodes } from './support';

/**
 * Ticket 09 sanity and accessibility in the browser (plan T7, E2E-09-07): the backup-code dialog by keyboard alone,
 * names and descriptions, 44 px targets, no horizontal scroll at 360 and 1280 px, and the shortest recovery as a smoke
 * check. Tags: `@t09` plus `@t09-T7`; the smoke path also carries `@smoke`.
 *
 * Run while developing: `npm run test:browser -- --grep "@t09-T7" --project chrome`, never beside another browser run.
 */

const t7 = { tag: ['@t09', '@t09-T7', '@sanity'] };

/** Each control is at least 44 × 44 px. */
async function expectTargets(controls: Record<string, Locator>): Promise<void> {
  for (const [name, control] of Object.entries(controls)) {
    const box = await control.boundingBox();
    expect(box, `${name} is laid out`).not.toBeNull();
    expect(box!.width, `${name} width`).toBeGreaterThanOrEqual(44);
    expect(box!.height, `${name} height`).toBeGreaterThanOrEqual(44);
  }
}

async function expectNoHorizontalScroll(page: Page, where: string): Promise<void> {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth,
  }));
  expect(scrollWidth, `horizontal scroll ${where}`).toBeLessThanOrEqual(innerWidth);
}

test('E2E-09-07 the backup-code dialog works by keyboard and at narrow and wide widths', t7, async ({ page }, testInfo) => {
  const member = await recoveringStaff(page);
  await signOutFromStaff(page);
  await signInToChallenge(page, member);
  const lostPhone = page.getByRole('button', { name: copy.lostPhone });

  const dialog = await test.step('Enter on "Lost your phone?" opens the dialog with the field focused', async () => {
    await lostPhone.focus();
    await page.keyboard.press('Enter');
    const opened = backupDialog(page);
    await expect(opened).toBeVisible();
    await expect(opened.getByLabel(copy.backupCodeLabel)).toBeFocused();
    return opened;
  });
  const field = dialog.getByRole('textbox', { name: copy.backupCodeLabel });
  const close = dialog.getByRole('button', { name: 'Close', exact: true });
  const cancel = dialog.getByRole('button', { name: 'Cancel' });
  const continueButton = dialog.getByRole('button', { name: 'Continue' });

  await test.step('Tab stays inside the dialog in document order and wraps both ways', async () => {
    // The T3 markup puts Close in the header, so the order from the field is Cancel → Continue → Close → field.
    // (Plan T7 step 3 lists "field → Close → Cancel → Continue"; the markup order is what this asserts.)
    await expect(field).toBeFocused();
    for (const next of [cancel, continueButton, close, field]) {
      await page.keyboard.press('Tab');
      await expect(next).toBeFocused();
    }
    await page.keyboard.press('Shift+Tab');
    await expect(close).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(continueButton).toBeFocused();
    await field.focus();
  });

  await test.step('the field is named, and a format error is linked to it and announced', async () => {
    await expect(dialog).toHaveAccessibleName(copy.dialogTitle);
    await page.keyboard.type('abc');
    await page.keyboard.press('Enter');
    const error = dialog.getByRole('alert').filter({ hasText: copy.formatError });
    await expect(error).toBeVisible();
    await expect(field).toHaveAccessibleDescription(new RegExp(copy.formatError.replace(/[.]/g, '\\.')));
    await expect(field).toBeFocused();
  });

  await test.step('every control is at least 44 px; the focus ring is captured for the evidence', async () => {
    await expectTargets({ field, Close: close, Cancel: cancel, Continue: continueButton });
    await testInfo.attach('backup-dialog-focus', { body: await page.screenshot(), contentType: 'image/png' });
  });

  await test.step('Escape closes it and focus returns to "Lost your phone?"', async () => {
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(lostPhone).toBeFocused();
    await expectTargets({ 'Lost your phone?': lostPhone });
  });

  for (const width of [360, 1280]) {
    await test.step(`at ${width} px the challenge, the dialog and the setup page do not scroll sideways`, async () => {
      await page.setViewportSize({ width, height: 800 });
      await expectNoHorizontalScroll(page, `on the challenge at ${width} px`);
      const opened = await openBackupDialog(page);
      await expectNoHorizontalScroll(page, `with the dialog open at ${width} px`);
      await expectTargets({ 'Continue': opened.getByRole('button', { name: 'Continue' }) });
      await testInfo.attach(`backup-dialog-${width}`, { body: await page.screenshot(), contentType: 'image/png' });
      await page.keyboard.press('Escape');
      await expect(opened).toBeHidden();
    });
  }

  await test.step('the replacement setup page fits at 360 and 1280 px', async () => {
    await page.setViewportSize({ width: 360, height: 800 });
    await redeemBackupCode(page, member.backupCodes[0]);
    for (const width of [360, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      await expectNoHorizontalScroll(page, `on the replacement setup at ${width} px`);
    }
    await finishReplacement(page, 'SENT');
    for (const width of [360, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      await expectNoHorizontalScroll(page, `with replacement codes and notice shown at ${width} px`);
    }
  });
});

test('E2E-09-07b the regeneration page is labelled, keyboard-usable and fits at 360 px', t7, async ({ page }, testInfo) => {
  const member = await recoveringStaff(page);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/staff/backup-codes');
  const field = page.getByRole('textbox', { name: copy.regenerateCodeLabel });
  const submit = page.getByRole('button', { name: copy.regenerateTitle });
  const back = page.getByRole('link', { name: copy.regenerateBack });
  await expect(page.getByRole('heading', { level: 1, name: copy.regenerateTitle })).toBeVisible();
  await expectTargets({ field, submit, back });
  await expectNoHorizontalScroll(page, 'on the regeneration page at 360 px');

  await field.focus();
  await page.keyboard.press('Tab');
  await expect(submit).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(back).toBeFocused();
  await testInfo.attach('regeneration-focus-360', { body: await page.screenshot(), contentType: 'image/png' });

  await field.fill(await freshCode(member.authenticator));
  await submit.click();
  expect(await readBackupCodes(page)).toHaveLength(10);
  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await expectNoHorizontalScroll(page, `with regenerated codes shown at ${width} px`);
  }
});

test('@smoke E2E-09-07c a Moderator signs in with a backup code, sets up a new authenticator and reaches /staff', {
  tag: ['@t09', '@t09-T7', '@sanity'],
}, async ({ page }) => {
  test.setTimeout(180_000);
  const member = await recoveringStaff(page);
  await signOutFromStaff(page);
  await replaceThroughPages(page, member);
  expect(factorStatuses(member.username)).toEqual(['REVOKED', 'ACTIVE']);
});
