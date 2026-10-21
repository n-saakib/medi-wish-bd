import { randomInt } from 'node:crypto';
import { expect, type APIRequestContext, type APIResponse, type Locator, type Page } from '@playwright/test';
import { ApiSession, type ApiActor, type MfaStatus } from './apiSession';
import {
  enroll, readBackupCodes, registerThroughApi, signIn, syntheticCustomer, type Authenticator, type Customer,
  type StaffMember,
} from './support';
import { apiUrl, checkedTarget, grantRole, makeSuperAdmin, markMobileVerified, psql } from './testApi';
import { totpCode, totpStep } from './totp';

/**
 * Ticket 09 (replace a lost staff authenticator using a backup code): helpers shared by the `staffMfaRecovery*` specs.
 * The contract they assert is the plan's §4 and the frozen API in `09.T1-contract-evidence.md`. Every helper works on
 * synthetic Users the calling test registers itself, so the shared throttle (5 failures, then a 15-minute lock) of one
 * test never reaches another.
 */

/** D4's alphabet: no look-alikes (`I L O U 0 1`). Codes are shown as `XXXX-XXXX`. */
export const backupCodeAlphabet = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
export const backupCodePattern = /^[ABCDEFGHJKMNPQRSTVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTVWXYZ23456789]{4}$/;

/** The page copy the specs rely on (plan §4.6 and §10.3). */
export const copy = {
  accessDenied: 'You don’t have permission to do that.',
  lostPhone: 'Lost your phone?',
  dialogTitle: 'Use a backup code',
  backupCodeLabel: 'Backup code',
  dialogHint: 'You’ll set up a new authenticator next. No backup codes left? Contact the store owner.',
  formatError: 'Enter the 8-character code, like ABCD-2345.',
  replaceTitle: 'Set up your new authenticator',
  replaceIntro: 'Your old authenticator stops working once this one is verified.',
  firstEnrollTitle: 'Set up your authenticator',
  backupTitle: 'Backup codes (shown once)',
  saved: 'I’ve saved them',
  staffTitle: 'Staff access verified',
  challengeTitle: 'Verify it’s you',
  challengeCodeLabel: 'Authenticator code',
  regenerateTitle: 'Get new backup codes',
  regenerateIntro: 'Your unused backup codes will stop working. Enter a fresh code from your authenticator app.',
  regenerateCodeLabel: 'Your authenticator code',
  regenerateBack: 'Back to staff pages',
  codeInvalid: 'The code is invalid or has already been used.',
  tooManyAttempts: 'Too many attempts. Try again later.',
} as const;

/** `contactNotice` of a verified replacement (frozen contract), with the panel line each one shows (plan §4.6). */
export type ContactNotice = 'SENT' | 'FAILED' | 'NO_VERIFIED_CONTACT' | 'NOT_CONFIGURED';
export const noticeText: Record<ContactNotice, string> = {
  SENT: 'We sent a notice to your verified mobile.',
  FAILED: 'We couldn’t send a notice to your verified mobile. Your new authenticator is active.',
  NO_VERIFIED_CONTACT: 'No verified contact to notify.',
  NOT_CONFIGURED: 'Security notices aren’t set up, so none was sent.',
};

/** The exact key sets of the session bodies (frozen contract); anything more is a contract break. */
export const sessionFields = ['accessToken', 'expiresIn', 'mfa', 'tokenType', 'user'];
export const firstEnrollmentFields = [...sessionFields, 'backupCodes'].sort();
export const replacementFields = [...sessionFields, 'backupCodes', 'contactNotice'].sort();
export const enrollmentStartFields = ['enrollmentId', 'expiresIn', 'otpauthUri', 'secret'];
export const userProfileFields = ['email', 'mobile', 'mobileVerified', 'username'];

/** The replacement session's fixed lifetime (P9) in seconds; refresh never extends it. */
export const replacementLifetimeSeconds = 600;

/** A random well-formed code from D4's alphabet that is none of `known`, so it is refused as wrong, not as malformed. */
export function wrongBackupCode(known: readonly string[] = []): string {
  for (;;) {
    const raw = Array.from({ length: 8 }, () => backupCodeAlphabet[randomInt(backupCodeAlphabet.length)]).join('');
    const code = `${raw.slice(0, 4)}-${raw.slice(4)}`;
    if (!known.includes(code)) return code;
  }
}

