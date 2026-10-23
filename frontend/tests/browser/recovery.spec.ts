import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test, type APIResponse, type Locator, type Page, type Request } from '@playwright/test';
import {
  encodedForms, openProfile, recordProfileCalls, registerByApi, setAccountState, signInByApi, storedProfile, urlScanText,
} from './profileSupport';
import {
  accentColour, ageLimits, agePasswordLimit, capturedMail, codeInLog, comparableHeaders, expectAccepted, expectKeyboardOrder, expectLayout,
  expectNoMailFor, forgotPasswordPage, hasCode, mailedCode, markEmailVerified, newPassword, profileRecovery, readCapturedMail, recoveryCopy,
  requestReset, resetConfirmPath, resetPasswordThroughPage, resetRequestPath, resetSentinel, setStoredEmail, storedCodes,
  storedCodeIds, storedEmailState,
  unknownEmail, verificationConfirmPath, verificationPath, verifiedCustomer, verifyEmailThroughProfile, wrongCode,
} from './recoverySupport';
import { freshCode, register, signIn, syntheticCustomer, verifiedAdmin } from './support';
import { apiLogPath, apiUrl, sessionStates } from './testApi';

/**
 * Ticket 05 browser acceptance tests (plan §10.4, E2E-05-40 to 59): email verification on Profile and the email
 * password reset, through the real frontend build against the real test API, with mail read from the run's capture
 * directory. They are written test-first and pass once the page (T3) and the API (T4) are joined, so each carries
 * `@t05-T5`. Synthetic data only.
 *
 * Each test also carries one area tag, so a slice can be run while it is being built:
 * `npm run test:browser -- --grep @t05-reset` (the forgot-password page and the reset), `@t05-verify` (verification on
 * Profile), `@t05-email-change` (Current password and email changes, O8), `@t05-a11y` (E2E-05-45/46) or `@t05-privacy`
 * (E2E-05-47), `@t05-limits` (E2E-05-56); `--grep @t05-T5` runs them all.
 */
const t5 = ['@t05', '@t05-T5'];
const reset = { tag: [...t5, '@t05-reset'] };
const verification = { tag: [...t5, '@t05-verify'] };
const emailChange = { tag: [...t5, '@t05-email-change'] };
const a11y = { tag: [...t5, '@t05-a11y'] };
const privacy = { tag: [...t5, '@t05-privacy'] };
const limits = { tag: [...t5, '@t05-limits'] };
const smoke = { tag: [...t5, '@t05-reset', '@smoke'] };

const hex = () => randomBytes(3).toString('hex');

/** The four Ticket 05 routes; a recorded request to any other path is ignored. */
const recoveryPaths = [resetRequestPath, resetConfirmPath, verificationPath, verificationConfirmPath];

/** One request the page sent to a Ticket 05 route, with its `Content-Type` and, once answered, the status. */
type RecoveryCall = { method: string; path: string; body: string | null; contentType: string | undefined; status?: number };

/**
 * Records every request the page sends to the four Ticket 05 routes (CORS preflights left out) when it is dispatched,
 * so a request sent on a client-side validation failure counts even before it is answered. The returned reader lists
 * the calls to one path; it leaves out a call answered `401`, which the session client refreshes and retries once.
 */
function recordRecoveryCalls(page: Page): (path: string) => RecoveryCall[] {
  const calls: RecoveryCall[] = [];
  const byRequest = new WeakMap<Request, RecoveryCall>();
  page.on('request', (request) => {
    if (request.method() === 'OPTIONS' || !request.url().startsWith(apiUrl)) return;
    const { pathname } = new URL(request.url());
    if (!recoveryPaths.includes(pathname)) return;
    const call: RecoveryCall = {
      method: request.method(), path: pathname, body: request.postData(), contentType: request.headers()['content-type'],
    };
    calls.push(call);
    byRequest.set(request, call);
  });
  page.on('response', (response) => {
    const call = byRequest.get(response.request());
    if (call) call.status = response.status();
  });
  return (path) => calls.filter((call) => call.path === path && call.status !== 401);
}

/** The JSON a recorded call sent. */
function sentJson(call: RecoveryCall): unknown {
  return JSON.parse(call.body ?? 'null');
}

/** One request the page dispatched, with the API's status once it answered. */
type DispatchedRequest = { body: string | null; status?: number };

/**
 * Intercepts every `method` request the page sends to `path` and records it when it is dispatched, so a duplicate
 * counts however late (or whether) it is answered. Each is held until `release()`; later ones pass straight through
 * and are still recorded. `statuses()` lists one entry per real attempt, `undefined` while unanswered; it leaves out a
 * request answered `401`, which the session client refreshes and retries once. Copied from `profile.spec.ts`, plus
 * `bodies()` for the request-body checks.
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
    statuses: () => requests.filter(({ status }) => status !== 401).map(({ status }) => status),
    bodies: () => requests.filter(({ status }) => status !== 401).map(({ body }) => body),
    release: () => {
      open = true;
      waiting.splice(0).forEach((resolve) => resolve());
    },
  };
}

/** `text` as a regular expression that matches it literally. */
function literal(text: string): RegExp {
  return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

/**
 * Asserts a field error: the input is marked invalid and linked to a visible error by aria-describedby. A field with a
 * hint (New password, "6–30 characters") may be described by the hint and the error together, so the message is
 * matched within the accessible description rather than as all of it.
 */
async function expectFieldError(input: Locator, message: string): Promise<void> {
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(input).toHaveAccessibleDescription(literal(message));
  await expect.poll(() => input.evaluate((field, expected) => {
    const ids = field.getAttribute('aria-describedby')?.match(/\S+/g) ?? [];
    return ids.some((id) => {
      const description = field.ownerDocument.getElementById(id);
      return description?.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
        && description.innerText.includes(expected);
    });
  }, message)).toBe(true);
}

/** Every input on the page is disabled or read-only, and no edit button, Verify included, is enabled. */
async function expectReadOnly(page: Page): Promise<void> {
  expect(await page.getByRole('main').locator('input').evaluateAll((inputs) =>
    inputs.filter((input) => !(input as HTMLInputElement).disabled && !(input as HTMLInputElement).readOnly).length)).toBe(0);
  for (const name of ['Save changes', 'Change', 'Cancel change', recoveryCopy.verifyEmail]) {
    await expect(page.getByRole('button', { name, exact: true, disabled: false })).toHaveCount(0);
  }
}

/**
 * Signs in through the form already on `/sign-in`, without loading the page again, so a notice shown there (such as
 * "Your password was changed.") is still in place; the caller checks where the session lands.
 */
async function signInHere(page: Page, identifier: string, password: string): Promise<void> {
  await page.getByLabel('Mobile, email or username').fill(identifier);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

/** Signs out from `/account`, which lands on the home page. */
async function signOut(page: Page): Promise<void> {
  await page.goto('/account');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL('/');
}

/** The address with alternate letters in upper case, as a person might type it. */
function mixedCase(email: string): string {
  return [...email].map((character, index) => (index % 2 === 0 ? character.toUpperCase() : character)).join('');
}

/** Presses Tab until `target` has focus, failing after `presses` presses. */
async function tabTo(page: Page, target: Locator, presses = 30): Promise<void> {
  for (let press = 0; press < presses; press += 1) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((element) => element === document.activeElement)) return;
  }
  throw new Error(`Tab did not reach the control within ${presses} presses`);
}

/** The focused `target` shows the amber `--accent` `:focus-visible` outline. */
async function expectAccentRing(page: Page, target: Locator): Promise<void> {
  const accent = await accentColour(page);
  expect(await target.evaluate((element, colour) => {
    const style = getComputedStyle(element);
    return style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0 && style.outlineColor === colour;
  }, accent), 'the amber focus ring').toBe(true);
}

