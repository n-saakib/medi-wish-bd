import { randomBytes, randomInt } from 'node:crypto';
import { expect, request, type APIRequestContext, type APIResponse } from '@playwright/test';
import { freshCode, registerThroughApi, syntheticCustomer, type Authenticator, type Customer } from './support';
import { accessTokenLifetimeMs, apiUrl, checkedTarget, grantRole, makeSuperAdmin, psql, rolledBackSql } from './testApi';
import { totpCode, totpStep } from './totp';

/** The staff-MFA status a sign-in, refresh, verification or backup-code recovery (Ticket 09) reports. */
export type MfaStatus = 'NOT_REQUIRED' | 'ENROLLMENT_REQUIRED' | 'VERIFICATION_REQUIRED' | 'REPLACEMENT_REQUIRED' | 'VERIFIED';

/** The four roles, lowest to highest; a User holds exactly one, with every permission of the roles below it (S6). */
export const roleOrder = ['CUSTOMER', 'DELIVERY_PERSON', 'MODERATOR', 'ADMIN'] as const;
export type Role = typeof roleOrder[number];

/** A role other than CUSTOMER, which an operator gives a test User with SQL. */
export type StaffRole = Exclude<Role, 'CUSTOMER'>;

/** `UserSummary` of `POST /api/admin/users/search` (Ticket 08 plan §4.2). */
export type UserSummary = {
  id: string;
  username: string;
  role: Role;
  staffMfa: 'NOT_REQUIRED' | 'ENROLLED' | 'SETUP_REQUIRED';
  superAdmin: boolean;
  createdAt: string;
};

/** One audited transition, newest first in `roleChanges`; `actorUsername` is null when the actor no longer exists. */
export type RoleChange = { occurredAt: string; actorUsername: string | null; oldRole: Role; newRole: Role };

/** `UserRoles` of `GET /api/admin/users/{id}` and `PUT /api/admin/users/{id}/roles` (Ticket 08 plan §4.2). */
export type UserRoles = UserSummary & {
  rolesVersion: number;
  self: boolean;
  /** The roles this caller may set for this User, lowest first; empty when the caller may not change the role. */
  assignableRoles: Role[];
  roleChanges: RoleChange[];
};

export type UserPage = { items: UserSummary[]; page: number; size: number; totalItems: number };

/** The exact field sets of the role API's bodies; anything else (such as a mobile or email) is a contract break. */
export const userSummaryFields = ['createdAt', 'id', 'role', 'staffMfa', 'superAdmin', 'username'];
export const userRolesFields = [...userSummaryFields, 'assignableRoles', 'roleChanges', 'rolesVersion', 'self'].sort();
export const roleChangeFields = ['actorUsername', 'newRole', 'occurredAt', 'oldRole'];

/** The backend's `messages.properties` text for each error code the role and staff-MFA APIs answer with. */
export const errorMessages = {
  INVALID_REQUEST: 'The request is invalid.',
  AUTHENTICATION_REQUIRED: 'Authentication is required.',
  ACCESS_DENIED: 'Access is denied.',
  MFA_REQUIRED: 'Authenticator verification is required.',
  MFA_CODE_INVALID: 'The code is invalid or has already been used.',
  MFA_ENROLLMENT_STALE: 'This setup has expired. Start again.',
  TOO_MANY_ATTEMPTS: 'Too many attempts. Try again later.',
  NOT_FOUND: 'The requested resource was not found.',
  STALE_UPDATE: 'This record changed after you opened it. Reload and try again.',
  ROLE_CHANGE_REFUSED: 'This role change is not allowed.',
} as const;

export type ErrorCode = keyof typeof errorMessages;

/** Leaves some margin before the test API's 10-second access lifetime, so a token is never used as it expires. */
const refreshAfterMs = accessTokenLifetimeMs - 4_000;

type SessionBody = { accessToken: string; mfa: MfaStatus };

type CallOptions = {
  /** The JSON body, or a raw string body sent with `headers`. */
  data?: unknown;
  headers?: Record<string, string>;
  /** A specific access token (the session's current one is not refreshed), or null to send no Authorization header. */
  token?: string | null;
};

/**
 * One API client for one User: its own cookie jar (the refresh cookie) and the latest access token. `call` refreshes
 * the token when it is near the end of its lifetime, unless a test passes an explicit `token` to observe an old one.
 */