/** A 6-digit code that is not the authenticator's code for the current or the next step. */
export function wrongTotp(authenticator: Authenticator): string {
  const taken = new Set([-1, 0, 1].map((offset) => totpCode(authenticator.key, totpStep() + offset)));
  for (;;) {
    const code = String(randomInt(1_000_000)).padStart(6, '0');
    if (!taken.has(code)) return code;
  }
}

/** The `XXXX-XXXX` code as a person might type it: lower case, the separator swapped for a space, padded. */
export function typedLoosely(code: string): string {
  return `  ${code.slice(0, 4).toLowerCase()} ${code.slice(5).toLowerCase()} `;
}

// ---------------------------------------------------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------------------------------------------------

/** A staff member as the browser specs hold them: the enrolled authenticator plus the backup codes shown at setup. */
export type RecoveringMember = StaffMember & { backupCodes: string[] };

export type StaffKind = 'MODERATOR' | 'ADMIN' | 'SUPER_ADMIN';

/**
 * Registers a User through the API, gives them `kind` with SQL (and verifies their mobile unless `verifiedMobile` is
 * false), then signs in, enrolls through the pages, reads the 10 backup codes and saves them; `page` ends on `/staff`.
 */
export async function recoveringStaff(page: Page, kind: StaffKind = 'MODERATOR',
  { verifiedMobile = true }: { verifiedMobile?: boolean } = {}): Promise<RecoveringMember> {
  const member = await registerThroughApi(page.request);
  if (verifiedMobile) markMobileVerified(member.username);
  if (kind === 'SUPER_ADMIN') makeSuperAdmin(member.username);
  else grantRole(member.username, kind);
  await signIn(page, member.username, member.password);
  const authenticator = await enroll(page);
  const backupCodes = await readBackupCodes(page);
  await page.getByRole('button', { name: copy.saved }).click();
  await expect(page).toHaveURL('/staff');
  await expect(page.getByRole('heading', { name: copy.staffTitle })).toBeVisible();
  return { ...member, authenticator, backupCodes };
}

/** The backup-code dialog (plan §4.6); its accessible name is its heading. */
export function backupDialog(page: Page): Locator {
  return page.getByRole('dialog', { name: copy.dialogTitle });
}

/** On `/staff/mfa`: opens the dialog with "Lost your phone?" and waits for the focused field. */
export async function openBackupDialog(page: Page): Promise<Locator> {
  await expect(page).toHaveURL('/staff/mfa');
  await page.getByRole('button', { name: copy.lostPhone }).click();
  const dialog = backupDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel(copy.backupCodeLabel)).toBeFocused();
  return dialog;
}

/** Types `code` into the open dialog and presses Continue; the caller checks the outcome. */
export async function submitBackupCode(page: Page, code: string): Promise<void> {
  const dialog = backupDialog(page);
  await dialog.getByLabel(copy.backupCodeLabel).fill(code);
  await dialog.getByRole('button', { name: 'Continue' }).click();
}

/** Like `submitBackupCode`, and returns the status of the `/recovery` response it caused. */
export async function submitBackupCodeAndWait(page: Page, code: string): Promise<number> {
  const response = page.waitForResponse((answer) => answer.url() === `${apiUrl}/api/auth/mfa/recovery`
    && answer.request().method() === 'POST');
  await submitBackupCode(page, code);
  return (await response).status();
}

/**
 * On a setup page whose manual key the caller already read (`readManualKey` leaves `Can’t scan?` open): enters the key's
 * current code and waits for the focused backup-codes heading.
 */
export async function verifySetupKey(page: Page, key: string): Promise<Authenticator> {
  const step = totpStep();
  await page.getByLabel('Enter the 6-digit code').fill(totpCode(key, step));
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('heading', { name: copy.backupTitle })).toBeFocused();
  return { key, step };
}

