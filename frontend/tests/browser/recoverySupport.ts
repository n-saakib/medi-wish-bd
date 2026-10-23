import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { expect, type APIRequestContext, type APIResponse, type Locator, type Page } from '@playwright/test';
import { registerByApi } from './profileSupport';
import { syntheticCustomer, type Customer } from './support';
import { apiUrl, checkedTarget, psql, testMailVariable } from './testApi';

/**
 * Ticket 05 contract strings (plan §4.2 and §10.3). The API's messages and the pages' copy must match them exactly;
 * change them only together with the plan.
 */
export const recoveryCopy = {
  // API messages (backend `messages.properties`).
  codeInvalidApi: 'That code is wrong or has expired. Ask for a new code.',
  currentPasswordInvalidApi: 'Enter your current password to change your email.',
  emailRequiredApi: 'Add an email address to your profile first.',
  tooManyAttemptsApi: 'Too many attempts. Try again later.',
  accountClosingApi: 'This account is closing, so it can\'t be changed.',
  invalidRequestApi: 'The request is invalid.',
  // Forgot-password page (`forgotPassword` namespace).
  title: 'Reset password',
  intro: 'We’ll send a code to your verified email.',
  email: 'Email',
  emailInvalid: 'Enter a valid email address.',
  sendCode: 'Send code',
  sending: 'Sending…',
  codeSent: 'If the details match an account, a code is on its way.',
  code: 'Code',
  codeFormat: 'Enter the 6-digit code from your email.',
  newPassword: 'New password',
  passwordHint: '6–30 characters',
  passwordInvalid: 'Enter a password of 6–30 characters.',
  submit: 'Reset password',
  submitting: 'Resetting…',
  sendNewCode: 'Send a new code',
  help: 'Need help? Contact Medi Wish support.',
  // Sign-in (`signIn` namespace).
  forgotPassword: 'Forgot password?',
  passwordReset: 'Your password was changed. Please sign in.',
  sessionExpired: 'Your session has expired. Please sign in again.',
  // Profile (`profile` namespace).
  verified: 'Verified',
  notVerified: 'Not verified',
  verifyEmail: 'Verify',
  currentPassword: 'Current password',
  emailVerified: 'Email verified.',
  verifyEmailTitle: 'Verify email',
  verifyEmailIntro: (email: string) => `We sent a 6-digit code to ${email}. It expires in 15 minutes.`,
  confirm: 'Confirm',
  cancel: 'Cancel',
  newCodeSent: 'A new code is on its way.',
  profileSaved: 'Profile saved.',
  // Shared `errors` keys (new ones carry the API text).
  codeInvalid: 'That code is wrong or has expired. Ask for a new code.',
  currentPasswordInvalid: 'Enter your current password to change your email.',
  emailRequired: 'Add an email address to your profile first.',
  tooManyAttempts: 'Too many attempts. Try again later.',
  accountClosing: 'Your account is closing.',
  checkDetails: 'Check your details and try again.',
  genericError: 'The request could not be completed.',
  authenticationFailed: 'Those details don’t match an account.',
  staleUpdate: 'This record changed after you opened it. Reload and try again.',
} as const;

/** The four Ticket 05 routes (plan §4.2); none carries a User id or an address. */
export const resetRequestPath = '/api/auth/password-reset/request';
export const resetConfirmPath = '/api/auth/password-reset/confirm';
export const verificationPath = '/api/user/me/email-verification';
export const verificationConfirmPath = '/api/user/me/email-verification/confirm';

/** A unique synthetic address in the `example.test` domain that no User holds. */
export function unknownEmail(): string {
  return `nobody.${randomBytes(5).toString('hex')}@example.test`;
}

/** A 6-digit code that differs from `code`, so it is always wrong. */
export function wrongCode(code: string, offset = 1): string {
  return String((Number(code) + offset) % 1_000_000).padStart(6, '0');
}

