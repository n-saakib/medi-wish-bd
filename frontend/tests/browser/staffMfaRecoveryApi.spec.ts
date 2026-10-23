import { readFileSync } from 'node:fs';
import { expect, test, type APIResponse } from '@playwright/test';
import {
  ApiSession, apiCustomer, apiStaff, apiSuperAdmin, changeRole, expectActive, expectError, expectRevoked, findUser,
  readUserRoles, signInAgain, type ApiActor, type ErrorCode,
} from './apiSession';
import {
  activeSessions, apiRecoveryStaff, auditCount, auditText, auditTypes, backupCodePattern, consumedSessionIds,
  enrollmentStartFields, expireReplacementSessions, factorRows, factorStatuses, firstEnrollmentFields, passwordSession,
  redeem, refreshCookieMaxAge, regenerate, replaceThroughApi, replacementFields, replacementLifetimeSeconds,
  revokeActiveFactorLikeTicket10, roleOf, sendRaw, sessionFields, sessionRows, startEnrollment, startedEnrollment,
  throttleState, userProfileFields, verifyChallenge, verifyEnrollment, wrongBackupCode, wrongTotp, type RecoveryActor,
} from './staffMfaRecoverySupport';
import { freshCode, registerThroughApi } from './support';
import { accessTokenLifetimeMs, apiLogPath, apiUrl, grantRole, markMobileVerified, removeRole } from './testApi';
import { totpCode, totpStep } from './totp';

/**
 * Ticket 09 at the API: backup-code recovery, replacement enrollment and backup-code regeneration exercised directly
 * against the test API, as a script would, without the pages (plan §4.2, frozen API contract and actor table in
 * `09.T1-contract-evidence.md`). Each test registers its own synthetic Users, so one test's throttle never reaches
 * another. Tags: `@t09` plus `@t09-T4`, the sub-ticket whose routes make these pass (T2's services are needed too).
 *
 * Run while developing the backend: build the jar (`.\mvnw.cmd -o package -DskipTests`), then
 * `npm run test:browser -- --grep "@t09-T4" --project chrome`.
 */

const t4 = { tag: ['@t09', '@t09-T4'] };
const security = { tag: ['@t09', '@t09-T4', '@security'] };
const concurrency = { tag: ['@t09', '@t09-T4', '@concurrency'] };
const crossRoles = { tag: ['@t09', '@t09-T4', '@cross-08-09'] };
const cross06 = { tag: ['@t09', '@t09-T4', '@cross-06-09', '@regression'] };

const recoveryPath = '/api/auth/mfa/recovery';
const backupCodesPath = '/api/auth/mfa/backup-codes';
const enrollmentPath = '/api/auth/mfa/enrollment';
const enrollmentVerifyPath = '/api/auth/mfa/enrollment/verify';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A 200 with `Cache-Control: no-store` and exactly `fields`; returns the body. */
async function expectBody(response: APIResponse, fields: string[]): Promise<Record<string, unknown>> {
  expect(response.status(), `status of ${new URL(response.url()).pathname}`).toBe(200);
  expect(response.headers()['cache-control']).toBe('no-store');
  const body = await response.json() as Record<string, unknown>;
  expect(Object.keys(body).sort()).toEqual(fields);
  return body;
}

/** Ten distinct `XXXX-XXXX` codes, none of them in `previous`. */
function expectFreshCodes(codes: unknown, previous: readonly string[] = []): string[] {
  expect(Array.isArray(codes)).toBe(true);
  const list = codes as string[];
  expect(list).toHaveLength(10);
  for (const code of list) expect(code).toMatch(backupCodePattern);
  expect(new Set(list).size).toBe(10);
  expect(list.filter((code) => previous.includes(code))).toEqual([]);
  return list;
}

/** The `code` and `message` of an error body, without its per-request id. */
async function errorShape(response: APIResponse): Promise<{ code: unknown; message: unknown }> {
  const { code, message } = await response.json() as Record<string, unknown>;
  return { code, message };
}

async function disposeAll(...sessions: (ApiSession | ApiActor | undefined)[]): Promise<void> {
  for (const item of sessions) {
    if (!item) continue;
    await ('session' in item ? item.session : item).dispose();
  }
}

/** Uses `code` from a new password-only session of `actor`; returns that session, now REPLACEMENT_REQUIRED. */
async function replacementSession(actor: RecoveryActor, code = actor.backupCodes[0]): Promise<ApiSession> {
  const session = await passwordSession(actor);
  expect((await redeem(session, code)).status(), 'backup code accepted').toBe(200);
  expect(session.mfa).toBe('REPLACEMENT_REQUIRED');
  return session;
}

// ---------------------------------------------------------------------------------------------------------------------
// Using a backup code: the replacement session
// ---------------------------------------------------------------------------------------------------------------------

