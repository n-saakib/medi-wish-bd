import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';
import { type ApiActor, ApiSession, apiStaff, apiSuperAdmin, expectActive, expectRevoked, signInAgain } from './apiSession';
import {
  copy, expectError, expectNoStore, profilePath, type Profile, registerByApi, setAccountState, signInByApi,
} from './profileSupport';
import {
  ageLimits, agePasswordLimit, auditEventTypes, capturedMail, codeFrom, codeInLog, comparableHeaders, confirmReset, expectAccepted,
  expectNoMailFor, expectReset, expireCode, hasCode, mailedCode, type MailKind, makePasswordUnusable, markEmailVerified,
  newPassword, postRaw, readCapturedMail, recoveryCopy, requestReset, resetConfirmPath, resetRequestPath, resetSentinel,
  setStoredEmail, storedCodeIds, storedCodes, storedEmailState, storedPasswordHash, unknownEmail, verificationConfirmPath, verificationPath, verifiedCustomer,
  wrongCode,
} from './recoverySupport';
import { syntheticCustomer, type Customer } from './support';
import { apiLogPath, apiUrl, checkedTarget, frontendUrl, grantRole, psql, sessionStates, tableFingerprints } from './testApi';

/**
 * Ticket 05 API-level acceptance tests (plan §10.4, E2E-05-01 to E2E-05-36) against the real test API, PostgreSQL 18
 * and the run's mail capture directory (plan O4). They are written test-first: each passes once T4 wires the T2/T3
 * rules to the API, so each carries `@t05-T4`, plus one area tag for focused runs during development:
 *
 * - `@t05-reset`: the public reset routes; `@t05-verify`: the email verification routes;
 * - `@t05-email-change`: the current-password rule and its effects on `PUT /profile`;
 * - `@t05-limits`: the issue, address and current-password limits; `@t05-authz`: routes, roles and CORS;
 * - `@t05-privacy`: the R1 log, response and table checks.
 *
 * Synthetic data only. Privacy checks use booleans or counts so their failures do not dump raw bodies, mail, or logs.
 */
const area = (name: string) => ({ tag: ['@t05', '@t05-T4', `@t05-${name}`] });
const reset = area('reset');
const verify = area('verify');
const emailChange = area('email-change');
const limits = area('limits');
const authz = area('authz');
const privacy = area('privacy');

const hex = () => randomBytes(4).toString('hex');

/** A fresh synthetic address no User holds yet. */
const freshEmail = (prefix = 'recovery') => `${prefix}.${hex()}@example.test`;

/** The JSON body limit of the credential and Bearer command routes, in bytes (`AuthRequestBodyLimitFilter`). */
const bodyLimit = 16 * 1024;

/** `value` as JSON of exactly `bytes` bytes, padded with JSON white space so only its size can be refused. */
function paddedJson(value: object, bytes: number): string {
  const json = JSON.stringify(value);
  const padding = bytes - Buffer.byteLength(json);
  expect(padding).toBeGreaterThanOrEqual(0);
  return `{${' '.repeat(padding)}${json.slice(1)}`;
}

/** The Ticket 05 `Profile` (plan §4.2): the Ticket 11 body plus `emailVerified`. */
type RecoveryProfile = Profile & { emailVerified: boolean };

/** Exactly these keys, sorted. Listed in full so a later change to the Ticket 11 list cannot hide a missing key. */
const recoveryProfileKeys = ['accountState', 'dateOfBirth', 'email', 'emailVerified', 'fullName', 'mobile',
  'mobileVerified', 'pendingMobile', 'username', 'version'];

/** Asserts a complete Ticket 05 `Profile` with `no-store`; `emailVerified` is false whenever `email` is null. */
async function expectRecoveryProfile(response: APIResponse, status = 200): Promise<RecoveryProfile> {
  expect(response.status(), 'profile response status').toBe(status);
  expectNoStore(response);
  const body = await response.json() as RecoveryProfile;
  expect(Object.keys(body).sort()).toEqual(recoveryProfileKeys);
  expect(typeof body.emailVerified).toBe('boolean');
  if (body.email === null) expect(body.emailVerified, 'no email is never verified').toBe(false);
  return body;
}

/** A `204` with an empty body and `no-store`. */
async function expectNoContent(response: APIResponse): Promise<void> {
  expect(response.status(), 'empty response status').toBe(204);
  expect((await response.text()).length, 'empty response body length').toBe(0);
  expectNoStore(response);
}

const expectCodeInvalid = (response: APIResponse) =>
  expectError(response, 400, 'CODE_INVALID', recoveryCopy.codeInvalidApi);
const expectInvalid = (response: APIResponse) =>
  expectError(response, 400, 'INVALID_REQUEST', recoveryCopy.invalidRequestApi);
const expectPasswordInvalid = (response: APIResponse) =>
  expectError(response, 400, 'CURRENT_PASSWORD_INVALID', recoveryCopy.currentPasswordInvalidApi);
const expectTooMany = (response: APIResponse) =>
  expectError(response, 429, 'TOO_MANY_ATTEMPTS', recoveryCopy.tooManyAttemptsApi);
const expectClosing = (response: APIResponse) =>
  expectError(response, 409, 'ACCOUNT_CLOSING', recoveryCopy.accountClosingApi);
const expectEmailRequired = (response: APIResponse) =>
  expectError(response, 409, 'EMAIL_REQUIRED', recoveryCopy.emailRequiredApi);
const expectMfaRequired = (response: APIResponse) =>
  expectError(response, 403, 'MFA_REQUIRED', 'Authenticator verification is required.');
const expectAuthenticationRequired = (response: APIResponse) =>
  expectError(response, 401, 'AUTHENTICATION_REQUIRED', 'Authentication is required.');

/** A password sign-in is refused with the uniform `401 AUTHENTICATION_FAILED`. */
async function expectSignInRefused(api: APIRequestContext, identifier: string, password: string): Promise<void> {
  await expectError(await signInByApi(api, identifier, password), 401, 'AUTHENTICATION_FAILED',
    'The identifier or password is invalid.');
}

/** A password sign-in succeeds. */
async function expectSignIn(api: APIRequestContext, identifier: string, password: string): Promise<void> {
  expect((await signInByApi(api, identifier, password)).status(), 'sign-in with the expected password').toBe(200);
}

// ---------------------------------------------------------------------------------------------------------------
// Sessions. Every session a test opens is disposed after it; a revoked session's context is disposed the same way.
// ---------------------------------------------------------------------------------------------------------------

const opened: ApiSession[] = [];

test.afterEach(async () => {
  for (const session of opened.splice(0)) await session.dispose().catch(() => undefined);
});

/** Signs `user` in with the password in a request context of its own (one session) and tracks it for disposal. */
async function signedIn(user: Customer): Promise<ApiSession> {
  const session = await ApiSession.signIn(user);
  opened.push(session);
  return session;
}

/** Tracks a staff actor's current session for disposal and returns the actor. */
function tracked(actor: ApiActor): ApiActor {
  opened.push(actor.session);
  return actor;
}

/** The caller's profile, checked to be a complete Ticket 05 `Profile`. */
async function readProfile(session: ApiSession): Promise<RecoveryProfile> {
  return expectRecoveryProfile(await session.call('GET', profilePath));
}

/** The four Ticket 11 fields at the current version with `edit` applied; an `undefined` key is left out of the JSON. */
async function profileBody(session: ApiSession, edit: Record<string, unknown>): Promise<Record<string, unknown>> {
  const current = await readProfile(session);
  return { fullName: current.fullName, email: current.email, dateOfBirth: current.dateOfBirth, version: current.version,
    ...edit };
}

/** `PUT /api/user/me/profile` with the current fields, `edit` applied; the caller checks the answer. */
async function saveProfile(session: ApiSession, edit: Record<string, unknown>): Promise<APIResponse> {
  return session.call('PUT', profilePath, { data: await profileBody(session, edit) });
}

/** `POST /api/user/me/email-verification`, with no body unless `data` is given (the route ignores a body). */
function requestVerification(session: ApiSession, data?: unknown): Promise<APIResponse> {
  return session.call('POST', verificationPath, data === undefined ? {} : { data });
}

/** `POST /api/user/me/email-verification/confirm` with exactly `{"code": code}` (`undefined` sends `{}`). */
function confirmVerification(session: ApiSession, code: unknown): Promise<APIResponse> {
  return session.call('POST', verificationConfirmPath, { data: { code } });
}

/** Asks for a reset for `email` and returns the newly mailed reset code. */
async function resetCode(api: APIRequestContext, email: string): Promise<string> {
  const before = capturedMail({ to: email, kind: 'PASSWORD_RESET_CODE' }).length;
  await expectAccepted(await requestReset(api, email));
  return mailedCode(email, 'PASSWORD_RESET_CODE', before + 1);
}

/** Asks for a verification code from `session` and returns the code mailed to `email`. */
async function verificationCode(session: ApiSession, email: string): Promise<string> {
  const before = capturedMail({ to: email, kind: 'EMAIL_VERIFICATION_CODE' }).length;
  await expectNoContent(await requestVerification(session));
  return mailedCode(email, 'EMAIL_VERIFICATION_CODE', before + 1);
}

/** The messages to `to` (optionally of `kind`) once a sentinel proves every earlier message has been written. */
async function settledMail(api: APIRequestContext, to: string, kind?: MailKind) {
  const caused = await resetSentinel(api)();
  await readCapturedMail(caused.to, caused.kind);
  return capturedMail({ to, kind });
}