/** Find a six-digit code in a backend log without mistaking timestamp or UUID framing for leaked code data. */
export function codeInLog(log: string, code: string): boolean {
  if (!/^\d{6}$/.test(code)) throw new Error('codeInLog needs a six-digit code');
  const withoutFraming = log
    .replace(/(?<![\w-])\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})(?![\w-])/g, ' ')
    .replace(/(?<![0-9a-fA-F-])[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}(?![0-9a-fA-F-])/g, ' ');
  return new RegExp(`(?<!\\d)${code}(?!\\d)`).test(withoutFraming);
}

/** A valid new password (6–30 characters, A5) that differs from every synthetic one. */
export function newPassword(): string {
  return `Reset-${randomBytes(6).toString('hex')}`;
}

/** Sends `body` to a public or Bearer route as raw text with `contentType`; the caller checks the answer. */
export function postRaw(api: APIRequestContext, routePath: string, body: string, contentType = 'application/json',
  headers: Record<string, string> = {}): Promise<APIResponse> {
  return api.post(`${apiUrl}${routePath}`, { headers: { 'Content-Type': contentType, ...headers }, data: body });
}

/** `POST /api/auth/password-reset/request` with exactly `{"email": email}` (any JSON value, for shape tests). */
export function requestReset(api: APIRequestContext, email: unknown, headers: Record<string, string> = {}): Promise<APIResponse> {
  return postRaw(api, resetRequestPath, JSON.stringify({ email }), 'application/json', headers);
}

/** `POST /api/auth/password-reset/confirm` with `body` sent as JSON exactly as given. */
export function confirmReset(api: APIRequestContext, body: unknown, headers: Record<string, string> = {}): Promise<APIResponse> {
  return postRaw(api, resetConfirmPath, JSON.stringify(body), 'application/json', headers);
}

/** A reset request that must answer the uniform `202` with an empty body and `no-store`. */
export async function expectAccepted(response: APIResponse): Promise<void> {
  expect(response.status(), 'the uniform reset answer').toBe(202);
  expect((await response.text()).length, 'the 202 body length').toBe(0);
  expect(response.headers()['cache-control'] ?? '').toMatch(/(^|[\s,])no-store($|[\s,])/);
  expect(response.headers()['set-cookie'], 'a reset request sets no cookie').toBeUndefined();
}

/** A successful reset confirm: `204`, empty body, no tokens or cookies. */
export async function expectReset(response: APIResponse): Promise<void> {
  expect(response.status(), 'the reset-confirm status').toBe(204);
  expect((await response.text()).length, 'the reset-confirm body length').toBe(0);
  expect(response.headers()['cache-control'] ?? '').toMatch(/(^|[\s,])no-store($|[\s,])/);
  expect(response.headers()['set-cookie'], 'a reset opens no session').toBeUndefined();
}

/** The response headers that may differ between two otherwise identical answers. */
const varyingHeaders = new Set(['x-request-id', 'date']);

/** The headers of a response without the ones that legitimately vary per request, for uniformity checks. */
export function comparableHeaders(response: APIResponse): Record<string, string> {
  return Object.fromEntries(Object.entries(response.headers()).filter(([name]) => !varyingHeaders.has(name.toLowerCase()))
    .sort(([a], [b]) => a.localeCompare(b)));
}

// ---------------------------------------------------------------------------------------------------------------
// Captured mail (plan §4.4, O4). The test API writes each message as `<epochMillis>-<uuid>.json` with exactly the keys
// `to`, `subject`, `body` and `kind`. These helpers never log a body, code or address.
// ---------------------------------------------------------------------------------------------------------------

export type MailKind = 'EMAIL_VERIFICATION_CODE' | 'PASSWORD_RESET_CODE' | 'PASSWORD_CHANGED' | 'EMAIL_CHANGED'
  | 'STAFF_AUTHENTICATOR_REPLACED';
export type CapturedMail = { to: string; subject: string; body: string; kind: MailKind; file: string };

const mailKinds: readonly MailKind[] = [
  'EMAIL_VERIFICATION_CODE', 'PASSWORD_RESET_CODE', 'PASSWORD_CHANGED', 'EMAIL_CHANGED', 'STAFF_AUTHENTICATOR_REPLACED',
];
const mailFileName = /^\d+-[0-9a-f-]{36}\.json$/;