test('E2E-09-20 a backup code turns a password-only session into a 10-minute replacement session', t4,
  async ({ request }) => {
    const actor = await apiRecoveryStaff(request);
    const { username } = actor.user;
    const restricted = await passwordSession(actor);
    const restrictedRow = sessionRows(username).at(-1)!;
    const restrictedToken = restricted.accessToken;

    const response = await redeem(restricted, actor.backupCodes[0]);
    const body = await expectBody(response, sessionFields);

    await test.step('the body is a session body reporting REPLACEMENT_REQUIRED, with a short refresh cookie', () => {
      expect(body).toMatchObject({ tokenType: 'Bearer', mfa: 'REPLACEMENT_REQUIRED' });
      expect(typeof body.accessToken).toBe('string');
      expect(body.accessToken).not.toBe(restrictedToken);
      expect(Object.keys(body.user as object).sort()).toEqual(userProfileFields);
      expect(body.user).toEqual({ username, mobile: actor.user.mobile, email: actor.user.email, mobileVerified: true });
      // `expiresIn` is the access-token lifetime, capped by the session's 10-minute expiry.
      expect(body.expiresIn).toBeGreaterThan(0);
      expect(body.expiresIn).toBeLessThanOrEqual(replacementLifetimeSeconds);
      const maxAge = refreshCookieMaxAge(response);
      expect(maxAge, 'a refresh cookie is set').not.toBeNull();
      expect(maxAge!).toBeGreaterThan(replacementLifetimeSeconds - 30);
      expect(maxAge!).toBeLessThanOrEqual(replacementLifetimeSeconds);
    });

    await test.step('the database holds one replacement session bound to the still-active factor', () => {
      const [factor] = factorRows(username);
      expect(factor, 'P3: the old authenticator stays active until the replacement is verified')
        .toMatchObject({ status: 'ACTIVE', unusedCodes: 9, usedCodes: 1 });
      const sessions = sessionRows(username);
      expect(sessions.find(({ id }) => id === restrictedRow.id)?.state).toBe('mfa-replacement-started');
      const replacing = sessions.filter(({ replacingFactorId }) => replacingFactorId !== null);
      expect(replacing).toHaveLength(1);
      expect(replacing[0]).toMatchObject({ state: 'active', replacingFactorId: factor.id, verified: false });
      expect(replacing[0].lifetimeSeconds).toBeGreaterThan(replacementLifetimeSeconds - 5);
      expect(replacing[0].lifetimeSeconds).toBeLessThanOrEqual(replacementLifetimeSeconds);
      expect(consumedSessionIds(username), 'C2: the code records the session that presented it').toEqual([restrictedRow.id]);
      expect(auditCount(username, 'MFA_RECOVERY_STARTED')).toBe(1);
      expect(throttleState(username).failedCount).toBe(0);
    });

    await test.step('the restricted token it replaced is revoked; the earlier verified session is untouched', async () => {
      await expectError(await restricted.call('GET', '/api/user/me', { token: restrictedToken }), 401,
        'AUTHENTICATION_REQUIRED');
      await expectActive(actor.session);
    });

    await test.step('the replacement token reaches no staff, profile or other MFA route', async () => {
      const denied: [method: 'GET' | 'POST', path: string, data?: unknown][] = [
        ['GET', '/api/staff/me'],
        ['GET', '/api/user/me'],
        ['GET', '/api/staff/products'],
        ['POST', '/api/admin/users/search', {}],
        ['POST', '/api/auth/mfa/verify', { code: totpCode(actor.authenticator.key, totpStep()) }],
        ['POST', recoveryPath, { backupCode: actor.backupCodes[1] }],
        ['POST', backupCodesPath, { code: totpCode(actor.authenticator.key, totpStep()) }],
      ];
      for (const [method, path, data] of denied) {
        await expectError(await restricted.call(method, path, { data }), 403, 'MFA_REQUIRED');
      }
      // Being refused by authorization never spends a code or counts a failure.
      expect(factorRows(username)[0]).toMatchObject({ unusedCodes: 9, usedCodes: 1 });
      expect(throttleState(username).failedCount).toBe(0);
    });

    await test.step('refresh keeps REPLACEMENT_REQUIRED and never moves the expiry', async () => {
      const expiresAt = sessionRows(username).find(({ replacingFactorId }) => replacingFactorId)!.expiresAt;
      let previousMaxAge = refreshCookieMaxAge(response)!;
      for (let round = 0; round < 2; round += 1) {
        const refreshed = await restricted.refresh();
        expect(refreshed.status()).toBe(200);
        expect(restricted.mfa).toBe('REPLACEMENT_REQUIRED');
        const maxAge = refreshCookieMaxAge(refreshed);
        expect(maxAge, 'the rotated cookie never outlives the session').not.toBeNull();
        expect(maxAge!).toBeLessThanOrEqual(previousMaxAge);
        previousMaxAge = maxAge!;
      }
      expect(sessionRows(username).find(({ replacingFactorId }) => replacingFactorId)!.expiresAt).toBe(expiresAt);
    });
    await disposeAll(actor, restricted);
  });

test('E2E-09-21 the actor table: only a password-only staff session may use a code, only a verified one regenerate',
  security, async ({ request }) => {
    const anyCode = { backupCode: wrongBackupCode() };
    const anyTotp = { code: '123456' };
    const anyVerify = { enrollmentId: '00000000-0000-4000-8000-000000000000', code: '123456' };
    type Cell = [path: string, data: unknown | undefined, status: number, code: ErrorCode];
    const expectCells = async (call: (path: string, data: unknown) => Promise<APIResponse>, cells: Cell[]) => {
      for (const [path, data, status, code] of cells) await expectError(await call(path, data), status, code);
    };

    await test.step('anonymous: 401 on every route', async () => {
      await expectCells((path, data) => request.post(`${apiUrl}${path}`, { data }), [
        [recoveryPath, anyCode, 401, 'AUTHENTICATION_REQUIRED'],
        [backupCodesPath, anyTotp, 401, 'AUTHENTICATION_REQUIRED'],
        [enrollmentPath, undefined, 401, 'AUTHENTICATION_REQUIRED'],
        [enrollmentVerifyPath, anyVerify, 401, 'AUTHENTICATION_REQUIRED'],
      ]);
    });

    for (const role of ['CUSTOMER', 'DELIVERY_PERSON'] as const) {
      await test.step(`${role}: 403 ACCESS_DENIED on every route`, async () => {
        const actor = role === 'CUSTOMER' ? await apiCustomer(request) : await apiStaff(request, role);
        expect(actor.session.mfa).toBe('NOT_REQUIRED');
        await expectCells((path, data) => actor.session.call('POST', path, { data }), [
          [recoveryPath, anyCode, 403, 'ACCESS_DENIED'],
          [backupCodesPath, anyTotp, 403, 'ACCESS_DENIED'],
          [enrollmentPath, undefined, 403, 'ACCESS_DENIED'],
          [enrollmentVerifyPath, anyVerify, 403, 'ACCESS_DENIED'],
        ]);
        await disposeAll(actor);
      });
    }

    await test.step('staff without a factor (ENROLLMENT_REQUIRED): no code route', async () => {
      const user = await registerThroughApi(request);
      grantRole(user.username, 'ADMIN');
      const session = await ApiSession.signIn(user);
      expect(session.mfa).toBe('ENROLLMENT_REQUIRED');
      await expectCells((path, data) => session.call('POST', path, { data, token: session.accessToken }), [
        [recoveryPath, anyCode, 403, 'MFA_REQUIRED'],
        [backupCodesPath, anyTotp, 403, 'MFA_REQUIRED'],
      ]);
      expect(throttleState(user.username).failedCount).toBe(0);
      await session.dispose();
    });

    const actor = await apiRecoveryStaff(request);
    await test.step('password-only staff (VERIFICATION_REQUIRED): no enrollment or regeneration', async () => {
      const session = await passwordSession(actor);
      await expectCells((path, data) => session.call('POST', path, { data, token: session.accessToken }), [
        [backupCodesPath, anyTotp, 403, 'MFA_REQUIRED'],
        [enrollmentPath, undefined, 403, 'MFA_REQUIRED'],
        [enrollmentVerifyPath, anyVerify, 403, 'MFA_REQUIRED'],
      ]);
      await session.dispose();
    });

    await test.step('verified staff: no code use and no enrollment', async () => {
      await expectCells((path, data) => actor.session.call('POST', path, { data }), [
        [recoveryPath, anyCode, 403, 'ACCESS_DENIED'],
        [enrollmentPath, undefined, 403, 'ACCESS_DENIED'],
        [enrollmentVerifyPath, anyVerify, 403, 'ACCESS_DENIED'],
      ]);
    });
    expect(factorRows(actor.user.username)[0], 'no refused call spent a code')
      .toMatchObject({ status: 'ACTIVE', unusedCodes: 10, usedCodes: 0 });
    expect(throttleState(actor.user.username).failedCount, 'no refused call counted a failure').toBe(0);
    await disposeAll(actor);
  });

