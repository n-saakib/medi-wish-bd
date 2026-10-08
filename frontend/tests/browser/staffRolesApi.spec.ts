import { randomBytes, randomUUID } from 'node:crypto';
import { expect, test, type APIResponse } from '@playwright/test';
import {
  ApiSession, apiCustomer, apiStaff, apiSuperAdmin, changeRole, expectActive, expectError, expectRevoked, findUser,
  getUserRoles, listUsers, putRole, readUserRoles, roleChangeFields, roleChangeRows, roleOrder, signInAgain,
  roleRequiredError, storedRoles, tryAddSecondRole, tryAuditRow, tryDeleteOnlyRole, tryReplaceRole,
  tryRoleDeletedThenIdChanged, tryUserWithoutRole,
  userRolesFields, userSummaryFields, type ApiActor, type ErrorCode, type Role, type UserPage, type UserRoles,
} from './apiSession';
import { registerThroughApi, syntheticCustomer } from './support';
import { apiUrl, frontendUrl, grantRole, rolledBackSql, sessionStates } from './testApi';

/**
 * Ticket 08 at the API: the role routes of plan §4.2 exercised directly against the test API, as a script or `curl`
 * would, without the pages. Every User holds exactly one role and higher roles inherit lower ones (DECISIONS S6).
 * Each test registers its own synthetic Users. Tags: `@t08` plus the one sub-ticket whose completion makes the test
 * pass (plan §10).
 */

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** What an ordinary Admin may set for a User who is not an Admin (S5: never ADMIN). */
const ordinaryAssignable: Role[] = ['CUSTOMER', 'DELIVERY_PERSON', 'MODERATOR'];

type RouteMethod = 'GET' | 'POST' | 'PUT';

/** Each role route answers `status`/`code` for this caller (a random, well-formed target id). */
async function expectEveryRoleRoute(call: (method: RouteMethod, path: string, data?: unknown) => Promise<APIResponse>,
  status: number, code: ErrorCode): Promise<void> {
  const target = randomUUID();
  await expectError(await call('POST', '/api/admin/users/search', {}), status, code);
  await expectError(await call('POST', '/api/admin/users/search', { username: 'journey', role: 'ADMIN', page: 0, size: 20 }),
    status, code);
  await expectError(await call('GET', `/api/admin/users/${target}`), status, code);
  await expectError(await call('PUT', `/api/admin/users/${target}/roles`, { role: 'MODERATOR', rolesVersion: 0 }),
    status, code);
}

function asCaller(session: ApiSession) {
  return (method: RouteMethod, path: string, data?: unknown) => session.call(method, path, { data });
}

/** The id of a User, looked up by an Admin through the search's username filter. */
async function idOf(admin: ApiActor, user: ApiActor | { username: string }): Promise<string> {
  return (await findUser(admin.session, 'user' in user ? user.user.username : user.username)).id;
}

/** A User whose role has not changed: still `role`, version 0, no history, one stored role. */
async function expectUnchanged(admin: ApiActor, id: string, username: string, role: Role = 'CUSTOMER'): Promise<void> {
  const current = await readUserRoles(admin.session, id);
  expect({ role: current.role, rolesVersion: current.rolesVersion, roleChanges: current.roleChanges })
    .toEqual({ role, rolesVersion: 0, roleChanges: [] });
  expect(storedRoles(username)).toEqual([role]);
}

/** `old → new` for each change, in the order given. */
function transitions(changes: readonly { oldRole: string; newRole: string }[]): string[] {
  return changes.map(({ oldRole, newRole }) => `${oldRole} → ${newRole}`);
}

/** Refreshes a session just before a change, so `expectRevoked` can tell revocation from expiry. */
async function freshen(actor: ApiActor): Promise<void> {
  expect((await actor.session.refresh()).status(), 'refresh before the change').toBe(200);
}

async function disposeAll(...actors: ApiActor[]): Promise<void> {
  for (const actor of actors) await actor.session.dispose();
}

// ---------------------------------------------------------------------------------------------------------------------
// T2: the database keeps one role per User and audits one transition
// ---------------------------------------------------------------------------------------------------------------------

test('E2E-08-51 the database holds exactly one role per User, never none, and accepts only real old → new transitions',
  { tag: ['@t08', '@t08-T2'] }, async ({ request }) => {
    const customer = await registerThroughApi(request);
    expect(storedRoles(customer.username), 'registration creates exactly CUSTOMER').toEqual(['CUSTOMER']);

    await test.step('a second user_roles row for the same User is refused by the key on user_id', async () => {
      expect(tryAddSecondRole(customer.username, 'ADMIN')).toContain('pk_user_roles');
      expect(tryAddSecondRole(customer.username, 'CUSTOMER')).toContain('pk_user_roles');
    });

    await test.step('every User keeps a role: committing a User without one, or deleting the only one, fails', async () => {
      // Deferred constraint triggers: forced here with SET CONSTRAINTS ALL IMMEDIATE, as a commit would run them.
      expect(tryUserWithoutRole(customer.username), 'a User inserted without a role').toContain(roleRequiredError);
      expect(tryDeleteOnlyRole(customer.username), 'the only role deleted').toContain(roleRequiredError);
      expect(tryRoleDeletedThenIdChanged(customer.username), 'the only role deleted, then the User id changed')
        .toContain(roleRequiredError);
      // Replacing the role inside one transaction (delete, then insert) commits.
      expect(tryReplaceRole(customer.username, 'MODERATOR')).toBe('');
    });

    await test.step('only the four roles may be stored', async () => {
      const refused = rolledBackSql("UPDATE user_roles SET role = 'SUPER_ADMIN' WHERE user_id ="
        + ` (SELECT id FROM users WHERE username = '${customer.username}');`);
      expect(refused.error).toContain('ck_user_roles_role');
    });

    await test.step('the audit accepts every real transition, including to and from CUSTOMER, and nothing else', async () => {
      expect(tryAuditRow(customer.username, 'CUSTOMER', 'MODERATOR')).toBe('');
      expect(tryAuditRow(customer.username, 'ADMIN', 'CUSTOMER')).toBe('');
      expect(tryAuditRow(customer.username, 'CUSTOMER', 'SUPER_ADMIN')).toContain('ck_user_role_changes_new_role');
      expect(tryAuditRow(customer.username, 'OWNER', 'CUSTOMER')).toContain('ck_user_role_changes_old_role');
      expect(tryAuditRow(customer.username, 'MODERATOR', 'MODERATOR')).toContain('ck_user_role_changes_changed');
    });

    const version = rolledBackSql(`SELECT roles_version FROM users WHERE username = '${customer.username}';`);
    expect(version).toEqual({ output: '0', error: '' });
    expect(storedRoles(customer.username), 'the probes left nothing behind').toEqual(['CUSTOMER']);
  });

// ---------------------------------------------------------------------------------------------------------------------
// T4: routes, authorization, the role hierarchy and request validation
// ---------------------------------------------------------------------------------------------------------------------