/**
 * `expectKeyboardOrder` from the top of the document on a page that cannot be loaded afresh. The forgot-password code
 * step lives only in React state (a reload returns to the email step, plan §4.7), and its uniform status takes focus
 * when shown. A temporary `tabindex="-1"` marker at the start of `<body>` takes focus instead, which puts the
 * sequential focus starting point where a fresh load leaves it; the marker is not a control, so the expected order is
 * unchanged, and it is removed afterwards.
 */
async function expectKeyboardOrderFromTop(page: Page): Promise<void> {
  await page.evaluate(() => {
    const marker = document.createElement('div');
    marker.tabIndex = -1;
    marker.dataset.keyboardStart = '';
    document.body.prepend(marker);
    marker.focus();
  });
  try {
    await expectKeyboardOrder(page);
  } finally {
    await page.evaluate(() => document.querySelector('[data-keyboard-start]')?.remove());
  }
}

/** The response headers that may differ between two otherwise identical answers (as in `comparableHeaders`). */
const varyingHeaders = new Set(['x-request-id', 'date']);

/** Captures the upstream answer before it is fulfilled to the page, so a later navigation cannot discard its body. */
async function pageAnswer(response: APIResponse): Promise<{ status: number; headers: Record<string, string>; bodyLength: number }> {
  const headers = Object.entries(response.headers())
    .filter(([name]) => !varyingHeaders.has(name.toLowerCase()))
    .sort(([a], [b]) => a.localeCompare(b));
  return { status: response.status(), headers: Object.fromEntries(headers), bodyLength: (await response.body()).length };
}

test('E2E-05-40 full journey: verify the email on Profile, reset the password from sign-in, and sign in with the new one', reset, async ({ page, request }) => {
  const customer = syntheticCustomer();
  const calls = recordRecoveryCalls(page);
  const ui = profileRecovery(page);
  const forgot = forgotPasswordPage(page);
  const typedEmail = mixedCase(customer.email);
  // Leading and trailing spaces: a password is never trimmed (A5), so it must be sent and accepted exactly as typed.
  const replacement = ` ${newPassword()} `;
  let verificationCode = '';
  let resetCode = '';

  await test.step('registration with an email opens /account; Edit profile shows the email Not verified', async () => {
    await register(page, customer);
    await page.getByRole('link', { name: 'Edit profile', exact: true }).click();
    await expect(page).toHaveURL('/account/profile');
    await expect(ui.email).toHaveValue(customer.email);
    await expect(ui.emailNotVerifiedChip).toBeVisible();
    await expect(ui.verify).toBeEnabled();
  });

  await test.step('Verify mails a code; Confirm shows Verified and focuses "Email verified."', async () => {
    await ui.verify.click();
    await expect(ui.dialog).toBeVisible();
    await expect(ui.dialog.getByText(recoveryCopy.verifyEmailIntro(customer.email))).toBeVisible();
    verificationCode = await mailedCode(customer.email, 'EMAIL_VERIFICATION_CODE');
    await ui.dialogCode.fill(verificationCode);
    await ui.dialogConfirm.click();
    await expect(ui.dialog).toBeHidden();
    await expect(ui.emailVerifiedChip).toBeVisible();
    await expect(ui.verifiedNotice).toBeFocused();
    await expect(ui.verify).toHaveCount(0);
    expect(storedEmailState(customer.username)).toEqual({ email: customer.email, emailVerified: true });
  });

  await test.step('a reload still shows Verified', async () => {
    await page.reload();
    await expect(ui.emailVerifiedChip).toBeVisible();
    await expect(ui.verify).toHaveCount(0);
  });

  await test.step('after signing out, Forgot password? on /sign-in opens /forgot-password', async () => {
    await signOut(page);
    await page.goto('/sign-in');
    await page.getByRole('link', { name: recoveryCopy.forgotPassword, exact: true }).click();
    await expect(page).toHaveURL('/forgot-password');
    await expect(forgot.heading).toBeVisible();
  });

  await test.step('the email typed in mixed case gets the uniform message, focused, and a reset code by mail', async () => {
    // The verification code started the shared 60-second gap (plan O7); move it into the past.
    expect(ageLimits(customer.username, 61)).toBe(1);
    await forgot.email.fill(`  ${typedEmail}  `);
    await forgot.sendCode.click();
    await expect(forgot.codeSent).toBeFocused();
    resetCode = await mailedCode(customer.email, 'PASSWORD_RESET_CODE');
  });

  await test.step('the code and a new password reset it; /sign-in announces the change and no session is left', async () => {
    await forgot.code.fill(resetCode);
    await forgot.newPassword.fill(replacement);
    await forgot.submit.click();
    await expect(page).toHaveURL('/sign-in');
    await expect(page.getByRole('status').filter({ hasText: recoveryCopy.passwordReset })).toBeFocused();
    expect(sessionStates(customer.username)).not.toContain('active');
  });

  await test.step('the old password is refused; the new one signs in and survives a reload', async () => {
    await signInHere(page, customer.username, customer.password);
    await expect(page.getByRole('alert').filter({ hasText: recoveryCopy.authenticationFailed })).toBeVisible();
    await expect(page).toHaveURL('/sign-in');
    expect(sessionStates(customer.username)).not.toContain('active');

    await signInHere(page, customer.username, replacement);
    await expect(page).toHaveURL('/account');
    await page.reload();
    await expect(page).toHaveURL('/account');
    await expect(page.getByRole('heading', { level: 1, name: 'Your account' })).toBeVisible();
    expect(sessionStates(customer.username)).toContain('active');
  });

  await test.step('one password-changed notice reached the address, with no code and no password', async () => {
    const notice = await readCapturedMail(customer.email, 'PASSWORD_CHANGED');
    expect(hasCode(notice.body)).toBe(false);
    expect(notice.body.includes(replacement.trim()), 'password absent from password-changed notice').toBe(false);
    const sentinel = await resetSentinel(request)();
    await readCapturedMail(sentinel.to, sentinel.kind);
    expect(capturedMail({ to: customer.email, kind: 'PASSWORD_CHANGED' })).toHaveLength(1);
  });

  await test.step('the page sent exactly the contract bodies', async () => {
    const verifyRequests = calls(verificationPath);
    expect(verifyRequests.map(({ method, status }) => [method, status])).toEqual([['POST', 204]]);
    expect((verifyRequests[0].body ?? '').length, 'the verification request has no body').toBe(0);
    expect(verifyRequests[0].contentType, 'nor a Content-Type').toBeUndefined();
    expect(calls(verificationConfirmPath).map(({ status }) => status)).toEqual([200]);
    expect(calls(verificationConfirmPath).map(sentJson)).toEqual([{ code: verificationCode }]);
    // The email is sent trimmed but as typed; the API normalizes it.
    expect(calls(resetRequestPath).map(({ status }) => status)).toEqual([202]);
    expect(calls(resetRequestPath).map(sentJson)).toEqual([{ email: typedEmail }]);
    expect(calls(resetConfirmPath).map(({ status }) => status)).toEqual([204]);
    expect(calls(resetConfirmPath).map(sentJson)).toEqual([{ email: typedEmail, code: resetCode, newPassword: replacement }]);
  });
});