test('E2E-09-22 malformed recovery bodies and codes are 400 INVALID_REQUEST and never counted', security,
  async ({ request }) => {
    const actor = await apiRecoveryStaff(request);
    const session = await passwordSession(actor);
    const bodies = [
      '{}', '[]', 'null', '"ABCD-2345"', '{"backupCode":12345678}', '{"backupCode":null}', '{"backupCode":true}',
      '{"backupCode":["ABCD-2345"]}', '{"backupCode":{"code":"ABCD-2345"}}', '{"backupCode":"ABCD-2345","extra":1}',
      '{"backupCode":"ABCD-2345","code":"123456"}', '{"code":"123456"}', '{"backupcode":"ABCD-2345"}',
      '{"backupCode":"ABCD-2345"', 'backupCode=ABCD-2345', '',
    ];
    // Well-shaped bodies whose code is not D4's format: wrong length, look-alikes (I L O U 0 1), two separators,
    // another separator, non-ASCII and full-width characters, and a long value.
    const codes = [
      '', ' ', 'ABCD-234', 'ABCD-23456', 'ABCD2345X', 'ABCI-2345', 'ABCL-2345', 'ABCO-2345', 'ABCU-2345', 'ABC0-2345',
      'ABC1-2345', 'ABCD--2345', '-ABCD-2345', 'AB-CD-2345', 'ABCD_2345', 'ABCD.2345', 'ÄBCD-2345', 'ABCD-２３４５',
      'ABCD\n2345', 'A'.repeat(300),
    ];
    for (const body of bodies) {
      await expectError(await sendRaw(session, recoveryPath, body), 400, 'INVALID_REQUEST');
    }
    for (const backupCode of codes) {
      const response = await sendRaw(session, recoveryPath, JSON.stringify({ backupCode }));
      await expectError(response, 400, 'INVALID_REQUEST');
    }
    await test.step('a non-JSON content type is 415 and an oversized body is refused by the 16 KiB limit', async () => {
      await expectError(await sendRaw(session, recoveryPath, '{"backupCode":"ABCD-2345"}', 'text/plain'), 415,
        'INVALID_REQUEST');
      await expectError(await sendRaw(session, recoveryPath, JSON.stringify({ backupCode: 'A'.repeat(17 * 1024) })), 400,
        'INVALID_REQUEST');
    });

    await test.step('none of those counted, spent a code or ended the session', async () => {
      expect(bodies.length + codes.length, 'more attempts than the 5-failure limit').toBeGreaterThan(5);
      expect(throttleState(actor.user.username)).toEqual({ failedCount: 0, locked: false });
      expect(auditCount(actor.user.username, 'MFA_RECOVERY_CODE_REJECTED')).toBe(0);
      expect(factorRows(actor.user.username)[0]).toMatchObject({ unusedCodes: 10, usedCodes: 0 });
      expect((await redeem(session, actor.backupCodes[0])).status(), 'a real code still works').toBe(200);
    });
    await disposeAll(actor, session);
  });

test('E2E-09-23 malformed regeneration bodies and codes are 400 INVALID_REQUEST and never counted', security,
  async ({ request }) => {
    const actor = await apiRecoveryStaff(request);
    const bodies = [
      '{}', '[]', 'null', '"123456"', '{"code":123456}', '{"code":null}', '{"code":"123456","extra":1}',
      '{"backupCode":"ABCD-2345"}', '{"code":"123456","backupCode":"ABCD-2345"}', '{"code":["123456"]}', '{"code":"123456"',
      '',
    ];
    const codes = ['', '12345', '1234567', 'abcdef', '12 34 5', '１２３４５６', '12345a', 'ABCD-2345', '1'.repeat(300)];
    for (const body of bodies) {
      await expectError(await sendRaw(actor.session, backupCodesPath, body), 400, 'INVALID_REQUEST');
    }
    for (const code of codes) {
      await expectError(await sendRaw(actor.session, backupCodesPath, JSON.stringify({ code })), 400, 'INVALID_REQUEST');
    }
    await expectError(await sendRaw(actor.session, backupCodesPath, '{"code":"123456"}', 'text/plain'), 415,
      'INVALID_REQUEST');
    await expectError(await sendRaw(actor.session, backupCodesPath, JSON.stringify({ code: '1'.repeat(17 * 1024) })), 400,
      'INVALID_REQUEST');

    expect(throttleState(actor.user.username)).toEqual({ failedCount: 0, locked: false });
    expect(factorRows(actor.user.username)[0]).toMatchObject({ unusedCodes: 10, usedCodes: 0 });
    expect(auditCount(actor.user.username, 'MFA_BACKUP_CODES_REGENERATED')).toBe(0);
    // Spaces inside a 6-digit code are allowed, as at the challenge ("123 456").
    const code = await freshCode(actor.authenticator);
    const regenerated = await regenerate(actor.session, `${code.slice(0, 3)} ${code.slice(3)}`);
    expectFreshCodes((await expectBody(regenerated, ['backupCodes'])).backupCodes, actor.backupCodes);
    await disposeAll(actor);
  });

test('E2E-09-24 a code typed in lower case, with spaces or without the separator is accepted', t4, async ({ request }) => {
  const actor = await apiRecoveryStaff(request);
  const [first, second, third] = actor.backupCodes;
  const forms = [
    `  ${first.slice(0, 4).toLowerCase()} ${first.slice(5).toLowerCase()}  `,
    second.replace('-', ''),
    ` ${third.slice(0, 2)} ${third.slice(2)} `,
  ];
  for (const form of forms) {
    const session = await passwordSession(actor);
    const response = await redeem(session, form);
    expect(response.status(), `accepted: ${JSON.stringify(form)}`).toBe(200);
    expect(session.mfa).toBe('REPLACEMENT_REQUIRED');
    await session.dispose();
  }
  expect(factorRows(actor.user.username)[0]).toMatchObject({ status: 'ACTIVE', unusedCodes: 7, usedCodes: 3 });
  expect(throttleState(actor.user.username).failedCount).toBe(0);
  await disposeAll(actor);
});