test('E2E-08-01 anonymous callers and invalid tokens get 401 from every role route', { tag: ['@t08', '@t08-T4'] },
  async ({ request }) => {
    const anonymous = (method: RouteMethod, path: string, data?: unknown) =>
      request.fetch(`${apiUrl}${path}`, { method, data });
    await expectEveryRoleRoute(anonymous, 401, 'AUTHENTICATION_REQUIRED');

    const forged = (method: RouteMethod, path: string, data?: unknown) =>
      request.fetch(`${apiUrl}${path}`, { method, data, headers: { Authorization: 'Bearer not-a-real-token' } });
    await expectEveryRoleRoute(forged, 401, 'AUTHENTICATION_REQUIRED');
  });

test('E2E-08-02 Customers and DeliveryPersons get 403 ACCESS_DENIED from every role route',
  { tag: ['@t08', '@t08-T4'] }, async ({ request }) => {
    const customer = await apiCustomer(request);
    const deliveryPerson = await apiStaff(request, 'DELIVERY_PERSON');
    // DeliveryPerson carries no MFA mandate (AC4): the password session is complete and reads its own profile.
    expect(deliveryPerson.session.mfa).toBe('NOT_REQUIRED');
    await expectActive(deliveryPerson.session);

    await expectEveryRoleRoute(asCaller(customer.session), 403, 'ACCESS_DENIED');
    await expectEveryRoleRoute(asCaller(deliveryPerson.session), 403, 'ACCESS_DENIED');
    await disposeAll(customer, deliveryPerson);
  });

test('E2E-08-03 a verified Moderator gets 403 ACCESS_DENIED from every role route', { tag: ['@t08', '@t08-T4'] },
  async ({ request }) => {
    const moderator = await apiStaff(request, 'MODERATOR');
    expect(moderator.session.mfa).toBe('VERIFIED');
    // The Moderator really is verified staff: the staff profile answers, with the one role.
    const staff = await moderator.session.call('GET', '/api/staff/me');
    expect(staff.status()).toBe(200);
    expect(await staff.json()).toEqual({ username: moderator.user.username, roles: ['MODERATOR'], superAdmin: false });

    await expectEveryRoleRoute(asCaller(moderator.session), 403, 'ACCESS_DENIED');
    await disposeAll(moderator);
  });

/**
 * A restricted staff session holds no role authority at all, so the hierarchy grants it nothing below its role either:
 * the role routes and the Moderator- and Customer-level routes all answer 403 MFA_REQUIRED.
 */
async function expectRestricted(session: ApiSession): Promise<void> {
  await expectEveryRoleRoute(asCaller(session), 403, 'MFA_REQUIRED');
  await expectError(await session.call('GET', '/api/staff/me'), 403, 'MFA_REQUIRED');
  await expectError(await session.call('GET', '/api/user/me'), 403, 'MFA_REQUIRED');
}

test('E2E-08-04 restricted Admin sessions get 403 MFA_REQUIRED from every role route and every lower-role route',
  { tag: ['@t08', '@t08-T4'] }, async ({ request }) => {
    // An Admin who has never enrolled: the password session may only set up an authenticator.
    const unenrolled = await registerThroughApi(request);
    grantRole(unenrolled.username, 'ADMIN');
    const enrollment = await ApiSession.signIn(unenrolled);
    expect(enrollment.mfa).toBe('ENROLLMENT_REQUIRED');
    await expectRestricted(enrollment);
    await enrollment.dispose();

    // An enrolled Admin who signed in again but has not entered a code yet.
    const admin = await apiStaff(request, 'ADMIN');
    expect(await signInAgain(admin)).toBe('VERIFICATION_REQUIRED');
    await expectRestricted(admin.session);
    await disposeAll(admin);
  });

test('E2E-08-50 the role hierarchy: each role reaches its own and every lower role’s routes, never a higher one (AC4)',
  { tag: ['@t08', '@t08-T4'] }, async ({ request }) => {
    const customer = await apiCustomer(request);
    const deliveryPerson = await apiStaff(request, 'DELIVERY_PERSON');
    const moderator = await apiStaff(request, 'MODERATOR');
    const admin = await apiStaff(request, 'ADMIN');
    const everyone = [customer, deliveryPerson, moderator, admin];
    // Each User holds exactly one role: the Admin does not also hold MODERATOR or CUSTOMER.
    expect(everyone.map((actor) => storedRoles(actor.user.username)))
      .toEqual([['CUSTOMER'], ['DELIVERY_PERSON'], ['MODERATOR'], ['ADMIN']]);

    await test.step('Customer level (`GET /api/user/me`): every role', async () => {
      for (const actor of everyone) await expectActive(actor.session);
    });

    await test.step('Moderator level (`GET /api/staff/me`): the Admin through the hierarchy, not DeliveryPerson or Customer', async () => {
      const adminStaff = await admin.session.call('GET', '/api/staff/me');
      expect(adminStaff.status()).toBe(200);
      expect(await adminStaff.json()).toEqual({ username: admin.user.username, roles: ['ADMIN'], superAdmin: false });
      expect((await moderator.session.call('GET', '/api/staff/me')).status()).toBe(200);
      await expectError(await deliveryPerson.session.call('GET', '/api/staff/me'), 403, 'ACCESS_DENIED');
      await expectError(await customer.session.call('GET', '/api/staff/me'), 403, 'ACCESS_DENIED');
    });

    await test.step('Admin level (the role routes): the Admin only', async () => {
      expect((await listUsers(admin.session)).status()).toBe(200);
      for (const lower of [moderator, deliveryPerson, customer]) {
        await expectError(await listUsers(lower.session), 403, 'ACCESS_DENIED');
      }
    });
    // DeliveryPerson level: no DeliveryPerson route exists on dev or in Ticket 08. The first ticket that adds one
    // (Tickets 40 and 41) proves that Moderators and Admins reach it and Customers do not (plan §10.6).
    await disposeAll(...everyone);
  });

test('E2E-08-05 a verified Admin searches Users with an empty filter: the bounded summary, sorted and not cached',
  { tag: ['@t08', '@t08-T4'] }, async ({ request }) => {
    const admin = await apiStaff(request, 'ADMIN');

    const response = await listUsers(admin.session);
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toBe('no-store');
    const body = await response.json() as UserPage;
    expect(Object.keys(body).sort()).toEqual(['items', 'page', 'size', 'totalItems']);
    expect({ page: body.page, size: body.size }).toEqual({ page: 0, size: 20 });
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.length).toBeLessThanOrEqual(20);
    expect(body.totalItems).toBeGreaterThanOrEqual(body.items.length);
    for (const item of body.items) {
      expect(Object.keys(item).sort()).toEqual(userSummaryFields);
      expect(item.id).toMatch(uuidPattern);
      expect(roleOrder).toContain(item.role);
      expect(Number.isNaN(Date.parse(item.createdAt))).toBe(false);
    }
    // Byte (code-point) order, as `ORDER BY username COLLATE "C"`: plain code-unit comparison, not locale collation.
    const usernames = body.items.map((item) => item.username);
    expect(usernames).toEqual([...usernames].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)));

    const self = await findUser(admin.session, admin.user.username);
    expect(self).toMatchObject({ role: 'ADMIN', staffMfa: 'ENROLLED', superAdmin: false });
    await disposeAll(admin);
  });