export class ApiSession {
  private constructor(
    private readonly context: APIRequestContext,
    readonly user: Customer,
    public accessToken: string,
    public mfa: MfaStatus,
    public issuedAt: number,
  ) {}

  /** Signs in with the password through `POST /api/auth/login`; the status must be 200. */
  static async signIn(user: Customer): Promise<ApiSession> {
    const context = await request.newContext({ baseURL: apiUrl });
    const response = await context.post('/api/auth/login', { data: { identifier: user.username, password: user.password } });
    expect(response.status(), 'sign-in status').toBe(200);
    const body = await response.json() as SessionBody;
    return new ApiSession(context, user, body.accessToken, body.mfa, Date.now());
  }

  /** How long ago the current access token was issued. */
  tokenAgeMs(): number {
    return Date.now() - this.issuedAt;
  }

  /** `POST /api/auth/refresh` with the CSRF value, as the browser does; a 200 replaces the access token. */
  async refresh(): Promise<APIResponse> {
    const { csrfToken } = await (await this.context.get('/api/auth/csrf')).json() as { csrfToken: string };
    const response = await this.context.post('/api/auth/refresh', { headers: { 'X-XSRF-TOKEN': csrfToken } });
    if (response.status() === 200) this.accept(await response.json() as SessionBody);
    return response;
  }

  /** Sends one request; see `CallOptions` for the token rules. */
  async call(method: 'GET' | 'PUT' | 'POST' | 'OPTIONS', path: string, options: CallOptions = {}): Promise<APIResponse> {
    let token = options.token;
    if (token === undefined) {
      if (this.tokenAgeMs() > refreshAfterMs) expect((await this.refresh()).status(), 'refresh before a call').toBe(200);
      token = this.accessToken;
    }
    const headers = { ...(token === null ? {} : { Authorization: `Bearer ${token}` }), ...options.headers };
    return this.context.fetch(path, { method, headers, data: options.data });
  }

  /** Enrolls an authenticator through the API from a session that must set one up; the session becomes VERIFIED. */
  async enroll(): Promise<Authenticator> {
    expect(this.mfa).toBe('ENROLLMENT_REQUIRED');
    const started = await this.call('POST', '/api/auth/mfa/enrollment');
    expect(started.status(), 'enrollment start').toBe(201);
    expect(started.headers()['cache-control'], 'enrollment start caching').toBe('no-store');
    const { enrollmentId, secret } = await started.json() as { enrollmentId: string; secret: string };
    const step = totpStep();
    const verified = await this.call('POST', '/api/auth/mfa/enrollment/verify',
      { data: { enrollmentId, code: totpCode(secret, step) } });
    expect(verified.status(), 'enrollment verification').toBe(200);
    expect(verified.headers()['cache-control'], 'enrollment verification caching').toBe('no-store');
    this.accept(await verified.json() as SessionBody);
    expect(this.mfa).toBe('VERIFIED');
    return { key: secret, step };
  }

  /** Enters a fresh code from a session that must verify; the session becomes VERIFIED. */
  async verify(authenticator: Authenticator): Promise<void> {
    expect(this.mfa).toBe('VERIFICATION_REQUIRED');
    const response = await this.call('POST', '/api/auth/mfa/verify',
      { data: { code: await freshCode(authenticator) } });
    expect(response.status(), 'code verification').toBe(200);
    this.accept(await response.json() as SessionBody);
    expect(this.mfa).toBe('VERIFIED');
  }

  async dispose(): Promise<void> {
    await this.context.dispose();
  }

  private accept(body: SessionBody): void {
    this.accessToken = body.accessToken;
    this.mfa = body.mfa;
    this.issuedAt = Date.now();
  }
}

/** A User and a signed-in API session; `authenticator` is set once the User has enrolled. */
export type ApiActor = { user: Customer; session: ApiSession; authenticator?: Authenticator };

/** A new registered Customer, signed in through the API (`NOT_REQUIRED`). */
export async function apiCustomer(api: APIRequestContext, username?: string): Promise<ApiActor> {
  const user = await registerThroughApi(api, syntheticCustomer(username));
  return { user, session: await ApiSession.signIn(user) };
}