test('E2E-09-25 a wrong, spent or another User’s code gets one identical, counted answer', security, async ({ request }) => {
  const owner = await apiRecoveryStaff(request);
  const other = await apiRecoveryStaff(request);
  const refusals: { code: unknown; message: unknown }[] = [];
  const refused = async (response: APIResponse) => {
    await expectError(response, 400, 'MFA_CODE_INVALID');
    refusals.push(await errorShape(response));
  };

  await test.step('another User’s unused code is refused, counted on the sender, and stays unused', async () => {
    const session = await passwordSession(other);
    await refused(await redeem(session, owner.backupCodes[0]));
    expect(throttleState(other.user.username).failedCount).toBe(1);
    expect(factorRows(owner.user.username)[0]).toMatchObject({ unusedCodes: 10, usedCodes: 0 });
    expect(throttleState(owner.user.username).failedCount).toBe(0);
    await session.dispose();
  });

  const session = await passwordSession(owner);
  await test.step('a spent code and a well-formed wrong code are refused the same way and counted', async () => {
    const first = await replacementSession(owner, owner.backupCodes[0]);
    await refused(await redeem(session, owner.backupCodes[0]));
    await refused(await redeem(session, wrongBackupCode(owner.backupCodes)));
    expect(throttleState(owner.user.username)).toEqual({ failedCount: 2, locked: false });
    expect(auditCount(owner.user.username, 'MFA_RECOVERY_CODE_REJECTED')).toBe(2);
    await first.dispose();
  });

  await test.step('every refusal is the same code and message, so none reveals which case it was', () => {
    expect(new Set(refusals.map((shape) => JSON.stringify(shape))).size).toBe(1);
  });

  await test.step('the refused session keeps its authenticator challenge (Ticket 06), and success clears the count',
    async () => {
      expect(session.mfa).toBe('VERIFICATION_REQUIRED');
      expect((await verifyChallenge(session, wrongTotp(owner.authenticator))).status()).toBe(400);
      expect(throttleState(owner.user.username).failedCount, 'both kinds of failure share one count').toBe(3);
      expect((await redeem(session, owner.backupCodes[1])).status(), 'four failures do not lock').toBe(200);
      expect(throttleState(owner.user.username)).toEqual({ failedCount: 0, locked: false });
    });
  await disposeAll(owner, other, session);
});

test('E2E-09-26 TOTP and backup-code failures share one throttle; a locked User spends no code', security,
  async ({ request }) => {
    const actor = await apiRecoveryStaff(request);
    const { username } = actor.user;
    const session = await passwordSession(actor);

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await expectError(await verifyChallenge(session, wrongTotp(actor.authenticator)), 400, 'MFA_CODE_INVALID');
    }
    await expectError(await redeem(session, wrongBackupCode(actor.backupCodes)), 400, 'MFA_CODE_INVALID');
    await test.step('the fifth failure, a backup code, locks both kinds of code', async () => {
      await expectError(await redeem(session, wrongBackupCode(actor.backupCodes)), 429, 'TOO_MANY_ATTEMPTS');
      expect(throttleState(username).locked).toBe(true);
      expect(auditCount(username, 'MFA_ATTEMPTS_LOCKED')).toBe(1);
    });

    await test.step('while locked, a correct backup code and a correct TOTP code are refused, and nothing is spent',
      async () => {
        await expectError(await redeem(session, actor.backupCodes[0]), 429, 'TOO_MANY_ATTEMPTS');
        const another = await passwordSession(actor);
        await expectError(await redeem(another, actor.backupCodes[1]), 429, 'TOO_MANY_ATTEMPTS');
        await expectError(await verifyChallenge(another, await freshCode(actor.authenticator)), 429, 'TOO_MANY_ATTEMPTS');
        await expectError(await regenerate(actor.session, await freshCode(actor.authenticator)), 429, 'TOO_MANY_ATTEMPTS');
        expect(factorRows(username)[0]).toMatchObject({ status: 'ACTIVE', unusedCodes: 10, usedCodes: 0 });
        expect(consumedSessionIds(username)).toEqual([]);
        expect(sessionRows(username).filter(({ replacingFactorId }) => replacingFactorId)).toEqual([]);
        await another.dispose();
      });
    await disposeAll(actor, session);
  });

test('E2E-09-27 regeneration failures and challenge failures share the throttle too', security, async ({ request }) => {
  const actor = await apiRecoveryStaff(request);
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    await expectError(await regenerate(actor.session, wrongTotp(actor.authenticator)), 400, 'MFA_CODE_INVALID');
  }
  const session = await passwordSession(actor);
  await expectError(await verifyChallenge(session, wrongTotp(actor.authenticator)), 429, 'TOO_MANY_ATTEMPTS');
  await expectError(await redeem(session, actor.backupCodes[0]), 429, 'TOO_MANY_ATTEMPTS');
  expect(factorRows(actor.user.username)[0]).toMatchObject({ unusedCodes: 10, usedCodes: 0 });
  // The verified session that failed to regenerate is still a verified session (C12).
  await expectActive(actor.session);
  await disposeAll(actor, session);
});

test('E2E-09-28 one code submitted from two sign-ins recovers exactly once', concurrency, async ({ request }) => {
  const actor = await apiRecoveryStaff(request);
  const { username } = actor.user;
  for (const [round, code] of actor.backupCodes.slice(0, 3).entries()) {
    await test.step(`round ${round + 1}`, async () => {
      const [a, b] = await Promise.all([passwordSession(actor), passwordSession(actor)]);
      const responses = await Promise.all([redeem(a, code), redeem(b, code)]);
      expect(responses.map((response) => response.status()).sort()).toEqual([200, 400]);
      const loser = responses.find((response) => response.status() === 400)!;
      await expectError(loser, 400, 'MFA_CODE_INVALID');
      expect([a.mfa, b.mfa].sort()).toEqual(['REPLACEMENT_REQUIRED', 'VERIFICATION_REQUIRED']);
      expect(consumedSessionIds(username)).toHaveLength(round + 1);
      expect(auditCount(username, 'MFA_RECOVERY_STARTED')).toBe(round + 1);
      expect(auditCount(username, 'MFA_RECOVERY_CODE_REJECTED')).toBe(round + 1);
      await disposeAll(a, b);
    });
  }
  expect(factorRows(username)[0]).toMatchObject({ unusedCodes: 7, usedCodes: 3 });
  expect(sessionRows(username).filter(({ replacingFactorId, state }) => replacingFactorId && state === 'active'))
    .toHaveLength(3);
  await disposeAll(actor);
});