test('E2E-08-06 malformed search filters are refused with 400 INVALID_REQUEST', { tag: ['@t08', '@t08-T4'] },
  async ({ request }) => {
    const admin = await apiStaff(request, 'ADMIN');
    const malformed: Record<string, unknown>[] = [
      { role: 'SUPER_ADMIN' }, { role: 'OWNER' }, { role: 'admin' }, { page: -1 }, { page: 'first' }, { size: 0 },
      { size: 51 }, { username: 'a'.repeat(51) }, { user: 'unknown property' },
    ];
    for (const filter of malformed) {
      await expectError(await listUsers(admin.session, filter), 400, 'INVALID_REQUEST');
    }
    // Not a JSON object: an array, a bare string and a truncated body.
    for (const data of ['[]', '"journey"', '{"username":']) {
      await expectError(await admin.session.call('POST', '/api/admin/users/search',
        { data, headers: { 'Content-Type': 'application/json' } }), 400, 'INVALID_REQUEST');
    }
    // The bounds themselves are accepted, and CUSTOMER is a valid filter.
    expect((await listUsers(admin.session, { size: 50, page: 0, username: 'a'.repeat(50) })).status()).toBe(200);
    expect((await listUsers(admin.session, { size: 1, role: 'DELIVERY_PERSON' })).status()).toBe(200);
    expect((await listUsers(admin.session, { size: 1, role: 'CUSTOMER' })).status()).toBe(200);
    await disposeAll(admin);
  });

test('E2E-08-07 malformed and unknown User ids: 400 for a non-UUID, 404 NOT_FOUND for an unknown User',
  { tag: ['@t08', '@t08-T4'] }, async ({ request }) => {
    const admin = await apiStaff(request, 'ADMIN');
    await expectError(await getUserRoles(admin.session, 'not-a-uuid'), 400, 'INVALID_REQUEST');
    await expectError(await putRole(admin.session, 'not-a-uuid', 'MODERATOR', 0), 400, 'INVALID_REQUEST');
    await expectError(await getUserRoles(admin.session, randomUUID()), 404, 'NOT_FOUND');
    await expectError(await putRole(admin.session, randomUUID(), 'MODERATOR', 0), 404, 'NOT_FOUND');
    await disposeAll(admin);
  });

test('E2E-08-08 malformed role-change bodies, unknown roles and the old array shape are refused with 400',
  { tag: ['@t08', '@t08-T4'] }, async ({ request }) => {
    const admin = await apiStaff(request, 'ADMIN');
    const customer = await apiCustomer(request);
    const id = await idOf(admin, customer);
    const bodies: unknown[] = [
      { role: 'SUPER_ADMIN', rolesVersion: 0 },
      { role: 'OWNER', rolesVersion: 0 },
      { role: 'moderator', rolesVersion: 0 },
      { role: '', rolesVersion: 0 },
      { role: ['MODERATOR'], rolesVersion: 0 },
      { role: null, rolesVersion: 0 },
      { rolesVersion: 0 },
      { role: 'MODERATOR' },
      { role: 'MODERATOR', rolesVersion: null },
      { role: 'MODERATOR', rolesVersion: -1 },
      { role: 'MODERATOR', rolesVersion: 0, note: 'unknown property' },
      // The superseded multi-role shape (plan §3 R2) is an unknown property now.
      { staffRoles: ['MODERATOR'], rolesVersion: 0 },
      { role: 'MODERATOR', staffRoles: ['MODERATOR'], rolesVersion: 0 },
      '{"role":"MODERATOR",',
    ];
    for (const data of bodies) {
      const response = await admin.session.call('PUT', `/api/admin/users/${id}/roles`,
        typeof data === 'string' ? { data, headers: { 'Content-Type': 'application/json' } } : { data });
      await expectError(response, 400, 'INVALID_REQUEST');
    }
    await expectUnchanged(admin, id, customer.user.username);
    await expectActive(customer.session);
    await disposeAll(admin, customer);
  });

test('E2E-08-09 PUT passes the CORS preflight from the frontend origin only, and needs no CSRF token',
  { tag: ['@t08', '@t08-T4'] }, async ({ request }) => {
    const path = `/api/admin/users/${randomUUID()}/roles`;
    const preflight = (origin: string) => request.fetch(`${apiUrl}${path}`, {
      method: 'OPTIONS',
      headers: { Origin: origin, 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'authorization,content-type' },
    });
    const allowed = await preflight(frontendUrl);
    expect(allowed.status()).toBe(200);
    expect(allowed.headers()['access-control-allow-origin']).toBe(frontendUrl);
    expect(allowed.headers()['access-control-allow-methods']).toContain('PUT');
    expect((await preflight(frontendUrl.replace('127.0.0.1', 'localhost'))).status()).toBe(403);

    // The session client sends only the Bearer token; no XSRF cookie or header exists in this context.
    const admin = await apiStaff(request, 'ADMIN');
    const customer = await apiCustomer(request);
    const response = await putRole(admin.session, await idOf(admin, customer), 'DELIVERY_PERSON', 0);
    expect(response.status()).toBe(200);
    await disposeAll(admin, customer);
  });

// ---------------------------------------------------------------------------------------------------------------------
// T5: the joined backend (I1, audit, rules and the list contract)
// ---------------------------------------------------------------------------------------------------------------------

test('E2E-08-10 setting MODERATOR replaces CUSTOMER, returns the documented body and revokes both target sessions',
  { tag: ['@t08', '@t08-T5'] }, async ({ request }) => {
    const admin = await apiStaff(request, 'ADMIN');
    const customer = await apiCustomer(request);
    const summary = await findUser(admin.session, customer.user.username);
    expect(summary).toMatchObject({ role: 'CUSTOMER', staffMfa: 'NOT_REQUIRED', superAdmin: false });
    const before = await readUserRoles(admin.session, summary.id);
    expect(before).toMatchObject({ rolesVersion: 0, self: false, assignableRoles: ordinaryAssignable, roleChanges: [] });
    // A second, independent session of the same Customer (another device): its own token and refresh cookie.
    const otherDevice: ApiActor = { user: customer.user, session: await ApiSession.signIn(customer.user) };

    await freshen(customer);
    await freshen(otherDevice);
    const response = await putRole(admin.session, summary.id, 'MODERATOR', 0);
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toBe('no-store');
    const body = await response.json() as UserRoles;
    expect(Object.keys(body).sort()).toEqual(userRolesFields);
    expect(body).toMatchObject({
      id: summary.id, username: customer.user.username, role: 'MODERATOR', staffMfa: 'SETUP_REQUIRED',
      superAdmin: false, createdAt: summary.createdAt, rolesVersion: 1, self: false, assignableRoles: ordinaryAssignable,
    });
    expect(body.roleChanges).toHaveLength(1);
    expect(Object.keys(body.roleChanges[0]).sort()).toEqual(roleChangeFields);
    expect(body.roleChanges[0]).toMatchObject({ actorUsername: admin.user.username, oldRole: 'CUSTOMER', newRole: 'MODERATOR' });
    expect(Date.parse(body.roleChanges[0].occurredAt)).toBeGreaterThanOrEqual(Date.parse(summary.createdAt));
    // Replaced, not added: the CUSTOMER row is gone.
    expect(storedRoles(customer.user.username)).toEqual(['MODERATOR']);

    // Old sessions cannot acquire new powers: in both sessions, access and refresh are dead before the tokens expire.
    await expectRevoked(customer.session);
    await expectRevoked(otherDevice.session);
    expect(sessionStates(customer.user.username)).toEqual(['role-changed', 'role-changed']);
    // The actor's own session is untouched.
    await expectActive(admin.session);
    await disposeAll(admin, customer, otherDevice);
  });