/** The run's mail capture directory, set by the test API setup; it must be an absolute path to an existing directory. */
export function mailDirectory(): string {
  const directory = process.env[testMailVariable] ?? '';
  if (!path.isAbsolute(directory) || !existsSync(directory) || !statSync(directory).isDirectory()) {
    throw new Error('mailDirectory needs the directory set by the test API setup');
  }
  return directory;
}

/**
 * Every captured message in filename order (epoch milliseconds then UUID), optionally only those to `to`
 * (any letter case) and of `kind`. Half-written `.tmp` files and foreign names are ignored; a malformed message throws
 * naming only its file. Messages captured within one millisecond have no guaranteed relative send order.
 */
export function capturedMail(filter: { to?: string; kind?: MailKind } = {}): CapturedMail[] {
  const directory = mailDirectory();
  const messages: CapturedMail[] = [];
  for (const file of readdirSync(directory).filter((name) => mailFileName.test(name)).sort()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path.join(directory, file), 'utf8'));
    } catch {
      throw new Error(`Malformed captured mail ${file}`);
    }
    const message = parsed as Record<string, unknown>;
    const wellFormed = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      && Object.keys(message).sort().join(',') === 'body,kind,subject,to'
      && ['body', 'kind', 'subject', 'to'].every((key) => typeof message[key] === 'string')
      && mailKinds.includes(message.kind as MailKind);
    if (!wellFormed) throw new Error(`Malformed captured mail ${file}`);
    messages.push({ ...(message as Omit<CapturedMail, 'file'>), file });
  }
  return messages.filter((message) => (filter.to === undefined || message.to.toLowerCase() === filter.to.toLowerCase())
    && (filter.kind === undefined || message.kind === filter.kind));
}

/**
 * Waits (polling every 100 ms) until at least `nth` messages of `kind` to `to` exist and returns the `nth` (1-based).
 * The error names the kind and count, never the address.
 */