test('E2E-09-29 the same restricted session cannot use a code twice, in sequence or at once', concurrency,
  async ({ request }) => {
    const actor = await apiRecoveryStaff(request);
    const { username } = actor.user;

    await test.step('in sequence: its token is dead after the first use, and the second code stays unused', async () => {
      const session = await passwordSession(actor);
      const token = session.accessToken;
      const issuedAt = session.issuedAt;
      expect((await redeem(session, actor.backupCodes[0])).status()).toBe(200);
      expect(Date.now() - issuedAt, 'the consumed session bearer is unexpired').toBeLessThan(accessTokenLifetimeMs - 1_000);
      await expectError(await redeem(session, actor.backupCodes[1], { token }), 401, 'AUTHENTICATION_REQUIRED');
      expect(factorRows(username)[0]).toMatchObject({ unusedCodes: 9, usedCodes: 1 });
      await session.dispose();
    });

    await test.step('at once with one token: one 200, the other 401 because the session was replaced', async () => {
      const session = await passwordSession(actor);
      const token = session.accessToken;
      const statuses = (await Promise.all([
        session.call('POST', recoveryPath, { token, data: { backupCode: actor.backupCodes[2] } }),
        session.call('POST', recoveryPath, { token, data: { backupCode: actor.backupCodes[2] } }),
      ])).map((response) => response.status()).sort();
      expect(statuses).toEqual([200, 401]);
      expect(factorRows(username)[0]).toMatchObject({ unusedCodes: 8, usedCodes: 2 });
      await session.dispose();
    });
    await disposeAll(actor);
  });

// ---------------------------------------------------------------------------------------------------------------------
// Replacement enrollment
// ---------------------------------------------------------------------------------------------------------------------

test('E2E-09-30 a replacement start creates a pending factor beside the active one; the old one keeps working', t4,
  async ({ request }) => {
    const actor = await apiRecoveryStaff(request);
    const { username } = actor.user;
    const session = await replacementSession(actor);

    const first = await startedEnrollment(session);
    await test.step('the start body is Ticket 06’s, with a new key', () => {
      expect(Object.keys(first).sort()).toEqual(enrollmentStartFields);
      expect(first.enrollmentId).toMatch(uuidPattern);
      expect(first.secret).toMatch(/^[A-Z2-7]{32}$/);
      expect(first.secret).not.toBe(actor.authenticator.key);
      expect(factorStatuses(username)).toEqual(['ACTIVE', 'PENDING']);
    });

    const second = await test.step('starting again replaces the pending factor', async () => {
      const again = await startedEnrollment(session);
      expect(again.enrollmentId).not.toBe(first.enrollmentId);
      expect(again.secret).not.toBe(first.secret);
      expect(factorStatuses(username)).toEqual(['ACTIVE', 'PENDING']);
      expect(factorRows(username)[1].id).toBe(again.enrollmentId);
      return again;
    });

    await test.step('P3: while the replacement is pending, the old authenticator still signs in', async () => {
      const found = await passwordSession(actor);
      expect((await verifyChallenge(found, await freshCode(actor.authenticator))).status()).toBe(200);
      expect(found.mfa).toBe('VERIFIED');
      expect((await found.call('GET', '/api/staff/me')).status()).toBe(200);
      await found.dispose();
    });

    await test.step('the first, replaced enrollment is stale; a wrong code for the current one is counted', async () => {
      await expectError(await verifyEnrollment(session, first.enrollmentId, totpCode(first.secret, totpStep())), 409,
        'MFA_ENROLLMENT_STALE');
      await expectError(await verifyEnrollment(session, second.enrollmentId, wrongTotp({ key: second.secret, step: -1 })),
        400, 'MFA_CODE_INVALID');
      expect(throttleState(username).failedCount).toBe(1);
      expect(factorStatuses(username)).toEqual(['ACTIVE', 'PENDING']);
      expect(session.mfa).toBe('REPLACEMENT_REQUIRED');
    });
    await disposeAll(actor, session);
  });

test('E2E-09-31 a verified replacement revokes the old factor, its codes and every session, and issues new codes',
  t4, async ({ request }) => {
    test.setTimeout(180_000);
    const actor = await apiRecoveryStaff(request);
    const { username } = actor.user;
    const secondBrowser = await passwordSession(actor);
    expect((await verifyChallenge(secondBrowser, await freshCode(actor.authenticator))).status()).toBe(200);
    const [oldFactor] = factorRows(username);

    const recovering = await passwordSession(actor);
    const verifiedBefore = activeSessions(username).filter(({ verified }) => verified).map(({ id }) => id);
    expect(verifiedBefore).toHaveLength(2);
    expect((await redeem(recovering, actor.backupCodes[0])).status()).toBe(200);
    const pending = await startedEnrollment(recovering);
    // Refresh after recovery/setup work, then observe revocation before slower database probes.
    for (const session of [actor.session, secondBrowser]) expect((await session.refresh()).status()).toBe(200);
    const step = totpStep();
    const verified = await verifyEnrollment(recovering, pending.enrollmentId, totpCode(pending.secret, step));
    expect(verified.status()).toBe(200);
    const body = await verified.json() as Record<string, unknown>;
    const replaced = {
      body, backupCodes: body.backupCodes as string[], authenticator: { key: pending.secret, step },
    };
    await test.step('fresh earlier bearer tokens and refresh cookies are refused after replacement', async () => {
      for (const session of [actor.session, secondBrowser]) await expectRevoked(session);
    });

    await test.step('the body is the enrollment body plus contactNotice, with 10 fresh codes', async () => {
      expect(Object.keys(replaced.body).sort()).toEqual(replacementFields);
      expect(replaced.body).toMatchObject({ tokenType: 'Bearer', mfa: 'VERIFIED', contactNotice: 'SENT' });
      expectFreshCodes(replaced.body.backupCodes, actor.backupCodes);
    });

    await test.step('the database: old factor revoked with no codes, new factor active with 10 unused codes', () => {
      const factors = factorRows(username);
      expect(factors).toHaveLength(2);
      expect(factors[0]).toMatchObject({ id: oldFactor.id, status: 'REVOKED', revoked: true, unusedCodes: 0, usedCodes: 0 });
      expect(factors[1]).toMatchObject({ status: 'ACTIVE', activated: true, revoked: false, unusedCodes: 10, usedCodes: 0 });
    });

    await test.step('every earlier session is revoked; exactly one verified session on the new factor remains', () => {
      const sessions = sessionRows(username);
      const active = activeSessions(username);
      expect(active).toHaveLength(1);
      expect(active[0]).toMatchObject({ factorId: factorRows(username)[1].id, verified: true, replacingFactorId: null });
      const stateOf = (id: string) => sessions.find((row) => row.id === id)?.state;
      for (const id of verifiedBefore) expect(stateOf(id), 'a verified session from before').toBe('mfa-replaced');
      // The password-only session that used the code ended as replacement-started; the replacement session itself
      // ended with the two verified ones, so exactly three were replaced.
      expect(sessions.filter(({ state }) => state === 'mfa-replacement-started')).toHaveLength(1);
      expect(sessions.filter(({ state }) => state === 'mfa-replaced')).toHaveLength(3);
    });

    await test.step('audit: recovery started, factor replaced, notice sent, in that order', () => {
      const events = auditTypes(username).filter((type) =>
        ['MFA_RECOVERY_STARTED', 'MFA_FACTOR_REPLACED', 'MFA_REPLACEMENT_NOTICE_SENT'].includes(type));
      expect(events).toEqual(['MFA_RECOVERY_STARTED', 'MFA_FACTOR_REPLACED', 'MFA_REPLACEMENT_NOTICE_SENT']);
    });

    await test.step('R1: a password sign-in still needs a code; the old factor and old codes are refused', async () => {
      const next = await passwordSession(actor);
      await expectError(await next.call('GET', '/api/staff/me', { token: next.accessToken }), 403, 'MFA_REQUIRED');
      await expectError(await verifyChallenge(next, await freshCode(actor.authenticator)), 400, 'MFA_CODE_INVALID');
      await expectError(await redeem(next, actor.backupCodes[0]), 400, 'MFA_CODE_INVALID');
      await expectError(await redeem(next, actor.backupCodes[1]), 400, 'MFA_CODE_INVALID');
      expect((await verifyChallenge(next, await freshCode(replaced.authenticator))).status()).toBe(200);
      const staff = await next.call('GET', '/api/staff/me');
      expect(staff.status()).toBe(200);
      expect(await staff.json()).toEqual({ username, roles: ['MODERATOR'], superAdmin: false });
      await next.dispose();
    });

    await test.step('a new backup code starts the next recovery, bound to the new factor', async () => {
      const later = await replacementSession(actor, replaced.backupCodes[0]);
      const binding = activeSessions(username).find(({ replacingFactorId }) => replacingFactorId);
      expect(binding?.replacingFactorId).toBe(factorRows(username)[1].id);
      await later.dispose();
    });
    await disposeAll(actor, secondBrowser, recovering);
  });

