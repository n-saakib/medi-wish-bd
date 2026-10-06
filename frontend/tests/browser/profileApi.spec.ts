import { randomBytes } from 'node:crypto';
import { expect, request as apiRequest, test, type APIRequestContext, type APIResponse } from '@playwright/test';
import {
  awayFromDhakaMidnight, copy, dhakaDate, expectError, expectNoStore, expectProfile, mobileChangePath, profilePath,
  type MfaStatus, ProfileApi, profileWritableTables, registerByApi, setAccountState, signInByApi, storedProfile,
  syntheticDigits, syntheticMobile,
} from './profileSupport';
import { syntheticCustomer, type Customer } from './support';
import {
  apiUrl, checkedTarget, frontendUrl, grantRole, markMobileVerified, psql, tableFingerprints,
} from './testApi';
import { totpCode, totpStep } from './totp';

/**
 * Ticket 11 API-level acceptance tests against the real test API and PostgreSQL 18. Every profile test passes once the
 * core rules (T2) are wired to the API (T4), so each carries `@t11-T4`; E2E-11-50 needs only the T2 identifier formats
 * on the existing registration route, so it carries `@t11-T2`. Synthetic data only.
 */
const t2 = { tag: ['@t11', '@t11-T2'] };
const t4 = { tag: ['@t11', '@t11-T4'] };

const hex = () => randomBytes(4).toString('hex');

/**
 * A unique synthetic email of exactly `length` characters in the accepted format (plan P12): a `localLength` local
 * part and a domain of labels of at most 63 characters ending in `example.test`.
 */
function emailOfLength(length: number, localLength = 16): string {
  const local = `${hex()}${'l'.repeat(localLength - 8)}`;
  const labels: string[] = [];
  let need = length - localLength - 1 - 'example.test'.length;
  while (need > 0) {
    let label = Math.min(63, need - 1);
    if (need - (label + 1) === 1) label -= 1;
    labels.push('d'.repeat(label));
    need -= label + 1;
  }
  return `${local}@${[...labels, 'example.test'].join('.')}`;
}

/** Sends a registration and returns the answer unchecked. */
function postRegistration(api: APIRequestContext, customer: Customer): Promise<APIResponse> {
  const { username, mobile, email, password } = customer;
  return api.post(`${apiUrl}/api/auth/register`, { data: { username, mobile, email, password } });
}

/** The four editable fields at a version, with `null` for anything not given. */
function edit(version: number, fields: { fullName?: string | null; email?: string | null; dateOfBirth?: string | null } = {}) {
  return { fullName: null, email: null, dateOfBirth: null, ...fields, version };
}

/** The JSON body limit of the profile write routes, in bytes (the backend's `AuthRequestBodyLimitFilter`, plan §4.4). */
const bodyLimit = 16 * 1024;

/**
 * `value` as JSON of exactly `bytes` bytes. JSON white space after the opening brace pads it, so the body still parses
 * to the same valid value and only its size can make the API refuse it.
 */
function paddedJson(value: object, bytes: number): string {
  const json = JSON.stringify(value);
  const padding = bytes - Buffer.byteLength(json);
  expect(padding).toBeGreaterThanOrEqual(0);
  return `{${' '.repeat(padding)}${json.slice(1)}`;
}

/** Every profile route with a body that would change something, for authorization checks. */
function everyRoute(api: APIRequestContext, headers: Record<string, string>): Promise<APIResponse>[] {
  return [
    api.get(`${apiUrl}${profilePath}`, { headers }),
    api.put(`${apiUrl}${profilePath}`, { headers: { ...headers, 'Content-Type': 'application/json' },
      data: JSON.stringify(edit(0, { fullName: 'Intruder' })) }),
    api.post(`${apiUrl}${mobileChangePath}`, { headers: { ...headers, 'Content-Type': 'application/json' },
      data: JSON.stringify({ mobile: syntheticMobile() }) }),
    api.delete(`${apiUrl}${mobileChangePath}`, { headers }),
  ];
}

/** The stored roles of `username`, sorted: every User holds exactly one role (DECISIONS S6). */
function storedRoles(username: string): string[] {
  const schema = checkedTarget('storedRoles', username);
  const lines = psql(`SELECT r.role FROM ${schema}.user_roles r JOIN ${schema}.users u ON u.id = r.user_id`
    + ` WHERE u.username = '${username}' ORDER BY r.role;`);
  return lines === '' ? [] : lines.split(/\r?\n/);
}

/**
 * Registers a User, makes `role` their only role and enrolls an authenticator in a request context of their own, and
 * returns a client on the MFA-verified session. The context keeps that session's refresh cookie, which no other
 * sign-in can replace, so the client renews the 10-second access token through the refresh route and the session
 * stays verified however long the test runs. The caller disposes `client.api`.
 */
async function verifiedStaff(role: 'ADMIN' | 'MODERATOR'): Promise<ProfileApi> {
  const api = await apiRequest.newContext();
  try {
    const member = await registerByApi(api);
    grantRole(member.username, role);
    const signedIn = await signInByApi(api, member.username, member.password);
    const restricted = { Authorization: `Bearer ${(await signedIn.json() as { accessToken: string }).accessToken}` };
    const enrollment = await api.post(`${apiUrl}/api/auth/mfa/enrollment`, { headers: restricted });
    expect(enrollment.status()).toBe(201);
    const { enrollmentId, secret } = await enrollment.json() as { enrollmentId: string; secret: string };
    const verified = await api.post(`${apiUrl}/api/auth/mfa/enrollment/verify`, {
      headers: { ...restricted, 'Content-Type': 'application/json' },
      data: JSON.stringify({ enrollmentId, code: totpCode(secret, totpStep()) }),
    });
    expect(verified.status()).toBe(200);
    const session = await verified.json() as { accessToken: string; mfa: MfaStatus };
    expect(session.mfa).toBe('VERIFIED');
    return ProfileApi.onSession(api, member, session);
  } catch (error) {
    await api.dispose();
    throw error;
  }
}