/** Registers a synthetic User without an email (the key left out); returns them with the email unused. */
async function registerWithoutEmail(api: APIRequestContext): Promise<Customer> {
  const customer = syntheticCustomer();
  const { username, mobile, password } = customer;
  expect((await api.post(`${apiUrl}/api/auth/register`, { data: { username, mobile, password } })).status(),
    'registration without an email').toBe(201);
  return customer;
}

// ---------------------------------------------------------------------------------------------------------------
// SQL probes local to this spec. Each checks the schema and the synthetic username first.
// ---------------------------------------------------------------------------------------------------------------

const userIdSql = (schema: string, username: string) => `(SELECT id FROM ${schema}.users WHERE username = '${username}')`;

/** Clears the verified mark of a User's saved email, so one User can hold codes of both purposes. */
function markEmailUnverified(username: string): void {
  const schema = checkedTarget('markEmailUnverified', username);
  const set = psql(`UPDATE ${schema}.users SET email_verified_at = NULL WHERE username = '${username}'`
    + ' RETURNING email_verified_at IS NULL;');
  if (set !== 't') throw new Error(`No User ${username} to unverify`);
}

/** Whether every live code of the User is stored as a 64-character lower-case hex HMAC (plan O3), never the code. */
function codeHashesWellFormed(username: string): boolean {
  const schema = checkedTarget('codeHashesWellFormed', username);
  return psql(`SELECT coalesce(bool_and(code_hash ~ '^[0-9a-f]{64}$'), false) FROM ${schema}.account_codes`
    + ` WHERE user_id = ${userIdSql(schema, username)};`) === 't';
}

/** A digest of one live code row, including its hash and try count, without exposing code material. */
function codeRowFingerprint(username: string, purpose: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET'): string {
  const schema = checkedTarget('codeRowFingerprint', username);
  return psql(`SELECT count(*) || ':' || coalesce(md5(string_agg(c::text, '|' ORDER BY c.id::text)), '-')`
    + ` FROM ${schema}.account_codes c WHERE c.user_id = ${userIdSql(schema, username)}`
    + ` AND c.purpose = '${purpose}';`);
}

/**
 * A fingerprint of the User's authenticator factors and backup codes (row counts and an md5 of every column), so a
 * test proves a reset left them untouched without reading a secret into the test output.
 */
function staffMfaFingerprint(username: string): string {
  const schema = checkedTarget('staffMfaFingerprint', username);
  const id = userIdSql(schema, username);
  return psql(`SELECT (SELECT count(*) || ':' || coalesce(md5(string_agg(f::text, '|' ORDER BY f::text)), '-')`
    + ` FROM ${schema}.staff_mfa_factors f WHERE f.user_id = ${id}) || ' '`
    + ` || (SELECT count(*) || ':' || coalesce(md5(string_agg(b::text, '|' ORDER BY b::text)), '-')`
    + ` FROM ${schema}.staff_mfa_backup_codes b JOIN ${schema}.staff_mfa_factors f ON f.id = b.factor_id`
    + ` WHERE f.user_id = ${id});`);
}

/** Whether the singleton `staff_bootstrap` row names the User as Super Admin. */
function isSuperAdmin(username: string): boolean {
  const schema = checkedTarget('isSuperAdmin', username);
  return psql(`SELECT super_admin_user_id = ${userIdSql(schema, username)} FROM ${schema}.staff_bootstrap`
    + ' WHERE id = 1;') === 't';
}

/** The tables a recovery flow may write; every other table must keep its fingerprint (plan T6 R1). */
const recoveryWritableTables = ['users', 'account_codes', 'account_code_limits', 'user_sessions',
  'user_session_refresh_tokens', 'security_audit_events', 'databasechangelog', 'databasechangeloglock'] as const;