test('E2E-09-32 a first enrollment answers exactly as in Ticket 06, without contactNotice', cross06, async ({ request }) => {
  const user = await registerThroughApi(request);
  markMobileVerified(user.username);
  grantRole(user.username, 'ADMIN');
  const session = await ApiSession.signIn(user);
  const { enrollmentId, secret } = await startedEnrollment(session);
  const response = await verifyEnrollment(session, enrollmentId, totpCode(secret, totpStep()));
  const body = await expectBody(response, firstEnrollmentFields);
  expect(body.mfa).toBe('VERIFIED');
  expectFreshCodes(body.backupCodes);
  expect(auditTypes(user.username).filter((type) => type.startsWith('MFA_REPLACEMENT_NOTICE_'))).toEqual([]);
  expect(auditTypes(user.username)).not.toContain('MFA_FACTOR_REPLACED');
  await session.dispose();
});

test('E2E-09-33 a replacement without a verified mobile completes and reports NO_VERIFIED_CONTACT', t4,
  async ({ request }) => {
    const actor = await apiRecoveryStaff(request, 'MODERATOR', { verifiedMobile: false });
    const recovering = await passwordSession(actor);
    const replaced = await replaceThroughApi(recovering, actor.backupCodes[0]);
    expect(replaced.contactNotice).toBe('NO_VERIFIED_CONTACT');
    expect(factorStatuses(actor.user.username)).toEqual(['REVOKED', 'ACTIVE']);
    expect(auditCount(actor.user.username, 'MFA_REPLACEMENT_NOTICE_NO_VERIFIED_CONTACT')).toBe(1);
    expect(auditCount(actor.user.username, 'MFA_REPLACEMENT_NOTICE_SENT')).toBe(0);
    await disposeAll(actor, recovering);
  });

test('E2E-09-34 a later recovery start makes the first stale, and completion revokes the other', t4,
  async ({ request }) => {
    const actor = await apiRecoveryStaff(request);
    const one = await replacementSession(actor, actor.backupCodes[0]);
    const firstSessionId = activeSessions(actor.user.username).find(({ replacingFactorId }) => replacingFactorId)!.id;
    const two = await replacementSession(actor, actor.backupCodes[1]);
    const first = await startedEnrollment(one);
    const second = await startedEnrollment(two);
    await expectError(await verifyEnrollment(one, first.enrollmentId, totpCode(first.secret, totpStep())), 409,
      'MFA_ENROLLMENT_STALE');
    expect((await verifyEnrollment(two, second.enrollmentId, totpCode(second.secret, totpStep()))).status()).toBe(200);
    expect(sessionRows(actor.user.username).find(({ id }) => id === firstSessionId)?.state).toBe('mfa-replaced');
    await expectError(await one.refresh(), 401, 'AUTHENTICATION_REQUIRED');
    expect(factorStatuses(actor.user.username)).toEqual(['REVOKED', 'ACTIVE']);
    expect(factorRows(actor.user.username)[1].id).toBe(second.enrollmentId);
    await disposeAll(actor, one, two);
  });

// ---------------------------------------------------------------------------------------------------------------------
// Abandoned, expired and stale recoveries
// ---------------------------------------------------------------------------------------------------------------------

test('E2E-09-35 an abandoned recovery expires after 10 minutes and leaves the old authenticator working', t4,
  async ({ request }) => {
    const actor = await apiRecoveryStaff(request);
    const { username } = actor.user;
    const session = await replacementSession(actor);
    const abandoned = await startedEnrollment(session);
    const [oldFactor] = factorRows(username);
    const replacementToken = session.accessToken;

    await test.step('once its expiry passes, the replacement token and its refresh are refused', async () => {
      expect(expireReplacementSessions(username)).toBe(1);
      await expectError(await startEnrollment(session, { token: replacementToken }), 401, 'AUTHENTICATION_REQUIRED');
      await expectError(await verifyEnrollment(session, abandoned.enrollmentId, totpCode(abandoned.secret, totpStep()),
        { token: replacementToken }),
        401, 'AUTHENTICATION_REQUIRED');
      await expectError(await session.refresh(), 401, 'AUTHENTICATION_REQUIRED');
    });

    await test.step('the User signs in with the old authenticator; the used code stays used', async () => {
      const found = await passwordSession(actor);
      expect((await verifyChallenge(found, await freshCode(actor.authenticator))).status()).toBe(200);
      expect(factorRows(username)[0]).toMatchObject({ id: oldFactor.id, status: 'ACTIVE', unusedCodes: 9, usedCodes: 1 });
      const again = await passwordSession(actor);
      await expectError(await redeem(again, actor.backupCodes[0]), 400, 'MFA_CODE_INVALID');
      await disposeAll(found, again);
    });

    await test.step('the next recovery’s start deletes the abandoned pending factor', async () => {
      const later = await replacementSession(actor, actor.backupCodes[1]);
      const next = await startedEnrollment(later);
      const pending = factorRows(username).filter(({ status }) => status === 'PENDING');
      expect(pending.map(({ id }) => id)).toEqual([next.enrollmentId]);
      expect(next.enrollmentId).not.toBe(abandoned.enrollmentId);
      await later.dispose();
    });
    await disposeAll(actor, session);
  });