/** From a password sign-in on `/staff/mfa`: uses `code` and waits for the replacement setup page. */
export async function redeemBackupCode(page: Page, code: string): Promise<void> {
  await openBackupDialog(page);
  await submitBackupCode(page, code);
  await expect(page).toHaveURL('/staff/mfa/enroll');
  await expect(page.getByRole('heading', { name: copy.replaceTitle })).toBeVisible();
  await expect(backupDialog(page)).toHaveCount(0);
}

/** Signs `member` in with the password; the session must land on the code challenge. */
export async function signInToChallenge(page: Page, member: Customer): Promise<void> {
  await signIn(page, member.username, member.password);
  await expect(page).toHaveURL('/staff/mfa');
  await expect(page.getByRole('heading', { name: copy.challengeTitle })).toBeVisible();
}

/** The new authenticator and codes a finished replacement leaves, with the notice line the panel showed. */
export type Replacement = { authenticator: Authenticator; backupCodes: string[] };

/**
 * On the replacement setup page: reads the new key, verifies its current code, and waits for the backup-codes panel with
 * the `notice` line; the panel stays open so the caller can inspect it before pressing "I’ve saved them".
 */
export async function finishReplacement(page: Page, notice: ContactNotice): Promise<Replacement> {
  await expect(page.getByRole('heading', { name: copy.replaceTitle })).toBeVisible();
  const authenticator = await enroll(page);
  await expect(page.getByText(noticeText[notice], { exact: true })).toBeVisible();
  return { authenticator, backupCodes: await readBackupCodes(page) };
}

/** The whole recovery through the pages, from a password sign-in to `/staff`; returns the new authenticator and codes. */
export async function replaceThroughPages(page: Page, member: RecoveringMember, code = member.backupCodes[0],
  notice: ContactNotice = 'SENT'): Promise<Replacement> {
  await signInToChallenge(page, member);
  await redeemBackupCode(page, code);
  const replacement = await finishReplacement(page, notice);
  await page.getByRole('button', { name: copy.saved }).click();
  await expect(page).toHaveURL('/staff');
  await expect(page.getByRole('heading', { name: copy.staffTitle })).toBeVisible();
  return replacement;
}

/** Signs out from the staff header (an icon button named "Sign out") and waits for the sign-in page. */
export async function signOutFromStaff(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL('/sign-in');
}

/** The danger alert with `text`, wherever it is on the page. */
export function alertWith(scope: Page | Locator, text: string): Locator {
  return scope.getByRole('alert').filter({ hasText: text });
}

/**
 * Local and session storage, history state, location and cookie values as one string. Cookies include HttpOnly values
 * that page JavaScript cannot read. The app has no IndexedDB or CacheStorage use, so any database or cache on this fresh
 * browser origin fails rather than hiding a persisted secret.
 */
export async function readStorage(page: Page): Promise<string> {
  const [storage, cookies] = await Promise.all([
    page.evaluate(async () => {
      const indexedDb = await indexedDB.databases();
      const cacheStorage = await caches.keys();
      if (indexedDb.length || cacheStorage.length) {
        throw new Error('Unexpected IndexedDB database or CacheStorage cache on the app origin');
      }
      return {
        local: { ...localStorage },
        session: { ...sessionStorage },
        history: history.state,
        location: location.href,
      };
    }),
    page.context().cookies(),
  ]);
  return JSON.stringify({ ...storage, cookies: cookies.map(({ name, value }) => ({ name, value })) });
}