/** A registered User whose only role becomes `role` in SQL, then signed in; Admins and Moderators enroll (VERIFIED). */
export async function apiStaff(api: APIRequestContext, role: StaffRole): Promise<ApiActor> {
  const user = await registerThroughApi(api);
  grantRole(user.username, role);
  const session = await ApiSession.signIn(user);
  if (role === 'DELIVERY_PERSON') return { user, session };
  return { user, session, authenticator: await session.enroll() };
}

/** A new Super Admin (see `makeSuperAdmin`), signed in and enrolled through the API. */
export async function apiSuperAdmin(api: APIRequestContext): Promise<ApiActor> {
  const user = await registerThroughApi(api);
  makeSuperAdmin(user.username);
  const session = await ApiSession.signIn(user);
  return { user, session, authenticator: await session.enroll() };
}

/** Signs `actor` in again with the password (their old session was revoked); returns the new session's MFA status. */
export async function signInAgain(actor: ApiActor): Promise<MfaStatus> {
  await actor.session.dispose();
  actor.session = await ApiSession.signIn(actor.user);
  return actor.session.mfa;
}

/**
 * The User search: `POST /api/admin/users/search` with the filter (`username`, `role`, `page`, `size`) as the JSON body,
 * so a username never travels in a URL (plan §4.2). `filter` is loosely typed so tests can send invalid values.
 */
export function listUsers(admin: ApiSession, filter: Record<string, unknown> = {}): Promise<APIResponse> {
  return admin.call('POST', '/api/admin/users/search', { data: filter });
}

export function getUserRoles(admin: ApiSession, userId: string): Promise<APIResponse> {
  return admin.call('GET', `/api/admin/users/${userId}`);
}

/** `PUT /api/admin/users/{id}/roles` with `{ role, rolesVersion }`; `role` is a string so tests can send invalid values. */
export function putRole(admin: ApiSession, userId: string, role: string, rolesVersion: number): Promise<APIResponse> {
  return admin.call('PUT', `/api/admin/users/${userId}/roles`, { data: { role, rolesVersion } });
}

/** The list entry of `username`, found with the username filter; the User must exist. */
export async function findUser(admin: ApiSession, username: string): Promise<UserSummary> {
  const response = await listUsers(admin, { username });
  expect(response.status(), 'user search status').toBe(200);
  const match = (await response.json() as UserPage).items.find((item) => item.username === username);
  expect(match, 'the searched User is listed').toBeDefined();
  return match!;
}

/** The current `UserRoles` of a User, read by an Admin; the status must be 200, and the response not cached. */
export async function readUserRoles(admin: ApiSession, userId: string): Promise<UserRoles> {
  const response = await getUserRoles(admin, userId);
  expect(response.status(), 'user roles status').toBe(200);
  expect(response.headers()['cache-control'], 'user roles caching').toBe('no-store');
  return await response.json() as UserRoles;
}

/** A 200 role change (or same-role no-op); returns the new `UserRoles`. */
export async function changeRole(admin: ApiSession, userId: string, role: Role, rolesVersion: number): Promise<UserRoles> {
  const response = await putRole(admin, userId, role, rolesVersion);
  expect(response.status(), `role change to ${role}`).toBe(200);
  return await response.json() as UserRoles;
}

/**
 * The bounded error envelope: exactly `code`, `message` and `requestId`, the backend's message for the code, the
 * request id echoed in `X-Request-ID`, and `Cache-Control: no-store`.
 */
export async function expectError(response: APIResponse, status: number, code: ErrorCode): Promise<void> {
  expect(response.status(), `status for ${code}`).toBe(status);
  const body = await response.json() as Record<string, unknown>;
  expect(Object.keys(body).sort()).toEqual(['code', 'message', 'requestId']);
  expect(body).toEqual({ code, message: errorMessages[code], requestId: response.headers()['x-request-id'] });
  expect(response.headers()['cache-control']).toBe('no-store');
}

/**
 * The session's current access token and refresh cookie are both refused with 401, while the token is still inside its
 * lifetime, so the refusal is revocation, not expiry.
 */