test('E2E-05-41 wrong codes are refused and void the code after five; after the 60-second gap a new code replaces it', reset, async ({ page, request }) => {
  const customer = await verifiedCustomer(request);
  const calls = recordRecoveryCalls(page);
  const forgot = forgotPasswordPage(page);
  const replacement = newPassword();
  const confirmStatuses = () => calls(resetConfirmPath).map(({ status }) => status);
  let first = '';
  let second = '';
  let firstCodeId = '';

  await test.step('a code is mailed', async () => {
    await page.goto('/forgot-password');
    await forgot.email.fill(customer.email);
    await forgot.sendCode.click();
    await expect(forgot.codeSent).toBeFocused();
    first = await mailedCode(customer.email, 'PASSWORD_RESET_CODE');
    [firstCodeId] = storedCodeIds(customer.username, 'PASSWORD_RESET');
    expect(firstCodeId).toBeTruthy();
  });

  await test.step('a wrong code: the alert, Code emptied and focused, New password kept; the old password still works', async () => {
    await forgot.code.fill(wrongCode(first));
    await forgot.newPassword.fill(replacement);
    await forgot.submit.click();
    await expect.poll(confirmStatuses).toEqual([400]);
    await expect(forgot.codeInvalid).toBeVisible();
    await expect(forgot.code).toHaveValue('');
    await expect(forgot.code).toBeFocused();
    await expect(forgot.newPassword).toHaveValue(replacement);
    expect((await signInByApi(request, customer.username, customer.password)).status()).toBe(200);
    expect(storedCodes(customer.username)).toEqual([
      { purpose: 'PASSWORD_RESET', sentTo: customer.email, failedAttempts: 1 },
    ]);
  });

  await test.step('four more wrong codes (five in all) void the code', async () => {
    for (let attempt = 2; attempt <= 5; attempt += 1) {
      await forgot.code.fill(wrongCode(first, attempt));
      await forgot.submit.click();
      await expect.poll(confirmStatuses).toEqual(Array<number>(attempt).fill(400));
      await expect(forgot.codeInvalid).toBeVisible();
      await expect(forgot.code).toBeFocused();
    }
    expect(storedCodes(customer.username).filter(({ purpose }) => purpose === 'PASSWORD_RESET')).toEqual([]);
  });

  await test.step('the right code is now refused the same way', async () => {
    await forgot.code.fill(first);
    await forgot.submit.click();
    await expect.poll(confirmStatuses).toEqual(Array<number>(6).fill(400));
    await expect(forgot.codeInvalid).toBeVisible();
    await expect(forgot.code).toHaveValue('');
  });

  await test.step('after the 60-second gap, Send a new code replaces the stored authorization', async () => {
    expect(ageLimits(customer.username, 61)).toBe(1);
    await forgot.sendNewCode.click();
    await expect.poll(() => calls(resetRequestPath).map(({ status }) => status)).toEqual([202, 202]);
    await expect(forgot.codeSent).toBeFocused();
    expect(calls(resetRequestPath).map(sentJson)).toEqual([{ email: customer.email }, { email: customer.email }]);
    second = await mailedCode(customer.email, 'PASSWORD_RESET_CODE', 2);
    const replacementIds = storedCodeIds(customer.username, 'PASSWORD_RESET');
    expect(replacementIds).toHaveLength(1);
    expect(replacementIds[0]).not.toBe(firstCodeId);
  });

  await test.step('distinct old digits fail; the newly mailed code resets', async () => {
    await forgot.newPassword.fill(replacement);
    if (first !== second) {
      await forgot.code.fill(first);
      await forgot.submit.click();
      await expect.poll(confirmStatuses).toEqual(Array<number>(7).fill(400));
      await expect(forgot.codeInvalid).toBeVisible();
    }

    await forgot.code.fill(second);
    await forgot.submit.click();
    await expect(page).toHaveURL('/sign-in');
    const invalidCount = first === second ? 6 : 7;
    expect(confirmStatuses()).toEqual([...Array<number>(invalidCount).fill(400), 204]);
    expect(sentJson(calls(resetConfirmPath)[invalidCount])).toEqual({ email: customer.email, code: second, newPassword: replacement });
    expect((await signInByApi(request, customer.username, customer.password)).status()).toBe(401);
    expect((await signInByApi(request, customer.username, replacement)).status()).toBe(200);
  });
});

test('E2E-05-42 unknown and unverified addresses get the same answer as a verified one, and no mail', reset, async ({ page, request }) => {
  const unknown = unknownEmail();
  const unverified = (await registerByApi(request)).email;
  const verified = (await verifiedCustomer(request)).email;
  const forgot = forgotPasswordPage(page);
  const answers: Awaited<ReturnType<typeof pageAnswer>>[] = [];
  await page.route(`${apiUrl}${resetRequestPath}`, async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const response = await route.fetch();
    answers.push(await pageAnswer(response));
    await route.fulfill({ response });
  });

  for (const [label, address] of [['an unknown address', unknown], ['a registered but unverified address', unverified],
    ['a verified address', verified]] as const) {
    await test.step(`${label} shows the uniform message, focused, and the code step`, async () => {
      await page.goto('/forgot-password');
      await forgot.email.fill(address);
      await forgot.sendCode.click();
      await expect(forgot.codeSent).toBeFocused();
      await expect(forgot.code).toBeVisible();
      await expect(forgot.newPassword).toBeVisible();
    });
  }

  await test.step('the three answers the page received are identical: 202, the same headers, an empty body', async () => {
    expect(answers[0].status).toBe(202);
    expect(answers[0].bodyLength).toBe(0);
    expect(answers[1]).toEqual(answers[0]);
    expect(answers[2]).toEqual(answers[0]);
  });

  await test.step('sent directly to the same route, the three answers are identical too', async () => {
    const direct: Record<string, string>[] = [];
    for (const address of [unknown, unverified, verified]) {
      const response = await requestReset(request, address);
      await expectAccepted(response);
      direct.push(comparableHeaders(response));
    }
    expect(direct[1]).toEqual(direct[0]);
    expect(direct[2]).toEqual(direct[0]);
  });

  await test.step('only the verified address got a code', async () => {
    await readCapturedMail(verified, 'PASSWORD_RESET_CODE');
    await expectNoMailFor([unknown, unverified], resetSentinel(request));
  });
});

test('E2E-05-43 an email change needs Current password, notifies the old verified address and ends its reset eligibility', emailChange, async ({ page, request }) => {
  const customer = await verifiedCustomer(request);
  const calls = recordProfileCalls(page);
  const puts = () => calls.filter(({ method }) => method === 'PUT');
  const ui = profileRecovery(page);
  const forgot = forgotPasswordPage(page);
  const changed = `changed.${hex()}@example.test`;
  await openProfile(page, customer);
  await expect(ui.emailVerifiedChip).toBeVisible();

  await test.step('typing a new email replaces the status row with Current password', async () => {
    await ui.email.fill(changed);
    await expect(ui.currentPassword).toBeVisible();
    await expect(ui.emailVerifiedChip).toHaveCount(0);
    await expect(ui.verify).toHaveCount(0);
  });

  await test.step('Save changes with Current password empty: a field error, focused, and no PUT', async () => {
    await ui.save.click();
    await expectFieldError(ui.currentPassword, recoveryCopy.currentPasswordInvalid);
    await expect(ui.currentPassword).toBeFocused();
    expect(puts()).toEqual([]);
  });

  await test.step('a wrong password: the API refuses it, shown as a field error; the field is emptied and focused', async () => {
    await ui.currentPassword.fill(`${customer.password}-wrong`);
    await ui.save.click();
    await expect.poll(() => puts().map(({ status }) => status)).toEqual([400]);
    await expectFieldError(ui.currentPassword, recoveryCopy.currentPasswordInvalid);
    await expect(ui.currentPassword).toHaveValue('');
    await expect(ui.currentPassword).toBeFocused();
    expect(storedEmailState(customer.username)).toEqual({ email: customer.email, emailVerified: true });
  });

  await test.step('the right password saves: Profile saved., Not verified, and Current password is gone', async () => {
    await ui.currentPassword.fill(customer.password);
    await ui.save.click();
    await expect(ui.saved).toBeFocused();
    await expect(ui.email).toHaveValue(changed);
    await expect(ui.emailNotVerifiedChip).toBeVisible();
    await expect(ui.verify).toBeVisible();
    await expect(ui.currentPassword).toHaveCount(0);
    expect(puts().map(({ status }) => status)).toEqual([400, 200]);
    const sent = JSON.parse(puts()[1].body ?? '{}') as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual(['currentPassword', 'dateOfBirth', 'email', 'fullName', 'version']);
    expect(sent.currentPassword).toBe(customer.password);
    expect(storedEmailState(customer.username)).toEqual({ email: changed, emailVerified: false });
  });

  await test.step('the old verified address gets the email-changed notice, with no code', async () => {
    const notice = await readCapturedMail(customer.email, 'EMAIL_CHANGED');
    expect(hasCode(notice.body)).toBe(false);
    expect(notice.body.includes(customer.password), 'password absent from email-changed notice').toBe(false);
  });

  await test.step('a name-only edit saves without Current password, and its PUT has no currentPassword key', async () => {
    await ui.fullName.fill('Name Only');
    await expect(ui.currentPassword).toHaveCount(0);
    await ui.save.click();
    await expect.poll(() => puts().map(({ status }) => status)).toEqual([400, 200, 200]);
    const sent = JSON.parse(puts()[2].body ?? '{}') as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual(['dateOfBirth', 'email', 'fullName', 'version']);
  });

  await test.step('a reset request for the old address shows the uniform message and mails no code', async () => {
    await signOut(page);
    await page.goto('/forgot-password');
    await forgot.email.fill(customer.email);
    await forgot.sendCode.click();
    await expect(forgot.codeSent).toBeFocused();
    // The old address rightly got the EMAIL_CHANGED notice, so `expectNoMailFor` (any kind) cannot be used as is. The
    // same ordering argument applies to one kind: once the later sentinel mail exists, a reset code would exist too.
    const sentinel = await resetSentinel(request)();
    await readCapturedMail(sentinel.to, sentinel.kind);
    expect(capturedMail({ to: customer.email, kind: 'PASSWORD_RESET_CODE' })).toHaveLength(0);
  });
});