test('E2E-08-11 I1: a promoted Customer must enroll; demotion to CUSTOMER and re-promotion follow staff MFA (R7)',
  { tag: ['@t08', '@t08-T5'] }, async ({ request }) => {
    test.setTimeout(180_000);
    const admin = await apiStaff(request, 'ADMIN');
    const customer = await apiCustomer(request);
    const id = await idOf(admin, customer);

    await test.step('promotion: the old session dies and the new one must enroll before staff access', async () => {
      await freshen(customer);
      await changeRole(admin.session, id, 'MODERATOR', 0);
      await expectRevoked(customer.session);
      expect(await signInAgain(customer)).toBe('ENROLLMENT_REQUIRED');
      await expectError(await customer.session.call('GET', '/api/staff/me'), 403, 'MFA_REQUIRED');
      await expectError(await listUsers(customer.session), 403, 'MFA_REQUIRED');
    });

    await test.step('after enrollment the Moderator reaches staff routes, but not the role routes', async () => {
      customer.authenticator = await customer.session.enroll();
      const staff = await customer.session.call('GET', '/api/staff/me');
      expect(staff.status()).toBe(200);
      expect(await staff.json()).toEqual({ username: customer.user.username, roles: ['MODERATOR'], superAdmin: false });
      await expectError(await listUsers(customer.session), 403, 'ACCESS_DENIED');
      expect((await findUser(admin.session, customer.user.username)).staffMfa).toBe('ENROLLED');
    });

    await test.step('demotion to CUSTOMER: the verified session dies at once; the next one needs no MFA and has no staff access', async () => {
      await freshen(customer);
      const demoted = await changeRole(admin.session, id, 'CUSTOMER', 1);
      expect(demoted).toMatchObject({ role: 'CUSTOMER', staffMfa: 'NOT_REQUIRED', rolesVersion: 2 });
      await expectRevoked(customer.session);
      expect(await signInAgain(customer)).toBe('NOT_REQUIRED');
      await expectError(await customer.session.call('GET', '/api/staff/me'), 403, 'ACCESS_DENIED');
      await expectActive(customer.session);
    });

    await test.step('re-promotion: the kept authenticator is asked for, never skipped (P2, R7)', async () => {
      await freshen(customer);
      const regranted = await changeRole(admin.session, id, 'MODERATOR', 2);
      expect(regranted).toMatchObject({ staffMfa: 'ENROLLED', rolesVersion: 3 });
      await expectRevoked(customer.session);
      expect(await signInAgain(customer)).toBe('VERIFICATION_REQUIRED');
      await expectError(await customer.session.call('GET', '/api/staff/me'), 403, 'MFA_REQUIRED');
      await customer.session.verify(customer.authenticator!);
      expect((await customer.session.call('GET', '/api/staff/me')).status()).toBe(200);
      expect(transitions(regranted.roleChanges))
        .toEqual(['CUSTOMER → MODERATOR', 'MODERATOR → CUSTOMER', 'CUSTOMER → MODERATOR']);
    });
    expect(transitions(roleChangeRows(customer.user.username)))
      .toEqual(['CUSTOMER → MODERATOR', 'MODERATOR → CUSTOMER', 'CUSTOMER → MODERATOR']);
    await disposeAll(admin, customer);
  });

test('E2E-08-12 setting DELIVERY_PERSON revokes sessions but adds no MFA and no staff or role access (AC4)',
  { tag: ['@t08', '@t08-T5'] }, async ({ request }) => {
    const admin = await apiStaff(request, 'ADMIN');
    const customer = await apiCustomer(request);
    const id = await idOf(admin, customer);

    await freshen(customer);
    const changed = await changeRole(admin.session, id, 'DELIVERY_PERSON', 0);
    expect(changed).toMatchObject({ role: 'DELIVERY_PERSON', staffMfa: 'NOT_REQUIRED', rolesVersion: 1 });
    await expectRevoked(customer.session);

    expect(await signInAgain(customer)).toBe('NOT_REQUIRED');
    // A DeliveryPerson keeps every Customer permission (S6).
    await expectActive(customer.session);
    await expectError(await customer.session.call('GET', '/api/staff/me'), 403, 'ACCESS_DENIED');
    await expectEveryRoleRoute(asCaller(customer.session), 403, 'ACCESS_DENIED');
    await disposeAll(admin, customer);
  });

test('E2E-08-52 every change among Customer, DeliveryPerson and Moderator replaces the one role, is audited and revokes',
  { tag: ['@t08', '@t08-T5'] }, async ({ request }) => {
    test.setTimeout(180_000);
    const admin = await apiStaff(request, 'ADMIN');
    const target = await apiCustomer(request);
    const id = await idOf(admin, target);
    const path: Role[] = ['CUSTOMER', 'DELIVERY_PERSON', 'MODERATOR', 'CUSTOMER', 'MODERATOR', 'DELIVERY_PERSON', 'CUSTOMER'];

    for (let version = 0; version < path.length - 1; version++) {
      const [from, to] = [path[version], path[version + 1]];
      await test.step(`${from} → ${to}`, async () => {
        if (version === 0) await freshen(target);
        else await signInAgain(target);
        const changed = await changeRole(admin.session, id, to, version);
        expect(changed).toMatchObject({ role: to, rolesVersion: version + 1, assignableRoles: ordinaryAssignable });
        expect(changed.roleChanges[0]).toMatchObject({ oldRole: from, newRole: to, actorUsername: admin.user.username });
        expect(storedRoles(target.user.username)).toEqual([to]);
        await expectRevoked(target.session);
      });
    }
    const rows = roleChangeRows(target.user.username);
    expect(transitions(rows)).toEqual(path.slice(1).map((to, index) => `${path[index]} → ${to}`));
    expect(sessionStates(target.user.username)).toEqual(Array(path.length - 1).fill('role-changed'));
    await disposeAll(admin, target);
  });