export async function expectRevoked(session: ApiSession, rejectedRefresh?: APIResponse): Promise<void> {
  const token = session.accessToken;
  expect(session.tokenAgeMs(), 'the old token is still inside its lifetime').toBeLessThan(accessTokenLifetimeMs - 1_000);
  await expectError(await session.call('GET', '/api/user/me', { token }), 401, 'AUTHENTICATION_REQUIRED');
  if (rejectedRefresh) {
    await expectError(rejectedRefresh, 401, 'AUTHENTICATION_REQUIRED');
    expect(rejectedRefresh.headers()['set-cookie'], 'the refused refresh clears its cookie').toContain('MW_REFRESH=;');
    expect((await session.refresh()).status(), 'refresh after the cookie was cleared').toBe(204);
  } else {
    await expectError(await session.refresh(), 401, 'AUTHENTICATION_REQUIRED');
  }
}

/** The session was not revoked: `/api/user/me` answers 200, after a refresh when the token is near its expiry. */
export async function expectActive(session: ApiSession): Promise<void> {
  expect((await session.call('GET', '/api/user/me')).status(), 'the session still works').toBe(200);
}

/** One `user_role_changes` row, oldest first; `actor` is the actor's username or null, `requestId` null when absent. */
export type RoleChangeRow = { oldRole: string; newRole: string; actor: string | null; requestId: string | null };

/** The audit rows whose target is `username`, read straight from the run's schema (Ticket 08). */
export function roleChangeRows(username: string): RoleChangeRow[] {
  const schema = checkedTarget('roleChangeRows', username);
  const lines = psql(`SELECT c.old_role || ' ' || c.new_role || ' ' || coalesce(a.username, '-') || ' '`
    + ` || coalesce(c.request_id, '-') FROM ${schema}.user_role_changes c`
    + ` JOIN ${schema}.users t ON t.id = c.target_user_id LEFT JOIN ${schema}.users a ON a.id = c.actor_user_id`
    + ` WHERE t.username = '${username}' ORDER BY c.occurred_at, c.id;`);
  return lines === '' ? [] : lines.split(/\r?\n/).map((line) => {
    const [oldRole, newRole, actor, requestId] = line.split(' ');
    return { oldRole, newRole, actor: actor === '-' ? null : actor, requestId: requestId === '-' ? null : requestId };
  });
}

/** Every `user_roles` row of `username`, sorted: exactly one once Ticket 08's constraint holds. */
export function storedRoles(username: string): string[] {
  const schema = checkedTarget('storedRoles', username);
  const lines = psql(`SELECT r.role FROM ${schema}.user_roles r JOIN ${schema}.users u ON u.id = r.user_id`
    + ` WHERE u.username = '${username}' ORDER BY r.role;`);
  return lines === '' ? [] : lines.split(/\r?\n/);
}

/**
 * Tries, inside a rolled-back transaction, to give `username` a second `user_roles` row with `role`; returns the
 * PostgreSQL error text (empty when the database accepted it). Proves the one-role rule lives in the database.
 */
export function tryAddSecondRole(username: string, role: string): string {
  checkedTarget('tryAddSecondRole', username);
  if (!/^[A-Z_]{1,32}$/.test(role)) throw new Error('tryAddSecondRole accepts only role-shaped values');
  return rolledBackSql(`INSERT INTO user_roles (user_id, role) SELECT id, '${role}' FROM users`
    + ` WHERE username = '${username}';`).error;
}

/**
 * Tries, inside a rolled-back transaction, to insert one `user_role_changes` row for `username` (as target and actor);
 * returns the PostgreSQL error text, or empty when the row was accepted.
 */
export function tryAuditRow(username: string, oldRole: string, newRole: string): string {
  checkedTarget('tryAuditRow', username);
  if (![oldRole, newRole].every((role) => /^[A-Z_]{1,32}$/.test(role))) throw new Error('tryAuditRow accepts only role-shaped values');
  return rolledBackSql('INSERT INTO user_role_changes (id, occurred_at, actor_user_id, target_user_id, old_role, new_role)'
    + ` SELECT gen_random_uuid(), now(), id, id, '${oldRole}', '${newRole}' FROM users WHERE username = '${username}';`).error;
}

/** The text the database raises when a transaction would commit a User without a role (plan §4.5). */
export const roleRequiredError = 'user_role_required';

/**
 * Tries, inside a rolled-back transaction, to insert a copy of the User `username` (new id, username and mobile, no
 * email) without any `user_roles` row, then forces the deferred checks with `SET CONSTRAINTS ALL IMMEDIATE`, as a commit
 * would; returns the PostgreSQL error text, or empty when the database accepted it.
 */