/** URLs, console/page errors and non-credential request bodies observed by the browser. */
export function recordSurfaces(page: Page) {
  const urls: string[] = [];
  const consoleText: string[] = [];
  const consoleCaptures: Promise<{ error?: unknown }>[] = [];
  const pageErrors: string[] = [];
  const payloads: string[] = [];
  const apiOrigin = new URL(apiUrl).origin;
  const credentialPaths = new Set([
    '/api/auth/login', '/api/auth/mfa/recovery', '/api/auth/mfa/enrollment/verify',
    '/api/auth/mfa/verify', '/api/auth/mfa/backup-codes',
  ]);
  const captureUrl = (url: string) => {
    urls.push(url);
    try {
      // Include normal URL encoding so raw-value privacy assertions also catch encoded contacts and credentials.
      urls.push(decodeURIComponent(url.replace(/\+/g, ' ')));
    } catch {
      // A malformed percent escape must not prevent inspection of the raw URL.
    }
  };
  page.on('request', (request) => {
    const url = request.url();
    captureUrl(url);
    const parsed = new URL(url);
    const authorizedCredentialPost = request.method() === 'POST'
      && parsed.origin === apiOrigin && credentialPaths.has(parsed.pathname);
    if (!authorizedCredentialPost) {
      const body = request.postData();
      if (body !== null) payloads.push(body);
    }
  });
  page.on('framenavigated', (frame) => captureUrl(frame.url()));
  page.on('console', (message) => {
    consoleText.push(message.text());
    // Playwright abbreviates logged objects in text(); inspect serializable arguments too.
    const capture = Promise.all(message.args().map((arg) => arg.jsonValue())).then((args) => {
      for (const arg of args) {
        const serialized = JSON.stringify(arg);
        if (serialized !== undefined) consoleText.push(serialized);
      }
    });
    // Keep the rejection observable at flush time without creating an unhandled event-listener rejection.
    consoleCaptures.push(capture.then(() => ({}), (error: unknown) => ({ error })));
  });
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
  const flushConsole = async () => {
    for (const result of await Promise.all(consoleCaptures)) {
      if ('error' in result) throw result.error;
    }
  };
  return { urls, consoleText, pageErrors, payloads, flushConsole };
}

/** Counts the requests the page sends to `path` (any method), so a spec can prove a client check sent nothing. */
export function countRequests(page: Page, path: string): { readonly count: number } {
  const counter = { count: 0 };
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === path && request.method() !== 'OPTIONS') counter.count += 1;
  });
  return counter;
}

// ---------------------------------------------------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------------------------------------------------

/** A staff actor over the API with the backup codes of their enrollment (Ticket 06 shows them once). */
export type RecoveryActor = ApiActor & { authenticator: Authenticator; backupCodes: string[] };

type SessionBody = { accessToken: string; mfa: MfaStatus };

/** Takes the new access token and status of a 200 session body, as `ApiSession` does after a refresh. */
export function adopt(session: ApiSession, body: SessionBody): void {
  session.accessToken = body.accessToken;
  session.mfa = body.mfa;
  session.issuedAt = Date.now();
}

/** Starts and verifies a first enrollment from an `ENROLLMENT_REQUIRED` session, keeping the backup codes. */
export async function enrollKeepingCodes(session: ApiSession): Promise<{ authenticator: Authenticator; backupCodes: string[] }> {
  expect(session.mfa).toBe('ENROLLMENT_REQUIRED');
  const started = await session.call('POST', '/api/auth/mfa/enrollment');
  expect(started.status(), 'enrollment start').toBe(201);
  expect(started.headers()['cache-control'], 'enrollment start caching').toBe('no-store');
  const { enrollmentId, secret } = await started.json() as { enrollmentId: string; secret: string };
  const step = totpStep();
  const verified = await session.call('POST', '/api/auth/mfa/enrollment/verify',
    { data: { enrollmentId, code: totpCode(secret, step) } });
  expect(verified.status(), 'enrollment verification').toBe(200);
  expect(verified.headers()['cache-control'], 'enrollment verification caching').toBe('no-store');
  const body = await verified.json() as SessionBody & { backupCodes: string[] };
  adopt(session, body);
  expect(session.mfa).toBe('VERIFIED');
  return { authenticator: { key: secret, step }, backupCodes: body.backupCodes };
}

/**
 * A new staff User over the API: registered, given `kind` with SQL (mobile verified unless `verifiedMobile` is false),
 * signed in and enrolled, with the 10 backup codes kept. The session is VERIFIED.
 */
export async function apiRecoveryStaff(api: APIRequestContext, kind: StaffKind = 'MODERATOR',
  { verifiedMobile = true }: { verifiedMobile?: boolean } = {}): Promise<RecoveryActor> {
  const user = await registerThroughApi(api, syntheticCustomer());
  if (verifiedMobile) markMobileVerified(user.username);
  if (kind === 'SUPER_ADMIN') makeSuperAdmin(user.username);
  else grantRole(user.username, kind);
  const session = await ApiSession.signIn(user);
  const { authenticator, backupCodes } = await enrollKeepingCodes(session);
  expect(backupCodes).toHaveLength(10);
  return { user, session, authenticator, backupCodes };
}