test('E2E-08-13 every change is audited as one old → new row with actor, target and request id',
  { tag: ['@t08', '@t08-T5'] }, async ({ request }) => {
    const admin = await apiStaff(request, 'ADMIN');
    const customer = await apiCustomer(request);
    const id = await idOf(admin, customer);

    const first = await putRole(admin.session, id, 'MODERATOR', 0);
    expect(first.status()).toBe(200);
    const second = await putRole(admin.session, id, 'DELIVERY_PERSON', 1);
    expect(second.status()).toBe(200);
    const body = await second.json() as UserRoles;
    expect({ role: body.role, rolesVersion: body.rolesVersion }).toEqual({ role: 'DELIVERY_PERSON', rolesVersion: 2 });
    // Newest first, one entry per save.
    expect(transitions(body.roleChanges)).toEqual(['MODERATOR → DELIVERY_PERSON', 'CUSTOMER → MODERATOR']);
    expect(body.roleChanges.every(({ actorUsername }) => actorUsername === admin.user.username)).toBe(true);

    expect(roleChangeRows(customer.user.username)).toEqual([
      { oldRole: 'CUSTOMER', newRole: 'MODERATOR', actor: admin.user.username, requestId: first.headers()['x-request-id'] },
      { oldRole: 'MODERATOR', newRole: 'DELIVERY_PERSON', actor: admin.user.username, requestId: second.headers()['x-request-id'] },
    ]);
    await disposeAll(admin, customer);
  });

test('E2E-08-14 a stale rolesVersion is refused with 409 STALE_UPDATE and changes nothing',
  { tag: ['@t08', '@t08-T5'] }, async ({ request }) => {
    const admin = await apiStaff(request, 'ADMIN');
    const customer = await apiCustomer(request);
    const id = await idOf(admin, customer);
    await changeRole(admin.session, id, 'MODERATOR', 0);
    expect(await signInAgain(customer)).toBe('ENROLLMENT_REQUIRED');

    await expectError(await putRole(admin.session, id, 'DELIVERY_PERSON', 0), 409, 'STALE_UPDATE');
    await expectError(await putRole(admin.session, id, 'CUSTOMER', 7), 409, 'STALE_UPDATE');

    const after = await readUserRoles(admin.session, id);
    expect({ role: after.role, rolesVersion: after.rolesVersion, changes: after.roleChanges.length })
      .toEqual({ role: 'MODERATOR', rolesVersion: 1, changes: 1 });
    // A refused save revokes nothing.
    expect((await customer.session.refresh()).status()).toBe(200);
    await disposeAll(admin, customer);
  });

test('E2E-08-15 nobody changes their own role (409 ROLE_CHANGE_REFUSED), while their current role is a 200 no-op',
  { tag: ['@t08', '@t08-T5'] }, async ({ request }) => {
    const admin = await apiStaff(request, 'ADMIN');
    const id = await idOf(admin, admin.user);
    const own = await readUserRoles(admin.session, id);
    expect(own).toMatchObject({ self: true, assignableRoles: [], role: 'ADMIN', rolesVersion: 0 });

    for (const role of ['CUSTOMER', 'DELIVERY_PERSON', 'MODERATOR'] as const) {
      await expectError(await putRole(admin.session, id, role, 0), 409, 'ROLE_CHANGE_REFUSED');
    }
    // Rule order (§4.1): the current role is NO_CHANGE before the self rule, so it is a harmless 200.
    const unchanged = await changeRole(admin.session, id, 'ADMIN', 0);
    expect(unchanged).toMatchObject({ role: 'ADMIN', rolesVersion: 0, roleChanges: [], self: true });

    await expectActive(admin.session);
    expect(storedRoles(admin.user.username)).toEqual(['ADMIN']);
    expect(roleChangeRows(admin.user.username)).toEqual([]);
    expect(sessionStates(admin.user.username)).not.toContain('role-changed');
    await disposeAll(admin);
  });

test('E2E-08-16 an ordinary Admin can neither make someone an Admin nor replace another Admin’s role (S5)',
  { tag: ['@t08', '@t08-T5'] }, async ({ request }) => {
    const admin = await apiStaff(request, 'ADMIN');
    const otherAdmin = await apiStaff(request, 'ADMIN');
    const customer = await apiCustomer(request);
    const customerId = await idOf(admin, customer);
    const otherId = await idOf(admin, otherAdmin);
    expect((await readUserRoles(admin.session, customerId)).assignableRoles).toEqual(ordinaryAssignable);
    expect((await readUserRoles(admin.session, otherId)).assignableRoles).toEqual([]);

    await test.step('setting ADMIN is refused, even with a stale version (rule 5 before rule 6)', async () => {
      await expectError(await putRole(admin.session, customerId, 'ADMIN', 0), 409, 'ROLE_CHANGE_REFUSED');
      await expectError(await putRole(admin.session, customerId, 'ADMIN', 7), 409, 'ROLE_CHANGE_REFUSED');
      await expectUnchanged(admin, customerId, customer.user.username);
      await expectActive(customer.session);
    });

    await test.step('replacing another Admin’s role with any lower role is refused and changes nothing', async () => {
      for (const role of ['CUSTOMER', 'DELIVERY_PERSON', 'MODERATOR'] as const) {
        await expectError(await putRole(admin.session, otherId, role, 0), 409, 'ROLE_CHANGE_REFUSED');
      }
      // Asking for the role they already hold changes nothing, so it is a 200 no-op.
      expect(await changeRole(admin.session, otherId, 'ADMIN', 0)).toMatchObject({ role: 'ADMIN', rolesVersion: 0 });
      await expectUnchanged(admin, otherId, otherAdmin.user.username, 'ADMIN');
      await expectActive(otherAdmin.session);
    });

    await test.step('the same Admin still replaces a Customer’s role with a lower staff role', async () => {
      expect(await changeRole(admin.session, customerId, 'MODERATOR', 0)).toMatchObject({ role: 'MODERATOR', rolesVersion: 1 });
    });
    expect(roleChangeRows(otherAdmin.user.username)).toEqual([]);
    await disposeAll(admin, otherAdmin, customer);
  });

test('E2E-08-17 the Super Admin makes a Customer an Admin, then demotes them to Moderator and to Customer',
  { tag: ['@t08', '@t08-T5'] }, async ({ request }) => {
    test.setTimeout(180_000);
    const owner = await apiSuperAdmin(request);
    const customer = await apiCustomer(request);
    const id = await idOf(owner, customer);
    expect(await readUserRoles(owner.session, id))
      .toMatchObject({ assignableRoles: [...roleOrder], superAdmin: false, self: false });

    await test.step('promotion to ADMIN: the new Admin must enroll and is an ordinary Admin', async () => {
      await freshen(customer);
      const granted = await changeRole(owner.session, id, 'ADMIN', 0);
      expect(granted).toMatchObject({ role: 'ADMIN', staffMfa: 'SETUP_REQUIRED', rolesVersion: 1, assignableRoles: [...roleOrder] });
      expect(storedRoles(customer.user.username)).toEqual(['ADMIN']);
      await expectRevoked(customer.session);
      expect(await signInAgain(customer)).toBe('ENROLLMENT_REQUIRED');
      await expectError(await listUsers(customer.session), 403, 'MFA_REQUIRED');
      customer.authenticator = await customer.session.enroll();
      expect((await listUsers(customer.session)).status()).toBe(200);
      expect(await (await customer.session.call('GET', '/api/staff/me')).json())
        .toEqual({ username: customer.user.username, roles: ['ADMIN'], superAdmin: false });
      expect((await readUserRoles(customer.session, await idOf(customer, owner))).assignableRoles).toEqual([]);
    });

    await test.step('demotion to MODERATOR: signed out, the kept authenticator is asked for, staff access stays', async () => {
      await freshen(customer);
      expect(await changeRole(owner.session, id, 'MODERATOR', 1)).toMatchObject({ role: 'MODERATOR', staffMfa: 'ENROLLED' });
      await expectRevoked(customer.session);
      expect(await signInAgain(customer)).toBe('VERIFICATION_REQUIRED');
      await customer.session.verify(customer.authenticator!);
      expect((await customer.session.call('GET', '/api/staff/me')).status()).toBe(200);
      await expectError(await listUsers(customer.session), 403, 'ACCESS_DENIED');
    });

    await test.step('demotion to CUSTOMER: signed out, no MFA, no staff access', async () => {
      await freshen(customer);
      const removed = await changeRole(owner.session, id, 'CUSTOMER', 2);
      expect(removed).toMatchObject({ role: 'CUSTOMER', staffMfa: 'NOT_REQUIRED', rolesVersion: 3 });
      expect(removed.roleChanges.map(({ oldRole, newRole, actorUsername }) => `${oldRole} → ${newRole} ${actorUsername}`))
        .toEqual(['MODERATOR → CUSTOMER', 'ADMIN → MODERATOR', 'CUSTOMER → ADMIN'].map((line) => `${line} ${owner.user.username}`));
      await expectRevoked(customer.session);
      expect(await signInAgain(customer)).toBe('NOT_REQUIRED');
      await expectError(await customer.session.call('GET', '/api/staff/me'), 403, 'ACCESS_DENIED');
    });
    await disposeAll(owner, customer);
  });

