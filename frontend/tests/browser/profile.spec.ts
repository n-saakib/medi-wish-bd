import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  awayFromDhakaMidnight, copy, dhakaDate, encodedForms, mobileChangePath, openProfile, profilePath, ProfileApi,
  recordProfileCalls,
  recordProfileRequests, registerByApi, setAccountState, signInByApi, storedProfile, syntheticFullName, syntheticMobile,
  type ProfileCall, urlScanText,
} from './profileSupport';
import { expectKeyboardOrder, expectLayout } from './recoverySupport';
import { register, signIn, syntheticCustomer } from './support';
import { apiLogPath, apiUrl, grantRole, markMobileVerified } from './testApi';
import { totpCode, totpStep } from './totp';

/**
 * Ticket 11 browser acceptance tests: the real frontend build against the real test API. They pass once the page (T3)
 * and the API (T4) are joined, so each carries `@t11-T5`. Synthetic data only.
 */
const t5 = { tag: ['@t11', '@t11-T5'] };

const hex = () => randomBytes(3).toString('hex');

/** The page's controls, named exactly as plan §4.6 and §10 fix them. */
function profilePage(page: Page) {
  const main = page.getByRole('main');
  const dialog = page.getByRole('dialog', { name: 'Change mobile' });
  return {
    main,
    fullName: page.getByLabel('Full name'),
    email: page.getByRole('textbox', { name: 'Email' }),
    mobileField: page.getByRole('group', { name: 'Mobile', exact: true }),
    emailField: page.getByRole('group', { name: 'Email' }),
    currentPassword: page.getByLabel('Current password', { exact: true }),
    verify: page.getByRole('button', { name: 'Verify', exact: true }),
    dateOfBirth: page.getByLabel('Date of birth'),
    save: page.getByRole('button', { name: 'Save changes', exact: true }),
    change: page.getByRole('button', { name: 'Change', exact: true }),
    cancelChange: page.getByRole('button', { name: 'Cancel change', exact: true }),
    saved: page.getByRole('status').filter({ hasText: copy.profileSaved }),
    dialog,
    newMobile: dialog.getByLabel('New mobile'),
    saveForVerification: dialog.getByRole('button', { name: 'Save for verification', exact: true }),
    dialogCancel: dialog.getByRole('button', { name: 'Cancel', exact: true }),
  };
}

function only(calls: ProfileCall[], method: string): ProfileCall[] {
  return calls.filter((call) => call.method === method);
}

/** One request the page dispatched, with the API's status once it answered. */
type DispatchedRequest = { body: string | null; status?: number };

/**
 * Intercepts every `method` request the page sends to `path` and records it when it is dispatched, so a duplicate
 * counts however late (or whether) it is answered. Each is held until `release()`; later ones pass straight through
 * and are still recorded. `statuses()` lists one entry per real attempt, `undefined` while unanswered; it leaves out a
 * request answered `401`, which the session client refreshes and retries once.
 */
async function holdRequests(page: Page, method: string, path: string) {
  const requests: DispatchedRequest[] = [];
  const waiting: (() => void)[] = [];
  let open = false;
  await page.route(`${apiUrl}${path}`, async (route) => {
    if (route.request().method() !== method) return route.fallback();
    const entry: DispatchedRequest = { body: route.request().postData() };
    requests.push(entry);
    if (!open) await new Promise<void>((resolve) => { waiting.push(resolve); });
    const response = await route.fetch();
    entry.status = response.status();
    await route.fulfill({ response });
  });
  return {
    statuses:() => requests.filter(({ status }) => status !== 401).map(({ status }) => status),
    release: () => {
      open = true;
      waiting.splice(0).forEach((resolve) => resolve());
    },
  };
}

/** Asserts a field error: the message is shown, and the input is marked invalid and described by it. */
async function expectFieldError(input: Locator, message: string): Promise<void> {
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(input).toHaveAccessibleDescription(message);
}

/** Every input on the page is disabled or read-only, and no edit button is enabled. */
async function expectReadOnly(page: Page): Promise<void> {
  expect(await page.getByRole('main').locator('input').evaluateAll((inputs) =>
    inputs.filter((input) => !(input as HTMLInputElement).disabled && !(input as HTMLInputElement).readOnly).length)).toBe(0);
  for (const name of ['Save changes', 'Change', 'Cancel change']) {
    await expect(page.getByRole('button', { name, exact: true, disabled: false })).toHaveCount(0);
  }
}