test('E2E-05-44 a reset in another browser signs out an open tab: its next save goes to sign-in and saves nothing', reset, async ({ page, browser, request }) => {
  const customer = await verifiedCustomer(request);
  const ui = profileRecovery(page);
  await openProfile(page, customer);
  expect(sessionStates(customer.username)).toEqual(['active']);

  await test.step('another browser resets the password through the page', async () => {
    const other = await browser.newContext();
    try {
      await resetPasswordThroughPage(await other.newPage(), customer.email, newPassword());
    } finally {
      await other.close();
    }
    expect(sessionStates(customer.username)).toEqual(['password-reset']);
  });

  await test.step('the open tab saves a name: it is sent to sign-in with the expiry notice, and nothing is saved', async () => {
    await ui.fullName.fill('After Reset');
    await ui.save.click();
    await expect(page).toHaveURL('/sign-in');
    await expect(page.getByRole('status').filter({ hasText: recoveryCopy.sessionExpired })).toBeFocused();
    expect(storedProfile(customer.username)).toMatchObject({ fullName: null, profileVersion: 0 });
    expect(sessionStates(customer.username)).toEqual(['password-reset']);
  });
});

for (const [id, width] of [['E2E-05-45', 375], ['E2E-05-46', 1280]] as const) {
  test.describe(`${width} px`, () => {
    test.use({ viewport: { width, height: 800 } });

    test(`${id} the sign-in link, both forgot-password steps and the Verify email dialog fit ${width} px and work by keyboard`, a11y, async ({ page, request }) => {
      const calls = recordRecoveryCalls(page);
      const forgot = forgotPasswordPage(page);
      const main = page.getByRole('main');

      await test.step('/sign-in: Tab reaches Forgot password?, which shows the amber ring and is at least 44 × 44 px', async () => {
        await page.goto('/sign-in');
        const link = page.getByRole('link', { name: recoveryCopy.forgotPassword, exact: true });
        await expect(link).toHaveAttribute('href', '/forgot-password');
        await tabTo(page, link);
        await expect(link).toBeFocused();
        await expectAccentRing(page, link);
        const box = await link.boundingBox();
        expect(box?.width ?? 0, 'the link is at least 44 px wide').toBeGreaterThanOrEqual(44);
        expect(box?.height ?? 0, 'the link is at least 44 px tall').toBeGreaterThanOrEqual(44);
      });

      await test.step('the email step: layout and keyboard order on a fresh load, then a linked field error', async () => {
        await page.goto('/forgot-password');
        await expect(forgot.email).toBeVisible();
        await expectLayout(page, main);
        await expectKeyboardOrder(page);
        await forgot.email.fill('not-an-email');
        await forgot.sendCode.click();
        await expectFieldError(forgot.email, recoveryCopy.emailInvalid);
        await expect(forgot.email).toBeFocused();
        expect(calls(resetRequestPath)).toEqual([]);
      });

      await test.step('the code step: layout and keyboard order, then linked Code and New password errors', async () => {
        await forgot.email.fill(unknownEmail());
        await forgot.sendCode.click();
        await expect(forgot.codeSent).toBeFocused();
        await expect(forgot.code).toBeVisible();
        await expectLayout(page, main);
        await expectKeyboardOrderFromTop(page);
        await forgot.code.fill('12345');
        await forgot.newPassword.fill('12345');
        await forgot.submit.click();
        await expectFieldError(forgot.code, recoveryCopy.codeFormat);
        await expectFieldError(forgot.newPassword, recoveryCopy.passwordInvalid);
        await expect(forgot.code).toBeFocused();
        expect(calls(resetConfirmPath)).toEqual([]);
      });

      await test.step('Profile: Enter on Verify opens the dialog, focus stays in it, it fits, and Escape returns to Verify', async () => {
        const customer = await registerByApi(request);
        const ui = profileRecovery(page);
        await openProfile(page, customer);
        await expectLayout(page, ui.main);
        await ui.verify.focus();
        await page.keyboard.press('Enter');
        await expect(ui.dialog).toBeVisible();
        await expect.poll(() => page.evaluate(() => document.activeElement?.closest('dialog') !== null)).toBe(true);
        await expectLayout(page, ui.dialog);
        for (let press = 0; press < 6; press += 1) {
          await page.keyboard.press('Tab');
          // Chrome and Edge can move focus to browser chrome after the last dialog control.
          expect(await page.evaluate(() => document.activeElement?.closest('dialog') !== null
            || (document.activeElement === document.body && !document.hasFocus()))).toBe(true);
        }
        await page.keyboard.press('Escape');
        await expect(ui.dialog).toBeHidden();
        await expect(ui.verify).toBeFocused();
      });
    });
  });
}