export function tryUserWithoutRole(username: string): string {
  checkedTarget('tryUserWithoutRole', username);
  const copy = `norole.${randomBytes(4).toString('hex')}`;
  const mobile = `017${randomInt(10_000_000, 100_000_000)}`;
  return rolledBackSql(`CREATE TEMP TABLE role_probe ON COMMIT DROP AS SELECT * FROM users WHERE username = '${username}';`
    + ` UPDATE role_probe SET id = gen_random_uuid(), username = '${copy}', mobile = '${mobile}', email = NULL;`
    + ' INSERT INTO users SELECT * FROM role_probe; SET CONSTRAINTS ALL IMMEDIATE;').error;
}

/**
 * Tries, inside a rolled-back transaction, to delete the only `user_roles` row of `username`, then forces the deferred
 * checks as a commit would; returns the PostgreSQL error text, or empty when the database accepted it.
 */
export function tryDeleteOnlyRole(username: string): string {
  checkedTarget('tryDeleteOnlyRole', username);
  return rolledBackSql('DELETE FROM user_roles WHERE user_id = (SELECT id FROM users'
    + ` WHERE username = '${username}'); SET CONSTRAINTS ALL IMMEDIATE;`).error;
}

/**
 * Tries, inside a rolled-back transaction, to insert a copy of the User `username` with a CUSTOMER role (so it has no
 * sessions or other rows that pin its id), delete that role and then change the copy's `users.id`, and forces the
 * deferred checks; returns the error text, or empty when the database accepted it. Neither the insert check (the old
 * id is gone) nor the delete check (its User is gone) can see the role-less User, so only a check on `id` updates can.
 */
export function tryRoleDeletedThenIdChanged(username: string): string {
  checkedTarget('tryRoleDeletedThenIdChanged', username);
  const copy = `newid.${randomBytes(4).toString('hex')}`;
  const mobile = `017${randomInt(10_000_000, 100_000_000)}`;
  return rolledBackSql(`CREATE TEMP TABLE role_probe ON COMMIT DROP AS SELECT * FROM users WHERE username = '${username}';`
    + ` UPDATE role_probe SET id = gen_random_uuid(), username = '${copy}', mobile = '${mobile}', email = NULL;`
    + ' INSERT INTO users SELECT * FROM role_probe;'
    + ` INSERT INTO user_roles (user_id, role) SELECT id, 'CUSTOMER' FROM users WHERE username = '${copy}';`
    + ` DELETE FROM user_roles WHERE user_id = (SELECT id FROM users WHERE username = '${copy}');`
    + ` UPDATE users SET id = gen_random_uuid() WHERE username = '${copy}'; SET CONSTRAINTS ALL IMMEDIATE;`).error;
}

/**
 * Tries, inside a rolled-back transaction, to replace the role of `username` by deleting its row and inserting `role`
 * (the order registration and the SQL helpers rely on), then forces the deferred checks; returns the error text, or
 * empty when the database accepted it.
 */
export function tryReplaceRole(username: string, role: string): string {
  checkedTarget('tryReplaceRole', username);
  if (!/^[A-Z_]{1,32}$/.test(role)) throw new Error('tryReplaceRole accepts only role-shaped values');
  return rolledBackSql('DELETE FROM user_roles WHERE user_id = (SELECT id FROM users'
    + ` WHERE username = '${username}'); INSERT INTO user_roles (user_id, role) SELECT id, '${role}' FROM users`
    + ` WHERE username = '${username}'; SET CONSTRAINTS ALL IMMEDIATE;`).error;
}

/**
 * Clears the actor of every `user_role_changes` row whose target is `username`, which is what `ON DELETE SET NULL` leaves
 * when the actor's User row is deleted (plan §4.5). This one is kept: use it only on a test's own synthetic target.
 */
export function clearRoleChangeActors(username: string): void {
  const schema = checkedTarget('clearRoleChangeActors', username);
  const cleared = psql(`UPDATE ${schema}.user_role_changes SET actor_user_id = NULL WHERE target_user_id =`
    + ` (SELECT id FROM ${schema}.users WHERE username = '${username}') RETURNING 1;`);
  if (cleared === '') throw new Error(`User ${username} has no role changes`);
}