test('E2E-11-33 a Customer edits the profile, stages a mobile change and cancels it through the browser', t5, async ({ page }) => {
  const customer = syntheticCustomer();
  const calls = recordProfileCalls(page);
  const ui = profilePage(page);
  const tag = hex();
  const typedEmail = `Demo.${tag}@Example.test`;
  const savedEmail = typedEmail.toLowerCase();
  const newMobile = syntheticMobile();

  await test.step('registration (Ticket 02) lands on /account, whose Edit profile link opens /account/profile', async () => {
    await register(page, customer);
    await page.getByRole('link', { name: 'Edit profile', exact: true }).click();
    await expect(page).toHaveURL('/account/profile');
    await expect(page.getByRole('heading', { level: 1, name: 'Profile' })).toBeVisible();
  });

  await test.step('the page shows the registered values; the username is text, not a field', async () => {
    await expect(ui.main.getByText(customer.username, { exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Username' })).toHaveCount(0);
    await expect(ui.main.getByText(customer.mobile)).toBeVisible();
    await expect(ui.mobileField.getByText('Not verified', { exact: true })).toBeVisible();
    await expect(ui.fullName).toHaveValue('');
    await expect(ui.email).toHaveValue(customer.email);
    await expect(ui.dateOfBirth).toHaveValue('');
    await expect(ui.save).toBeDisabled();
  });

  await test.step('Save changes stores the normalized values and announces "Profile saved."', async () => {
    await ui.fullName.fill('  Demo   Profile ');
    await ui.email.fill(typedEmail);
    await expect(ui.currentPassword).toBeVisible();
    await ui.currentPassword.fill(customer.password);
    await ui.dateOfBirth.fill('1990-05-01');
    await expect(ui.save).toBeEnabled();
    await ui.save.click();
    await expect(ui.saved).toBeFocused();
    await expect(ui.fullName).toHaveValue('Demo Profile');
    await expect(ui.email).toHaveValue(savedEmail);
    await expect(ui.dateOfBirth).toHaveValue('1990-05-01');
    await expect(ui.save).toBeDisabled();
    await expect(ui.currentPassword).toHaveCount(0);

    const puts = only(calls, 'PUT');
    expect(puts.map(({ status }) => status)).toEqual([200]);
    const sent = JSON.parse(puts[0].body ?? '{}') as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual(['currentPassword', 'dateOfBirth', 'email', 'fullName', 'version']);
    expect(sent.currentPassword).toBe(customer.password);
    expect(sent.version).toBe(0);
  });

  await test.step('a reload shows the persisted values', async () => {
    await page.reload();
    await expect(ui.fullName).toHaveValue('Demo Profile');
    await expect(ui.email).toHaveValue(savedEmail);
    await expect(ui.dateOfBirth).toHaveValue('1990-05-01');
    await expect(page.getByText(copy.profileSaved)).toHaveCount(0);
    expect(storedProfile(customer.username)).toMatchObject({
      fullName: 'Demo Profile', email: savedEmail, dateOfBirth: '1990-05-01', profileVersion: 1,
    });
  });

  await test.step('Change → Save for verification stages the number; the current number stays', async () => {
    await ui.change.click();
    await expect(ui.dialog).toBeVisible();
    await expect(ui.dialog.getByText(copy.mobileExplanation)).toBeVisible();
    await ui.newMobile.fill(newMobile);
    await ui.saveForVerification.click();
    await expect(ui.dialog).toBeHidden();
    await expect(ui.main.getByText(copy.pendingNote(newMobile))).toBeVisible();
    await expect(ui.main.getByText(customer.mobile)).toBeVisible();
    await expect(ui.mobileField.getByText('Not verified', { exact: true })).toBeVisible();
    await expect(ui.cancelChange).toBeVisible();

    const posts = only(calls, 'POST');
    expect(posts.map(({ status }) => status)).toEqual([202]);
    expect(JSON.parse(posts[0].body ?? '{}')).toEqual({ mobile: newMobile });
  });

  await test.step('a reload still shows the pending number', async () => {
    await page.reload();
    await expect(ui.main.getByText(copy.pendingNote(newMobile))).toBeVisible();
    await expect(ui.main.getByText(customer.mobile)).toBeVisible();
  });

  await test.step('Cancel change removes it, and it stays gone after a reload', async () => {
    await ui.cancelChange.click();
    await expect(ui.main.getByText(copy.pendingNote(newMobile))).toHaveCount(0);
    await expect(ui.cancelChange).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: 'Mobile change cancelled.' })).toBeFocused();
    const deletes = only(calls, 'DELETE');
    expect(deletes.map(({ status, body }) => [status, body])).toEqual([[204, null]]);
    await page.reload();
    await expect(ui.fullName).toHaveValue('Demo Profile');
    await expect(ui.main.getByText(copy.pendingNote(newMobile))).toHaveCount(0);
    expect(storedProfile(customer.username)).toMatchObject({ mobile: customer.mobile, pendingChanges: [] });
  });

  await test.step('/account shows the new email, and the new email signs in (Ticket 03)', async () => {
    await page.goto('/account');
    await expect(page.getByText(savedEmail, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL('/');
    await signIn(page, typedEmail, customer.password);
    await expect(page).toHaveURL('/account');
    await expect(page.getByText(customer.mobile, { exact: true })).toBeVisible();
  });
});

test('E2E-11-34 a save from an outdated tab shows the stale message, and Reload shows the newer values', t5, async ({ page, context }) => {
  const customer = await registerByApi(page.request);
  const tabA = profilePage(page);
  await openProfile(page, customer);
  const other = await context.newPage();
  const tabB = profilePage(other);
  const callsB = recordProfileCalls(other);
  await other.goto('/account/profile');
  await expect(tabB.fullName).toBeVisible();

  await tabA.fullName.fill('Alpha Tab');
  await tabA.save.click();
  await expect(tabA.saved).toBeVisible();

  await tabB.fullName.fill('Beta Tab');
  await tabB.save.click();
  await expect(other.getByRole('alert').filter({ hasText: copy.staleUpdate })).toBeFocused();
  expect(only(callsB, 'PUT').map(({ status }) => status)).toEqual([409]);
  expect(storedProfile(customer.username)).toMatchObject({ fullName: 'Alpha Tab', profileVersion: 1 });

  await other.getByRole('button', { name: 'Reload', exact: true }).click();
  await expect(tabB.fullName).toHaveValue('Alpha Tab');
  await expect(other.getByRole('heading', { name: 'Profile', level: 1 })).toBeFocused();
  await expect(other.getByText(copy.staleUpdate)).toHaveCount(0);

  await tabB.fullName.fill('Beta Tab');
  await tabB.save.click();
  await expect(tabB.saved).toBeVisible();
  expect(storedProfile(customer.username)).toMatchObject({ fullName: 'Beta Tab', profileVersion: 2 });
});

test('E2E-11-35 a profile left open when the account starts closing turns read-only on save', t5, async ({ page, request }) => {
  const customer = await registerByApi(page.request);
  const pendingMobile = syntheticMobile();
  // Staged through the separate `request` context: signing in through `page.request` would give the browser a session,
  // and the sign-in page would then skip straight to /account.
  await ProfileApi.forUser(request, customer).stage({ mobile: pendingMobile });
  const calls = recordProfileCalls(page);
  const ui = profilePage(page);
  await openProfile(page, customer);
  await expect(ui.cancelChange).toBeVisible();
  const before = storedProfile(customer.username);

  setAccountState(customer.username, 'CLOSURE_REQUESTED');
  await ui.fullName.fill('Too Late');
  await ui.save.click();

  await expect(ui.main.getByText(copy.accountClosing, { exact: true })).toBeVisible();
  await expectReadOnly(page);
  expect(only(calls, 'PUT').map(({ status }) => status)).toEqual([409]);
  expect(storedProfile(customer.username)).toEqual({ ...before, accountState: 'CLOSURE_REQUESTED' });

  await page.reload();
  await expect(ui.main.getByText(copy.accountClosing, { exact: true })).toBeVisible();
  await expect(ui.fullName).toHaveValue('');
  await expect(ui.main.getByText(copy.pendingNote(pendingMobile))).toBeVisible();
  await expectReadOnly(page);
});

test('E2E-11-36 a signed-out visitor opening /account/profile is sent to sign-in without reading a profile', t5, async ({ page }) => {
  // Every request counts, including one answered 401, so a profile read sent before the guard redirects fails here.
  const requests = recordProfileRequests(page);

  await page.goto('/account/profile');

  await expect(page).toHaveURL('/sign-in');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  expect(requests).toEqual([]);
});

test('E2E-11-37 invalid values show field errors and send nothing; valid ones save', t5, async ({ page }) => {
  await awayFromDhakaMidnight(page);
  const customer = await registerByApi(page.request);
  const calls = recordProfileCalls(page);
  const ui = profilePage(page);
  await openProfile(page, customer);

  for (const dateOfBirth of [dhakaDate(1), '1899-12-31']) {
    await ui.dateOfBirth.fill(dateOfBirth);
    await ui.save.click();
    await expectFieldError(ui.dateOfBirth, copy.dateOfBirthInvalid);
    await expect(ui.dateOfBirth).toBeFocused();
  }
  await ui.dateOfBirth.fill(dhakaDate(0));
  await ui.email.fill('not-an-email');
  await ui.save.click();
  await expectFieldError(ui.email, copy.emailInvalid);
  await expect(ui.email).toBeFocused();
  await ui.email.fill('');
  await expect(ui.currentPassword).toBeVisible();
  await ui.currentPassword.fill(customer.password);
  // Full name accepts at most 100 characters; the over-length error itself is covered by the unit tests.
  await expect(ui.fullName).toHaveAttribute('maxlength', '100');
  expect(only(calls, 'PUT')).toEqual([]);

  await ui.fullName.fill('n'.repeat(100));
  await ui.save.click();
  await expect(ui.saved).toBeVisible();
  await expect(ui.fullName).not.toHaveAttribute('aria-invalid', 'true');
  expect(storedProfile(customer.username)).toMatchObject({
    fullName: 'n'.repeat(100), email: null, dateOfBirth: dhakaDate(0), profileVersion: 1,
  });
});

test.describe('in a browser far west of Dhaka', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });

  test('E2E-11-38 the date-of-birth limit is today in Asia/Dhaka, not in the browser time zone', t5, async ({ page }) => {
    // 20:00 UTC is noon on 10 January in Los Angeles and already 11 January in Dhaka.
    await page.clock.setFixedTime(new Date('2026-01-10T20:00:00Z'));
    const customer = await registerByApi(page.request);
    const calls = recordProfileCalls(page);
    const ui = profilePage(page);
    await openProfile(page, customer);

    await ui.dateOfBirth.fill('2026-01-12');
    await ui.save.click();
    await expectFieldError(ui.dateOfBirth, copy.dateOfBirthInvalid);
    expect(only(calls, 'PUT')).toEqual([]);

    await ui.dateOfBirth.fill('2026-01-11');
    await ui.save.click();
    await expect(ui.saved).toBeVisible();
    expect(storedProfile(customer.username).dateOfBirth).toBe('2026-01-11');
  });
});