test('E2E-09-36 a factor reset elsewhere (Ticket 10 style) makes the replacement stale; it never verifies', security,
  async ({ request }) => {
    const actor = await apiRecoveryStaff(request);
    const { username } = actor.user;
    const session = await replacementSession(actor);
    const pending = await startedEnrollment(session);

    revokeActiveFactorLikeTicket10(username);
    await test.step('the replacement session downgrades to ENROLLMENT_REQUIRED (plan §4.1)', async () => {
      expect((await session.refresh()).status()).toBe(200);
      expect(session.mfa).toBe('ENROLLMENT_REQUIRED');
      await expectError(await session.call('GET', '/api/staff/me', { token: session.accessToken }), 403, 'MFA_REQUIRED');
    });

    await test.step('verifying the replacement’s pending factor is refused, and no factor becomes active', async () => {
      const response = await verifyEnrollment(session, pending.enrollmentId, totpCode(pending.secret, totpStep()));
      expect([403, 409], 'refused as stale or denied, never VERIFIED').toContain(response.status());
      expect(session.mfa).not.toBe('VERIFIED');
      expect(factorStatuses(username)).not.toContain('ACTIVE');
    });
    await disposeAll(actor, session);
  });

// ---------------------------------------------------------------------------------------------------------------------
// Ticket 08: a role removed during recovery ends it (P10)
// ---------------------------------------------------------------------------------------------------------------------

/** The Moderator's id and current roles version, read by the Super Admin. */
async function rolesOf(owner: ApiActor, username: string): Promise<{ id: string; rolesVersion: number }> {
  const { id } = await findUser(owner.session, username);
  return { id, rolesVersion: (await readUserRoles(owner.session, id)).rolesVersion };
}

test('E2E-09-37 a role removed after the code is used ends the recovery and is never restored', crossRoles,
  async ({ request }) => {
    const owner = await apiSuperAdmin(request);
    const moderator = await apiRecoveryStaff(request);
    const { username } = moderator.user;
    const [oldFactor] = factorRows(username);
    const session = await replacementSession(moderator);

    await test.step('the Super Admin makes the Moderator a Customer: the replacement session is revoked', async () => {
      const { id, rolesVersion } = await rolesOf(owner, username);
      expect((await session.refresh()).status()).toBe(200);
      const replacementToken = session.accessToken;
      await changeRole(owner.session, id, 'CUSTOMER', rolesVersion);
      await expectError(await startEnrollment(session, { token: replacementToken }), 401, 'AUTHENTICATION_REQUIRED');
      await expectError(await session.call('GET', '/api/user/me', { token: replacementToken }), 401,
        'AUTHENTICATION_REQUIRED');
      await expectError(await session.refresh(), 401, 'AUTHENTICATION_REQUIRED');
    });

    await test.step('signing in again gives a Customer session; R7: the factor is kept, and nothing was replaced',
      async () => {
        expect(await signInAgain(moderator)).toBe('NOT_REQUIRED');
        expect(roleOf(username)).toBe('CUSTOMER');
        expect(factorRows(username).filter(({ status }) => status === 'ACTIVE').map(({ id }) => id)).toEqual([oldFactor.id]);
        expect(auditCount(username, 'MFA_FACTOR_REPLACED')).toBe(0);
      });

    await test.step('promoted again, the Moderator verifies with the old authenticator, not a new one', async () => {
      const { id, rolesVersion } = await rolesOf(owner, username);
      await changeRole(owner.session, id, 'MODERATOR', rolesVersion);
      expect(await signInAgain(moderator)).toBe('VERIFICATION_REQUIRED');
      expect((await verifyChallenge(moderator.session, await freshCode(moderator.authenticator))).status()).toBe(200);
    });
    await disposeAll(owner, moderator, session);
  });

test('E2E-09-38 a role removed between the setup start and its verification refuses the verification', crossRoles,
  async ({ request }) => {
    const owner = await apiSuperAdmin(request);
    const moderator = await apiRecoveryStaff(request);
    const { username } = moderator.user;
    const [oldFactor] = factorRows(username);
    const session = await replacementSession(moderator);
    const pending = await startedEnrollment(session);

    const { id, rolesVersion } = await rolesOf(owner, username);
    expect((await session.refresh()).status()).toBe(200);
    const replacementToken = session.accessToken;
    await changeRole(owner.session, id, 'CUSTOMER', rolesVersion);
    await expectError(await verifyEnrollment(session, pending.enrollmentId, totpCode(pending.secret, totpStep()),
      { token: replacementToken }), 401,
      'AUTHENTICATION_REQUIRED');
    const factors = factorRows(username);
    expect(factors.filter(({ status }) => status === 'ACTIVE').map(({ id: factorId }) => factorId)).toEqual([oldFactor.id]);
    expect(factors.find(({ id: factorId }) => factorId === pending.enrollmentId)?.status ?? 'deleted').not.toBe('ACTIVE');
    expect(auditCount(username, 'MFA_FACTOR_REPLACED')).toBe(0);
    await disposeAll(owner, moderator, session);
  });

test('E2E-09-39 a role taken away with SQL (sessions kept) leaves the replacement session no MFA route', crossRoles,
  async ({ request }) => {
    const moderator = await apiRecoveryStaff(request);
    const { username } = moderator.user;
    const session = await replacementSession(moderator);
    const pending = await startedEnrollment(session);
    expect((await session.refresh()).status()).toBe(200);
    const replacementToken = session.accessToken;

    removeRole(username, 'MODERATOR');
    // The role is re-read on every request: a Customer holds no MFA authority, so both routes are plainly denied.
    await expectError(await startEnrollment(session, { token: replacementToken }), 403, 'ACCESS_DENIED');
    await expectError(await verifyEnrollment(session, pending.enrollmentId, totpCode(pending.secret, totpStep()),
      { token: replacementToken }), 403,
      'ACCESS_DENIED');
    expect(factorStatuses(username)).toEqual(['ACTIVE', 'PENDING']);
    expect(auditCount(username, 'MFA_FACTOR_REPLACED')).toBe(0);
    await disposeAll(moderator, session);
  });