test('E2E-08-18 the Super Admin’s role is never replaced, by another Admin or by themself (AC7, AC8)',
  { tag: ['@t08', '@t08-T5'] }, async ({ request }) => {
    const owner = await apiSuperAdmin(request);
    const admin = await apiStaff(request, 'ADMIN');
    const ownerId = await idOf(admin, owner);

    const listed = await findUser(admin.session, owner.user.username);
    expect(listed).toMatchObject({ superAdmin: true, role: 'ADMIN' });
    expect((await findUser(admin.session, admin.user.username)).superAdmin).toBe(false);
    expect(await readUserRoles(admin.session, ownerId)).toMatchObject({ superAdmin: true, assignableRoles: [], self: false });
    expect(await readUserRoles(owner.session, ownerId)).toMatchObject({ superAdmin: true, assignableRoles: [], self: true });

    for (const role of ['CUSTOMER', 'DELIVERY_PERSON', 'MODERATOR'] as const) {
      await expectError(await putRole(owner.session, ownerId, role, 0), 409, 'ROLE_CHANGE_REFUSED');
      await expectError(await putRole(admin.session, ownerId, role, 0), 409, 'ROLE_CHANGE_REFUSED');
    }
    await expectError(await putRole(admin.session, ownerId, 'SUPER_ADMIN', 0), 400, 'INVALID_REQUEST');
    // ADMIN is the role they hold: a no-op for either caller, which signs nobody out.
    expect(await changeRole(admin.session, ownerId, 'ADMIN', 0)).toMatchObject({ role: 'ADMIN', rolesVersion: 0, roleChanges: [] });
    expect(await changeRole(owner.session, ownerId, 'ADMIN', 0)).toMatchObject({ role: 'ADMIN', rolesVersion: 0 });

    await expectActive(owner.session);
    expect(storedRoles(owner.user.username)).toEqual(['ADMIN']);
    expect(roleChangeRows(owner.user.username)).toEqual([]);
    expect(sessionStates(owner.user.username)).not.toContain('role-changed');
    expect(await (await owner.session.call('GET', '/api/staff/me')).json())
      .toEqual({ username: owner.user.username, roles: ['ADMIN'], superAdmin: true });
    await disposeAll(owner, admin);
  });

test('E2E-08-19 the search filters by username prefix and exact role, pages, reports staff MFA and omits private fields',
  { tag: ['@t08', '@t08-T5'] }, async ({ request }) => {
    const admin = await apiStaff(request, 'ADMIN');
    const prefix = `list.${randomBytes(4).toString('hex')}`;
    const customer = await registerThroughApi(request, syntheticCustomer(`${prefix}.a1`));
    const moderator = await registerThroughApi(request, syntheticCustomer(`${prefix}.a2`));
    grantRole(moderator.username, 'MODERATOR');
    const enrolledAdmin = await registerThroughApi(request, syntheticCustomer(`${prefix}.a3`));
    grantRole(enrolledAdmin.username, 'ADMIN');
    const enrolledSession = await ApiSession.signIn(enrolledAdmin);
    await enrolledSession.enroll();
    await enrolledSession.dispose();
    const deliveryPerson = await registerThroughApi(request, syntheticCustomer(`${prefix}.a4`));
    grantRole(deliveryPerson.username, 'DELIVERY_PERSON');
    const underscore = await registerThroughApi(request, syntheticCustomer(`${prefix}_u`));
    const lookalike = await registerThroughApi(request, syntheticCustomer(`${prefix}zu`));
    const everyone = [customer, moderator, enrolledAdmin, deliveryPerson, underscore, lookalike];

    const page = async (query: Record<string, string | number>) => {
      const response = await listUsers(admin.session, query);
      expect(response.status(), JSON.stringify(query)).toBe(200);
      return await response.json() as UserPage;
    };
    const names = (body: UserPage) => body.items.map((item) => item.username);

    await test.step('prefix, trimmed and case-insensitive; `_` and `%` are literal', async () => {
      expect(new Set(names(await page({ username: prefix })))).toEqual(new Set(everyone.map((user) => user.username)));
      expect(names(await page({ username: `  ${prefix.toUpperCase()}.A  ` })))
        .toEqual([customer, moderator, enrolledAdmin, deliveryPerson].map((user) => user.username));
      expect(names(await page({ username: `${prefix}_` }))).toEqual([underscore.username]);
      expect(await page({ username: `${prefix}%` })).toMatchObject({ items: [], totalItems: 0 });
    });

    await test.step('the role filter matches the one stored role, not the roles it inherits', async () => {
      expect(names(await page({ username: prefix, role: 'MODERATOR' }))).toEqual([moderator.username]);
      expect(names(await page({ username: prefix, role: 'ADMIN' }))).toEqual([enrolledAdmin.username]);
      expect(names(await page({ username: prefix, role: 'DELIVERY_PERSON' }))).toEqual([deliveryPerson.username]);
      expect(new Set(names(await page({ username: prefix, role: 'CUSTOMER' }))))
        .toEqual(new Set([customer, underscore, lookalike].map((user) => user.username)));
      const admins = await page({ role: 'ADMIN', size: 50 });
      expect(admins.items.every((item) => item.role === 'ADMIN')).toBe(true);
    });

    await test.step('paging reports the totals and never repeats or skips a User', async () => {
      const pages = [await page({ username: prefix, size: 2, page: 0 }), await page({ username: prefix, size: 2, page: 1 }),
        await page({ username: prefix, size: 2, page: 2 })];
      for (const [index, body] of pages.entries()) {
        expect({ page: body.page, size: body.size, totalItems: body.totalItems, count: body.items.length })
          .toEqual({ page: index, size: 2, totalItems: 6, count: 2 });
      }
      expect(pages.flatMap(names)).toEqual(names(await page({ username: prefix, size: 50 })));
      expect(await page({ username: prefix, size: 2, page: 3 })).toMatchObject({ items: [], totalItems: 6 });
    });

    await test.step('staff MFA state and the Super Admin flag', async () => {
      const byName = new Map((await page({ username: prefix, size: 50 })).items.map((item) => [item.username, item]));
      expect(byName.get(customer.username)).toMatchObject({ role: 'CUSTOMER', staffMfa: 'NOT_REQUIRED', superAdmin: false });
      expect(byName.get(moderator.username)).toMatchObject({ role: 'MODERATOR', staffMfa: 'SETUP_REQUIRED' });
      expect(byName.get(enrolledAdmin.username)).toMatchObject({ role: 'ADMIN', staffMfa: 'ENROLLED', superAdmin: false });
      expect(byName.get(deliveryPerson.username)).toMatchObject({ role: 'DELIVERY_PERSON', staffMfa: 'NOT_REQUIRED' });
    });

    await test.step('list and detail bodies carry no mobile, email or password (R8)', async () => {
      const listText = await (await listUsers(admin.session, { username: prefix, size: 50 })).text();
      const detail = await getUserRoles(admin.session, (await findUser(admin.session, enrolledAdmin.username)).id);
      const detailText = await detail.text();
      expect(Object.keys(JSON.parse(detailText) as object).sort()).toEqual(userRolesFields);
      for (const user of everyone) {
        for (const secret of [user.mobile, user.email, user.password]) {
          expect(listText.includes(secret) || detailText.includes(secret), 'private value in a role API body').toBe(false);
        }
      }
      expect(/"(mobile|email|password\w*|fullName|address\w*)"/.test(listText + detailText)).toBe(false);
    });
    await disposeAll(admin);
  });