test('E2E-05-47 the email, codes and passwords stay out of URLs, the console, storage, cookies, history and the API log', privacy, async ({ page, request }) => {
  const customer = await registerByApi(request);
  const urls: string[] = [];
  const navigated: string[] = [];
  const consoleText: string[] = [];
  const storage: string[] = [];
  const cookies: { name: string; value: string; httpOnly: boolean; path: string }[] = [];
  page.on('request', (sent) => urls.push(sent.url()));
  page.on('framenavigated', (frame) => {
    urls.push(frame.url());
    navigated.push(frame.url());
  });
  page.on('console', (message) => consoleText.push(message.text()));
  const snapshotStorage = async () => {
    storage.push(await page.evaluate(() => JSON.stringify({
      local: { ...localStorage }, session: { ...sessionStorage }, history: history.state, location: location.href,
    })));
    cookies.push(...(await page.context().cookies()).map(({ name, value, httpOnly, path }) => ({ name, value, httpOnly, path })));
  };
  const forgot = forgotPasswordPage(page);
  const replacement = newPassword();
  const codes: string[] = [];

  await test.step('the email is verified on Profile', async () => {
    await openProfile(page, customer);
    await snapshotStorage();
    const ui = profileRecovery(page);
    const before = capturedMail({ to: customer.email, kind: 'EMAIL_VERIFICATION_CODE' }).length;
    await ui.verify.click();
    await expect(ui.dialog).toBeVisible();
    const code = await mailedCode(customer.email, 'EMAIL_VERIFICATION_CODE', before + 1);
    codes.push(code);
    await ui.dialogCode.fill(code);
    await snapshotStorage();
    await ui.dialogConfirm.click();
    await expect(ui.dialog).toBeHidden();
    await expect(ui.emailVerifiedChip).toBeVisible();
    await snapshotStorage();
  });

  await test.step('a reload on the code step returns to an empty email step', async () => {
    await signOut(page);
    // The verification code started the shared 60-second gap (plan O7).
    ageLimits(customer.username, 61);
    await page.goto('/forgot-password');
    await forgot.email.fill(customer.email);
    await snapshotStorage();
    await forgot.sendCode.click();
    await expect(forgot.codeSent).toBeVisible();
    codes.push(await mailedCode(customer.email, 'PASSWORD_RESET_CODE'));
    await forgot.code.fill(codes[1]);
    await forgot.newPassword.fill(replacement);
    await snapshotStorage();

    await page.reload();
    await expect(page).toHaveURL('/forgot-password');
    await expect(forgot.email).toHaveValue('');
    await expect(forgot.code).toHaveCount(0);
    await expect(forgot.newPassword).toHaveCount(0);
    await snapshotStorage();
  });

  await test.step('the reset, then a sign-in with the new password', async () => {
    ageLimits(customer.username, 61);
    await forgot.email.fill(customer.email);
    await forgot.sendCode.click();
    await expect(forgot.codeSent).toBeVisible();
    codes.push(await mailedCode(customer.email, 'PASSWORD_RESET_CODE', 2));
    await forgot.code.fill(codes[2]);
    await forgot.newPassword.fill(replacement);
    await snapshotStorage();
    await forgot.submit.click();
    await expect(page).toHaveURL('/sign-in');
    await snapshotStorage();
    await signInHere(page, customer.username, replacement);
    await expect(page).toHaveURL('/account');
    await snapshotStorage();
  });

  await test.step('/forgot-password never gained a query or a hash', async () => {
    const locations = storage.map((snapshot) => (JSON.parse(snapshot) as { location: string }).location);
    // Navigations and the page's own location only: Next.js fetches its RSC payload with an `_rsc` query, which is a
    // request URL, not the page's address.
    const forgotPages = [...navigated, ...locations].map((url) => new URL(url))
      .filter(({ pathname }) => pathname === '/forgot-password');
    expect(forgotPages.length).toBeGreaterThan(0);
    for (const url of forgotPages) expect(url.search === '' && url.hash === '', '/forgot-password gains no query or hash').toBe(true);
  });

  await test.step('no tracked value appears on any surface', async () => {
    const apiLog = readFileSync(apiLogPath, 'utf8');
    // Response-status events prove the scan read the request log, not an empty file.
    expect(apiLog.includes('"message":"HTTP response status='), 'the backend log contains response-status events').toBe(true);
    const surfaces = {
      'backend log': apiLog,
      console: consoleText.join('\n'),
      // Each URL also as decoded text, so an encoded value cannot hide in a path, query or fragment.
      'URLs and history': urls.map(urlScanText).join('\n'),
      'storage and history state': storage.join('\n'),
    };
    // The email and both passwords as typed, percent-encoded and form-encoded (`+` for a space).
    const forms = [customer.email, customer.password, replacement].flatMap(encodedForms);
    // In the backend log, mask recognized timestamps and UUIDs before checking whole digit tokens, so a leaked
    // `code:123456`, `code-123456` or `code.123456` still counts without accidental timestamp/ID matches.
    for (const [surface, text] of Object.entries(surfaces)) {
      expect(forms.filter((value) => text.includes(value)).length, `email or passwords found in the ${surface}`).toBe(0);
      const found = surface === 'backend log'
        ? codes.filter((code) => codeInLog(text, code))
        : codes.filter((code) => new RegExp(`(?<!\\d)${code}(?!\\d)`).test(text));
      expect(found.length, `codes found in the ${surface}`).toBe(0);
    }
    const cookieFields = cookies.flatMap(({ name, value }) => [name, value]);
    expect(forms.filter((form) => cookieFields.some((field) => field.includes(form))).length,
      'email or passwords found in cookies').toBe(0);
    // The backend's HttpOnly refresh credential is 32 random bytes encoded as 43 base64url characters.
    // Its incidental six-digit runs are unrelated to recovery codes; scan every other cookie field.
    const codeFields = cookies.flatMap(({ name, value, httpOnly, path }) => [
      name,
      ...(name === 'MW_REFRESH' && httpOnly && path === '/api/auth' && /^[A-Za-z0-9_-]{43}$/.test(value) ? [] : [value]),
    ]);
    expect(codes.filter((code) => codeFields.some((field) => new RegExp(`(?<!\\d)${code}(?!\\d)`).test(field))).length,
      'codes found in cookies').toBe(0);
  });
});

test('E2E-05-48 smoke: a verified Customer resets the password from sign-in and signs in with it; a 5-character password is refused', smoke, async ({ page, request }) => {
  const customer = await verifiedCustomer(request);
  const calls = recordRecoveryCalls(page);
  const forgot = forgotPasswordPage(page);
  const replacement = newPassword();

  await page.goto('/sign-in');
  await page.getByRole('link', { name: recoveryCopy.forgotPassword, exact: true }).click();
  await expect(page).toHaveURL('/forgot-password');
  await forgot.email.fill(customer.email);
  await forgot.sendCode.click();
  await expect(forgot.codeSent).toBeFocused();
  const code = await mailedCode(customer.email, 'PASSWORD_RESET_CODE');

  await forgot.code.fill(code);
  await forgot.newPassword.fill('abcde');
  await forgot.submit.click();
  await expectFieldError(forgot.newPassword, recoveryCopy.passwordInvalid);
  await expect(forgot.newPassword).toBeFocused();
  expect(calls(resetConfirmPath)).toEqual([]);

  await forgot.newPassword.fill(replacement);
  await forgot.submit.click();
  await expect(page).toHaveURL('/sign-in');
  await signInHere(page, customer.username, replacement);
  await expect(page).toHaveURL('/account');
});

test('E2E-05-49 a closing account cannot verify its email: Verify and Confirm show the closing state and send no mail', verification, async ({ page, request }) => {
  const customer = await registerByApi(request);
  const calls = recordRecoveryCalls(page);
  const ui = profileRecovery(page);
  await openProfile(page, customer);
  await expect(ui.emailNotVerifiedChip).toBeVisible();
  await expect(ui.verify).toBeEnabled();

  await test.step('Verify after the account starts closing: 409, the closing warning focused, everything read-only', async () => {
    setAccountState(customer.username, 'CLOSURE_REQUESTED');
    await ui.verify.click();
    await expect.poll(() => calls(verificationPath).map(({ status }) => status)).toEqual([409]);
    // The warning is the focused element (plan T3: "the closing warning is focused").
    await expect(page.locator(':focus')).toContainText(recoveryCopy.accountClosing);
    await expect(ui.dialog).toBeHidden();
    await expectReadOnly(page);
    await expect(ui.verify).toBeDisabled();
    await expectNoMailFor([customer.email], resetSentinel(request));
  });

  await test.step('Confirm in a dialog opened before the account started closing: 409, the dialog closes, nothing verified', async () => {
    setAccountState(customer.username, 'ACTIVE');
    await page.reload();
    await expect(ui.verify).toBeEnabled();
    await ui.verify.click();
    await expect(ui.dialog).toBeVisible();
    const code = await mailedCode(customer.email, 'EMAIL_VERIFICATION_CODE');
    setAccountState(customer.username, 'CLOSURE_REQUESTED');
    await ui.dialogCode.fill(code);
    await ui.dialogConfirm.click();
    await expect.poll(() => calls(verificationConfirmPath).map(({ status }) => status)).toEqual([409]);
    await expect(ui.dialog).toBeHidden();
    await expect(ui.main.getByText(recoveryCopy.accountClosing, { exact: true })).toBeVisible();
    await expectReadOnly(page);
    await expect(ui.verify).toBeDisabled();
    expect(storedEmailState(customer.username)).toEqual({ email: customer.email, emailVerified: false });
  });
});