test('E2E-11-39 an email another User holds shows the duplicate message and saves nothing', t5, async ({ page }) => {
  const other = await registerByApi(page.request);
  const customer = await registerByApi(page.request);
  const calls = recordProfileCalls(page);
  const ui = profilePage(page);
  await openProfile(page, customer);

  await ui.email.fill(other.email.toUpperCase());
  await ui.currentPassword.fill(customer.password);
  await ui.save.click();

  await expect(page.getByRole('alert').filter({ hasText: copy.duplicateUser })).toBeVisible();
  expect(only(calls, 'PUT').map(({ status }) => status)).toEqual([409]);
  expect(storedProfile(customer.username)).toMatchObject({ email: customer.email, profileVersion: 0 });
});

test('E2E-11-40 a value the API refuses shows the check-your-details message', t5, async ({ page }) => {
  const customer = await registerByApi(page.request);
  const calls = recordProfileCalls(page);
  const ui = profilePage(page);
  await openProfile(page, customer);
  // The browser cannot produce 30 February, so the request is changed on its way to the real API.
  await page.route(`${apiUrl}${profilePath}`, async (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    const body = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
    await route.continue({ postData: JSON.stringify({ ...body, dateOfBirth: '1990-02-30' }) });
  });

  await ui.fullName.fill('Refused Date');
  await ui.dateOfBirth.fill('1990-02-28');
  await ui.save.click();

  await expect(page.getByRole('alert').filter({ hasText: copy.checkDetails })).toBeVisible();
  expect(only(calls, 'PUT').map(({ status }) => status)).toEqual([400]);
  expect(storedProfile(customer.username)).toMatchObject({ fullName: null, dateOfBirth: null, profileVersion: 0 });
});