// ---------------------------------------------------------------------------------------------------------------------
// T6: regression (R1), abuse, concurrency and recovery
// ---------------------------------------------------------------------------------------------------------------------

test('E2E-08-20 R1: a Moderator cannot self-promote, change another User or read Users through the role API',
  { tag: ['@t08', '@t08-T6'] }, async ({ request }) => {
    const admin = await apiStaff(request, 'ADMIN');
    const moderator = await apiStaff(request, 'MODERATOR');
    const customer = await apiCustomer(request);
    const moderatorId = await idOf(admin, moderator);
    const customerId = await idOf(admin, customer);

    await expectError(await putRole(moderator.session, moderatorId, 'ADMIN', 0), 403, 'ACCESS_DENIED');
    // Rule 1 comes before the no-op rule: even the role they hold is refused.
    await expectError(await putRole(moderator.session, moderatorId, 'MODERATOR', 0), 403, 'ACCESS_DENIED');
    await expectError(await putRole(moderator.session, customerId, 'DELIVERY_PERSON', 0), 403, 'ACCESS_DENIED');
    await expectError(await listUsers(moderator.session, { username: customer.user.username }), 403, 'ACCESS_DENIED');
    await expectError(await getUserRoles(moderator.session, customerId), 403, 'ACCESS_DENIED');

    await expectUnchanged(admin, moderatorId, moderator.user.username, 'MODERATOR');
    await expectUnchanged(admin, customerId, customer.user.username);
    await expectActive(moderator.session);
    await disposeAll(admin, moderator, customer);
  });

test('E2E-08-21 mass assignment, oversized and non-JSON bodies are refused with 400 and change nothing',
  { tag: ['@t08', '@t08-T6'] }, async ({ request }) => {
    const admin = await apiStaff(request, 'ADMIN');
    const customer = await apiCustomer(request);
    const id = await idOf(admin, customer);
    const path = `/api/admin/users/${id}/roles`;

    const massAssignment = { role: 'MODERATOR', rolesVersion: 0, roles: ['ADMIN'], superAdmin: true };
    await expectError(await admin.session.call('PUT', path, { data: massAssignment }), 400, 'INVALID_REQUEST');
    await expectError(await admin.session.call('PUT', path,
      { data: { role: 'MODERATOR', rolesVersion: 0, id: randomUUID(), self: true, assignableRoles: [...roleOrder] } }),
    400, 'INVALID_REQUEST');
    // Valid JSON of known fields padded past 16 KiB with whitespace: only the size limit can refuse it.
    const oversized = `{"role":"MODERATOR"${' '.repeat(17 * 1024)},"rolesVersion":0}`;
    await expectError(await admin.session.call('PUT', path, { data: oversized, headers: { 'Content-Type': 'application/json' } }),
      400, 'INVALID_REQUEST');
    // The search shares the limit: the same valid filter is listed, and refused once padded past 16 KiB.
    const filter = (padding: string) => `{"username":"${customer.user.username}"${padding},"size":1}`;
    const json = { 'Content-Type': 'application/json' };
    const listed = await admin.session.call('POST', '/api/admin/users/search', { data: filter(''), headers: json });
    expect(listed.status(), 'the unpadded search').toBe(200);
    expect((await listed.json() as UserPage).items.map(({ username }) => username)).toEqual([customer.user.username]);
    await expectError(await admin.session.call('POST', '/api/admin/users/search',
      { data: filter(' '.repeat(17 * 1024)), headers: json }), 400, 'INVALID_REQUEST');
    await expectError(await admin.session.call('PUT', path,
      { data: '{"role":"MODERATOR","rolesVersion":0}', headers: { 'Content-Type': 'text/plain' } }), 400,
    'INVALID_REQUEST');

    await expectUnchanged(admin, id, customer.user.username);
    expect(roleChangeRows(customer.user.username)).toEqual([]);
    await expectActive(customer.session);
    await expectActive(admin.session);
    await disposeAll(admin, customer);
  });

test('E2E-08-22 two Admins setting different roles with the same version: one 200, one 409 STALE_UPDATE',
  { tag: ['@t08', '@t08-T6'] }, async ({ request }) => {
    const first = await apiStaff(request, 'ADMIN');
    const second = await apiStaff(request, 'ADMIN');
    const customer = await apiCustomer(request);
    const id = await idOf(first, customer);
    for (const admin of [first, second]) await freshen(admin);

    const responses = await Promise.all([
      putRole(first.session, id, 'MODERATOR', 0),
      putRole(second.session, id, 'DELIVERY_PERSON', 0),
    ]);
    expect(responses.map((response) => response.status()).sort()).toEqual([200, 409]);
    const winnerIndex = responses.findIndex((response) => response.status() === 200);
    await expectError(responses[1 - winnerIndex], 409, 'STALE_UPDATE');
    const [winnerRole, winner] = winnerIndex === 0 ? ['MODERATOR', first] as const : ['DELIVERY_PERSON', second] as const;

    const after = await readUserRoles(first.session, id);
    expect({ role: after.role, rolesVersion: after.rolesVersion }).toEqual({ role: winnerRole, rolesVersion: 1 });
    expect(storedRoles(customer.user.username)).toEqual([winnerRole]);
    expect(roleChangeRows(customer.user.username).map(({ oldRole, newRole, actor }) => ({ oldRole, newRole, actor })))
      .toEqual([{ oldRole: 'CUSTOMER', newRole: winnerRole, actor: winner.user.username }]);
    await disposeAll(first, second, customer);
  });