/**
 * Sends `intruder`'s requests that name another User (`victimId`, `victimUsername`) in a path or query string. No
 * route takes a User id, so no answer may contain one of `secrets`, and an answer with a profile is the intruder's own.
 */
async function expectNoForeignProfile(api: APIRequestContext, intruder: ProfileApi, victimId: string,
  victimUsername: string, secrets: string[]): Promise<void> {
  const own = await intruder.profile();
  expect(own.username).toBe(intruder.user.username);
  const json = await intruder.headers({ 'Content-Type': 'application/json' });
  const change = JSON.stringify(edit(own.version, { fullName: 'Intruder Was Here' }));

  const probes = await Promise.all([
    api.get(`${apiUrl}/api/user/${victimId}/profile`, { headers: json }),
    api.put(`${apiUrl}/api/user/${victimId}/profile`, { headers: json, data: change }),
    api.post(`${apiUrl}/api/user/${victimId}/mobile-change`, { headers: json, data: JSON.stringify({ mobile: syntheticMobile() }) }),
    api.delete(`${apiUrl}/api/user/${victimId}/mobile-change`, { headers: json }),
    api.get(`${apiUrl}/api/user/${victimUsername}/profile`, { headers: json }),
    api.get(`${apiUrl}/api/users/${victimId}`, { headers: json }),
    api.get(`${apiUrl}${profilePath}?userId=${victimId}`, { headers: json }),
    api.get(`${apiUrl}${profilePath}?username=${victimUsername}`, { headers: json }),
    api.put(`${apiUrl}${profilePath}?userId=${victimId}`, { headers: json, data: change }),
    api.delete(`${apiUrl}${mobileChangePath}?userId=${victimId}`, { headers: json }),
  ]);
  for (const probe of probes) {
    const text = await probe.text();
    for (const secret of secrets) expect(text, probe.url()).not.toContain(secret);
    if (probe.ok() && probe.status() !== 204) expect(JSON.parse(text).username, probe.url()).toBe(intruder.user.username);
  }
}