test('E2E-11-41 the Change mobile dialog: keyboard, focus return, errors inside it, and replacing a pending number', t5, async ({ page }) => {
  const other = await registerByApi(page.request);
  const customer = await registerByApi(page.request);
  const calls = recordProfileCalls(page);
  const ui = profilePage(page);
  await openProfile(page, customer);
  const focusIsInDialog = () => page.evaluate(() => document.activeElement?.closest('dialog') !== null);

  await test.step('Enter opens it; it asks only for the new number and never for a code', async () => {
    await ui.change.focus();
    await page.keyboard.press('Enter');
    await expect(ui.dialog).toBeVisible();
    await expect.poll(focusIsInDialog).toBe(true);
    await expect(ui.dialog.getByText(copy.mobileExplanation)).toBeVisible();
    await expect(ui.dialog.getByRole('textbox')).toHaveCount(1);
    await expect(ui.newMobile).toBeVisible();
    await expect(page.getByRole('button', { name: /send code/i })).toHaveCount(0);
  });

  await test.step('Escape closes it without a request and returns focus to Change', async () => {
    await ui.newMobile.fill(syntheticMobile());
    await page.keyboard.press('Escape');
    await expect(ui.dialog).toBeHidden();
    await expect(ui.change).toBeFocused();
  });

  await test.step('Cancel closes it without a request and returns focus to Change', async () => {
    await page.keyboard.press('Enter');
    await expect(ui.dialog).toBeVisible();
    await ui.newMobile.fill(syntheticMobile());
    await ui.dialogCancel.click();
    await expect(ui.dialog).toBeHidden();
    await expect(ui.change).toBeFocused();
    expect(only(calls, 'POST')).toEqual([]);
  });

  await test.step('a number another User holds is refused inside the dialog', async () => {
    await ui.change.click();
    await ui.newMobile.fill(other.mobile);
    await ui.saveForVerification.click();
    await expect(ui.dialog.getByRole('alert').filter({ hasText: copy.duplicateUser })).toBeVisible();
    await expect(ui.dialog).toBeVisible();
    await expect(ui.newMobile).toBeFocused();
  });

  await test.step('the current number is refused inside the dialog; the API alone decides (P7)', async () => {
    await ui.newMobile.fill(customer.mobile);
    await ui.saveForVerification.click();
    await expect(ui.dialog.getByRole('alert').filter({ hasText: copy.checkDetails })).toBeVisible();
    expect(only(calls, 'POST').map(({ status }) => status)).toEqual([409, 400]);
    expect(storedProfile(customer.username).pendingChanges).toEqual([]);
  });

  await test.step('a new number is staged, and a newer one replaces it', async () => {
    const [second, third] = [syntheticMobile(), syntheticMobile()];
    await ui.newMobile.fill(second);
    await ui.saveForVerification.click();
    await expect(ui.dialog).toBeHidden();
    await expect(ui.main.getByText(copy.pendingNote(second))).toBeVisible();
    await expect(ui.change).toBeFocused();

    await ui.change.click();
    await ui.newMobile.fill(third);
    await ui.saveForVerification.click();
    await expect(ui.dialog).toBeHidden();
    await expect(ui.main.getByText(copy.pendingNote(third))).toBeVisible();
    await expect(ui.change).toBeFocused();
    await expect(ui.main.getByText(copy.pendingNote(second))).toHaveCount(0);
    expect(storedProfile(customer.username).pendingChanges.map(({ newMobile }) => newMobile)).toEqual([third]);
  });
});