test('E2E-05-50 sign-in links to /forgot-password, which asks only for an email, shows help as text and turns signed-in visitors away', reset, async ({ page, request }) => {
  const forgot = forgotPasswordPage(page);
  const main = page.getByRole('main');

  await test.step('/sign-in: Forgot password? follows the Password label, outside it, and links to /forgot-password', async () => {
    await page.goto('/sign-in');
    await expect(page.locator('label[for="sign-in-password"]')).toHaveText('Password');
    const link = page.getByRole('link', { name: recoveryCopy.forgotPassword, exact: true });
    await expect(link).toHaveAttribute('href', '/forgot-password');
    expect(await link.evaluate((element) => {
      const label = document.querySelector('label[for="sign-in-password"]');
      return label !== null && !label.contains(element)
        && (label.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    }), 'the link comes after the Password label, outside it').toBe(true);
    await link.click();
    await expect(page).toHaveURL('/forgot-password');
  });

  await test.step('/forgot-password asks only for an email: no mobile field or text-message wording', async () => {
    await expect(forgot.heading).toBeVisible();
    await expect(page).toHaveTitle(literal(recoveryCopy.title));
    await expect(main.getByText(recoveryCopy.intro, { exact: true })).toBeVisible();
    await expect(main.getByRole('textbox')).toHaveCount(1);
    await expect(main.getByRole('textbox', { name: recoveryCopy.email, exact: true })).toBeVisible();
    await expect(main.locator('input[type="tel"]')).toHaveCount(0);
    expect(await main.innerText()).not.toMatch(/mobile|\+880|text message|use email instead/i);
  });

  await test.step('the help line is plain text with no link (O5)', async () => {
    await expect(main.getByText(recoveryCopy.help, { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: /help|support/i })).toHaveCount(0);
    await expect(page.locator('a', { hasText: recoveryCopy.help })).toHaveCount(0);
  });

  await test.step('a signed-in Customer opening /forgot-password is sent to /account', async () => {
    const customer = await registerByApi(request);
    await signIn(page, customer.username, customer.password);
    await expect(page).toHaveURL('/account');
    await page.goto('/forgot-password');
    await expect(page).toHaveURL('/account');
  });
});

test('E2E-05-51 Send a new code in the dialog waits out the 60-second gap, and the newer code replaces the older one', verification, async ({ page, request }) => {
  const customer = await registerByApi(request);
  const calls = recordRecoveryCalls(page);
  const ui = profileRecovery(page);
  let first = '';
  let second = '';
  let firstCodeId = '';
  await openProfile(page, customer);

  await test.step('Verify mails a first code', async () => {
    await ui.verify.click();
    await expect(ui.dialog).toBeVisible();
    first = await mailedCode(customer.email, 'EMAIL_VERIFICATION_CODE');
    [firstCodeId] = storedCodeIds(customer.username, 'EMAIL_VERIFICATION');
    expect(firstCodeId).toBeTruthy();
  });

  await test.step('Send a new code at once: 429, shown inside the dialog', async () => {
    await ui.dialogSendNewCode.click();
    await expect.poll(() => calls(verificationPath).map(({ status }) => status)).toEqual([204, 429]);
    await expect(ui.dialog.getByRole('alert').filter({ hasText: recoveryCopy.tooManyAttempts })).toBeVisible();
    await expect(ui.dialog).toBeVisible();
  });

  await test.step('after the 60-second gap: "A new code is on its way." and a second code', async () => {
    expect(ageLimits(customer.username, 61)).toBe(1);
    await ui.dialogSendNewCode.click();
    await expect.poll(() => calls(verificationPath).map(({ status }) => status)).toEqual([204, 429, 204]);
    await expect(ui.dialog.getByRole('status').filter({ hasText: recoveryCopy.newCodeSent })).toBeVisible();
    expect(calls(verificationPath).every(({ body }) => (body ?? '').length === 0), 'verification requests have no body').toBe(true);
    second = await mailedCode(customer.email, 'EMAIL_VERIFICATION_CODE', 2);
    const replacementIds = storedCodeIds(customer.username, 'EMAIL_VERIFICATION');
    expect(replacementIds).toHaveLength(1);
    expect(replacementIds[0]).not.toBe(firstCodeId);
  });

  await test.step('distinct replaced digits are refused inside the dialog', async () => {
    if (first !== second) {
      await ui.dialogCode.fill(first);
      await ui.dialogConfirm.click();
      await expect.poll(() => calls(verificationConfirmPath).map(({ status }) => status)).toEqual([400]);
      await expect(ui.dialog.getByRole('alert').filter({ hasText: recoveryCopy.codeInvalid })).toBeVisible();
      await expect(ui.dialogCode).toHaveValue('');
      await expect(ui.dialogCode).toBeFocused();
    }
  });

  await test.step('the second code verifies the email', async () => {
    await ui.dialogCode.fill(second);
    await ui.dialogConfirm.click();
    await expect(ui.dialog).toBeHidden();
    await expect(ui.emailVerifiedChip).toBeVisible();
    await expect(ui.verifiedNotice).toBeFocused();
    expect(calls(verificationConfirmPath).map(sentJson)).toEqual(first === second ? [{ code: second }] : [{ code: first }, { code: second }]);
    expect(storedEmailState(customer.username)).toEqual({ email: customer.email, emailVerified: true });
  });
});

test('E2E-05-52 a staff reset keeps MFA: the Admin signs in with the new password and is asked for the authenticator code', reset, async ({ page }) => {
  const admin = await verifiedAdmin(page);
  markEmailVerified(admin.username);
  const replacement = newPassword();

  await test.step('the Admin signs out and resets the password through the page', async () => {
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL('/sign-in');
    await resetPasswordThroughPage(page, admin.email, replacement);
    await expect(page.getByRole('status').filter({ hasText: recoveryCopy.passwordReset })).toBeFocused();
  });

  await test.step('the new password leads to the code challenge, not setup; a fresh code opens /staff', async () => {
    await signIn(page, admin.username, replacement);
    await expect(page).toHaveURL('/staff/mfa');
    await expect(page.getByRole('heading', { name: 'Verify it’s you' })).toBeVisible();
    await page.getByLabel('Authenticator code').fill(await freshCode(admin.authenticator));
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page).toHaveURL('/staff');
    await expect(page.getByRole('heading', { name: 'Staff access verified' })).toBeVisible();
  });
});