test('E2E-08-23 two identical concurrent saves both succeed with one version bump and one audit row',
  { tag: ['@t08', '@t08-T6'] }, async ({ request }) => {
    const first = await apiStaff(request, 'ADMIN');
    const second = await apiStaff(request, 'ADMIN');
    const customer = await apiCustomer(request);
    const id = await idOf(first, customer);
    for (const admin of [first, second]) await freshen(admin);

    const responses = await Promise.all([
      putRole(first.session, id, 'MODERATOR', 0),
      putRole(second.session, id, 'MODERATOR', 0),
    ]);
    expect(responses.map((response) => response.status())).toEqual([200, 200]);
    for (const response of responses) expect((await response.json() as UserRoles).rolesVersion).toBe(1);
    expect(roleChangeRows(customer.user.username)).toHaveLength(1);
    expect(storedRoles(customer.user.username)).toEqual(['MODERATOR']);
    await disposeAll(first, second, customer);
  });

test('E2E-08-24 the Super Admin demoting an Admin who is changing a third User neither deadlocks nor half-applies',
  { tag: ['@t08', '@t08-T6'] }, async ({ request }) => {
    const owner = await apiSuperAdmin(request);
    const admin = await apiStaff(request, 'ADMIN');
    const customer = await apiCustomer(request);
    const adminId = await idOf(owner, admin);
    const customerId = await idOf(owner, customer);
    for (const actor of [owner, admin]) await freshen(actor);

    const [demotion, change] = await Promise.all([
      putRole(owner.session, adminId, 'CUSTOMER', 0),
      putRole(admin.session, customerId, 'MODERATOR', 0),
    ]);
    expect(demotion.status()).toBe(200);
    expect([200, 401, 403]).toContain(change.status());

    const customerRows = roleChangeRows(customer.user.username);
    const customerNow = await readUserRoles(owner.session, customerId);
    if (change.status() === 200) {
      // B's save committed before the demotion: exactly B's row.
      expect(customerNow.role).toBe('MODERATOR');
      expect(customerRows.map(({ newRole, actor }) => `${newRole} ${actor}`)).toEqual([`MODERATOR ${admin.user.username}`]);
    } else {
      expect(customerNow.role).toBe('CUSTOMER');
      expect(customerRows).toEqual([]);
    }
    expect((await readUserRoles(owner.session, adminId)).role).toBe('CUSTOMER');
    expect(storedRoles(admin.user.username)).toEqual(['CUSTOMER']);
    expect((await admin.session.refresh()).status()).toBe(401);
    await disposeAll(owner, admin, customer);
  });

test('E2E-08-25 a role change racing the target’s refresh leaves no working session and no deadlock',
  { tag: ['@t08', '@t08-T6'] }, async ({ request }) => {
    const admin = await apiStaff(request, 'ADMIN');
    const customer = await apiCustomer(request);
    const id = await idOf(admin, customer);
    await freshen(admin);

    const [change, refresh] = await Promise.all([
      putRole(admin.session, id, 'MODERATOR', 0),
      customer.session.refresh(),
    ]);
    expect(change.status()).toBe(200);
    expect([200, 401]).toContain(refresh.status());
    // A racing 401 has already refused and cleared the cookie; a racing 200 leaves the new cookie to reject.
    await expectRevoked(customer.session, refresh.status() === 401 ? refresh : undefined);
    expect(sessionStates(customer.user.username)).toEqual(['role-changed']);
    await disposeAll(admin, customer);
  });

test('E2E-08-26 a lost response is safe to retry: the same role with the old version is a 200 no-op',
  { tag: ['@t08', '@t08-T6'] }, async ({ request }) => {
    const admin = await apiStaff(request, 'ADMIN');
    const customer = await apiCustomer(request);
    const id = await idOf(admin, customer);

    // The client never reads this response, as if the connection dropped after the commit.
    expect((await putRole(admin.session, id, 'MODERATOR', 0)).status()).toBe(200);
    expect(await signInAgain(customer)).toBe('ENROLLMENT_REQUIRED');

    const retried = await changeRole(admin.session, id, 'MODERATOR', 0);
    expect(retried).toMatchObject({ role: 'MODERATOR', rolesVersion: 1 });
    expect(retried.roleChanges).toHaveLength(1);
    expect(roleChangeRows(customer.user.username)).toHaveLength(1);
    // A no-op revokes nothing: the session opened after the first save still refreshes.
    expect((await customer.session.refresh()).status()).toBe(200);
    expect(sessionStates(customer.user.username)).toEqual(['role-changed', 'active']);
    await disposeAll(admin, customer);
  });

test('E2E-08-27 demoting a verified Moderator to CUSTOMER stops them on the very next staff request',
  { tag: ['@t08', '@t08-T6'] }, async ({ request }) => {
    const admin = await apiStaff(request, 'ADMIN');
    const moderator = await apiStaff(request, 'MODERATOR');
    const id = await idOf(admin, moderator);
    await freshen(moderator);
    const token = moderator.session.accessToken;
    expect((await moderator.session.call('GET', '/api/staff/me', { token })).status()).toBe(200);

    await changeRole(admin.session, id, 'CUSTOMER', 0);
    await expectError(await moderator.session.call('GET', '/api/staff/me', { token }), 401, 'AUTHENTICATION_REQUIRED');
    await expectRevoked(moderator.session);
    expect(await signInAgain(moderator)).toBe('NOT_REQUIRED');
    await expectError(await moderator.session.call('GET', '/api/staff/me'), 403, 'ACCESS_DENIED');
    await disposeAll(admin, moderator);
  });

// ---------------------------------------------------------------------------------------------------------------------
// T7: bounded payloads
// ---------------------------------------------------------------------------------------------------------------------

test('E2E-08-28 payloads stay bounded: at most 50 Users a page and the latest 20 role changes',
  { tag: ['@t08', '@t08-T7'] }, async ({ request }) => {
    const admin = await apiStaff(request, 'ADMIN');
    const customer = await apiCustomer(request);
    const id = await idOf(admin, customer);

    const widest = await listUsers(admin.session, { size: 50 });
    expect(widest.status()).toBe(200);
    expect(((await widest.json()) as UserPage).items.length).toBeLessThanOrEqual(50);

    let latest!: UserRoles;
    for (let version = 0; version < 21; version++) {
      latest = await changeRole(admin.session, id, version % 2 === 0 ? 'DELIVERY_PERSON' : 'CUSTOMER', version);
    }
    expect(latest.rolesVersion).toBe(21);
    expect(latest.roleChanges).toHaveLength(20);
    // The 21st save set DELIVERY_PERSON again; it is listed first, and history alternates from there.
    expect(transitions(latest.roleChanges.slice(0, 2))).toEqual(['CUSTOMER → DELIVERY_PERSON', 'DELIVERY_PERSON → CUSTOMER']);
    expect(roleChangeRows(customer.user.username)).toHaveLength(21);
    expect((await readUserRoles(admin.session, id)).roleChanges).toHaveLength(20);
    await disposeAll(admin, customer);
  });