test('E2E-11-42 Save changes waits for a change, shows Saving… and double submits send one request', t5, async ({ page }) => {
  const customer = await registerByApi(page.request);
  const ui = profilePage(page);
  await openProfile(page, customer);
  await expect(ui.save).toBeDisabled();
  // Each PUT and POST is recorded when the page dispatches it and held, so both clicks of a double click are made while
  // the first request is still open, and a second request counts however late it would be answered.
  const puts = await holdRequests(page, 'PUT', profilePath);
  const posts = await holdRequests(page, 'POST', mobileChangePath);

  await ui.fullName.fill('Double Saver');
  await ui.save.dblclick();
  await expect(page.getByRole('button', { name: 'Saving…', exact: true })).toBeDisabled();
  await expect.poll(puts.statuses).toEqual([undefined]);
  puts.release();
  await expect(ui.saved).toBeVisible();
  await expect(ui.fullName).toHaveValue('Double Saver');

  const newMobile = syntheticMobile();
  await ui.change.click();
  await ui.newMobile.fill(newMobile);
  await ui.saveForVerification.dblclick();
  await expect.poll(posts.statuses).toEqual([undefined]);
  posts.release();
  await expect(ui.dialog).toBeHidden();
  await expect(ui.main.getByText(copy.pendingNote(newMobile))).toBeVisible();

  // Everything the page ever dispatched is counted, answered or not: one save and one stage.
  expect(puts.statuses()).toEqual([200]);
  expect(posts.statuses()).toEqual([202]);
  expect(storedProfile(customer.username)).toMatchObject({ fullName: 'Double Saver', profileVersion: 1 });
  expect(storedProfile(customer.username).pendingChanges.map(({ newMobile: staged }) => staged)).toEqual([newMobile]);
});