test('E2E-05-53 one request at a time: a held reset or verification confirm blocks every other action until it answers', reset, async ({ page, request }) => {
  const forgot = forgotPasswordPage(page);
  const ui = profileRecovery(page);

  await test.step('reset: while the confirm is held, Resetting… and Send a new code are disabled and Enter sends nothing', async () => {
    const customer = await verifiedCustomer(request);
    const replacement = newPassword();
    await page.goto('/forgot-password');
    await forgot.email.fill(customer.email);
    await forgot.sendCode.click();
    await expect(forgot.codeSent).toBeFocused();
    const code = await mailedCode(customer.email, 'PASSWORD_RESET_CODE');
    const confirms = await holdRequests(page, 'POST', resetConfirmPath);

    await forgot.code.fill(code);
    await forgot.newPassword.fill(replacement);
    await forgot.submit.click();
    await expect(page.getByRole('button', { name: recoveryCopy.submitting, exact: true })).toBeDisabled();
    await expect(forgot.sendNewCode).toBeDisabled();
    // Nor can implicit submission (Enter in a field) start a second confirm.
    await forgot.code.press('Enter');
    await expect.poll(confirms.statuses).toEqual([undefined]);
    confirms.release();
    await expect(page).toHaveURL('/sign-in');

    // Everything the page ever dispatched is counted, answered or not: one confirm.
    expect(confirms.statuses()).toEqual([204]);
    expect(confirms.bodies().map((body) => JSON.parse(body ?? 'null') as unknown))
      .toEqual([{ email: customer.email, code, newPassword: replacement }]);
  });

  await test.step('verification: while the confirm is held, Confirm, Send a new code, Save changes and Change are disabled', async () => {
    const customer = await registerByApi(request);
    await openProfile(page, customer);
    // A dirty draft makes Save changes enabled, so its disabled state below is the one-request rule, not a clean form.
    await ui.fullName.fill('Draft Name');
    await expect(ui.save).toBeEnabled();
    await ui.verify.click();
    await expect(ui.dialog).toBeVisible();
    const code = await mailedCode(customer.email, 'EMAIL_VERIFICATION_CODE');
    const confirms = await holdRequests(page, 'POST', verificationConfirmPath);

    await ui.dialogCode.fill(code);
    await ui.dialogConfirm.click();
    await expect(ui.dialogConfirm).toBeDisabled();
    await expect(ui.dialogSendNewCode).toBeDisabled();
    await expect(ui.save).toBeDisabled();
    await expect(ui.change).toBeDisabled();
    await expect.poll(confirms.statuses).toEqual([undefined]);
    confirms.release();
    await expect(ui.dialog).toBeHidden();
    await expect(ui.emailVerifiedChip).toBeVisible();

    expect(confirms.statuses()).toEqual([200]);
    expect(confirms.bodies().map((body) => JSON.parse(body ?? 'null') as unknown)).toEqual([{ code }]);
    // The confirm answer touches only the verification part: the draft stays and can still be saved.
    await expect(ui.fullName).toHaveValue('Draft Name');
    await expect(ui.save).toBeEnabled();
  });
});

test('E2E-05-54 an email change signs out the User’s other tab; the tab that made it stays signed in', emailChange, async ({ page, browser, request }) => {
  const customer = await registerByApi(request);
  const changed = `changed.${hex()}@example.test`;
  const tabA = profileRecovery(page);
  await openProfile(page, customer);

  const other = await browser.newContext();
  try {
    const pageB = await other.newPage();
    const tabB = profileRecovery(pageB);
    await openProfile(pageB, customer);
    expect(sessionStates(customer.username)).toEqual(['active', 'active']);

    await test.step('the second browser changes the email with Current password', async () => {
      await tabB.email.fill(changed);
      await tabB.currentPassword.fill(customer.password);
      await tabB.save.click();
      await expect(tabB.saved).toBeVisible();
      expect(storedEmailState(customer.username)).toEqual({ email: changed, emailVerified: false });
    });

    await test.step('the first tab saves a name: it is sent to sign-in with the expiry notice, and nothing is saved', async () => {
      await tabA.fullName.fill('Other Tab');
      await tabA.save.click();
      await expect(page).toHaveURL('/sign-in');
      await expect(page.getByRole('status').filter({ hasText: recoveryCopy.sessionExpired })).toBeFocused();
      expect(storedProfile(customer.username)).toMatchObject({ fullName: null, email: changed, profileVersion: 1 });
    });

    await test.step('the second browser is still signed in; only the first tab’s session was revoked', async () => {
      await pageB.reload();
      await expect(pageB).toHaveURL('/account/profile');
      await expect(tabB.email).toHaveValue(changed);
      expect(sessionStates(customer.username)).toEqual(['email-changed', 'active']);
    });
  } finally {
    await other.close();
  }
});

// ---------------------------------------------------------------------------------------------------------------
// Page rules of plan §4.7 beyond the §10.4 table (added 2026-10-16 for development targeting)
// ---------------------------------------------------------------------------------------------------------------

test('E2E-05-55 the email status row follows the saved email; Current password appears for setting, changing or clearing it, not for a re-cased address', emailChange, async ({ page, request }) => {
  const customer = syntheticCustomer();
  const { username, mobile, password } = customer;
  expect((await request.post(`${apiUrl}/api/auth/register`, { data: { username, mobile, password } })).status(),
    'registration without an email').toBe(201);
  const calls = recordProfileCalls(page);
  const puts = () => calls.filter(({ method }) => method === 'PUT');
  const ui = profileRecovery(page);
  const added = `added.${hex()}@example.test`;
  await openProfile(page, customer);

  await test.step('no saved email: no email chip, no Verify and no Current password', async () => {
    await expect(ui.email).toHaveValue('');
    await expect(ui.emailVerifiedChip).toHaveCount(0);
    await expect(ui.emailNotVerifiedChip).toHaveCount(0);
    await expect(ui.verify).toHaveCount(0);
    await expect(ui.currentPassword).toHaveCount(0);
  });

  await test.step('setting an email is a change: Current password is required, and the saved email is Not verified', async () => {
    await ui.email.fill(added);
    await expect(ui.currentPassword).toBeVisible();
    await ui.currentPassword.fill(customer.password);
    await ui.save.click();
    await expect(ui.saved).toBeFocused();
    await expect(ui.emailNotVerifiedChip).toBeVisible();
    await expect(ui.verify).toBeEnabled();
    await expect(ui.currentPassword).toHaveCount(0);
    expect(JSON.parse(puts()[0].body ?? '{}')).toMatchObject({ email: added, currentPassword: customer.password });
  });

  await test.step('once verified, a name save with the address re-cased keeps verification and all sessions', async () => {
    await verifyEmailThroughProfile(page, added);
    await expect(ui.verify).toHaveCount(0);
    expect((await signInByApi(request, username, password)).status()).toBe(200);
    const sessionsBefore = sessionStates(username);
    const before = storedProfile(username);
    await ui.email.fill(added.toUpperCase());
    await expect(ui.emailVerifiedChip).toBeVisible();
    await expect(ui.currentPassword).toHaveCount(0);
    await ui.fullName.fill('Re-cased Email Save');
    await expect(ui.save).toBeEnabled();
    await ui.save.click();
    await expect(ui.saved).toBeFocused();
    const savedEdit = JSON.parse(puts()[1].body ?? '{}') as Record<string, unknown>;
    expect(savedEdit.fullName).toBe('Re-cased Email Save');
    expect(typeof savedEdit.email).toBe('string');
    expect((savedEdit.email as string).toLowerCase()).toBe(added);
    expect(savedEdit).not.toHaveProperty('currentPassword');
    expect(storedEmailState(username)).toEqual({ email: added, emailVerified: true });
    expect(storedProfile(username).profileVersion).toBe(before.profileVersion + 1);
    expect(sessionStates(username)).toEqual(sessionsBefore);
  });

  await test.step('clearing the email is a change: Current password is required, and afterwards no status row is shown', async () => {
    await ui.email.fill('');
    await expect(ui.currentPassword).toBeVisible();
    await expect(ui.emailVerifiedChip).toHaveCount(0);
    await ui.currentPassword.fill(customer.password);
    await ui.save.click();
    await expect(ui.saved).toBeFocused();
    await expect(ui.email).toHaveValue('');
    await expect(ui.currentPassword).toHaveCount(0);
    await expect(ui.emailVerifiedChip).toHaveCount(0);
    await expect(ui.emailNotVerifiedChip).toHaveCount(0);
    await expect(ui.verify).toHaveCount(0);
    expect(storedEmailState(customer.username)).toEqual({ email: null, emailVerified: false });
  });

  await test.step('the Mobile group keeps its own chip throughout', async () => {
    await expect(ui.mobileField.getByText(recoveryCopy.notVerified, { exact: true })).toBeVisible();
  });
});