test.describe('Ticket 11 profile API', () => {
  test('E2E-11-01 a new User reads an empty profile at version 0 and /api/user/me keeps its shape', t4, async ({ request }) => {
    const customer = syntheticCustomer();
    const user = await ProfileApi.register(request, customer);

    expect(await user.profile()).toEqual({
      username: customer.username, fullName: null, mobile: customer.mobile, mobileVerified: false, pendingMobile: null,
      email: customer.email, dateOfBirth: null, accountState: 'ACTIVE', version: 0,
    });
    const me = await request.get(`${apiUrl}/api/user/me`, { headers: await user.headers() });
    expect(await me.json()).toEqual({
      username: customer.username, mobile: customer.mobile, email: customer.email, mobileVerified: false,
    });
    expect(storedProfile(customer.username)).toMatchObject({
      fullName: null, dateOfBirth: null, profileVersion: 0, accountState: 'ACTIVE', pendingChanges: [],
    });
  });

  test('E2E-11-02 saving full name, email and date of birth normalizes, persists and bumps the version once', t4, async ({ request }) => {
    const customer = syntheticCustomer();
    const user = await ProfileApi.register(request, customer);
    const tag = hex();

    const saved = await expectProfile(await user.put(edit(0, {
      fullName: '  Demo   Profile ', email: `  Demo.${tag}@Example.test `, dateOfBirth: '1990-05-01',
    })), 200);

    expect(saved).toEqual({
      username: customer.username, fullName: 'Demo Profile', mobile: customer.mobile, mobileVerified: false,
      pendingMobile: null, email: `demo.${tag}@example.test`, dateOfBirth: '1990-05-01', accountState: 'ACTIVE',
      version: 1,
    });
    expect(await user.profile()).toEqual(saved);
    const me = await request.get(`${apiUrl}/api/user/me`, { headers: await user.headers() });
    expect(await me.json()).toEqual({
      username: customer.username, mobile: customer.mobile, email: `demo.${tag}@example.test`, mobileVerified: false,
    });
    expect(storedProfile(customer.username)).toMatchObject({
      username: customer.username, fullName: 'Demo Profile', email: `demo.${tag}@example.test`,
      dateOfBirth: '1990-05-01', profileVersion: 1, mobile: customer.mobile, pendingChanges: [],
    });
  });

  test('E2E-11-03 null or blank values clear the optional fields', t4, async ({ request }) => {
    const user = await ProfileApi.register(request);
    await user.save({ fullName: 'To Be Cleared', email: `clear.${hex()}@example.test`, dateOfBirth: '1985-01-31' });

    const cleared = await expectProfile(await user.put({ fullName: '   ', email: '  ', dateOfBirth: null, version: 1 }), 200);

    expect(cleared).toMatchObject({ fullName: null, email: null, dateOfBirth: null, version: 2 });
    const me = await request.get(`${apiUrl}/api/user/me`, { headers: await user.headers() });
    expect((await me.json() as { email: unknown }).email).toBeNull();
    expect(storedProfile(user.user.username)).toMatchObject({ fullName: null, email: null, dateOfBirth: null });
  });

  test('E2E-11-04 a changed email becomes the sign-in email and the old one stops working', t4, async ({ request }) => {
    const customer = syntheticCustomer();
    const user = await ProfileApi.register(request, customer);
    const newEmail = `moved.${hex()}@example.test`;
    await user.save({ email: newEmail });

    const byNewEmail = await signInByApi(request, newEmail.toUpperCase(), customer.password);
    expect(byNewEmail.status()).toBe(200);
    expect((await byNewEmail.json() as { user: { email: string } }).user.email).toBe(newEmail);
    await expectError(await signInByApi(request, customer.email, customer.password), 401, 'AUTHENTICATION_FAILED');
    expect((await signInByApi(request, customer.username, customer.password)).status()).toBe(200);
  });

  test('E2E-11-05 full name: trimmed, spaces collapsed, 1-100 characters, no control characters or line breaks', t4, async ({ request }) => {
    const user = await ProfileApi.register(request);
    let version = 0;
    for (const [sent, stored] of [
      ['A', 'A'],
      ['x'.repeat(100), 'x'.repeat(100)],
      [` ${'y'.repeat(100)} `, 'y'.repeat(100)],
      ['  Many   inner    spaces  ', 'Many inner spaces'],
      ['নুসরাত জাহান', 'নুসরাত জাহান'],
    ]) {
      const saved = await expectProfile(await user.put(edit(version, { fullName: sent })), 200);
      expect(saved.fullName, JSON.stringify(sent)).toBe(stored);
      version = saved.version;
    }

    for (const refused of ['z'.repeat(101), 'A\u0007B', 'A\nB', 'A\r\nB', 'A\tB', 'A\u0000B']) {
      await expectError(await user.put(edit(version, { fullName: refused })), 400, 'INVALID_REQUEST');
    }
    expect(storedProfile(user.user.username)).toMatchObject({ fullName: 'নুসরাত জাহান', profileVersion: version });
  });

  test('E2E-11-06 email: the dot-atom subset of RFC 5322 within the RFC 5321 limits, lower-cased', t4, async ({ request }) => {
    const user = await ProfileApi.register(request);
    const longest = emailOfLength(254);
    expect(longest).toHaveLength(254);
    let version = 0;
    for (const accepted of [
      longest,
      `${hex()}${'l'.repeat(56)}@example.test`,
      `o'brien+tag!#$%&*/=?^_\`{|}~-${hex()}@sub.example.test`,
      `first.middle.${hex()}@example.test`,
      `${hex()}@${'d'.repeat(63)}.example.test`,
    ]) {
      const saved = await expectProfile(await user.put(edit(version, { email: accepted.toUpperCase() })), 200);
      expect(saved.email, accepted).toBe(accepted.toLowerCase());
      version = saved.version;
    }
    const kept = storedProfile(user.user.username).email;

    for (const refused of [
      emailOfLength(255), `${hex()}${'l'.repeat(57)}@example.test`, `${hex()}@${'d'.repeat(64)}.example.test`,
      'not-an-email', 'two@@example.test', 'a@b@example.test', 'a b@example.test', '@example.test', 'user@',
      'user@localhost', 'user@[127.0.0.1]', '"quoted"@example.test', 'user(comment)@example.test', 'a..b@example.test',
      '.a@example.test', 'a.@example.test', 'a@-example.test', 'a@example-.test', 'a@example..test', 'a@example.test.',
      'ä@example.test', 'a@exämple.test',
    ]) {
      await expectError(await user.put(edit(version, { email: refused })), 400, 'INVALID_REQUEST');
    }
    expect(storedProfile(user.user.username)).toMatchObject({ email: kept, profileVersion: version });
  });

  test('E2E-11-07 date of birth: ISO yyyy-MM-dd from 1900-01-01 to today in Asia/Dhaka', t4, async ({ request }) => {
    await awayFromDhakaMidnight();
    const user = await ProfileApi.register(request);
    let version = 0;
    for (const accepted of ['1900-01-01', dhakaDate(0), '2000-02-29', null]) {
      const saved = await expectProfile(await user.put(edit(version, { fullName: 'Dob Tester', dateOfBirth: accepted })), 200);
      expect(saved.dateOfBirth).toBe(accepted);
      version = saved.version;
    }

    for (const refused of ['1899-12-31', dhakaDate(1), '1990-5-1', '1990-02-30', '1990-13-01', 'yesterday', 19900501]) {
      const response = await user.put({ fullName: 'Dob Tester', email: null, dateOfBirth: refused, version });
      await expectError(response, 400, 'INVALID_REQUEST');
    }
    expect(storedProfile(user.user.username)).toMatchObject({ dateOfBirth: null, profileVersion: version });
  });

  test('E2E-11-08 the edit needs exactly fullName, email, dateOfBirth and a non-negative version', t4, async ({ request }) => {
    const user = await ProfileApi.register(request);
    const valid = edit(0, { fullName: 'Shape Tester' });

    for (const key of Object.keys(valid)) {
      const missing: Record<string, unknown> = { ...valid };
      delete missing[key];
      await expectError(await user.put(missing), 400, 'INVALID_REQUEST');
    }
    // Strict records: no coercion of a fraction, a string or a boolean into the version.
    for (const version of [-1, null, 1.5, '0', true, false]) {
      await expectError(await user.put({ ...valid, version }), 400, 'INVALID_REQUEST');
    }
    // Nor of a number or a boolean into a text field.
    for (const wrong of [{ fullName: 42 }, { fullName: true }, { email: 42 }, { email: false }]) {
      await expectError(await user.put({ ...valid, ...wrong }), 400, 'INVALID_REQUEST');
    }
    for (const extra of ['username', 'mobile', 'mobileVerified', 'pendingMobile', 'accountState', 'id', 'profileVersion']) {
      await expectError(await user.put({ ...valid, [extra]: extra === 'mobileVerified' ? true : 'x' }), 400,
        'INVALID_REQUEST');
    }
    expect(storedProfile(user.user.username)).toMatchObject({ fullName: null, profileVersion: 0 });

    // The same body without the refused parts is accepted, so the refusals above came from the shape alone.
    expect((await expectProfile(await user.put(valid), 200)).fullName).toBe('Shape Tester');
  });

  test('E2E-11-09 the username is immutable and a mass-assignment payload changes nothing', t4, async ({ request }) => {
    const customer = syntheticCustomer();
    const user = await ProfileApi.register(request, customer);
    const other = `other.${hex()}`;

    await expectError(await user.put({ username: other, fullName: null, email: null, dateOfBirth: null, version: 0 }),
      400, 'INVALID_REQUEST');
    await expectError(await user.put({ fullName: 'A', email: null, dateOfBirth: null, version: 0, mobileVerified: true,
      username: 'x', accountState: 'ACTIVE' }), 400, 'INVALID_REQUEST');

    expect(storedProfile(customer.username)).toMatchObject({
      username: customer.username, fullName: null, mobileVerified: false, accountState: 'ACTIVE', profileVersion: 0,
    });
    await expectError(await signInByApi(request, other, customer.password), 401, 'AUTHENTICATION_FAILED');
    expect((await user.profile()).username).toBe(customer.username);
  });

  test('E2E-11-10 malformed, mistyped and oversized bodies are refused on both write routes', t4, async ({ request }) => {
    const user = await ProfileApi.register(request);
    const validEdit = edit(0, { fullName: 'Padded Name' });
    const validStage = { mobile: syntheticMobile() };
    // Valid bodies one byte over the limit: only the body limit can refuse them.
    const oversizedEdit = paddedJson(validEdit, bodyLimit + 1);
    const oversizedStage = paddedJson(validStage, bodyLimit + 1);

    for (const [body, contentType] of [
      [oversizedEdit, 'application/json'],
      [JSON.stringify(edit(0, { fullName: 'Plain Text' })), 'text/plain'],
      ['{', 'application/json'],
      ['[]', 'application/json'],
      ['', 'application/json'],
    ]) {
      await expectError(await user.put(body, contentType), 400, 'INVALID_REQUEST');
    }
    for (const [body, contentType] of [
      [oversizedStage, 'application/json'],
      [JSON.stringify({ mobile: syntheticMobile() }), 'text/plain'],
      ['{', 'application/json'],
      ['', 'application/json'],
    ]) {
      await expectError(await user.stage(body, contentType), 400, 'INVALID_REQUEST');
    }
    expect(storedProfile(user.user.username)).toMatchObject({ fullName: null, profileVersion: 0, pendingChanges: [] });

    // The same bodies padded to exactly the limit are accepted, so the oversized refusals came from the size alone.
    expect(await expectProfile(await user.put(paddedJson(validEdit, bodyLimit)), 200))
      .toMatchObject({ fullName: 'Padded Name', version: 1 });
    expect((await expectProfile(await user.stage(paddedJson(validStage, bodyLimit)), 202)).pendingMobile)
      .toBe(validStage.mobile);
  });

  test('E2E-11-11 an email another User holds, in any letter case, is refused as DUPLICATE_USER', t4, async ({ request }) => {
    const other = await registerByApi(request);
    const user = await ProfileApi.register(request);

    const refused = await expectError(await user.put(edit(0, { email: other.email.toUpperCase() })), 409,
      'DUPLICATE_USER', copy.duplicateUser);
    expect(JSON.stringify(refused)).not.toContain(other.email);
    expect(JSON.stringify(refused).toLowerCase()).not.toContain(other.username);
    expect(storedProfile(user.user.username)).toMatchObject({ email: user.user.email, profileVersion: 0 });

    // The User's own email in another case is the same email: a no-op that keeps the version.
    const same = await expectProfile(await user.put(edit(0, { email: user.user.email.toUpperCase() })), 200);
    expect(same).toMatchObject({ email: user.user.email, version: 0 });
  });

  test('E2E-11-12 a stale profile save is refused with STALE_UPDATE and changes nothing', t4, async ({ request }) => {
    const user = await ProfileApi.register(request);
    await expectProfile(await user.put(edit(0, { fullName: 'Tab A' })), 200);

    await expectError(await user.put(edit(0, { fullName: 'Tab B' })), 409, 'STALE_UPDATE', copy.staleApi);

    expect(storedProfile(user.user.username)).toMatchObject({ fullName: 'Tab A', profileVersion: 1 });
    // Staging a mobile carries no version, so a stale profile screen can still stage (P5).
    expect((await expectProfile(await user.stage({ mobile: syntheticMobile() }), 202)).version).toBe(1);
  });

  test('E2E-11-13 an identical save, even with an old version after a lost response, is a no-op', t4, async ({ request }) => {
    const user = await ProfileApi.register(request);
    const body = edit(0, { fullName: 'Lost Response', dateOfBirth: '1979-11-02' });
    expect((await expectProfile(await user.put(body), 200)).version).toBe(1);

    const retried = await expectProfile(await user.put(body), 200);
    expect(retried).toMatchObject({ fullName: 'Lost Response', dateOfBirth: '1979-11-02', version: 1 });
    expect((await expectProfile(await user.put({ ...body, version: 1 }), 200)).version).toBe(1);
    // Fields are normalized before the no-op check, and the no-op check runs before the version check (§4.1).
    const normalized = await expectProfile(await user.put({ ...body, fullName: '  Lost   Response ' }), 200);
    expect(normalized).toMatchObject({ fullName: 'Lost Response', version: 1 });
    // A different value at the old version is not a no-op, so the version check refuses it.
    await expectError(await user.put({ ...body, fullName: 'Lost Response Changed' }), 409, 'STALE_UPDATE', copy.staleApi);
    expect(storedProfile(user.user.username)).toMatchObject({ fullName: 'Lost Response', profileVersion: 1 });
  });

  test('E2E-11-14 two concurrent saves from one version: one succeeds, one is STALE_UPDATE', t4, async ({ request }) => {
    const user = await ProfileApi.register(request);
    await user.bearer();

    const [first, second] = await Promise.all([
      user.put(edit(0, { fullName: 'Racer One' })),
      user.put(edit(0, { fullName: 'Racer Two' })),
    ]);

    expect([first.status(), second.status()].sort()).toEqual([200, 409]);
    const [winner, loser] = first.status() === 200 ? [first, second] : [second, first];
    await expectError(loser, 409, 'STALE_UPDATE', copy.staleApi);
    const won = await expectProfile(winner, 200);
    expect(storedProfile(user.user.username)).toMatchObject({ fullName: won.fullName, profileVersion: 1 });
  });

  test('E2E-11-15 two concurrent identical saves both succeed with one version bump', t4, async ({ request }) => {
    const user = await ProfileApi.register(request);
    await user.bearer();
    const body = edit(0, { fullName: 'Twin Save' });

    const answers = await Promise.all([user.put(body), user.put(body)]);

    for (const answer of answers) expect(await expectProfile(answer, 200)).toMatchObject({ fullName: 'Twin Save', version: 1 });
    expect(storedProfile(user.user.username).profileVersion).toBe(1);
  });

  test('E2E-11-16 two Users racing to the same new email: one succeeds, one is DUPLICATE_USER', t4, async ({ request }) => {
    const [first, second] = await Promise.all([ProfileApi.register(request), ProfileApi.register(request)]);
    await Promise.all([first.bearer(), second.bearer()]);
    const email = `contested.${hex()}@example.test`;

    const answers = await Promise.all([first.put(edit(0, { email })), second.put(edit(0, { email: email.toUpperCase() }))]);

    expect(answers.map((answer) => answer.status()).sort()).toEqual([200, 409]);
    await expectError(answers.find((answer) => answer.status() === 409)!, 409, 'DUPLICATE_USER', copy.duplicateUser);
    const holders = [first, second].filter(({ user }) => storedProfile(user.username).email === email);
    expect(holders).toHaveLength(1);
  });

  test('E2E-11-17 a staged mobile is pending: the current mobile, /api/user/me and the version are unchanged', t4, async ({ request }) => {
    const customer = syntheticCustomer();
    const user = await ProfileApi.register(request, customer);
    await user.save({ fullName: 'Staged Tester' });
    const newMobile = syntheticMobile();

    const staged = await expectProfile(await user.stage({ mobile: newMobile }), 202);

    expect(staged).toMatchObject({
      mobile: customer.mobile, mobileVerified: false, pendingMobile: newMobile, fullName: 'Staged Tester', version: 1,
    });
    expect(await user.profile()).toEqual(staged);
    const me = await request.get(`${apiUrl}/api/user/me`, { headers: await user.headers() });
    expect(await me.json()).toEqual({
      username: customer.username, mobile: customer.mobile, email: customer.email, mobileVerified: false,
    });
    const stored = storedProfile(customer.username);
    expect(stored).toMatchObject({ mobile: customer.mobile, mobileVerified: false, profileVersion: 1 });
    expect(stored.pendingChanges.map(({ newMobile: mobile }) => mobile)).toEqual([newMobile]);
  });

  test('E2E-11-18 sign-in keeps using the current verified mobile while a change is pending', t4, async ({ request }) => {
    const customer = syntheticCustomer();
    const user = await ProfileApi.register(request, customer);
    markMobileVerified(customer.username);
    const newMobile = syntheticMobile();
    await expectProfile(await user.stage({ mobile: newMobile }), 202);

    const byCurrent = await signInByApi(request, customer.mobile, customer.password);
    expect(byCurrent.status()).toBe(200);
    expect((await byCurrent.json() as { user: unknown }).user).toEqual({
      username: customer.username, mobile: customer.mobile, email: customer.email, mobileVerified: true,
    });
    await expectError(await signInByApi(request, newMobile, customer.password), 401, 'AUTHENTICATION_FAILED');
    expect(await user.profile()).toMatchObject({ mobile: customer.mobile, mobileVerified: true, pendingMobile: newMobile });
  });

  test('E2E-11-19 a new mobile keeps the registration format: exactly 11 digits after trimming, not the current one', t4, async ({ request }) => {
    const customer = syntheticCustomer();
    const user = await ProfileApi.register(request, customer);

    for (const refused of [{ mobile: '' }, { mobile: '   ' }, { mobile: syntheticDigits(10) }, { mobile: syntheticDigits(12) },
      { mobile: `+88${syntheticDigits(11)}` }, { mobile: `${syntheticDigits(10)}x` }, { mobile: '0171-2345678' },
      { mobile: '0171 2345678' }, { mobile: '০১৭১২৩৪৫৬৭৮' }, { mobile: '０１７１２３４５６７８' }, { mobile: 17123456789 },
      { mobile: true }, { mobile: customer.mobile }, { mobile: `  ${customer.mobile}  ` }, {}, { mobile: null },
      { mobile: syntheticMobile(), mobileVerified: true }, { mobile: syntheticMobile(), username: 'x' }]) {
      await expectError(await user.stage(refused), 400, 'INVALID_REQUEST');
    }
    expect(storedProfile(customer.username).pendingChanges).toEqual([]);

    // Only trimmed, as at registration: no +880 canonicalization before Ticket 61 (P12).
    const trimmed = syntheticMobile();
    expect((await expectProfile(await user.stage({ mobile: `\t ${trimmed}  ` }), 202)).pendingMobile).toBe(trimmed);
    expect(storedProfile(customer.username).pendingChanges.map(({ newMobile }) => newMobile)).toEqual([trimmed]);
  });

  test('E2E-11-20 a mobile that belongs to another User is refused as DUPLICATE_USER', t4, async ({ request }) => {
    const other = await registerByApi(request);
    const user = await ProfileApi.register(request);

    for (const mobile of [other.mobile, ` ${other.mobile} `]) {
      const refused = await expectError(await user.stage({ mobile }), 409, 'DUPLICATE_USER', copy.duplicateUser);
      expect(JSON.stringify(refused)).not.toContain(other.mobile);
    }
    expect(storedProfile(user.user.username).pendingChanges).toEqual([]);
    expect((await user.profile()).pendingMobile).toBeNull();
  });

  test('E2E-11-21 a pending number reserves nothing: two Users may stage it and a new User may register it', t4, async ({ request }) => {
    const [first, second] = await Promise.all([ProfileApi.register(request), ProfileApi.register(request)]);
    const contested = syntheticMobile();

    expect((await expectProfile(await first.stage({ mobile: contested }), 202)).pendingMobile).toBe(contested);
    expect((await expectProfile(await second.stage({ mobile: contested }), 202)).pendingMobile).toBe(contested);
    await registerByApi(request, { ...syntheticCustomer(), mobile: contested });

    // Now the number belongs to a User: staging it again is refused and the earlier pending change stays.
    await expectError(await first.stage({ mobile: contested }), 409, 'DUPLICATE_USER', copy.duplicateUser);
    expect((await first.profile()).pendingMobile).toBe(contested);
  });

  test('E2E-11-22 a newer stage replaces the pending change with a new one', t4, async ({ request }) => {
    const user = await ProfileApi.register(request);
    const [second, third] = [syntheticMobile(), syntheticMobile()];

    await expectProfile(await user.stage({ mobile: second }), 202);
    const [original] = storedProfile(user.user.username).pendingChanges;
    expect((await expectProfile(await user.stage({ mobile: third }), 202)).pendingMobile).toBe(third);
    const [replacement] = storedProfile(user.user.username).pendingChanges;
    expect(storedProfile(user.user.username).pendingChanges).toHaveLength(1);
    expect(replacement.newMobile).toBe(third);
    expect(replacement.id).not.toBe(original.id);

    // Staging the same number again is still a new change, so a verification of the old one cannot apply.
    await expectProfile(await user.stage({ mobile: third }), 202);
    const pending = storedProfile(user.user.username).pendingChanges;
    expect(pending).toHaveLength(1);
    expect(pending[0].id).not.toBe(replacement.id);
  });

  test('E2E-11-23 cancelling a pending change answers 204 and is idempotent', t4, async ({ request }) => {
    const customer = syntheticCustomer();
    const user = await ProfileApi.register(request, customer);
    const nothingPending = await user.cancel();
    expect(nothingPending.status()).toBe(204);
    await expectProfile(await user.stage({ mobile: syntheticMobile() }), 202);

    const cancelled = await user.cancel();

    expect(cancelled.status()).toBe(204);
    expect((await cancelled.body()).length).toBe(0);
    expectNoStore(cancelled);
    expect(await user.profile()).toMatchObject({ mobile: customer.mobile, pendingMobile: null });
    expect(storedProfile(customer.username).pendingChanges).toEqual([]);
    expect((await user.cancel()).status()).toBe(204);
  });

  test('E2E-11-24 two concurrent stages leave exactly one pending change', t4, async ({ request }) => {
    const user = await ProfileApi.register(request);
    await user.bearer();
    const numbers = [syntheticMobile(), syntheticMobile()];

    const answers = await Promise.all(numbers.map((mobile) => user.stage({ mobile })));

    for (const answer of answers) await expectProfile(answer, 202);
    const pending = storedProfile(user.user.username).pendingChanges;
    expect(pending).toHaveLength(1);
    expect(numbers).toContain(pending[0].newMobile);
    expect((await user.profile()).pendingMobile).toBe(pending[0].newMobile);
  });

  test('E2E-11-25 no HTTP route verifies or applies a staged mobile', t4, async ({ request }) => {
    const customer = syntheticCustomer();
    const user = await ProfileApi.register(request, customer);
    const newMobile = syntheticMobile();
    await expectProfile(await user.stage({ mobile: newMobile }), 202);
    const json = await user.headers({ 'Content-Type': 'application/json' });

    const attempts: [string, Promise<APIResponse>][] = [
      ['POST verify', request.post(`${apiUrl}${mobileChangePath}/verify`, { headers: json, data: JSON.stringify({ code: '123456' }) })],
      ['POST activate', request.post(`${apiUrl}${mobileChangePath}/activate`, { headers: json, data: '{}' })],
      ['POST confirm', request.post(`${apiUrl}${mobileChangePath}/confirm`, { headers: json, data: JSON.stringify({ code: '123456' }) })],
      ['PUT mobile-change', request.put(`${apiUrl}${mobileChangePath}`, { headers: json, data: JSON.stringify({ mobile: newMobile }) })],
      ['PATCH profile', request.patch(`${apiUrl}${profilePath}`, { headers: json, data: JSON.stringify({ mobile: newMobile }) })],
      ['PUT /api/user/me', request.put(`${apiUrl}/api/user/me`, { headers: json, data: JSON.stringify({ mobile: newMobile }) })],
      ['POST /api/user/me/mobile', request.post(`${apiUrl}/api/user/me/mobile`, { headers: json, data: JSON.stringify({ mobile: newMobile }) })],
    ];
    // Only an answer that shows no handler ran is accepted: refused before dispatch by the deny-all rule (401 for a
    // path the Bearer filter does not cover, 403 for one it does) or no such path or method (404, 405). A 400, 409,
    // 415 or 5xx would mean a handler parsed the request, so the route exists.
    const noRoute: Record<number, string> = {
      401: 'AUTHENTICATION_REQUIRED', 403: 'ACCESS_DENIED', 404: 'NOT_FOUND', 405: 'METHOD_NOT_ALLOWED',
    };
    for (const [name, attempt] of attempts) {
      const answer = await attempt;
      expect(Object.keys(noRoute).map(Number), `${name} answered ${answer.status()}`).toContain(answer.status());
      await expectError(answer, answer.status(), noRoute[answer.status()]);
    }

    expect(await user.profile()).toMatchObject({ mobile: customer.mobile, mobileVerified: false, pendingMobile: newMobile });
    expect(storedProfile(customer.username)).toMatchObject({ mobile: customer.mobile, mobileVerified: false });
  });

  test('E2E-11-26 a closing account can be read but every edit is ACCOUNT_CLOSING, even from a stale screen', t4, async ({ request }) => {
    const customer = syntheticCustomer();
    const user = await ProfileApi.register(request, customer);
    const other = await registerByApi(request);
    const saved = await user.save({ fullName: 'Closing Soon', dateOfBirth: '1970-06-15' });
    const pendingMobile = syntheticMobile();
    await expectProfile(await user.stage({ mobile: pendingMobile }), 202);
    const before = storedProfile(customer.username);

    setAccountState(customer.username, 'CLOSURE_REQUESTED');

    expect(await user.profile()).toEqual({ ...saved, pendingMobile, accountState: 'CLOSURE_REQUESTED' });
    for (const body of [
      edit(1, { fullName: 'Changed Anyway' }),
      edit(0, { fullName: 'Stale Screen' }),
      { fullName: saved.fullName, email: saved.email, dateOfBirth: saved.dateOfBirth, version: saved.version },
      edit(1, { fullName: 'Closing Soon', dateOfBirth: '1899-12-31' }),
    ]) {
      await expectError(await user.put(body), 409, 'ACCOUNT_CLOSING', copy.closingApi);
    }
    for (const mobile of [syntheticMobile(), other.mobile]) {
      await expectError(await user.stage({ mobile }), 409, 'ACCOUNT_CLOSING', copy.closingApi);
    }
    await expectError(await user.cancel(), 409, 'ACCOUNT_CLOSING', copy.closingApi);
    expect(storedProfile(customer.username)).toEqual({ ...before, accountState: 'CLOSURE_REQUESTED' });

    // Control: the same account in ACTIVE state accepts the edit, so the refusals came from the state alone.
    setAccountState(customer.username, 'ACTIVE');
    expect((await expectProfile(await user.put(edit(1, { fullName: 'Changed Anyway' })), 200)).version).toBe(2);
  });

  test('E2E-11-27 every profile route needs a current session: missing, malformed and revoked tokens get 401', t4, async ({ request }) => {
    const customer = syntheticCustomer();
    await registerByApi(request, customer);
    const session = await apiRequest.newContext();
    try {
      const signedIn = await signInByApi(session, customer.username, customer.password);
      const { accessToken } = await signedIn.json() as { accessToken: string };
      const { csrfToken } = await (await session.get(`${apiUrl}/api/auth/csrf`)).json() as { csrfToken: string };
      expect((await session.post(`${apiUrl}/api/auth/logout`, { headers: { 'X-XSRF-TOKEN': csrfToken } })).status())
        .toBe(204);

      const attempts: Record<string, string>[] = [
        {}, { Authorization: 'Bearer not-a-token' }, { Authorization: `Bearer ${accessToken}` }];
      for (const headers of attempts) {
        for (const answer of await Promise.all(everyRoute(request, headers))) {
          await expectError(answer, 401, 'AUTHENTICATION_REQUIRED');
          expect(answer.headers()['www-authenticate']).toBe('Bearer');
        }
      }
    } finally {
      await session.dispose();
    }
    expect(storedProfile(customer.username)).toMatchObject({ fullName: null, profileVersion: 0, pendingChanges: [] });
  });

  test("E2E-11-28 one User's token never reads or changes another User's profile", t4, async ({ request }) => {
    const victim = await ProfileApi.register(request);
    await victim.save({ fullName: 'Victim Profile', email: `victim.${hex()}@example.test`, dateOfBirth: '1991-03-03' });
    const victimMobile = syntheticMobile();
    await expectProfile(await victim.stage({ mobile: victimMobile }), 202);
    const before = storedProfile(victim.user.username);
    const secrets = [victim.user.username, 'Victim Profile', before.email!, victim.user.mobile, victimMobile, before.id];

    await expectNoForeignProfile(request, await ProfileApi.register(request), before.id, victim.user.username, secrets);

    expect(storedProfile(victim.user.username)).toEqual(before);
    expect(await victim.profile()).toMatchObject({ fullName: 'Victim Profile', pendingMobile: victimMobile });
  });

  test('E2E-11-29 restricted staff sessions get MFA_REQUIRED on every profile route', t4, async ({ request }) => {
    for (const role of ['ADMIN', 'MODERATOR'] as const) {
      const staff = await registerByApi(request);
      grantRole(staff.username, role);
      const signedIn = await signInByApi(request, staff.username, staff.password);
      const { accessToken, mfa } = await signedIn.json() as { accessToken: string; mfa: string };
      expect(mfa).toBe('ENROLLMENT_REQUIRED');

      for (const answer of await Promise.all(everyRoute(request, { Authorization: `Bearer ${accessToken}` }))) {
        await expectError(answer, 403, 'MFA_REQUIRED');
      }
      expect(storedProfile(staff.username)).toMatchObject({ fullName: null, profileVersion: 0, pendingChanges: [] });
    }
  });

  test('E2E-11-30 MFA-verified staff and DeliveryPersons edit their own profile', t4, async ({ request }) => {
    // Each holds only their staff role, with no CUSTOMER role: the profile routes admit every role (DECISIONS S6).
    const deliveryPerson = await registerByApi(request);
    grantRole(deliveryPerson.username, 'DELIVERY_PERSON');
    expect(storedRoles(deliveryPerson.username)).toEqual(['DELIVERY_PERSON']);
    const delivery = ProfileApi.forUser(request, deliveryPerson);
    expect((await (await signInByApi(request, deliveryPerson.username, deliveryPerson.password)).json() as { mfa: string })
      .mfa).toBe('NOT_REQUIRED');

    // The verified Admin session lives in its own request context and is refreshed as its token ages.
    const admin = await verifiedStaff('ADMIN');
    try {
      expect(storedRoles(admin.user.username)).toEqual(['ADMIN']);

      for (const user of [admin, delivery]) {
        expect((await user.profile()).username).toBe(user.user.username);
        expect((await user.save({ fullName: 'Staff Member' })).fullName).toBe('Staff Member');
        await expectProfile(await user.stage({ mobile: syntheticMobile() }), 202);
        expect((await user.cancel()).status()).toBe(204);
        expect(storedProfile(user.user.username)).toMatchObject({ fullName: 'Staff Member', profileVersion: 1, pendingChanges: [] });
      }
    } finally {
      await admin.api.dispose();
    }
  });

  test('E2E-11-31 CORS preflights allow PUT, POST and DELETE from the storefront origin only', t4, async ({ request }) => {
    const preflight = (path: string, method: string, origin = frontendUrl) => request.fetch(`${apiUrl}${path}`, {
      method: 'OPTIONS',
      headers: { Origin: origin, 'Access-Control-Request-Method': method,
        'Access-Control-Request-Headers': 'authorization,content-type' },
    });

    for (const [path, method] of [[profilePath, 'GET'], [profilePath, 'PUT'], [mobileChangePath, 'POST'],
      [mobileChangePath, 'DELETE']]) {
      const answer = await preflight(path, method);
      expect(answer.status(), `${method} ${path}`).toBe(200);
      expect(answer.headers()['access-control-allow-origin']).toBe(frontendUrl);
      expect(answer.headers()['access-control-allow-methods'].split(/\s*,\s*/)).toContain(method);
    }
    expect((await preflight(mobileChangePath, 'DELETE', frontendUrl.replace('127.0.0.1', 'localhost'))).status()).toBe(403);
  });

  test('E2E-11-32 a profile edit and mobile changes rewrite no other table and never the username (R1)', t4, async ({ request }) => {
    const customer: Customer = syntheticCustomer();
    const user = await ProfileApi.register(request, customer);
    await user.bearer();
    const before = tableFingerprints(profileWritableTables);

    const steps: (() => Promise<unknown>)[] = [
      async () => expectProfile(await user.put(edit(0, { fullName: 'Regression Check', email: `r1.${hex()}@example.test`,
        dateOfBirth: '1988-08-08' })), 200),
      async () => expectProfile(await user.stage({ mobile: syntheticMobile() }), 202),
      async () => expect((await user.cancel()).status()).toBe(204),
      async () => expectProfile(await user.stage({ mobile: syntheticMobile() }), 202),
      async () => expectProfile(await user.put(edit(1, { fullName: null })), 200),
    ];
    for (const step of steps) {
      await step();
      expect(storedProfile(customer.username).username).toBe(customer.username);
    }

    expect(tableFingerprints(profileWritableTables)).toEqual(before);
  });

  test("E2E-11-49 a Moderator and an Admin, each holding only their staff role, edit their own profile and never reach a Customer's",
    t4, async ({ request }) => {
      const victim = await ProfileApi.register(request);
      await victim.save({ fullName: 'Customer Profile', email: `customer.${hex()}@example.test`, dateOfBirth: '1992-04-04' });
      const before = storedProfile(victim.user.username);
      const secrets = [victim.user.username, 'Customer Profile', before.email!, victim.user.mobile, before.id];

      for (const role of ['MODERATOR', 'ADMIN'] as const) {
        // The staff role inherits the Customer's features, but the profile routes still act only on the caller.
        const staff = await verifiedStaff(role);
        try {
          expect(storedRoles(staff.user.username)).toEqual([role]);
          expect((await staff.save({ fullName: `${role} Member` })).fullName).toBe(`${role} Member`);
          await expectNoForeignProfile(request, staff, before.id, victim.user.username, secrets);
        } finally {
          await staff.api.dispose();
        }
      }

      expect(storedProfile(victim.user.username)).toEqual(before);
    });

  test('E2E-11-50 registration applies the identifier formats: username 3-20, mobile 11 digits, the email subset', t2, async ({ request }) => {
    const longest = { ...syntheticCustomer(), username: `u${hex()}${'z'.repeat(11)}` };
    expect(longest.username).toHaveLength(20);
    await registerByApi(request, longest);
    expect((await signInByApi(request, longest.username, longest.password)).status()).toBe(200);

    const refused: Partial<Customer>[] = [
      { username: `u${hex()}${'z'.repeat(12)}` },
      { username: `u${hex()}@x` },
      { username: syntheticDigits(11) },
      { mobile: syntheticDigits(10) },
      { mobile: syntheticDigits(12) },
      { mobile: `+88${syntheticDigits(11)}` },
      { mobile: `${syntheticDigits(10)}x` },
      { mobile: '0171-2345678' },
      { mobile: '০১৭১২৩৪৫৬৭৮' },
      { email: emailOfLength(255) },
      { email: `${hex()}${'l'.repeat(57)}@example.test` },
      { email: `a..${hex()}@example.test` },
      { email: `"q${hex()}"@example.test` },
      { email: `u${hex()}@[127.0.0.1]` },
      { email: `u${hex()}@localhost` },
    ];
    expect(refused[0].username).toHaveLength(21);
    for (const fields of refused) {
      const customer = { ...syntheticCustomer(), ...fields };
      await expectError(await postRegistration(request, customer), 400, 'INVALID_REQUEST');
      // Nothing was created: neither the attempted username nor the valid parts of the attempt sign in.
      for (const identifier of [customer.username, customer.email]) {
        await expectError(await signInByApi(request, identifier, customer.password), 401, 'AUTHENTICATION_FAILED');
      }
    }
  });

  test("E2E-11-51 no identifier can take another kind's value: usernames, mobiles and emails never collide", t4, async ({ request }) => {
    // A username has a letter and no @, a mobile is 11 digits and an email has an @ (P12), so each refusal is a
    // format refusal (400), never a duplicate check (409): the formats alone make the collision impossible.
    const owner = await ProfileApi.register(request);
    const { username, mobile, email } = owner.user;
    const user = await ProfileApi.register(request);

    for (const value of [username, email]) {
      await expectError(await user.stage({ mobile: value }), 400, 'INVALID_REQUEST');
      await expectError(await postRegistration(request, { ...syntheticCustomer(), mobile: value }), 400, 'INVALID_REQUEST');
    }
    for (const value of [mobile, email]) {
      await expectError(await postRegistration(request, { ...syntheticCustomer(), username: value }), 400, 'INVALID_REQUEST');
    }
    for (const value of [username, mobile]) {
      await expectError(await user.put(edit(0, { email: value })), 400, 'INVALID_REQUEST');
      await expectError(await postRegistration(request, { ...syntheticCustomer(), email: value }), 400, 'INVALID_REQUEST');
    }
    expect(storedProfile(user.user.username)).toMatchObject({ email: user.user.email, profileVersion: 0, pendingChanges: [] });

    // Each of the owner's identifiers still names only the owner.
    for (const identifier of [username, email]) {
      const signedIn = await signInByApi(request, identifier, owner.user.password);
      expect(signedIn.status()).toBe(200);
      expect((await signedIn.json() as { user: { username: string } }).user.username).toBe(username);
    }
  });
});