test.describe('Ticket 05 recovery API', () => {
  // -------------------------------------------------------------------------------------------------------------
  // Password reset (public routes)
  // -------------------------------------------------------------------------------------------------------------

  test('E2E-05-01 a reset request answers one identical 202 for verified, unverified, unknown and re-cased addresses; only verified ones get mail',
    reset, async ({ request }) => {
      const verified = await verifiedCustomer(request);
      const recased = await verifiedCustomer(request);
      const unverified = await registerByApi(request, syntheticCustomer());
      const unknown = unknownEmail();

      const answers: APIResponse[] = [];
      for (const email of [verified.email, unverified.email, unknown, `  ${recased.email.toUpperCase()}  `]) {
        const answer = await requestReset(request, email);
        await expectAccepted(answer);
        answers.push(answer);
      }
      // Status, body and every header except the per-request id and date are the same for all four.
      for (const answer of answers.slice(1)) expect(comparableHeaders(answer)).toEqual(comparableHeaders(answers[0]));

      codeFrom((await readCapturedMail(verified.email, 'PASSWORD_RESET_CODE')).body);
      // The re-cased, padded address reaches the stored lower-case address.
      expect((await readCapturedMail(recased.email, 'PASSWORD_RESET_CODE')).to).toBe(recased.email);
      await expectNoMailFor([unverified.email, unknown], resetSentinel(request));

      expect(storedCodes(unverified.username)).toEqual([]);
      expect(storedCodes(verified.username)).toEqual([{ purpose: 'PASSWORD_RESET', sentTo: verified.email, failedAttempts: 0 }]);
      expect(codeHashesWellFormed(verified.username), 'the code is stored only as an HMAC').toBe(true);
      expect(auditEventTypes(verified.username)).toContain('PASSWORD_RESET_REQUESTED');
      expect(auditEventTypes(unverified.username)).not.toContain('PASSWORD_RESET_REQUESTED');
    });

  test('E2E-05-02 a full API reset changes the password, revokes every session and signs no one in', reset, async ({ request }) => {
    const customer = await verifiedCustomer(request);
    const hashBefore = storedPasswordHash(customer.username);

    await expectAccepted(await requestReset(request, ` ${customer.email.toUpperCase()} `));
    const code = await mailedCode(customer.email, 'PASSWORD_RESET_CODE');
    // Signed in just before the confirm, so its tokens are still inside their lifetime when they are refused.
    const earlier = await signedIn(customer);
    const password = newPassword();

    await expectReset(await confirmReset(request, { email: customer.email.toUpperCase(), code, newPassword: password }));

    expect(storedPasswordHash(customer.username)).not.toBe(hashBefore);
    await expectSignInRefused(request, customer.username, customer.password);
    await expectRevoked(earlier);
    expect(sessionStates(customer.username).every((state) => state === 'password-reset'), 'every earlier session revoked')
      .toBe(true);
    await expectSignIn(request, customer.username, password);
    await expectSignIn(request, customer.email, password);

    expect(storedCodes(customer.username)).toEqual([]);
    const audit = auditEventTypes(customer.username);
    expect(audit).toContain('PASSWORD_RESET_REQUESTED');
    expect(audit).toContain('PASSWORD_RESET_COMPLETED');
    expect(audit.indexOf('PASSWORD_RESET_REQUESTED')).toBeLessThan(audit.indexOf('PASSWORD_RESET_COMPLETED'));
  });

  test('E2E-05-03 a used reset code replays as CODE_INVALID and changes nothing', reset, async ({ request }) => {
    const customer = await verifiedCustomer(request);
    const code = await resetCode(request, customer.email);
    const first = newPassword();
    await expectReset(await confirmReset(request, { email: customer.email, code, newPassword: first }));
    const hashAfterReset = storedPasswordHash(customer.username);

    const second = newPassword();
    await expectCodeInvalid(await confirmReset(request, { email: customer.email, code, newPassword: second }));

    expect(storedPasswordHash(customer.username)).toBe(hashAfterReset);
    expect(storedCodes(customer.username)).toEqual([]);
    await expectSignIn(request, customer.username, first);
    await expectSignInRefused(request, customer.username, second);
  });

  test('E2E-05-04 an expired reset code is refused as CODE_INVALID and its row is removed', reset, async ({ request }) => {
    const customer = await verifiedCustomer(request);
    const code = await resetCode(request, customer.email);
    const hash = storedPasswordHash(customer.username);
    expireCode(customer.username, 'PASSWORD_RESET');

    await expectCodeInvalid(await confirmReset(request, { email: customer.email, code, newPassword: newPassword() }));

    expect(storedCodes(customer.username)).toEqual([]);
    expect(storedPasswordHash(customer.username)).toBe(hash);
    await expectSignIn(request, customer.username, customer.password);
  });

  test('E2E-05-05 five wrong reset codes void the code; the right code afterwards is CODE_INVALID', reset, async ({ request }) => {
    const customer = await verifiedCustomer(request);
    const code = await resetCode(request, customer.email);
    const hash = storedPasswordHash(customer.username);

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await expectCodeInvalid(await confirmReset(request,
        { email: customer.email, code: wrongCode(code, attempt), newPassword: newPassword() }));
      expect(storedCodes(customer.username)).toEqual([
        { purpose: 'PASSWORD_RESET', sentTo: customer.email, failedAttempts: attempt }]);
    }
    await expectCodeInvalid(await confirmReset(request, { email: customer.email, code: wrongCode(code, 5), newPassword: newPassword() }));
    expect(storedCodes(customer.username), 'the fifth wrong try deletes the code').toEqual([]);

    await expectCodeInvalid(await confirmReset(request, { email: customer.email, code, newPassword: newPassword() }));
    expect(storedPasswordHash(customer.username)).toBe(hash);
    await expectSignIn(request, customer.username, customer.password);
    const audit = auditEventTypes(customer.username);
    expect(audit.filter((type) => type === 'ACCOUNT_CODE_FAILED')).toHaveLength(4);
    expect(audit.filter((type) => type === 'ACCOUNT_CODE_LOCKED')).toHaveLength(1);
  });

  test('E2E-05-06 a newer reset request replaces the older code', reset, async ({ request }) => {
    const customer = await verifiedCustomer(request);
    const older = await resetCode(request, customer.email);
    const olderIds = storedCodeIds(customer.username, 'PASSWORD_RESET');
    expect(olderIds).toHaveLength(1);
    ageLimits(customer.username, 61);
    const newer = await resetCode(request, customer.email);
    const newerIds = storedCodeIds(customer.username, 'PASSWORD_RESET');
    expect(newerIds).toHaveLength(1);
    expect(newerIds).not.toEqual(olderIds);
    expect(storedCodes(customer.username), 'one live code per purpose').toHaveLength(1);

    // Equal random digits cannot identify which issuance supplied them; row identity still proves replacement.
    if (older !== newer) {
      await expectCodeInvalid(await confirmReset(request, { email: customer.email, code: older, newPassword: newPassword() }));
    }
    const password = newPassword();
    await expectReset(await confirmReset(request, { email: customer.email, code: newer, newPassword: password }));
    await expectSignIn(request, customer.username, password);
  });

  test('E2E-05-07 codes are bound to their purpose: a verification code cannot reset and a reset code cannot verify',
    reset, async ({ request }) => {
      const customer = await registerByApi(request, syntheticCustomer());
      const session = await signedIn(customer);
      const verification = await verificationCode(session, customer.email);
      // The SQL fixture makes the address verified, so the same User can also hold a reset code.
      ageLimits(customer.username, 61);
      markEmailVerified(customer.username);
      const resetting = await resetCode(request, customer.email);
      expect(storedCodes(customer.username).map((code) => code.purpose)).toEqual(['EMAIL_VERIFICATION', 'PASSWORD_RESET']);
      expect(storedCodeIds(customer.username, 'EMAIL_VERIFICATION')).toHaveLength(1);
      expect(storedCodeIds(customer.username, 'PASSWORD_RESET')).toHaveLength(1);

      // Equal random digits are also the valid digits for the target purpose, so cross-use cannot be observed.
      if (verification !== resetting) {
        await expectCodeInvalid(await confirmReset(request,
          { email: customer.email, code: verification, newPassword: newPassword() }));
      }
      await expectSignIn(request, customer.username, customer.password);

      // Unverified again, the verification route must refuse the reset code (a verified address would answer 200).
      markEmailUnverified(customer.username);
      if (verification !== resetting) await expectCodeInvalid(await confirmVerification(session, resetting));
      expect(storedEmailState(customer.username).emailVerified).toBe(false);
      expect(storedCodes(customer.username)).toEqual([
        { purpose: 'EMAIL_VERIFICATION', sentTo: customer.email, failedAttempts: verification === resetting ? 0 : 1 },
        { purpose: 'PASSWORD_RESET', sentTo: customer.email, failedAttempts: verification === resetting ? 0 : 1 },
      ]);

      // Each code still works for its own purpose.
      expect((await expectRecoveryProfile(await confirmVerification(session, verification))).emailVerified).toBe(true);
      const password = newPassword();
      await expectReset(await confirmReset(request, { email: customer.email, code: resetting, newPassword: password }));
      await expectSignIn(request, customer.username, password);
    });

  test("E2E-05-08 one account's reset code never resets another account", reset, async ({ request }) => {
    const first = await verifiedCustomer(request);
    const second = await verifiedCustomer(request);
    const firstCode = await resetCode(request, first.email);
    const secondCode = await resetCode(request, second.email);
    const firstIds = storedCodeIds(first.username, 'PASSWORD_RESET');
    const secondIds = storedCodeIds(second.username, 'PASSWORD_RESET');
    expect(firstIds).toHaveLength(1);
    expect(secondIds).toHaveLength(1);
    expect(firstIds).not.toEqual(secondIds);
    const hashes = [storedPasswordHash(first.username), storedPasswordHash(second.username)];

    // If the issuances have equal digits, neither cross-submit can identify which account supplied them.
    if (firstCode !== secondCode) {
      await expectCodeInvalid(await confirmReset(request, { email: first.email, code: secondCode, newPassword: newPassword() }));
      await expectCodeInvalid(await confirmReset(request, { email: second.email, code: firstCode, newPassword: newPassword() }));
    }
    await expectCodeInvalid(await confirmReset(request, { email: unknownEmail(), code: firstCode, newPassword: newPassword() }));
    expect([storedPasswordHash(first.username), storedPasswordHash(second.username)]).toEqual(hashes);
    await expectSignIn(request, first.username, first.password);
    await expectSignIn(request, second.username, second.password);

    for (const [customer, code] of [[first, firstCode], [second, secondCode]] as const) {
      const password = newPassword();
      await expectReset(await confirmReset(request, { email: customer.email, code, newPassword: password }));
      await expectSignIn(request, customer.username, password);
    }
  });

  test('E2E-05-09 the new password follows A5 exactly as typed; a refused password consumes no try', reset, async ({ request }) => {
    const customer = await verifiedCustomer(request);
    const code = await resetCode(request, customer.email);
    const hash = storedPasswordHash(customer.username);

    for (const refused of ['a'.repeat(5), 'b'.repeat(31), '', '      ', null, 123456, true, ['abcdef'], { value: 'abcdef' }]) {
      await expectInvalid(await confirmReset(request, { email: customer.email, code, newPassword: refused }));
    }
    expect(storedCodes(customer.username)).toEqual([{ purpose: 'PASSWORD_RESET', sentTo: customer.email, failedAttempts: 0 }]);
    expect(storedPasswordHash(customer.username)).toBe(hash);

    // Surrounding spaces are part of the password: never trimmed.
    await expectReset(await confirmReset(request, { email: customer.email, code, newPassword: ' abc123 ' }));
    await expectSignIn(request, customer.username, ' abc123 ');
    await expectSignInRefused(request, customer.username, 'abc123');

    // The bounds: 6 and 30 UTF-16 units are accepted.
    for (const password of ['c'.repeat(6), `${'d'.repeat(26)}${hex().slice(0, 4)}`]) {
      const other = await verifiedCustomer(request);
      await expectReset(await confirmReset(request, { email: other.email, code: await resetCode(request, other.email),
        newPassword: password }));
      await expectSignIn(request, other.username, password);
    }
  });

  test('E2E-05-11 the reset routes take exactly their JSON shape; a refused shape is 400 and consumes no try', reset, async ({ request }) => {
    const customer = await verifiedCustomer(request);
    const code = await resetCode(request, customer.email);
    const longEmail = `${'l'.repeat(321 - '@example.test'.length)}@example.test`;
    expect(longEmail).toHaveLength(321);

    const requestBodies: unknown[] = [
      {}, { email: 5 }, { email: null }, { email: true }, { email: [customer.email] }, { email: { value: customer.email } },
      { email: customer.email, extra: 1 }, { Email: customer.email }, { email: 'not-an-email' }, { email: '' },
      { email: '   ' }, { email: longEmail }, { email: `a..${hex()}@example.test` }, { email: `u${hex()}@localhost` },
    ];
    for (const body of requestBodies) {
      const answer = await postRaw(request, resetRequestPath, JSON.stringify(body));
      await expectInvalid(answer);
      expect((await answer.text()).includes(customer.email), 'an error never echoes the address').toBe(false);
    }

    const valid = { email: customer.email, code, newPassword: newPassword() };
    const confirmBodies: unknown[] = [
      {}, { code, newPassword: valid.newPassword }, { email: customer.email, newPassword: valid.newPassword },
      { email: customer.email, code }, { ...valid, extra: 1 }, { ...valid, email: 5 }, { ...valid, email: null },
      { ...valid, email: 'not-an-email' }, { ...valid, email: longEmail }, { ...valid, code: Number(code) },
      { ...valid, code: null }, { ...valid, code: '' }, { ...valid, code: code.slice(1) }, { ...valid, code: `${code}0` },
      { ...valid, code: 'abcdef' }, { ...valid, code: `${code.slice(0, 2)} ${code.slice(2)}` },
      { ...valid, code: ` ${code}` }, { ...valid, code: `${code} ` },
      { ...valid, code: code.replace(/\d/g, (digit) => String.fromCharCode(0xff10 + Number(digit))) },
      { ...valid, code: code.replace(/\d/g, (digit) => String.fromCharCode(0x0660 + Number(digit))) },
    ];
    for (const body of confirmBodies) {
      const answer = await postRaw(request, resetConfirmPath, JSON.stringify(body));
      await expectInvalid(answer);
      expect((await answer.text()).includes(customer.email), 'an error never echoes the address').toBe(false);
    }

    for (const path of [resetRequestPath, resetConfirmPath]) {
      for (const raw of ['[]', '{', '', 'null', '"text"', '{"email":"a@example.test",}']) {
        await expectInvalid(await postRaw(request, path, raw));
      }
      const body = path === resetRequestPath ? { email: unknownEmail() } : valid;
      await expectInvalid(await postRaw(request, path, JSON.stringify(body), 'text/plain'));
      await expectInvalid(await postRaw(request, path, paddedJson(body, bodyLimit + 1)));
    }

    // None of those consumed a try: the code is untouched.
    expect(storedCodes(customer.username)).toEqual([{ purpose: 'PASSWORD_RESET', sentTo: customer.email, failedAttempts: 0 }]);

    // Exactly 16 KiB is read: a request is accepted, and a confirm with a wrong code counts one try.
    await expectAccepted(await postRaw(request, resetRequestPath, paddedJson({ email: unknownEmail() }, bodyLimit)));
    await expectCodeInvalid(await postRaw(request, resetConfirmPath, paddedJson({ ...valid, code: wrongCode(code) }, bodyLimit)));
    expect(storedCodes(customer.username)).toEqual([{ purpose: 'PASSWORD_RESET', sentTo: customer.email, failedAttempts: 1 }]);

    await expectReset(await confirmReset(request, valid));
    await expectSignIn(request, customer.username, valid.newPassword);
  });

  test('E2E-05-12 an MFA-verified Admin resets; the next sign-in still needs the authenticator, which is unchanged',
    reset, async ({ request }) => {
      const admin = tracked(await apiStaff(request, 'ADMIN'));
      markEmailVerified(admin.user.username);
      const mfaBefore = staffMfaFingerprint(admin.user.username);
      expect(mfaBefore.startsWith('0:'), 'the Admin has an enrolled factor').toBe(false);

      const code = await resetCode(request, admin.user.email);
      expect((await admin.session.refresh()).status(), 'the verified session refreshes before the reset').toBe(200);
      const password = newPassword();
      await expectReset(await confirmReset(request, { email: admin.user.email, code, newPassword: password }));

      await expectRevoked(admin.session);
      expect(staffMfaFingerprint(admin.user.username), 'factor and backup codes untouched').toBe(mfaBefore);
      await expectSignInRefused(request, admin.user.username, admin.user.password);

      admin.user = { ...admin.user, password };
      expect(await signInAgain(admin)).toBe('VERIFICATION_REQUIRED');
      opened.push(admin.session);
      await expectMfaRequired(await admin.session.call('GET', '/api/staff/me'));
      await admin.session.verify(admin.authenticator!);
      expect((await admin.session.call('GET', '/api/staff/me')).status()).toBe(200);
    });

  test('E2E-05-13 the Super Admin resets and stays Super Admin behind the authenticator', reset, async ({ request }) => {
    const superAdmin = tracked(await apiSuperAdmin(request));
    markEmailVerified(superAdmin.user.username);
    const mfaBefore = staffMfaFingerprint(superAdmin.user.username);

    const code = await resetCode(request, superAdmin.user.email);
    const password = newPassword();
    await expectReset(await confirmReset(request, { email: superAdmin.user.email, code, newPassword: password }));

    expect(isSuperAdmin(superAdmin.user.username)).toBe(true);
    expect(staffMfaFingerprint(superAdmin.user.username)).toBe(mfaBefore);
    superAdmin.user = { ...superAdmin.user, password };
    expect(await signInAgain(superAdmin)).toBe('VERIFICATION_REQUIRED');
    opened.push(superAdmin.session);
    await superAdmin.session.verify(superAdmin.authenticator!);
    expect((await superAdmin.session.call('GET', '/api/staff/me')).status()).toBe(200);
  });

  test('E2E-05-14 a closing account resets its password and stays closing', reset, async ({ request }) => {
    const customer = await verifiedCustomer(request);
    const earlier = await signedIn(customer);
    setAccountState(customer.username, 'CLOSURE_REQUESTED');

    const code = await resetCode(request, customer.email);
    expect((await earlier.refresh()).status()).toBe(200);
    const password = newPassword();
    await expectReset(await confirmReset(request, { email: customer.email, code, newPassword: password }));

    await expectRevoked(earlier);
    const after = await signedIn({ ...customer, password });
    const profile = await readProfile(after);
    expect(profile.accountState).toBe('CLOSURE_REQUESTED');
    expect(profile.emailVerified).toBe(true);
    await expectClosing(await saveProfile(after, { fullName: 'Still Closing' }));
  });

  test('E2E-05-15 the reset code mail and the password-changed notice carry only what they must', reset, async ({ request }) => {
    const customer = await verifiedCustomer(request);
    const codeMail = await readCapturedMail(customer.email, 'PASSWORD_RESET_CODE', { nth: 1, timeoutMs: 0 })
      .catch(() => null);
    expect(codeMail === null, 'no reset mail before the request').toBe(true);

    await expectAccepted(await requestReset(request, customer.email));
    const mail = await readCapturedMail(customer.email, 'PASSWORD_RESET_CODE');
    const code = codeFrom(mail.body);
    expect(mail.subject.trim().length, 'reset mail subject is nonempty').toBeGreaterThan(0);
    // The lifetime, read with the code taken out so the code's own digits cannot satisfy it.
    expect(/\b15\b[^0-9]*minute/i.test(mail.body.replace(code, '')), 'reset mail states the lifetime').toBe(true);
    expect(/https?:\/\//.test(mail.body), 'reset mail has no link').toBe(false);
    expect(mail.body.includes(customer.password), 'reset mail has no password').toBe(false);

    const password = newPassword();
    await expectReset(await confirmReset(request, { email: customer.email, code, newPassword: password }));

    const notice = await readCapturedMail(customer.email, 'PASSWORD_CHANGED');
    expect(notice.subject.trim().length, 'password notice subject is nonempty').toBeGreaterThan(0);
    expect(hasCode(notice.body), 'the notice holds no code').toBe(false);
    for (const secret of [password, customer.password, code])
      expect(notice.body.includes(secret), 'password notice has no secret').toBe(false);
    expect(/https?:\/\//.test(notice.body), 'password notice has no link').toBe(false);
    expect((await settledMail(request, customer.email, 'PASSWORD_CHANGED')).length, 'exactly one notice').toBe(1);
  });

  test('E2E-05-16 unverified, unknown and closing-but-unverified addresses get no mail and no code', reset, async ({ request }) => {
    const unverified = await registerByApi(request, syntheticCustomer());
    const closing = await registerByApi(request, syntheticCustomer());
    setAccountState(closing.username, 'CLOSURE_REQUESTED');
    const unknown = unknownEmail();

    for (const email of [unverified.email, unknown, closing.email, closing.email.toUpperCase()]) {
      await expectAccepted(await requestReset(request, email));
    }
    await expectNoMailFor([unverified.email, unknown, closing.email], resetSentinel(request));
    expect(storedCodes(unverified.username)).toEqual([]);
    expect(storedCodes(closing.username)).toEqual([]);
    expect(auditEventTypes(unverified.username)).not.toContain('PASSWORD_RESET_REQUESTED');

    // A confirm for any of them fails the same way, whatever the code.
    for (const email of [unverified.email, unknown, closing.email]) {
      await expectCodeInvalid(await confirmReset(request, { email, code: '123456', newPassword: newPassword() }));
    }
    await expectSignIn(request, unverified.username, unverified.password);
  });

  test('E2E-05-29 two concurrent confirms of one code: exactly one resets', reset, async ({ request }) => {
    const customer = await verifiedCustomer(request);
    const code = await resetCode(request, customer.email);
    const passwords = [newPassword(), newPassword()];

    const answers = await Promise.all(passwords.map((password) =>
      confirmReset(request, { email: customer.email, code, newPassword: password })));
    expect(answers.map((answer) => answer.status()).sort()).toEqual([204, 400]);
    const winner = answers.findIndex((answer) => answer.status() === 204);
    await expectReset(answers[winner]);
    await expectCodeInvalid(answers[1 - winner]);

    await expectSignIn(request, customer.username, passwords[winner]);
    await expectSignInRefused(request, customer.username, passwords[1 - winner]);
    expect(storedCodes(customer.username)).toEqual([]);
  });

  // -------------------------------------------------------------------------------------------------------------
  // Limits (O2, O7, Q8)
  // -------------------------------------------------------------------------------------------------------------

  test('E2E-05-10 limits: 5 codes an hour counting verification codes, 60 seconds apart, 10 requests per address; all answer 202',
    limits, async ({ request }) => {
      await test.step('one verification code and four reset codes fill the hour; the sixth sends nothing', async () => {
        const customer = await registerByApi(request, syntheticCustomer());
        const session = await signedIn(customer);
        await verificationCode(session, customer.email);
        markEmailVerified(customer.username);

        // Inside the 60-second gap the request is accepted and nothing is sent.
        ageLimits(customer.username, 61);
        let liveCode = await resetCode(request, customer.email);
        const gapCodeIds = storedCodeIds(customer.username, 'PASSWORD_RESET');
        expect(gapCodeIds).toHaveLength(1);
        const gapCodeFingerprint = codeRowFingerprint(customer.username, 'PASSWORD_RESET');
        await expectAccepted(await requestReset(request, customer.email));
        expect((await settledMail(request, customer.email, 'PASSWORD_RESET_CODE')).length, 'nothing inside the gap').toBe(1);
        expect(storedCodeIds(customer.username, 'PASSWORD_RESET'), 'the gap keeps the mailed code row').toEqual(gapCodeIds);
        expect(codeRowFingerprint(customer.username, 'PASSWORD_RESET'), 'the gap leaves the mailed code untouched')
          .toBe(gapCodeFingerprint);

        for (let issued = 2; issued <= 4; issued += 1) {
          ageLimits(customer.username, 61);
          liveCode = await resetCode(request, customer.email);
        }
        ageLimits(customer.username, 61);
        const hourCodeIds = storedCodeIds(customer.username, 'PASSWORD_RESET');
        expect(hourCodeIds).toHaveLength(1);
        await expectAccepted(await requestReset(request, customer.email));
        expect((await settledMail(request, customer.email, 'PASSWORD_RESET_CODE')).length, 'the sixth code of the hour').toBe(4);
        expect(storedCodeIds(customer.username, 'PASSWORD_RESET'), 'the hourly limit keeps the mailed code row').toEqual(hourCodeIds);
        await expectReset(await confirmReset(request, { email: customer.email, code: liveCode, newPassword: newPassword() }));

        // A new hour issues again.
        ageLimits(customer.username, 7200);
        await resetCode(request, customer.email);
      });

      await test.step('the eleventh request in an hour for one address sends nothing, in any letter case', async () => {
        const limited = await verifiedCustomer(request);
        const control = await verifiedCustomer(request);
        const variants = (email: string) => [email, email.toUpperCase(), ` ${email} `];

        for (let sent = 0; sent < 10; sent += 1) {
          await expectAccepted(await requestReset(request, variants(limited.email)[sent % 3]));
        }
        for (let sent = 0; sent < 9; sent += 1) {
          await expectAccepted(await requestReset(request, variants(control.email)[sent % 3]));
        }
        // Only the first request of each issued a code (the rest fell inside the 60-second gap); clear the account
        // windows so only the address window can still refuse.
        ageLimits(limited.username, 7200);
        ageLimits(control.username, 7200);

        const addressCodeIds = storedCodeIds(limited.username, 'PASSWORD_RESET');
        expect(addressCodeIds).toHaveLength(1);
        await expectAccepted(await requestReset(request, limited.email));
        await expectAccepted(await requestReset(request, control.email));
        expect((await settledMail(request, limited.email, 'PASSWORD_RESET_CODE')).length, 'the eleventh request').toBe(1);
        expect(capturedMail({ to: control.email, kind: 'PASSWORD_RESET_CODE' }).length, 'the tenth request').toBe(2);
        expect(storedCodeIds(limited.username, 'PASSWORD_RESET'), 'the address limit keeps the mailed code row').toEqual(addressCodeIds);
        const liveCode = await mailedCode(limited.email, 'PASSWORD_RESET_CODE', 1);
        await expectReset(await confirmReset(request, { email: limited.email, code: liveCode, newPassword: newPassword() }));
      });
    });

  test('E2E-05-20 verification and reset codes share one issue limit: 5 an hour, 60 seconds apart', limits, async ({ request }) => {
    const customer = await registerByApi(request, syntheticCustomer());
    const session = await signedIn(customer);

    await verificationCode(session, customer.email);
    expect(storedCodeIds(customer.username, 'EMAIL_VERIFICATION'), 'a live verification code before the gap')
      .toHaveLength(1);
    const verificationGapFingerprint = codeRowFingerprint(customer.username, 'EMAIL_VERIFICATION');
    await expectTooMany(await requestVerification(session));
    expect(codeRowFingerprint(customer.username, 'EMAIL_VERIFICATION'), 'the gap leaves the verification code untouched')
      .toBe(verificationGapFingerprint);
    for (let issued = 2; issued <= 3; issued += 1) {
      ageLimits(customer.username, 61);
      await verificationCode(session, customer.email);
    }

    ageLimits(customer.username, 61);
    markEmailVerified(customer.username);
    await resetCode(request, customer.email);
    // A reset code also starts the shared 60-second gap.
    markEmailUnverified(customer.username);
    expect(storedCodeIds(customer.username, 'PASSWORD_RESET'), 'a live reset code before the cross-purpose gap')
      .toHaveLength(1);
    const resetGapFingerprint = codeRowFingerprint(customer.username, 'PASSWORD_RESET');
    await expectTooMany(await requestVerification(session));
    expect(codeRowFingerprint(customer.username, 'PASSWORD_RESET'), 'the cross-purpose gap leaves the reset code untouched')
      .toBe(resetGapFingerprint);

    ageLimits(customer.username, 61);
    markEmailVerified(customer.username);
    const liveCode = await resetCode(request, customer.email);

    // Five codes (three verification, two reset) fill the hour for both purposes.
    ageLimits(customer.username, 61);
    markEmailUnverified(customer.username);
    await expectTooMany(await requestVerification(session));
    markEmailVerified(customer.username);
    const limitedCodeIds = storedCodeIds(customer.username, 'PASSWORD_RESET');
    expect(limitedCodeIds).toHaveLength(1);
    await expectAccepted(await requestReset(request, customer.email));
    expect((await settledMail(request, customer.email, 'PASSWORD_RESET_CODE')).length, 'reset mail count').toBe(2);
    expect(capturedMail({ to: customer.email, kind: 'EMAIL_VERIFICATION_CODE' }).length, 'verification mail count').toBe(3);
    expect(storedCodeIds(customer.username, 'PASSWORD_RESET'), 'the shared limit keeps the mailed code row').toEqual(limitedCodeIds);
    await expectReset(await confirmReset(request, { email: customer.email, code: liveCode, newPassword: newPassword() }));

    ageLimits(customer.username, 7200);
    await resetCode(request, customer.email);
  });

  test('E2E-05-26 five wrong current passwords in an hour refuse even the right one; a right one resets the count',
    limits, async ({ request }) => {
      await test.step('the sixth attempt is 429 whatever it holds; name edits still work; a new hour clears it', async () => {
        const customer = await registerByApi(request, syntheticCustomer());
        const session = await signedIn(customer);
        const target = freshEmail();

        for (const wrong of ['', 'wrong-1', 'wrong-2', 'wrong-3', 'wrong-4']) {
          await expectPasswordInvalid(await saveProfile(session, { email: target, currentPassword: wrong }));
        }
        await expectTooMany(await saveProfile(session, { email: target, currentPassword: customer.password }));
        expect(storedEmailState(customer.username).email).toBe(customer.email);

        expect((await expectRecoveryProfile(await saveProfile(session, { fullName: 'Limited Not Locked' }))).fullName)
          .toBe('Limited Not Locked');

        expect(agePasswordLimit(customer.username)).toBe(1);
        expect((await expectRecoveryProfile(await saveProfile(session, { email: target, currentPassword: customer.password })))
          .email).toBe(target);
      });

      await test.step('four wrong, then the right one, start the count again', async () => {
        const customer = await registerByApi(request, syntheticCustomer());
        const session = await signedIn(customer);
        for (let round = 1; round <= 2; round += 1) {
          const target = freshEmail();
          for (let wrong = 1; wrong <= 4; wrong += 1) {
            await expectPasswordInvalid(await saveProfile(session, { email: target, currentPassword: `wrong-${round}-${wrong}` }));
          }
          expect((await expectRecoveryProfile(await saveProfile(session, { email: target, currentPassword: customer.password })))
            .email).toBe(target);
        }
      });
    });

  // -------------------------------------------------------------------------------------------------------------
  // Email verification (Bearer routes)
  // -------------------------------------------------------------------------------------------------------------

  test('E2E-05-17 verifying the saved email: 204, a mailed code, then a verified profile at the same version',
    verify, async ({ request }) => {
      const customer = await registerByApi(request, syntheticCustomer());
      const session = await signedIn(customer);
      const before = await readProfile(session);
      expect(before.emailVerified).toBe(false);

      // The route ignores any body.
      await expectNoContent(await requestVerification(session, { code: '000000', email: freshEmail() }));
      const mail = await readCapturedMail(customer.email, 'EMAIL_VERIFICATION_CODE');
      const code = codeFrom(mail.body);
      expect(mail.subject.trim().length, 'verification mail subject is nonempty').toBeGreaterThan(0);
      expect(/\b15\b[^0-9]*minute/i.test(mail.body.replace(code, '')), 'verification mail states the lifetime').toBe(true);
      expect(/https?:\/\//.test(mail.body), 'verification mail has no link').toBe(false);
      expect(mail.body.includes(customer.password), 'verification mail has no password').toBe(false);
      expect(storedCodes(customer.username)).toEqual([{ purpose: 'EMAIL_VERIFICATION', sentTo: customer.email, failedAttempts: 0 }]);
      expect(codeHashesWellFormed(customer.username)).toBe(true);

      const verified = await expectRecoveryProfile(await confirmVerification(session, code));
      expect(verified).toEqual({ ...before, emailVerified: true });
      expect(storedCodes(customer.username)).toEqual([]);
      expect(storedEmailState(customer.username)).toEqual({ email: customer.email, emailVerified: true });

      // Confirming again is idempotent and still does not bump the version.
      expect(await expectRecoveryProfile(await confirmVerification(session, code))).toEqual(verified);
      expect(await readProfile(session)).toEqual(verified);
      const audit = auditEventTypes(customer.username);
      expect(audit).toContain('EMAIL_VERIFICATION_REQUESTED');
      expect(audit).toContain('EMAIL_VERIFIED');

      // The verified address now receives reset codes.
      ageLimits(customer.username, 61);
      await resetCode(request, customer.email);
    });

  test('E2E-05-18 verification refuses malformed codes without a try; wrong codes count and five void the code',
    verify, async ({ request }) => {
      const customer = await registerByApi(request, syntheticCustomer());
      const session = await signedIn(customer);
      const code = await verificationCode(session, customer.email);

      const malformed: unknown[] = [undefined, Number(code), null, true, [code], code.slice(1), `${code}0`, 'abcdef',
        ` ${code}`, `${code.slice(0, 3)} ${code.slice(3)}`,
        code.replace(/\d/g, (digit) => String.fromCharCode(0xff10 + Number(digit))),
        code.replace(/\d/g, (digit) => String.fromCharCode(0x0660 + Number(digit)))];
      for (const value of malformed) await expectInvalid(await confirmVerification(session, value));
      await expectInvalid(await session.call('POST', verificationConfirmPath, { data: { code, extra: 1 } }));
      for (const raw of ['[]', '{', '', 'null']) {
        await expectInvalid(await session.call('POST', verificationConfirmPath,
          { data: raw, headers: { 'Content-Type': 'application/json' } }));
      }
      await expectInvalid(await session.call('POST', verificationConfirmPath,
        { data: JSON.stringify({ code }), headers: { 'Content-Type': 'text/plain' } }));
      await expectInvalid(await session.call('POST', verificationConfirmPath,
        { data: paddedJson({ code }, bodyLimit + 1), headers: { 'Content-Type': 'application/json' } }));
      expect(storedCodes(customer.username)).toEqual([{ purpose: 'EMAIL_VERIFICATION', sentTo: customer.email, failedAttempts: 0 }]);

      for (let attempt = 1; attempt <= 4; attempt += 1) {
        await expectCodeInvalid(await confirmVerification(session, wrongCode(code, attempt)));
        expect(storedCodes(customer.username)[0]?.failedAttempts).toBe(attempt);
      }
      await expectCodeInvalid(await confirmVerification(session, wrongCode(code, 5)));
      expect(storedCodes(customer.username), 'the fifth wrong try deletes the code').toEqual([]);
      await expectCodeInvalid(await confirmVerification(session, code));
      expect((await readProfile(session)).emailVerified).toBe(false);
      expect(auditEventTypes(customer.username)).toContain('ACCOUNT_CODE_LOCKED');

      ageLimits(customer.username, 61);
      const fresh = await verificationCode(session, customer.email);
      expect((await expectRecoveryProfile(await confirmVerification(session, fresh))).emailVerified).toBe(true);
    });

  test('E2E-05-19 verification needs a saved email; an already verified email gets 204 and no mail', verify, async ({ request }) => {
    await test.step('no saved email: both routes answer 409 EMAIL_REQUIRED', async () => {
      const noEmail = await registerWithoutEmail(request);
      const session = await signedIn(noEmail);
      const profile = await readProfile(session);
      expect(profile.email).toBeNull();
      expect(profile.emailVerified).toBe(false);
      await expectEmailRequired(await requestVerification(session));
      await expectEmailRequired(await confirmVerification(session, '123456'));
      expect(storedCodes(noEmail.username)).toEqual([]);
    });

    await test.step('already verified: 204, nothing sent, nothing issued; confirm answers the verified profile', async () => {
      const customer = await verifiedCustomer(request);
      const session = await signedIn(customer);
      await expectNoContent(await requestVerification(session));
      expect(storedCodes(customer.username)).toEqual([]);
      // Nothing was issued, so no 60-second gap blocks an immediate reset code.
      await resetCode(request, customer.email);
      expect(capturedMail({ to: customer.email, kind: 'EMAIL_VERIFICATION_CODE' }).length, 'no verification mail').toBe(0);
      const profile = await expectRecoveryProfile(await confirmVerification(session, '123456'));
      expect(profile.emailVerified).toBe(true);
      expect(storedCodes(customer.username).map((code) => code.purpose), 'the reset code is untouched')
        .toEqual(['PASSWORD_RESET']);
    });
  });

  test('E2E-05-21 a closing account can neither request nor confirm verification', verify, async ({ request }) => {
    const customer = await registerByApi(request, syntheticCustomer());
    const session = await signedIn(customer);
    const code = await verificationCode(session, customer.email);
    setAccountState(customer.username, 'CLOSURE_REQUESTED');
    ageLimits(customer.username, 61);

    await expectClosing(await requestVerification(session));
    await expectClosing(await confirmVerification(session, code));
    expect(storedEmailState(customer.username).emailVerified).toBe(false);
    expect((await settledMail(request, customer.email, 'EMAIL_VERIFICATION_CODE')).length, 'only the code sent before closing')
      .toBe(1);
  });

  // -------------------------------------------------------------------------------------------------------------
  // Email change (PUT /profile with currentPassword)
  // -------------------------------------------------------------------------------------------------------------

  test('E2E-05-22 changing the email needs the current password; a success clears the verified mark', emailChange, async ({ request }) => {
    const customer = await verifiedCustomer(request);
    const session = await signedIn(customer);
    const before = await readProfile(session);
    expect(before.emailVerified).toBe(true);
    const target = freshEmail();

    // Shape refusals come before the password check and are not counted against the limit.
    for (const malformed of [123, true, { value: customer.password }, [customer.password], 'p'.repeat(129)]) {
      await expectInvalid(await saveProfile(session, { email: target, currentPassword: malformed }));
      await expectInvalid(await saveProfile(session, { fullName: 'Shape Only', currentPassword: malformed }));
    }
    for (const refused of [undefined, null, '   ', `${customer.password}x`]) {
      await expectPasswordInvalid(await saveProfile(session, { email: target, currentPassword: refused }));
      expect(storedEmailState(customer.username)).toEqual({ email: customer.email, emailVerified: true });
      expect((await readProfile(session)).version).toBe(before.version);
    }

    const changed = await expectRecoveryProfile(await saveProfile(session, { email: target, currentPassword: customer.password }));
    expect(changed).toEqual({ ...before, email: target, emailVerified: false, version: before.version + 1 });
    expect(storedEmailState(customer.username)).toEqual({ email: target, emailVerified: false });
    const audit = auditEventTypes(customer.username);
    expect(audit.filter((type) => type === 'CURRENT_PASSWORD_FAILED')).toHaveLength(4);
    expect(audit).toContain('EMAIL_CHANGED');
  });

  test('E2E-05-23 an email change cancels outstanding reset and verification codes', emailChange, async ({ request }) => {
    const customer = await registerByApi(request, syntheticCustomer());
    const session = await signedIn(customer);
    const verification = await verificationCode(session, customer.email);
    ageLimits(customer.username, 61);
    markEmailVerified(customer.username);
    const resetting = await resetCode(request, customer.email);
    expect(storedCodes(customer.username)).toHaveLength(2);

    const target = freshEmail();
    await expectRecoveryProfile(await saveProfile(session, { email: target, currentPassword: customer.password }));
    expect(storedCodes(customer.username)).toEqual([]);

    await expectCodeInvalid(await confirmReset(request, { email: customer.email, code: resetting, newPassword: newPassword() }));
    await expectCodeInvalid(await confirmReset(request, { email: target, code: resetting, newPassword: newPassword() }));
    await expectCodeInvalid(await confirmVerification(session, verification));
    expect(storedEmailState(customer.username)).toEqual({ email: target, emailVerified: false });
    await expectSignIn(request, customer.username, customer.password);

    // The new address verifies with a new code.
    ageLimits(customer.username, 61);
    const fresh = await verificationCode(session, target);
    expect(storedCodes(customer.username)).toEqual([{ purpose: 'EMAIL_VERIFICATION', sentTo: target, failedAttempts: 0 }]);
    expect((await expectRecoveryProfile(await confirmVerification(session, fresh))).emailVerified).toBe(true);
  });

  test('E2E-05-24 an email change notifies the old address only when it was verified', emailChange, async ({ request }) => {
    const customer = await verifiedCustomer(request);
    const session = await signedIn(customer);
    const second = freshEmail();
    await expectRecoveryProfile(await saveProfile(session, { email: second, currentPassword: customer.password }));

    const notice = await readCapturedMail(customer.email, 'EMAIL_CHANGED');
    expect(notice.subject.trim().length, 'email-change notice subject is nonempty').toBeGreaterThan(0);
    expect(hasCode(notice.body), 'the notice holds no code').toBe(false);
    expect(notice.body.includes(customer.password), 'email-change notice has no password').toBe(false);
    expect(/https?:\/\//.test(notice.body), 'email-change notice has no link').toBe(false);

    // The second address was never verified: changing away from it sends no notice anywhere.
    const third = freshEmail();
    await expectRecoveryProfile(await saveProfile(session, { email: third, currentPassword: customer.password }));
    await expectNoMailFor([second, third], resetSentinel(request));
    expect(capturedMail({ to: customer.email, kind: 'EMAIL_CHANGED' }).length, 'exactly one notice').toBe(1);
  });

  test('E2E-05-25 clearing the email needs the password and ends recovery through that address', emailChange, async ({ request }) => {
    const customer = await verifiedCustomer(request);
    const session = await signedIn(customer);

    await expectPasswordInvalid(await saveProfile(session, { email: null }));
    expect(storedEmailState(customer.username)).toEqual({ email: customer.email, emailVerified: true });
    const cleared = await expectRecoveryProfile(await saveProfile(session, { email: null, currentPassword: customer.password }));
    expect(cleared.email).toBeNull();
    expect(cleared.emailVerified).toBe(false);
    await readCapturedMail(customer.email, 'EMAIL_CHANGED');

    ageLimits(customer.username, 61);
    await expectAccepted(await requestReset(request, customer.email));
    expect((await settledMail(request, customer.email, 'PASSWORD_RESET_CODE')).length, 'the old address gets no code').toBe(0);
    expect(storedCodes(customer.username)).toEqual([]);
    await expectEmailRequired(await requestVerification(session));
    await expectEmailRequired(await confirmVerification(session, '123456'));

    // Setting an email again also needs the password.
    const target = freshEmail();
    await expectPasswordInvalid(await saveProfile(session, { email: target }));
    expect((await expectRecoveryProfile(await saveProfile(session, { email: target, currentPassword: customer.password })))
      .email).toBe(target);
  });

  test('E2E-05-27 name and date edits need no password; an unchanged email in any case is a no-op; the Ticket 11 order holds',
    emailChange, async ({ request }) => {
      const customer = await verifiedCustomer(request);
      const session = await signedIn(customer);
      const start = await readProfile(session);

      // A wrong password on an edit that keeps the email is ignored and never counted.
      for (let edit = 1; edit <= 6; edit += 1) {
        expect((await expectRecoveryProfile(await saveProfile(session,
          { fullName: `No Password ${edit}`, currentPassword: `wrong-${edit}` }))).fullName).toBe(`No Password ${edit}`);
      }
      const dated = await expectRecoveryProfile(await saveProfile(session, { dateOfBirth: '1990-01-31' }));
      expect(dated.dateOfBirth).toBe('1990-01-31');
      expect(dated.version).toBe(start.version + 7);

      // The same address in another case, padded, is the stored value: a no-op that keeps the verified mark.
      const same = await expectRecoveryProfile(await saveProfile(session, { email: ` ${customer.email.toUpperCase()} ` }));
      expect(same).toEqual(dated);
      const renamed = await expectRecoveryProfile(await saveProfile(session,
        { email: customer.email.toUpperCase(), fullName: 'Same Email' }));
      expect(renamed).toMatchObject({ email: customer.email, emailVerified: true, version: dated.version + 1 });

      // Order: validation, then version, then the password, then uniqueness, all before any write.
      const holder = await registerByApi(request, syntheticCustomer());
      await expectInvalid(await saveProfile(session, { email: 'not-an-email' }));
      await expectError(await session.call('PUT', profilePath, { data: { ...await profileBody(session, {}),
        email: freshEmail(), version: renamed.version - 1 } }), 409, 'STALE_UPDATE', copy.staleApi);
      await expectPasswordInvalid(await saveProfile(session, { email: holder.email.toUpperCase() }));
      await expectError(await saveProfile(session, { email: holder.email, currentPassword: customer.password }), 409,
        'DUPLICATE_USER', copy.duplicateUser);
      expect(storedEmailState(customer.username)).toEqual({ email: customer.email, emailVerified: true });

      // The account state comes first of all.
      setAccountState(customer.username, 'CLOSURE_REQUESTED');
      await expectClosing(await saveProfile(session, { email: freshEmail(), currentPassword: customer.password }));
      await expectClosing(await saveProfile(session, { email: freshEmail() }));
      expect(storedEmailState(customer.username)).toEqual({ email: customer.email, emailVerified: true });
    });

  test('E2E-05-31 an email change revokes the other sessions and keeps the current one; nothing else revokes',
    emailChange, async ({ request }) => {
      const customer = await registerByApi(request, syntheticCustomer());
      const current = await signedIn(customer);
      const other = await signedIn(customer);
      const allActive = () => sessionStates(customer.username).every((state) => state === 'active');

      await expectPasswordInvalid(await saveProfile(current, { email: freshEmail(), currentPassword: 'wrong-password' }));
      await expectRecoveryProfile(await saveProfile(current, { fullName: 'Kept Sessions' }));
      await expectRecoveryProfile(await saveProfile(current, { email: customer.email.toUpperCase() }));
      await expectRecoveryProfile(await confirmVerification(current, await verificationCode(current, customer.email)));
      expect(allActive(), 'a refused change, a name save, a no-op and verification revoke nothing').toBe(true);
      await expectActive(other);

      expect((await other.refresh()).status()).toBe(200);
      const target = freshEmail();
      expect((await expectRecoveryProfile(await saveProfile(current, { email: target, currentPassword: customer.password })))
        .email).toBe(target);
      await expectRevoked(other);
      await expectActive(current);
      const states = sessionStates(customer.username);
      expect(states.filter((state) => state === 'active'), 'only the current session stays').toHaveLength(1);
      expect(states.filter((state) => state !== 'active').every((state) => state === 'email-changed')).toBe(true);

      // Clearing the email is a change too.
      const third = await signedIn(customer);
      await expectRecoveryProfile(await saveProfile(current, { email: null, currentPassword: customer.password }));
      await expectRevoked(third);
      await expectActive(current);
    });

  // -------------------------------------------------------------------------------------------------------------
  // Authorization and privacy
  // -------------------------------------------------------------------------------------------------------------

  test('E2E-05-28 verification routes need a signed-in, MFA-verified User of any role; reset routes ignore tokens; CORS',
    authz, async ({ request }) => {
      await test.step('anonymous and invalid tokens: 401', async () => {
        for (const path of [verificationPath, verificationConfirmPath]) {
          for (const headers of [{}, { Authorization: 'Bearer not-a-token' }] as Record<string, string>[]) {
            const answer = await request.post(`${apiUrl}${path}`, { headers, data: { code: '123456' } });
            await expectAuthenticationRequired(answer);
            expect(answer.headers()['www-authenticate']).toBe('Bearer');
          }
        }
      });

      await test.step('restricted staff sessions: 403 MFA_REQUIRED, nothing sent', async () => {
        const enrolling = await registerByApi(request, syntheticCustomer());
        grantRole(enrolling.username, 'ADMIN');
        const enrollingSession = await signedIn(enrolling);
        expect(enrollingSession.mfa).toBe('ENROLLMENT_REQUIRED');
        await expectMfaRequired(await requestVerification(enrollingSession));
        await expectMfaRequired(await confirmVerification(enrollingSession, '123456'));

        const moderator = tracked(await apiStaff(request, 'MODERATOR'));
        expect(await signInAgain(moderator)).toBe('VERIFICATION_REQUIRED');
        opened.push(moderator.session);
        await expectMfaRequired(await requestVerification(moderator.session));
        await expectMfaRequired(await confirmVerification(moderator.session, '123456'));
        await expectNoMailFor([enrolling.email, moderator.user.email], resetSentinel(request));

        await moderator.session.verify(moderator.authenticator!);
        await verificationCode(moderator.session, moderator.user.email);
      });

      await test.step('a Delivery Person and an MFA-verified Admin verify their own email', async () => {
        for (const role of ['DELIVERY_PERSON', 'ADMIN'] as const) {
          const staff = tracked(await apiStaff(request, role));
          const code = await verificationCode(staff.session, staff.user.email);
          const profile = await expectRecoveryProfile(await confirmVerification(staff.session, code));
          expect(profile).toMatchObject({ username: staff.user.username, emailVerified: true });
        }
      });

      await test.step('the reset routes are public: a token, valid or not, changes nothing', async () => {
        const customer = await verifiedCustomer(request);
        const session = await signedIn(customer);
        for (const headers of [{ Authorization: 'Bearer not-a-token' }, { Authorization: `Bearer ${session.accessToken}` }]) {
          await expectAccepted(await requestReset(request, unknownEmail(), headers));
          await expectCodeInvalid(await confirmReset(request,
            { email: customer.email, code: '123456', newPassword: newPassword() }, headers));
        }
        await expectAccepted(await requestReset(request, customer.email, { Authorization: 'Bearer not-a-token' }));
        await readCapturedMail(customer.email, 'PASSWORD_RESET_CODE');
      });

      await test.step('CORS preflights allow POST from the storefront origin only', async () => {
        const preflight = (path: string, origin = frontendUrl) => request.fetch(`${apiUrl}${path}`, {
          method: 'OPTIONS',
          headers: { Origin: origin, 'Access-Control-Request-Method': 'POST',
            'Access-Control-Request-Headers': 'authorization,content-type' },
        });
        for (const path of [resetRequestPath, resetConfirmPath, verificationPath, verificationConfirmPath]) {
          const answer = await preflight(path);
          expect(answer.status(), path).toBe(200);
          expect(answer.headers()['access-control-allow-origin']).toBe(frontendUrl);
          expect(answer.headers()['access-control-allow-methods'].split(/\s*,\s*/)).toContain('POST');
          expect((await preflight(path, frontendUrl.replace('127.0.0.1', 'localhost'))).status(), path).toBe(403);
        }
      });
    });

  test('E2E-05-30 R1: registration without an email still works, and no code, address or password reaches the log or a public answer',
    privacy, async ({ request }) => {
      const noEmail = await registerWithoutEmail(request);
      expect((await readProfile(await signedIn(noEmail))).email).toBeNull();

      const customer = await registerByApi(request, syntheticCustomer());
      const session = await signedIn(customer);
      const target = freshEmail();
      const password = newPassword();
      const publicAnswers: APIResponse[] = [];
      const signedInAnswers: APIResponse[] = [];
      const before = tableFingerprints(recoveryWritableTables);

      const verification = await verificationCode(session, customer.email);
      signedInAnswers.push(await confirmVerification(session, wrongCode(verification)));
      signedInAnswers.push(await confirmVerification(session, verification));
      ageLimits(customer.username, 61);
      publicAnswers.push(await requestReset(request, customer.email));
      const code = await mailedCode(customer.email, 'PASSWORD_RESET_CODE');
      publicAnswers.push(await confirmReset(request, { email: customer.email, code: wrongCode(code), newPassword: password }));
      publicAnswers.push(await confirmReset(request, { email: customer.email, code, newPassword: password }));
      publicAnswers.push(await confirmReset(request, { email: customer.email, code, newPassword: password }));
      publicAnswers.push(await requestReset(request, customer.email));
      const renewed = await signedIn({ ...customer, password });
      signedInAnswers.push(await saveProfile(renewed, { email: target, currentPassword: customer.password }));
      signedInAnswers.push(await saveProfile(renewed, { email: target, currentPassword: password }));
      await readCapturedMail(customer.email, 'EMAIL_CHANGED');

      expect(tableFingerprints(recoveryWritableTables), 'no other table changed').toEqual(before);

      const secrets = [password, customer.password, code, verification];
      for (const answer of publicAnswers) {
        const text = await answer.text();
        for (const value of [...secrets, customer.email, target])
          expect(text.includes(value), 'a public answer contains no secret or address').toBe(false);
      }
      for (const answer of signedInAnswers) {
        const text = await answer.text();
        for (const value of secrets)
          expect(text.includes(value), 'a signed-in answer contains no secret').toBe(false);
      }

      // The API logs each response status; finding those events proves the scan read the request log.
      const apiLog = readFileSync(apiLogPath, 'utf8');
      expect(apiLog.includes('"message":"HTTP response status='), 'the API log contains response events').toBe(true);
      for (const value of [password, customer.password]) expect(apiLog.includes(value), 'a password in the log').toBe(false);
      for (const mail of capturedMail()) {
        expect(apiLog.toLowerCase().includes(mail.to.toLowerCase()), `a ${mail.kind} address in the log`).toBe(false);
        if (mail.kind === 'EMAIL_VERIFICATION_CODE' || mail.kind === 'PASSWORD_RESET_CODE') {
          expect(codeInLog(apiLog, codeFrom(mail.body)), `a ${mail.kind} code in the log`).toBe(false);
        }
      }
      expect(apiLog.toLowerCase().includes(target.toLowerCase()), 'the new address in the log').toBe(false);
    });

  // -------------------------------------------------------------------------------------------------------------
  // Contract rules of plan §4.3 beyond the §10.4 table (added 2026-10-16 for development targeting)
  // -------------------------------------------------------------------------------------------------------------

  test('E2E-05-32 reset eligibility needs a usable password, checked when the code is asked for and again at confirm',
    reset, async ({ request }) => {
      // At request: a verified address whose User holds an unusable verifier gets the same 202 and nothing else.
      const unusable = await verifiedCustomer(request);
      makePasswordUnusable(unusable.username);
      await expectAccepted(await requestReset(request, unusable.email));
      await expectNoMailFor([unusable.email], resetSentinel(request));
      expect(storedCodes(unusable.username)).toEqual([]);
      expect(auditEventTypes(unusable.username)).not.toContain('PASSWORD_RESET_REQUESTED');

      // At confirm: a code issued while eligible no longer resets once the verifier became unusable.
      const later = await verifiedCustomer(request);
      const code = await resetCode(request, later.email);
      const stored = makePasswordUnusable(later.username);
      await expectCodeInvalid(await confirmReset(request, { email: later.email, code, newPassword: newPassword() }));
      expect(storedPasswordHash(later.username), 'the confirm wrote no password').toBe(stored);
      expect(auditEventTypes(later.username)).not.toContain('PASSWORD_RESET_COMPLETED');
      expect((await settledMail(request, later.email, 'PASSWORD_CHANGED')).length, 'no password-changed notice').toBe(0);
    });

  test('E2E-05-33 eligibility is checked again at confirm: an email unverified after the code was sent cannot reset',
    reset, async ({ request }) => {
      const customer = await verifiedCustomer(request);
      const code = await resetCode(request, customer.email);
      const hash = storedPasswordHash(customer.username);

      markEmailUnverified(customer.username);
      await expectCodeInvalid(await confirmReset(request, { email: customer.email, code, newPassword: newPassword() }));
      expect(storedPasswordHash(customer.username)).toBe(hash);
      await expectSignIn(request, customer.username, customer.password);
      expect(auditEventTypes(customer.username)).not.toContain('PASSWORD_RESET_COMPLETED');

      // An unverified address is not eligible for a new code either (Q1).
      ageLimits(customer.username, 61);
      await expectAccepted(await requestReset(request, customer.email));
      expect((await settledMail(request, customer.email, 'PASSWORD_RESET_CODE')).length, 'only the first code').toBe(1);
    });

  test('E2E-05-34 a code is bound to the address it was sent to: a saved email changed outside the profile route voids it',
    reset, async ({ request }) => {
      await test.step('reset: the old address finds no User, and the new address finds a code for another address', async () => {
        const customer = await verifiedCustomer(request);
        const code = await resetCode(request, customer.email);
        const hash = storedPasswordHash(customer.username);
        const moved = freshEmail('moved');
        setStoredEmail(customer.username, moved, true);

        await expectCodeInvalid(await confirmReset(request, { email: customer.email, code, newPassword: newPassword() }));
        await expectCodeInvalid(await confirmReset(request, { email: moved, code, newPassword: newPassword() }));
        expect(storedCodes(customer.username), 'a code for an old address is removed').toEqual([]);
        expect(storedPasswordHash(customer.username)).toBe(hash);

        // A code sent to the saved address resets.
        ageLimits(customer.username, 61);
        const fresh = await resetCode(request, moved);
        const password = newPassword();
        await expectReset(await confirmReset(request, { email: moved, code: fresh, newPassword: password }));
        await expectSignIn(request, customer.username, password);
        expect((await settledMail(request, moved, 'PASSWORD_CHANGED')).length, 'one notice, to the saved address').toBe(1);
        expect((await settledMail(request, customer.email, 'PASSWORD_CHANGED')).length, 'no notice to the old address').toBe(0);
      });

      await test.step('verification: a code for the old address is refused and removed; a new code verifies the new one', async () => {
        const customer = await registerByApi(request, syntheticCustomer());
        const session = await signedIn(customer);
        const code = await verificationCode(session, customer.email);
        const moved = freshEmail('moved');
        setStoredEmail(customer.username, moved, false);

        await expectCodeInvalid(await confirmVerification(session, code));
        expect(storedCodes(customer.username), 'a code for an old address is removed').toEqual([]);
        expect(storedEmailState(customer.username)).toEqual({ email: moved, emailVerified: false });

        ageLimits(customer.username, 61);
        const fresh = await verificationCode(session, moved);
        const verified = await expectRecoveryProfile(await confirmVerification(session, fresh));
        expect(verified).toMatchObject({ email: moved, emailVerified: true });
        expect(storedEmailState(customer.username)).toEqual({ email: moved, emailVerified: true });
      });
    });

  test('E2E-05-35 an expired verification code is refused and removed; the email stays unverified until a new code',
    verify, async ({ request }) => {
      const customer = await registerByApi(request, syntheticCustomer());
      const session = await signedIn(customer);
      const code = await verificationCode(session, customer.email);
      expireCode(customer.username, 'EMAIL_VERIFICATION');

      await expectCodeInvalid(await confirmVerification(session, code));
      expect(storedCodes(customer.username)).toEqual([]);
      expect(storedEmailState(customer.username).emailVerified).toBe(false);
      expect((await readProfile(session)).emailVerified).toBe(false);

      ageLimits(customer.username, 61);
      const fresh = await verificationCode(session, customer.email);
      expect((await expectRecoveryProfile(await confirmVerification(session, fresh))).emailVerified).toBe(true);
    });

  test('E2E-05-36 a reset changes only the password: the profile, its version and the verified mark stay, and every code goes',
    reset, async ({ request }) => {
      const customer = await registerByApi(request, syntheticCustomer());
      const session = await signedIn(customer);
      await expectRecoveryProfile(await saveProfile(session, { fullName: 'Kept Name' }));
      // A live verification code, then the SQL fixture makes the address verified so a reset code can join it.
      await verificationCode(session, customer.email);
      ageLimits(customer.username, 61);
      markEmailVerified(customer.username);
      const before = await readProfile(session);
      expect(before).toMatchObject({ fullName: 'Kept Name', emailVerified: true, accountState: 'ACTIVE' });
      const code = await resetCode(request, customer.email);
      expect(storedCodes(customer.username).map((stored) => stored.purpose)).toEqual(['EMAIL_VERIFICATION', 'PASSWORD_RESET']);

      const password = newPassword();
      await expectReset(await confirmReset(request, { email: customer.email, code, newPassword: password }));

      expect(storedCodes(customer.username), 'a reset removes the codes of both purposes').toEqual([]);
      expect(storedEmailState(customer.username)).toEqual({ email: customer.email, emailVerified: true });
      const renewed = await signedIn({ ...customer, password });
      expect(await readProfile(renewed), 'the same profile at the same version').toEqual(before);
    });
});