test('E2E-05-56 five wrong current passwords lead to a Too many attempts page alert; Current password is emptied after every outcome', limits, async ({ page, request }) => {
  const customer = await registerByApi(request);
  const calls = recordProfileCalls(page);
  const puts = () => calls.filter(({ method }) => method === 'PUT').map(({ status }) => status);
  const ui = profileRecovery(page);
  const changed = `changed.${hex()}@example.test`;
  await openProfile(page, customer);
  await ui.email.fill(changed);

  await test.step('five wrong passwords: each a field error, the field emptied', async () => {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await ui.currentPassword.fill(`${customer.password}-wrong-${attempt}`);
      await ui.save.click();
      await expect.poll(puts).toEqual(Array<number>(attempt).fill(400));
      await expectFieldError(ui.currentPassword, recoveryCopy.currentPasswordInvalid);
      await expect(ui.currentPassword).toHaveValue('');
    }
  });

  await test.step('the right password is now refused with 429, shown as a page alert; nothing is saved', async () => {
    await ui.currentPassword.fill(customer.password);
    await ui.save.click();
    await expect.poll(puts).toEqual([...Array<number>(5).fill(400), 429]);
    await expect(ui.main.getByRole('alert').filter({ hasText: recoveryCopy.tooManyAttempts })).toBeVisible();
    await expect(ui.currentPassword).toHaveValue('');
    await expect(ui.email).toHaveValue(changed);
    expect(storedEmailState(customer.username)).toEqual({ email: customer.email, emailVerified: false });
  });

  await test.step('after the hour the right password saves', async () => {
    expect(agePasswordLimit(customer.username)).toBe(1);
    await ui.currentPassword.fill(customer.password);
    await ui.save.click();
    await expect(ui.saved).toBeFocused();
    expect(storedEmailState(customer.username)).toEqual({ email: changed, emailVerified: false });
  });
});

test('E2E-05-57 the Verify email dialog checks the code on the page, Cancel sends nothing, and a spaced code verifies', verification, async ({ page, request }) => {
  const customer = await registerByApi(request);
  const calls = recordRecoveryCalls(page);
  const ui = profileRecovery(page);
  await openProfile(page, customer);

  await test.step('the dialog names the saved address and the 15-minute lifetime', async () => {
    await ui.verify.click();
    await expect(ui.dialog).toBeVisible();
    await expect(ui.dialog.getByRole('heading', { level: 2, name: recoveryCopy.verifyEmailTitle })).toBeVisible();
    await expect(ui.dialog).toContainText(recoveryCopy.verifyEmailIntro(customer.email));
  });

  await test.step('an empty, short or non-digit code is refused on the page, linked to Code, with no request', async () => {
    for (const value of ['', '12345', 'abcdef']) {
      await ui.dialogCode.fill(value);
      await ui.dialogConfirm.click();
      await expectFieldError(ui.dialogCode, recoveryCopy.codeFormat);
    }
    expect(calls(verificationConfirmPath)).toEqual([]);
  });

  await test.step('Cancel closes the dialog without a request and returns focus to Verify', async () => {
    await ui.dialogCode.fill('123456');
    await ui.dialogCancel.click();
    await expect(ui.dialog).toBeHidden();
    await expect(ui.verify).toBeFocused();
    expect(calls(verificationConfirmPath)).toEqual([]);
    expect(storedEmailState(customer.username).emailVerified).toBe(false);
  });

  await test.step('reopened after the gap, the dialog is empty, and a code typed as "123 456" is sent as six digits', async () => {
    expect(ageLimits(customer.username, 61)).toBe(1);
    await ui.verify.click();
    await expect(ui.dialog).toBeVisible();
    await expect(ui.dialogCode).toHaveValue('');
    await expect(ui.dialog.getByRole('alert')).toHaveCount(0);
    const code = await mailedCode(customer.email, 'EMAIL_VERIFICATION_CODE', 2);
    await ui.dialogCode.fill(`${code.slice(0, 3)} ${code.slice(3)}`);
    await ui.dialogConfirm.click();
    await expect(ui.dialog).toBeHidden();
    await expect(ui.emailVerifiedChip).toBeVisible();
    await expect(ui.verify).toHaveCount(0);
    expect(calls(verificationConfirmPath).map(sentJson)).toEqual([{ code }]);
  });

  await test.step('after a reload the email is still Verified and Verify is gone', async () => {
    await page.reload();
    await expect(ui.emailVerifiedChip).toBeVisible();
    await expect(ui.verify).toHaveCount(0);
  });
});

test('E2E-05-58 Verify after the saved email was removed elsewhere shows the add-an-email alert with Reload', verification, async ({ page, request }) => {
  const customer = await registerByApi(request);
  const calls = recordRecoveryCalls(page);
  const ui = profileRecovery(page);
  await openProfile(page, customer);
  await expect(ui.verify).toBeEnabled();

  // Removed by SQL, not by another session: an email change through the API would sign this tab out (O8).
  setStoredEmail(customer.username, null, false);
  await ui.verify.click();
  await expect.poll(() => calls(verificationPath).map(({ status }) => status)).toEqual([409]);
  await expect(ui.dialog).toBeHidden();
  await expect(ui.main.getByRole('alert').filter({ hasText: recoveryCopy.emailRequired })).toBeVisible();

  await ui.main.getByRole('button', { name: 'Reload', exact: true }).click();
  await expect(ui.email).toHaveValue('');
  await expect(ui.main.getByText(recoveryCopy.emailRequired)).toHaveCount(0);
  await expect(ui.emailNotVerifiedChip).toHaveCount(0);
  await expect(ui.verify).toHaveCount(0);
  await expectNoMailFor([customer.email], resetSentinel(request));
});

test('E2E-05-59 leaving the code step keeps no secret on Back, and a code typed with a space resets', reset, async ({ page, request }) => {
  const customer = await verifiedCustomer(request);
  const calls = recordRecoveryCalls(page);
  const forgot = forgotPasswordPage(page);
  const main = page.getByRole('main');
  const replacement = newPassword();

  await page.goto('/forgot-password');
  await forgot.email.fill(customer.email);
  await forgot.sendCode.click();
  await expect(forgot.codeSent).toBeFocused();
  const first = await mailedCode(customer.email, 'PASSWORD_RESET_CODE');
  await forgot.code.fill(first);
  await forgot.newPassword.fill(replacement);

  await test.step('away to /sign-in and Back: no input holds the code or the new password', async () => {
    await page.goto('/sign-in');
    await page.goBack();
    await expect(page).toHaveURL('/forgot-password');
    await expect(forgot.heading).toBeVisible();
    // A back-forward cache restore shows the code step emptied on pagehide; a fresh load shows the email step.
    const values = await main.locator('input').evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
    expect(values.includes(first), 'code absent after Back').toBe(false);
    expect(values.includes(replacement), 'new password absent after Back').toBe(false);
    expect(values.every((value) => value === '' || value === customer.email), 'only empty or email inputs after Back').toBe(true);
  });

  await test.step('a code typed as "123 456" is sent as six digits and resets', async () => {
    let code = first;
    if (await forgot.code.count() === 0) {
      expect(ageLimits(customer.username, 61)).toBe(1);
      await forgot.email.fill(customer.email);
      await forgot.sendCode.click();
      await expect(forgot.codeSent).toBeFocused();
      code = await mailedCode(customer.email, 'PASSWORD_RESET_CODE', 2);
    }
    await forgot.code.fill(`${code.slice(0, 3)} ${code.slice(3)}`);
    await forgot.newPassword.fill(replacement);
    await forgot.submit.click();
    await expect(page).toHaveURL('/sign-in');
    await expect(page.getByRole('status').filter({ hasText: recoveryCopy.passwordReset })).toBeFocused();
    expect(calls(resetConfirmPath).map(sentJson)).toEqual([{ email: customer.email, code, newPassword: replacement }]);
  });
});