test('E2E-11-43 the verification state is a text chip, and a pending change leaves the current number verified', t5, async ({ page }) => {
  const customer = await registerByApi(page.request);
  markMobileVerified(customer.username);
  const ui = profilePage(page);
  await openProfile(page, customer);

  await expect(ui.mobileField.getByText('Verified', { exact: true })).toBeVisible();
  await expect(ui.mobileField.getByText('Not verified', { exact: true })).toHaveCount(0);

  const newMobile = syntheticMobile();
  await ui.change.click();
  await ui.newMobile.fill(newMobile);
  await ui.saveForVerification.click();
  await expect(ui.main.getByText(copy.pendingNote(newMobile))).toBeVisible();
  await expect(ui.main.getByText(customer.mobile)).toBeVisible();
  await expect(ui.mobileField.getByText('Verified', { exact: true })).toBeVisible();
  expect(storedProfile(customer.username)).toMatchObject({ mobile: customer.mobile, mobileVerified: true });
});

for (const [id, width] of [['E2E-11-44', 375], ['E2E-11-45', 1280]] as const) {
  test.describe(`${width} px`, () => {
    test.use({ viewport: { width, height: 800 } });

    test(`${id} the profile page and mobile dialog fit ${width} px and work by keyboard with labels and focus rings`, t5, async ({ page, request }) => {
      const customer = await registerByApi(page.request);
      // A separate context, so the browser has no session before `openProfile` signs in (see E2E-11-35).
      await ProfileApi.forUser(request, customer).stage({ mobile: syntheticMobile() });
      const ui = profilePage(page);
      await openProfile(page, customer);
      await expect(ui.cancelChange).toBeVisible();
      await page.reload();
      await expect(ui.cancelChange).toBeVisible();

      await expectLayout(page, ui.main);
      await expect(ui.mobileField.getByText('Not verified', { exact: true })).toBeVisible();
      await expectKeyboardOrder(page);

      await ui.change.focus();
      await page.keyboard.press('Enter');
      await expect(ui.dialog).toBeVisible();
      await expectLayout(page, ui.dialog);
      for (let press = 0; press < 6; press += 1) {
        await page.keyboard.press('Tab');
        // Chrome and Edge can move focus to browser chrome after the last dialog control.
        expect(await page.evaluate(() => document.activeElement?.closest('dialog') !== null
          || (document.activeElement === document.body && !document.hasFocus()))).toBe(true);
      }
      await page.keyboard.press('Escape');
      await expect(ui.dialog).toBeHidden();
      await expect(ui.change).toBeFocused();
    });
  });
}

test('E2E-11-46 profile values and mobiles stay out of the log, console, storage, URLs and history', t5, async ({ page }) => {
  const other = await registerByApi(page.request);
  const customer = await registerByApi(page.request);
  const urls: string[] = [];
  const consoleText: string[] = [];
  const storage: string[] = [];
  page.on('request', (request) => urls.push(request.url()));
  page.on('framenavigated', (frame) => urls.push(frame.url()));
  page.on('console', (message) => consoleText.push(message.text()));
  const snapshotStorage = async () => {
    storage.push(await page.evaluate(() => JSON.stringify({
      local: { ...localStorage }, session: { ...sessionStorage }, history: history.state, location: location.href,
    })));
  };
  const ui = profilePage(page);
  const fullName = syntheticFullName();
  const email = `private.${hex()}@example.test`;
  const dateOfBirth = '1987-03-14';
  const pendingMobile = syntheticMobile();

  await openProfile(page, customer);
  await ui.fullName.fill(fullName);
  await ui.email.fill(email);
  await ui.currentPassword.fill(customer.password);
  await snapshotStorage();
  await ui.dateOfBirth.fill(dateOfBirth);
  await snapshotStorage();
  await ui.save.click();
  await expect(ui.saved).toBeVisible();
  await snapshotStorage();
  await ui.change.click();
  await ui.newMobile.fill(other.mobile);
  await snapshotStorage();
  await ui.saveForVerification.click();
  await expect(ui.dialog.getByRole('alert')).toBeVisible();
  await ui.newMobile.fill(pendingMobile);
  await snapshotStorage();
  await ui.saveForVerification.click();
  await expect(ui.main.getByText(copy.pendingNote(pendingMobile))).toBeVisible();
  await page.reload();
  await expect(ui.fullName).toHaveValue(fullName);
  await snapshotStorage();
  await ui.cancelChange.click();
  await expect(ui.cancelChange).toHaveCount(0);
  await snapshotStorage();

  const tracked = [fullName, email, dateOfBirth, customer.mobile, pendingMobile, other.mobile, customer.email,
    customer.password];
  const apiLog = readFileSync(apiLogPath, 'utf8');
  // Response-status events prove the scan read the request log, not an empty file.
  expect(apiLog).toContain('"message":"HTTP response status=');
  const surfaces = {
    'backend log': apiLog,
    console: consoleText.join('\n'),
    // Each URL also as decoded text, so an encoded value cannot hide in a path, query or fragment.
    'URLs and history': urls.map(urlScanText).join('\n'),
    'storage and history state': storage.join('\n'),
  };
  // Each value as typed, percent-encoded and form-encoded (`+` for a space).
  const forms = tracked.flatMap(encodedForms);
  for (const [surface, text] of Object.entries(surfaces)) {
    expect(forms.filter((value) => text.includes(value)).length, `profile values found in the ${surface}`).toBe(0);
  }
});