/** A new password-only session of `actor` (VERIFICATION_REQUIRED while a factor is active); the old one is kept. */
export async function passwordSession(actor: { user: Customer }): Promise<ApiSession> {
  const session = await ApiSession.signIn(actor.user);
  expect(session.mfa, 'a password sign-in of enrolled staff asks for a code').toBe('VERIFICATION_REQUIRED');
  return session;
}

/** `POST /api/auth/mfa/recovery` with `{ backupCode }` (or a raw `data`); a 200 replaces the session's token. */
export async function redeem(session: ApiSession, backupCode: string,
  options: { token?: string | null } = {}): Promise<APIResponse> {
  const response = await session.call('POST', '/api/auth/mfa/recovery',
    { token: options.token, data: { backupCode } });
  if (response.status() === 200) adopt(session, await response.json() as SessionBody);
  return response;
}

/** Sends any body to a route as JSON (or `contentType`), refreshing the session token if needed. */
export function sendRaw(session: ApiSession, path: string, body: string, contentType = 'application/json'): Promise<APIResponse> {
  return session.call('POST', path, { data: body, headers: { 'Content-Type': contentType } });
}

/** `POST /api/auth/mfa/enrollment` from a replacement (or enrollment) session; an explicit token avoids refresh. */
export function startEnrollment(session: ApiSession, options: { token?: string } = {}): Promise<APIResponse> {
  return session.call('POST', '/api/auth/mfa/enrollment', { token: options.token });
}

/** A 201 enrollment start: the enrollment id and the new key. */
export async function startedEnrollment(session: ApiSession): Promise<{ enrollmentId: string; secret: string }> {
  const response = await startEnrollment(session);
  expect(response.status(), 'replacement enrollment start').toBe(201);
  expect(response.headers()['cache-control'], 'enrollment start caching').toBe('no-store');
  const body = await response.json() as Record<string, unknown>;
  expect(Object.keys(body).sort()).toEqual(enrollmentStartFields);
  return body as { enrollmentId: string; secret: string };
}

/** `POST /api/auth/mfa/enrollment/verify`; a 200 replaces the session's token. */
export async function verifyEnrollment(session: ApiSession, enrollmentId: string, code: string,
  options: { token?: string } = {}): Promise<APIResponse> {
  const response = await session.call('POST', '/api/auth/mfa/enrollment/verify',
    { token: options.token, data: { enrollmentId, code } });
  if (response.status() === 200) {
    expect(response.headers()['cache-control'], 'enrollment verification caching').toBe('no-store');
    adopt(session, await response.json() as SessionBody);
  }
  return response;
}

/** `POST /api/auth/mfa/backup-codes` with `{ code }` from a verified session. */
export function regenerate(session: ApiSession, code: string): Promise<APIResponse> {
  return session.call('POST', '/api/auth/mfa/backup-codes', { data: { code } });
}

/** `POST /api/auth/mfa/verify` with `{ code }` (Ticket 06's challenge). */
export async function verifyChallenge(session: ApiSession, code: string): Promise<APIResponse> {
  const response = await session.call('POST', '/api/auth/mfa/verify', { data: { code } });
  if (response.status() === 200) adopt(session, await response.json() as SessionBody);
  return response;
}

/** What a finished API replacement returns. */
export type ApiReplacement = {
  authenticator: Authenticator;
  backupCodes: string[];
  contactNotice: ContactNotice;
  /** The 200 body of the replacement verify. */
  body: Record<string, unknown>;
};

/**
 * The whole recovery over the API, from `session` (a password-only session): uses `code`, starts the replacement and
 * verifies the new key's current code. `session` ends VERIFIED on the new authenticator.
 */