export async function readCapturedMail(to: string, kind: MailKind,
  { nth = 1, timeoutMs = 10_000 }: { nth?: number; timeoutMs?: number } = {}): Promise<CapturedMail> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const messages = capturedMail({ to, kind });
    if (messages.length >= nth) return messages[nth - 1];
    if (Date.now() >= deadline) throw new Error(`No ${kind} mail #${nth} within ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

const sixDigits = /(?<!\d)\d{6}(?!\d)/g;

/** The one 6-digit code in a mail body; a body with none or several is a contract break. */
export function codeFrom(body: string): string {
  const codes = body.match(sixDigits) ?? [];
  if (codes.length !== 1) throw new Error('Expected exactly one 6-digit code in the mail');
  return codes[0];
}

/** Whether a body holds any 6-digit run: a notice must hold none. */
export function hasCode(body: string): boolean {
  return (body.match(sixDigits) ?? []).length > 0;
}

/** The code of the `nth` mail of `kind` to `to`. */
export async function mailedCode(to: string, kind: 'EMAIL_VERIFICATION_CODE' | 'PASSWORD_RESET_CODE', nth = 1): Promise<string> {
  return codeFrom((await readCapturedMail(to, kind, { nth })).body);
}

/** What a sentinel caused: one message of `kind` to `to`, the `nth` such message. */
export type Sentinel = { to: string; kind: MailKind; nth?: number };

/**
 * Proves that no mail went to any of `addresses`: runs `sentinel`, which must cause one later message, waits for it,
 * then asserts the capture directory holds nothing to those addresses. This relies on the API's mail executor having
 * one worker (plan §4.4 and §6): mail is queued at commit, before the API answers, and leaves in order, so once the
 * sentinel's message exists, an earlier request's message would exist too.
 */
export async function expectNoMailFor(addresses: string[], sentinel: () => Promise<Sentinel>): Promise<void> {
  const caused = await sentinel();
  await readCapturedMail(caused.to, caused.kind, { nth: caused.nth ?? 1 });
  for (const address of addresses) {
    expect(capturedMail({ to: address }).length, 'mail to an address that must get none').toBe(0);
  }
}

/** A sentinel: a fresh Customer with a verified email asks for a reset, which sends exactly one reset-code mail. */
export function resetSentinel(api: APIRequestContext): () => Promise<Sentinel> {
  return async () => {
    const customer = await registerByApi(api, syntheticCustomer());
    markEmailVerified(customer.username);
    await expectAccepted(await requestReset(api, customer.email));
    return { to: customer.email, kind: 'PASSWORD_RESET_CODE' };
  };
}

// ---------------------------------------------------------------------------------------------------------------
// SQL fixtures and probes. Each checks the schema and the synthetic username before any SQL is built.
// ---------------------------------------------------------------------------------------------------------------

const userIdSql = (schema: string, username: string) => `(SELECT id FROM ${schema}.users WHERE username = '${username}')`;

/**
 * The seeded verified-email fixture (TESTING.md; story Q4 AC4): marks the User's saved email verified, as the
 * verification route would. Tests use it to set up reset cases; the route itself is proven separately.
 */
export function markEmailVerified(username: string): void {
  const schema = checkedTarget('markEmailVerified', username);
  const set = psql(`UPDATE ${schema}.users SET email_verified_at = now() WHERE username = '${username}'`
    + ' AND email IS NOT NULL RETURNING email_verified_at IS NOT NULL;');
  if (set !== 't') throw new Error(`No User ${username} with an email to verify`);
}

/** A User's saved email and whether it is verified, as the database holds them. */
export function storedEmailState(username: string): { email: string | null; emailVerified: boolean } {
  const schema = checkedTarget('storedEmailState', username);
  const row = psql(`SELECT json_build_object('email', email, 'emailVerified', email_verified_at IS NOT NULL)`
    + ` FROM ${schema}.users WHERE username = '${username}';`);
  if (!row) throw new Error(`No User ${username} to read`);
  return JSON.parse(row) as { email: string | null; emailVerified: boolean };
}

export type CodePurpose = 'EMAIL_VERIFICATION' | 'PASSWORD_RESET';
export type StoredCode = { purpose: CodePurpose; sentTo: string; failedAttempts: number };

/** The User's live `account_codes` rows, ordered by purpose. It never selects `code_hash`. */
export function storedCodes(username: string): StoredCode[] {
  const schema = checkedTarget('storedCodes', username);
  const rows = psql(`SELECT coalesce(json_agg(json_build_object('purpose', purpose, 'sentTo', sent_to,`
    + ` 'failedAttempts', failed_attempts) ORDER BY purpose), '[]'::json) FROM ${schema}.account_codes`
    + ` WHERE user_id = ${userIdSql(schema, username)};`);
  return JSON.parse(rows) as StoredCode[];
}

/** UUID identities for one User's code purpose, without selecting code material or changing `storedCodes` shape. */
export function storedCodeIds(username: string, purpose: CodePurpose): string[] {
  const schema = checkedTarget('storedCodeIds', username);
  const allowedPurpose = checkedPurpose('storedCodeIds', purpose);
  const rows = psql(`SELECT coalesce(json_agg(id::text ORDER BY id), '[]'::json) FROM ${schema}.account_codes`
    + ` WHERE user_id = ${userIdSql(schema, username)} AND purpose = '${allowedPurpose}';`);
  return JSON.parse(rows) as string[];
}

function checkedPurpose(helper: string, purpose: string): CodePurpose {
  if (purpose !== 'EMAIL_VERIFICATION' && purpose !== 'PASSWORD_RESET') throw new Error(`${helper} accepts only a known purpose`);
  return purpose;
}

/** Moves the User's live code of `purpose` past its expiry (created 16 minutes ago, expired a minute ago). */
export function expireCode(username: string, purpose: CodePurpose): void {
  const schema = checkedTarget('expireCode', username);
  const checked = checkedPurpose('expireCode', purpose);
  const moved = psql(`UPDATE ${schema}.account_codes SET created_at = now() - interval '16 minutes',`
    + ` expires_at = now() - interval '1 minute' WHERE purpose = '${checked}'`
    + ` AND user_id = ${userIdSql(schema, username)} RETURNING 1;`);
  if (moved !== '1') throw new Error(`User ${username} has no ${checked} code to expire`);
}

/**
 * Ages the User's shared issue window (plan O7, key `issue:<userId>`) by `seconds`: 61 clears the 60-second gap, 7200
 * clears the hourly window. Returns the number of rows changed (0 when no code was issued yet). Address windows are
 * keyed by an HMAC, so tests never age them; they use fresh addresses instead.
 */
export function ageLimits(username: string, seconds = 7200): number {
  const schema = checkedTarget('ageLimits', username);
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 86_400) throw new Error('ageLimits accepts 1 to 86400 seconds');
  const rows = psql(`UPDATE ${schema}.account_code_limits SET window_started_at = window_started_at`
    + ` - make_interval(secs => ${seconds}), last_at = last_at - make_interval(secs => ${seconds})`
    + ` WHERE limit_key = 'issue:' || ${userIdSql(schema, username)}::text RETURNING 1;`);
  return rows === '' ? 0 : rows.split(/\r?\n/).length;
}

/** Ages the User's wrong-current-password window (plan O2, key `password:<userId>`) past its hour. */
export function agePasswordLimit(username: string, seconds = 3700): number {
  const schema = checkedTarget('agePasswordLimit', username);
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 86_400) throw new Error('agePasswordLimit accepts 1 to 86400 seconds');
  const rows = psql(`UPDATE ${schema}.account_code_limits SET window_started_at = window_started_at`
    + ` - make_interval(secs => ${seconds}), last_at = last_at - make_interval(secs => ${seconds})`
    + ` WHERE limit_key = 'password:' || ${userIdSql(schema, username)}::text RETURNING 1;`);
  return rows === '' ? 0 : rows.split(/\r?\n/).length;
}

/** The User's password hash, to prove a refused reset or confirm changed nothing. */
export function storedPasswordHash(username: string): string {
  const schema = checkedTarget('storedPasswordHash', username);
  const hash = psql(`SELECT password_hash FROM ${schema}.users WHERE username = '${username}';`);
  if (!hash) throw new Error(`No User ${username} to read`);
  return hash;
}

/**
 * Replaces the User's password verifier with one `PasswordVerifierPolicy.isUsable` refuses (not Argon2), as corrupted
 * credential state would; reset eligibility then fails (plan §4.1 `resetEligible`). Returns the stored value.
 */
export function makePasswordUnusable(username: string): string {
  const schema = checkedTarget('makePasswordUnusable', username);
  const unusable = 'unusable-verifier';
  const set = psql(`UPDATE ${schema}.users SET password_hash = '${unusable}' WHERE username = '${username}'`
    + ' RETURNING password_hash;');
  if (set !== unusable) throw new Error(`No User ${username} to change`);
  return unusable;
}

/**
 * Sets the User's saved email outside the profile route (no version bump, no code cleanup, no notice), so a test can
 * prove a code is bound to the address it was sent to. `email` must be a synthetic lower-case `example.test` address.
 */
export function setStoredEmail(username: string, email: string | null, verified: boolean): void {
  const schema = checkedTarget('setStoredEmail', username);
  if (email !== null && !/^[a-z0-9.+-]+@example\.test$/.test(email)) throw new Error('setStoredEmail accepts only a synthetic address');
  if (email === null && verified) throw new Error('setStoredEmail cannot verify a missing email');
  const set = psql(`UPDATE ${schema}.users SET email = ${email === null ? 'NULL' : `'${email}'`}, email_verified_at = `
    + `${verified ? 'now()' : 'NULL'} WHERE username = '${username}' RETURNING 1;`);
  if (set !== '1') throw new Error(`No User ${username} to change`);
}

/** The `security_audit_events.event_type` values whose subject is the User, oldest first. */
export function auditEventTypes(username: string): string[] {
  const schema = checkedTarget('auditEventTypes', username);
  const lines = psql(`SELECT event_type FROM ${schema}.security_audit_events WHERE subject_user_id =`
    + ` ${userIdSql(schema, username)} ORDER BY occurred_at, id;`);
  return lines === '' ? [] : lines.split(/\r?\n/);
}

// ---------------------------------------------------------------------------------------------------------------
// Page helpers (plan §4.7 and §10.3).
// ---------------------------------------------------------------------------------------------------------------

/** The forgot-password page's controls, named exactly as plan §10.3 fixes them. */
export function forgotPasswordPage(page: Page) {
  return {
    heading: page.getByRole('heading', { level: 1, name: recoveryCopy.title }),
    email: page.getByLabel(recoveryCopy.email, { exact: true }),
    code: page.getByLabel(recoveryCopy.code, { exact: true }),
    newPassword: page.getByLabel(recoveryCopy.newPassword, { exact: true }),
    sendCode: page.getByRole('button', { name: recoveryCopy.sendCode, exact: true }),
    submit: page.getByRole('button', { name: recoveryCopy.submit, exact: true }),
    sendNewCode: page.getByRole('button', { name: recoveryCopy.sendNewCode, exact: true }),
    codeSent: page.getByRole('status').filter({ hasText: recoveryCopy.codeSent }),
    codeInvalid: page.getByRole('alert').filter({ hasText: recoveryCopy.codeInvalid }),
  };
}

/** The profile page's Ticket 05 controls: the two groups, their chips, Verify, Current password and the dialog. */
export function profileRecovery(page: Page) {
  const main = page.getByRole('main');
  const mobileField = page.getByRole('group', { name: 'Mobile', exact: true });
  const emailField = page.getByRole('group', { name: 'Email' });
  const dialog = page.getByRole('dialog', { name: recoveryCopy.verifyEmailTitle });
  return {
    main,
    mobileField,
    emailField,
    fullName: page.getByLabel('Full name'),
    email: page.getByRole('textbox', { name: 'Email' }),
    dateOfBirth: page.getByLabel('Date of birth'),
    currentPassword: page.getByLabel(recoveryCopy.currentPassword, { exact: true }),
    save: page.getByRole('button', { name: 'Save changes', exact: true }),
    change: page.getByRole('button', { name: 'Change', exact: true }),
    verify: page.getByRole('button', { name: recoveryCopy.verifyEmail, exact: true }),
    emailVerifiedChip: emailField.getByText(recoveryCopy.verified, { exact: true }),
    emailNotVerifiedChip: emailField.getByText(recoveryCopy.notVerified, { exact: true }),
    saved: page.getByRole('status').filter({ hasText: recoveryCopy.profileSaved }),
    verifiedNotice: page.getByRole('status').filter({ hasText: recoveryCopy.emailVerified }),
    dialog,
    dialogCode: dialog.getByLabel(recoveryCopy.code, { exact: true }),
    dialogConfirm: dialog.getByRole('button', { name: recoveryCopy.confirm, exact: true }),
    dialogCancel: dialog.getByRole('button', { name: recoveryCopy.cancel, exact: true }),
    dialogSendNewCode: dialog.getByRole('button', { name: recoveryCopy.sendNewCode, exact: true }),
  };
}

/**
 * From `/sign-in`: **Forgot password?** → the email → **Send code** → the newest reset code from the capture
 * directory → the code and `password` → **Reset password**; waits for `/sign-in` and returns the code it used.
 */
export async function resetPasswordThroughPage(page: Page, email: string, password: string): Promise<string> {
  const ui = forgotPasswordPage(page);
  const before = capturedMail({ to: email, kind: 'PASSWORD_RESET_CODE' }).length;
  await page.goto('/sign-in');
  await page.getByRole('link', { name: recoveryCopy.forgotPassword, exact: true }).click();
  await expect(page).toHaveURL('/forgot-password');
  await ui.email.fill(email);
  await ui.sendCode.click();
  await expect(ui.codeSent).toBeVisible();
  const code = await mailedCode(email, 'PASSWORD_RESET_CODE', before + 1);
  await ui.code.fill(code);
  await ui.newPassword.fill(password);
  await ui.submit.click();
  await expect(page).toHaveURL('/sign-in');
  return code;
}

/** On `/account/profile`: **Verify** → the newest verification code → **Confirm**; waits for **Verified**. */
export async function verifyEmailThroughProfile(page: Page, email: string): Promise<string> {
  const ui = profileRecovery(page);
  const before = capturedMail({ to: email, kind: 'EMAIL_VERIFICATION_CODE' }).length;
  await ui.verify.click();
  await expect(ui.dialog).toBeVisible();
  const code = await mailedCode(email, 'EMAIL_VERIFICATION_CODE', before + 1);
  await ui.dialogCode.fill(code);
  await ui.dialogConfirm.click();
  await expect(ui.dialog).toBeHidden();
  await expect(ui.emailVerifiedChip).toBeVisible();
  return code;
}

// ---------------------------------------------------------------------------------------------------------------
// Layout and keyboard checks, shared with the Ticket 11 profile spec (moved here unchanged).
// ---------------------------------------------------------------------------------------------------------------

/** No horizontal scroll, a label on every input, and targets of at least 44 px in the page and the open dialog. */
export async function expectLayout(page: Page, scope: Locator): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  const dialogHorizontal = await scope.evaluate((element) => {
    if (element.tagName !== 'DIALOG') return null;
    const bounds = element.getBoundingClientRect();
    return { overflow: element.scrollWidth - element.clientWidth, left: bounds.left, right: bounds.right,
      viewportWidth: window.innerWidth };
  });
  if (dialogHorizontal) {
    expect(dialogHorizontal.overflow, 'dialog content fits without sideways scrolling').toBe(0);
    expect(dialogHorizontal.left, 'dialog starts inside the viewport').toBeGreaterThanOrEqual(0);
    expect(dialogHorizontal.right, 'dialog ends inside the viewport').toBeLessThanOrEqual(dialogHorizontal.viewportWidth);
  }
  expect(await scope.locator('input').evaluateAll((inputs) =>
    inputs.filter((input) => (input as HTMLInputElement).labels?.length === 0).length)).toBe(0);
  const small = await scope.locator('button, input, a[href]').evaluateAll((elements) => elements
    .map((element, index) => ({ element, position: index + 1 }))
    .filter(({ element }) => element.getClientRects().length > 0)
    .filter(({ element }) => {
      const { width, height } = element.getBoundingClientRect();
      return height < 44 || width < 44;
    })
    .map(({ element, position }) => ({ tag: element.tagName.toLowerCase(), position })));
  expect(small).toEqual([]);
}

/** The amber `--accent` colour as the browser computes it. */
export function accentColour(page: Page): Promise<string> {
  return page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--accent)';
    document.body.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  });
}

/**
 * From a freshly loaded page, Tab visits every visible, enabled control in page order (a date input's segments count
 * once), and each shows the amber focus ring.
 */
export async function expectKeyboardOrder(page: Page): Promise<void> {
  const accent = await accentColour(page);
  const selector = 'a[href], button:not([disabled]), input:not([disabled])';
  const expected = await page.locator(selector).evaluateAll((elements) =>
    elements.filter((element) => element.getClientRects().length > 0).length);
  const visited: { position: number; ring: boolean }[] = [];
  for (let press = 0; press < expected * 4 + 5 && visited.length < expected; press += 1) {
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(({ colour, selector }) => {
      const element = document.activeElement as HTMLElement | null;
      if (!element || element === document.body) return null;
      const controls = Array.from(document.querySelectorAll(selector))
        .filter((control) => control.getClientRects().length > 0);
      const style = getComputedStyle(element);
      return {
        position: controls.indexOf(element) + 1,
        ring: style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0 && style.outlineColor === colour,
      };
    }, { colour: accent, selector });
    if (focused && visited.at(-1)?.position !== focused.position) visited.push(focused);
  }
  expect(visited).toEqual(Array.from({ length: expected }, (_, index) => ({ position: index + 1, ring: true })));
}

/** A registered Customer whose saved email is verified (the seeded fixture), for reset tests. */
export async function verifiedCustomer(api: APIRequestContext, customer: Customer = syntheticCustomer()): Promise<Customer> {
  const registered = await registerByApi(api, customer);
  markEmailVerified(registered.username);
  return registered;
}