test('E2E-11-47 smoke: a Customer saves a full name, and a future date of birth is refused', {
  tag: ['@t11', '@t11-T5', '@smoke'],
}, async ({ page }) => {
  await awayFromDhakaMidnight(page);
  const customer = await registerByApi(page.request);
  const ui = profilePage(page);
  await openProfile(page, customer);

  await ui.fullName.fill('Smoke Profile');
  await ui.save.click();
  await expect(ui.saved).toBeVisible();

  await ui.dateOfBirth.fill(dhakaDate(1));
  await ui.save.click();
  await expectFieldError(ui.dateOfBirth, copy.dateOfBirthInvalid);
});

test('E2E-11-48 an MFA-verified Admin edits their own profile on /account/profile', t5, async ({ page }) => {
  const admin = await registerByApi(page.request);
  grantRole(admin.username, 'ADMIN');
  // Signing in and enrolling through the page's request context leaves the verified refresh cookie in the browser.
  const signedIn = await signInByApi(page.request, admin.username, admin.password);
  const restricted = { Authorization: `Bearer ${(await signedIn.json() as { accessToken: string }).accessToken}` };
  const enrollment = await page.request.post(`${apiUrl}/api/auth/mfa/enrollment`, { headers: restricted });
  expect(enrollment.status()).toBe(201);
  const { enrollmentId, secret } = await enrollment.json() as { enrollmentId: string; secret: string };
  const verified = await page.request.post(`${apiUrl}/api/auth/mfa/enrollment/verify`, {
    headers: { ...restricted, 'Content-Type': 'application/json' },
    data: JSON.stringify({ enrollmentId, code: totpCode(secret, totpStep()) }),
  });
  expect((await verified.json() as { mfa: string }).mfa).toBe('VERIFIED');
  const ui = profilePage(page);

  await page.goto('/account/profile');
  await expect(page).toHaveURL('/account/profile');
  await expect(ui.main.getByText(admin.username, { exact: true })).toBeVisible();
  await ui.fullName.fill('Admin Profile');
  await ui.save.click();
  await expect(ui.saved).toBeVisible();
  expect(storedProfile(admin.username)).toMatchObject({ fullName: 'Admin Profile', profileVersion: 1 });
});