export async function replaceThroughApi(session: ApiSession, code: string): Promise<ApiReplacement> {
  expect((await redeem(session, code)).status(), 'backup code').toBe(200);
  expect(session.mfa).toBe('REPLACEMENT_REQUIRED');
  const { enrollmentId, secret } = await startedEnrollment(session);
  const step = totpStep();
  const response = await verifyEnrollment(session, enrollmentId, totpCode(secret, step));
  expect(response.status(), 'replacement verification').toBe(200);
  const body = await response.json() as Record<string, unknown>;
  expect(session.mfa).toBe('VERIFIED');
  return {
    authenticator: { key: secret, step },
    backupCodes: body.backupCodes as string[],
    contactNotice: body.contactNotice as ContactNotice,
    body,
  };
}

/** The `Max-Age` of the `MW_REFRESH` cookie a response sets, or null when it sets none. */
export function refreshCookieMaxAge(response: APIResponse): number | null {
  const cookie = response.headersArray().filter(({ name }) => name.toLowerCase() === 'set-cookie')
    .map(({ value }) => value).find((value) => value.startsWith('MW_REFRESH='));
  if (!cookie) return null;
  const maxAge = /;\s*Max-Age=(\d+)/i.exec(cookie);
  return maxAge ? Number(maxAge[1]) : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Database probes (read-only unless named otherwise); each checks the run's schema and the synthetic username first
// ---------------------------------------------------------------------------------------------------------------------

function rows(sql: string): string[][] {
  const text = psql(sql);
  return text === '' ? [] : text.split(/\r?\n/).map((line) => line.split('|'));
}

/** One `staff_mfa_factors` row of a User, oldest first. */
export type FactorRow = { id: string; status: string; revoked: boolean; activated: boolean; unusedCodes: number; usedCodes: number };

export function factorRows(username: string): FactorRow[] {
  const schema = checkedTarget('factorRows', username);
  return rows(`SELECT f.id, f.status, f.revoked_at IS NOT NULL, f.activated_at IS NOT NULL,`
    + ` (SELECT count(*) FROM ${schema}.staff_mfa_backup_codes c WHERE c.factor_id = f.id AND c.consumed_at IS NULL),`
    + ` (SELECT count(*) FROM ${schema}.staff_mfa_backup_codes c WHERE c.factor_id = f.id AND c.consumed_at IS NOT NULL)`
    + ` FROM ${schema}.staff_mfa_factors f JOIN ${schema}.users u ON u.id = f.user_id WHERE u.username = '${username}'`
    + ' ORDER BY f.created_at, f.id;')
    .map(([id, status, revoked, activated, unused, used]) => ({
      id, status, revoked: revoked === 't', activated: activated === 't', unusedCodes: Number(unused), usedCodes: Number(used),
    }));
}

/** The statuses of a User's factors, oldest first, e.g. `['REVOKED', 'ACTIVE']`. */
export function factorStatuses(username: string): string[] {
  return factorRows(username).map(({ status }) => status);
}

/** One `user_sessions` row of a User, oldest first, with the Ticket 06 and Ticket 09 MFA evidence. */
export type SessionRow = {
  id: string;
  state: string;
  factorId: string | null;
  replacingFactorId: string | null;
  verified: boolean;
  /** `expires_at - created_at` in whole seconds. */
  lifetimeSeconds: number;
  expiresAt: string;
};

export function sessionRows(username: string): SessionRow[] {
  const schema = checkedTarget('sessionRows', username);
  return rows(`SELECT s.id, coalesce(s.revoked_reason, 'active'), coalesce(s.mfa_factor_id::text, ''),`
    + ` coalesce(s.mfa_replacing_factor_id::text, ''), s.mfa_verified_at IS NOT NULL,`
    + ` floor(extract(epoch FROM s.expires_at - s.created_at))::bigint, to_char(s.expires_at AT TIME ZONE 'UTC',`
    + ` 'YYYY-MM-DD"T"HH24:MI:SS.US') FROM ${schema}.user_sessions s JOIN ${schema}.users u ON u.id = s.user_id`
    + ` WHERE u.username = '${username}' ORDER BY s.created_at, s.id;`)
    .map(([id, state, factorId, replacingFactorId, verified, lifetime, expiresAt]) => ({
      id, state, factorId: factorId || null, replacingFactorId: replacingFactorId || null, verified: verified === 't',
      lifetimeSeconds: Number(lifetime), expiresAt,
    }));
}

/** The User's active sessions. */
export function activeSessions(username: string): SessionRow[] {
  return sessionRows(username).filter(({ state }) => state === 'active');
}

/** Every `security_audit_events.event_type` of a User, oldest first. */
export function auditTypes(username: string): string[] {
  const schema = checkedTarget('auditTypes', username);
  const text = psql(`SELECT e.event_type FROM ${schema}.security_audit_events e JOIN ${schema}.users u`
    + ` ON u.id = e.subject_user_id WHERE u.username = '${username}' ORDER BY e.occurred_at, e.id;`);
  return text === '' ? [] : text.split(/\r?\n/);
}

/** How many audit events of `type` a User has. */
export function auditCount(username: string, type: string): number {
  return auditTypes(username).filter((event) => event === type).length;
}

/**
 * Every audit column of a User's events joined into one string, so a spec can prove no code, key, token or contact was
 * written there.
 */
export function auditText(username: string): string {
  const schema = checkedTarget('auditText', username);
  return psql(`SELECT string_agg(e::text, '|') FROM ${schema}.security_audit_events e JOIN ${schema}.users u`
    + ` ON u.id = e.subject_user_id WHERE u.username = '${username}';`);
}

/** The User's shared MFA throttle (P7): failures in the window and whether it is locked now; zeros when no row exists. */
export function throttleState(username: string): { failedCount: number; locked: boolean } {
  const schema = checkedTarget('throttleState', username);
  const [row] = rows(`SELECT t.failed_count, coalesce(t.locked_until > now(), false) FROM ${schema}.staff_mfa_throttle t`
    + ` JOIN ${schema}.users u ON u.id = t.user_id WHERE u.username = '${username}';`);
  return row ? { failedCount: Number(row[0]), locked: row[1] === 't' } : { failedCount: 0, locked: false };
}

/** The `consumed_session_id` of each consumed backup code of a User (C2: the restricted session that presented it). */
export function consumedSessionIds(username: string): string[] {
  const schema = checkedTarget('consumedSessionIds', username);
  const text = psql(`SELECT coalesce(c.consumed_session_id::text, '-') FROM ${schema}.staff_mfa_backup_codes c`
    + ` JOIN ${schema}.staff_mfa_factors f ON f.id = c.factor_id JOIN ${schema}.users u ON u.id = f.user_id`
    + ` WHERE u.username = '${username}' AND c.consumed_at IS NOT NULL ORDER BY c.consumed_at;`);
  return text === '' ? [] : text.split(/\r?\n/);
}

/** Writes: ends every active replacement session of a User now, as if its 10 minutes had passed (P3, AC4). */
export function expireReplacementSessions(username: string): number {
  const schema = checkedTarget('expireReplacementSessions', username);
  const text = psql(`UPDATE ${schema}.user_sessions SET expires_at = now() - interval '1 second'`
    + ` WHERE mfa_replacing_factor_id IS NOT NULL AND revoked_at IS NULL AND user_id =`
    + ` (SELECT id FROM ${schema}.users WHERE username = '${username}') RETURNING id;`);
  return text === '' ? 0 : text.split(/\r?\n/).length;
}

/**
 * Writes: revokes the User's active factor as a Ticket 10 Admin reset would (plan §8.3), so a replacement session bound
 * to it becomes stale.
 */
export function revokeActiveFactorLikeTicket10(username: string): void {
  const schema = checkedTarget('revokeActiveFactorLikeTicket10', username);
  const revoked = psql(`UPDATE ${schema}.staff_mfa_factors SET status = 'REVOKED', revoked_at = now()`
    + ` WHERE status = 'ACTIVE' AND user_id = (SELECT id FROM ${schema}.users WHERE username = '${username}')`
    + ' RETURNING status;');
  if (revoked !== 'REVOKED') throw new Error(`User ${username} has no active factor`);
}

/** The role the database holds for `username` (exactly one since Ticket 08). */
export function roleOf(username: string): string {
  const schema = checkedTarget('roleOf', username);
  return psql(`SELECT r.role FROM ${schema}.user_roles r JOIN ${schema}.users u ON u.id = r.user_id`
    + ` WHERE u.username = '${username}';`);
}