// ---------------------------------------------------------------------------------------------------------------------
// The Super Admin (P11) and regeneration (P4)
// ---------------------------------------------------------------------------------------------------------------------

test('E2E-09-40 the Super Admin may recover with their own backup code and stays Super Admin', t4, async ({ request }) => {
  const owner = await apiRecoveryStaff(request, 'SUPER_ADMIN');
  const recovering = await passwordSession(owner);
  const replaced = await replaceThroughApi(recovering, owner.backupCodes[0]);
  expect(replaced.contactNotice).toBe('SENT');
  const staff = await recovering.call('GET', '/api/staff/me');
  expect(staff.status()).toBe(200);
  expect(await staff.json()).toEqual({ username: owner.user.username, roles: ['ADMIN'], superAdmin: true });
  expect(factorStatuses(owner.user.username)).toEqual(['REVOKED', 'ACTIVE']);
  await disposeAll(owner, recovering);
});

test('E2E-09-41 a verified User replaces only their unused codes with a fresh TOTP code and keeps their sessions', t4,
  async ({ request }) => {
    test.setTimeout(180_000);
    const actor = await apiRecoveryStaff(request);
    const { username } = actor.user;

    // One code is spent by an abandoned recovery first, so the consumed row's survival can be seen.
    const abandoned = await replacementSession(actor, actor.backupCodes[0]);
    const abandonedSessionId = activeSessions(username).find(({ replacingFactorId }) => replacingFactorId)!.id;
    const other = await passwordSession(actor);
    expect((await verifyChallenge(other, await freshCode(actor.authenticator))).status()).toBe(200);

    await test.step('a wrong code and a replayed step are refused and counted', async () => {
      await expectError(await regenerate(actor.session, wrongTotp(actor.authenticator)), 400, 'MFA_CODE_INVALID');
      await expectError(await regenerate(actor.session, totpCode(actor.authenticator.key, actor.authenticator.step)), 400,
        'MFA_CODE_INVALID');
      expect(throttleState(username).failedCount).toBe(2);
    });

    const regenerated = await test.step('a fresh code returns exactly 10 new codes', async () => {
      const response = await regenerate(actor.session, await freshCode(actor.authenticator));
      return expectFreshCodes((await expectBody(response, ['backupCodes'])).backupCodes, actor.backupCodes);
    });

    await test.step('the unused codes were replaced; the spent one remains; nothing else changed', async () => {
      expect(factorRows(username)).toEqual([expect.objectContaining({ status: 'ACTIVE', unusedCodes: 10, usedCodes: 1 })]);
      expect(throttleState(username)).toEqual({ failedCount: 0, locked: false });
      expect(auditCount(username, 'MFA_BACKUP_CODES_REGENERATED')).toBe(1);
      // C12: regeneration revokes no session.
      await expectActive(actor.session);
      await expectActive(other);
      expect(sessionRows(username).find(({ id }) => id === abandonedSessionId)?.state).toBe('active');
      expect((await abandoned.refresh()).status()).toBe(200);
      expect(abandoned.mfa).toBe('REPLACEMENT_REQUIRED');
      expect(sessionRows(username).filter(({ state }) => state === 'mfa-replaced')).toEqual([]);
    });

    await test.step('an old unused code is refused and a new one starts a recovery', async () => {
      const next = await passwordSession(actor);
      await expectError(await redeem(next, actor.backupCodes[1]), 400, 'MFA_CODE_INVALID');
      expect((await redeem(next, regenerated[0])).status()).toBe(200);
      expect(next.mfa).toBe('REPLACEMENT_REQUIRED');
      await next.dispose();
    });
    await disposeAll(actor, abandoned, other);
  });

// ---------------------------------------------------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------------------------------------------------

test('E2E-09-42 codes, keys, tokens and contacts stay out of the API log, audit rows and error bodies', security,
  async ({ request }) => {
    const logStart = readFileSync(apiLogPath, 'utf8').length;
    const actor = await apiRecoveryStaff(request);
    const { username } = actor.user;
    const tokens = new Set<string>([actor.session.accessToken]);
    const errorBodies: string[] = [];

    const session = await passwordSession(actor);
    tokens.add(session.accessToken);
    const wrong = wrongBackupCode(actor.backupCodes);
    for (const attempt of [wrong, 'ABCI-2345']) {
      const response = await redeem(session, attempt);
      expect(response.status()).toBe(400);
      errorBodies.push(await response.text());
    }
    expect((await redeem(session, actor.backupCodes[0])).status(), 'backup code').toBe(200);
    expect(session.mfa).toBe('REPLACEMENT_REQUIRED');
    tokens.add(session.accessToken);
    const { enrollmentId, secret } = await startedEnrollment(session);
    const step = totpStep();
    const verificationTotp = totpCode(secret, step);
    const verified = await verifyEnrollment(session, enrollmentId, verificationTotp);
    expect(verified.status(), 'replacement verification').toBe(200);
    const replaced = {
      authenticator: { key: secret, step },
      backupCodes: (await verified.json() as { backupCodes: string[] }).backupCodes,
    };
    expect(session.mfa).toBe('VERIFIED');
    tokens.add(session.accessToken);
    const regenerationTotp = await freshCode(replaced.authenticator);
    const regenerated = await regenerate(session, regenerationTotp);
    const newest = expectFreshCodes((await expectBody(regenerated, ['backupCodes'])).backupCodes);

    for (const body of errorBodies) {
      expect(body).not.toContain(wrong);
      expect(body).not.toContain('ABCI');
    }
    const secrets = [
      ...actor.backupCodes, ...actor.backupCodes.map((code) => code.replace('-', '')),
      ...replaced.backupCodes, ...newest, actor.authenticator.key, replaced.authenticator.key,
      ...tokens, actor.user.password, actor.user.mobile, actor.user.email,
    ];
    const testLog = readFileSync(apiLogPath, 'utf8').slice(logStart);
    // The API logs each response status; finding one proves the scan read this test's request log.
    expect(testLog).toContain('"message":"HTTP response status=');
    expect([...secrets, username].filter((secret) => testLog.includes(secret)), 'secrets in the API log').toEqual([]);
    // Six digits can occur inside timestamps or UUIDs. Match submitted codes only as standalone values.
    expect([verificationTotp, regenerationTotp].some((code) =>
      new RegExp(`(^|[^A-Za-z0-9])${code}($|[^A-Za-z0-9])`, 'm').test(testLog)),
    'submitted TOTP in the API log').toBe(false);
    const audit = auditText(username);
    expect(audit, 'the User has audit rows').not.toBe('');
    expect([...secrets, username].filter((secret) => audit.includes(secret)), 'secrets in audit rows').toEqual([]);
    await disposeAll(actor, session);
  });