test('E2E-11-52 one profile request at a time: nothing else starts while a save, stage or cancel is open, and the page keeps the latest answer', t5, async ({ page, request }) => {
  const customer = await registerByApi(page.request);
  const firstPending = syntheticMobile();
  // A separate context, so the browser has no session before `openProfile` signs in (see E2E-11-35).
  await ProfileApi.forUser(request, customer).stage({ mobile: firstPending });
  const ui = profilePage(page);
  await openProfile(page, customer);
  await expect(ui.main.getByText(copy.pendingNote(firstPending))).toBeVisible();
  const puts = await holdRequests(page, 'PUT', profilePath);
  const posts = await holdRequests(page, 'POST', mobileChangePath);
  const deletes = await holdRequests(page, 'DELETE', mobileChangePath);

  await test.step('while a save is open, no stage or cancel can start and the fields cannot change under it', async () => {
    await ui.fullName.fill('First Save');
    await ui.save.click();
    await expect(page.getByRole('button', { name: 'Saving…', exact: true })).toBeDisabled();
    await expect(ui.change).toBeDisabled();
    await expect(ui.cancelChange).toBeDisabled();
    for (const field of [ui.fullName, ui.email, ui.dateOfBirth]) await expect(field).not.toBeEditable();
    puts.release();
    await expect(ui.saved).toBeVisible();
    await expect(ui.fullName).toHaveValue('First Save');
    await expect(ui.main.getByText(copy.pendingNote(firstPending))).toBeVisible();
  });

  const secondPending = syntheticMobile();
  await test.step('while a stage is open, it cannot be sent again; its answer keeps the saved values', async () => {
    await ui.change.click();
    await ui.newMobile.fill(secondPending);
    await ui.saveForVerification.click();
    await expect(ui.saveForVerification).toBeDisabled();
    await expect.poll(posts.statuses).toEqual([undefined]);
    posts.release();
    await expect(ui.dialog).toBeHidden();
    await expect(ui.main.getByText(copy.pendingNote(secondPending))).toBeVisible();
    await expect(ui.fullName).toHaveValue('First Save');
  });

  await test.step('while a cancel is open, no stage, second cancel or save of an unsaved edit can start', async () => {
    await ui.fullName.fill('Unsaved Draft');
    await expect(ui.save).toBeEnabled();
    await ui.cancelChange.click();
    await expect(ui.change).toBeDisabled();
    await expect(ui.cancelChange).toBeDisabled();
    await expect(ui.save).toBeDisabled();
    // Nor can implicit submission (Enter in a field) start one.
    await ui.fullName.press('Enter');
    await expect.poll(deletes.statuses).toEqual([undefined]);
    deletes.release();
    await expect(ui.cancelChange).toHaveCount(0);
    // The cancel answer touches only the mobile part (§4.6): the unsaved edit stays and can be saved again.
    await expect(ui.fullName).toHaveValue('Unsaved Draft');
    await expect(ui.save).toBeEnabled();
    expect(puts.statuses()).toEqual([200]);
  });

  await test.step('the page holds the latest version: the next save is current, not stale', async () => {
    await ui.fullName.fill('Second Save');
    await ui.save.click();
    await expect.poll(puts.statuses).toEqual([200, 200]);
    await expect(ui.fullName).toHaveValue('Second Save');
    await expect(page.getByText(copy.staleUpdate)).toHaveCount(0);
  });

  expect(posts.statuses()).toEqual([202]);
  expect(deletes.statuses()).toEqual([204]);
  expect(storedProfile(customer.username)).toMatchObject({
    fullName: 'Second Save', mobile: customer.mobile, profileVersion: 2, pendingChanges: [],
  });
});

test('E2E-11-53 a stage or cancel keeps an unsaved edit and the version it was made from, so a newer save elsewhere still makes it stale', t5, async ({ page, request }) => {
  const customer = await registerByApi(page.request);
  const calls = recordProfileCalls(page);
  const ui = profilePage(page);
  await openProfile(page, customer);
  // Another tab saves after this page loaded version 0. A separate context, so the browser keeps its own session.
  await ProfileApi.forUser(request, customer).save({ fullName: 'Other Tab' });
  await ui.fullName.fill('Unsaved Draft');

  const pending = syntheticMobile();
  await ui.change.click();
  await ui.newMobile.fill(pending);
  await ui.saveForVerification.click();
  await expect(ui.dialog).toBeHidden();
  await expect(ui.main.getByText(copy.pendingNote(pending))).toBeVisible();
  // The stage answer carries the newer saved profile, but the page applies only its mobile part (§4.6).
  await expect(ui.fullName).toHaveValue('Unsaved Draft');
  await expect(ui.save).toBeEnabled();

  await ui.cancelChange.click();
  await expect(ui.cancelChange).toHaveCount(0);
  await expect(ui.fullName).toHaveValue('Unsaved Draft');

  await ui.save.click();
  await expect(page.getByRole('alert').filter({ hasText: copy.staleUpdate })).toBeVisible();
  const puts = only(calls, 'PUT');
  expect(puts.map(({ status }) => status)).toEqual([409]);
  expect(JSON.parse(puts[0].body ?? '{}')).toMatchObject({ fullName: 'Unsaved Draft', version: 0 });
  expect(only(calls, 'POST').map(({ status }) => status)).toEqual([202]);
  expect(only(calls, 'DELETE').map(({ status }) => status)).toEqual([204]);
  expect(storedProfile(customer.username)).toMatchObject({ fullName: 'Other Tab', profileVersion: 1, pendingChanges: [] });
});
