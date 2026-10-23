import { randomBytes, randomInt } from 'node:crypto';
import { expect, type APIRequestContext, type APIResponse, type Page } from '@playwright/test';
import { signIn, syntheticCustomer, type Customer } from './support';
import { accessTokenLifetimeMs, apiUrl, checkedTarget, psql } from './testApi';

/** Ticket 11 contract strings (plan §4.2 and §10); the API's and the page's copy must match them exactly. */
export const copy = {
  staleApi: 'This record changed after you opened it. Reload and try again.',
  closingApi: 'This account is closing, so it can\'t be changed.',
  staleUpdate: 'This record changed after you opened it. Reload and try again.',
  accountClosing: 'Your account is closing.',
  duplicateUser: 'The username, mobile number or email is already in use.',
  checkDetails: 'Check your details and try again.',
  profileSaved: 'Profile saved.',
  fullNameInvalid: 'Enter a name of up to 100 characters.',
  emailInvalid: 'Enter a valid email address, or leave it empty.',
  dateOfBirthInvalid: 'Enter a date from 1 January 1900 to today.',
  mobileExplanation: 'Your current number stays active until the new one is verified. '
    + 'Verification by text message is coming soon.',
  pendingNote: (mobile: string) => `New number ${mobile} is waiting for verification.`,
} as const;

/** The routes of the profile resource; none carries a User id. */
export const profilePath = '/api/user/me/profile';
export const mobileChangePath = '/api/user/me/mobile-change';

/** The `Profile` body of plan §4.2. */
export type Profile = {
  username: string;
  fullName: string | null;
  mobile: string;
  mobileVerified: boolean;
  pendingMobile: string | null;
  email: string | null;
  emailVerified: boolean;
  dateOfBirth: string | null;
  accountState: 'ACTIVE' | 'CLOSURE_REQUESTED';
  version: number;
};

/** Exactly these keys, sorted: nothing else may leak through the profile resource. */
export const profileKeys = ['accountState', 'dateOfBirth', 'email', 'emailVerified', 'fullName', 'mobile', 'mobileVerified',
  'pendingMobile', 'username', 'version'];

/** The tables a profile or mobile edit may write (plan T6 R1); every other table must keep its fingerprint. */
export const profileWritableTables = ['users', 'user_mobile_changes', 'user_sessions', 'user_session_refresh_tokens',
  'account_codes', 'account_code_limits', 'security_audit_events',
  'databasechangelog', 'databasechangeloglock'] as const;

/** A synthetic mobile in the registration format (exactly 11 digits, P12), unique to one test run. */
export function syntheticMobile(): string {
  return `018${randomInt(10_000_000, 100_000_000)}`;
}

/** A synthetic full name that is easy to find in a log or URL. */
export function syntheticFullName(): string {
  return `Profile Tester ${randomBytes(4).toString('hex')}`;
}

/** The calendar date in Asia/Dhaka `days` after today, as `yyyy-MM-dd` (Dhaka has no daylight saving time). */
export function dhakaDate(days = 0, from = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(from + days * 86_400_000));
}

/** Waits past Dhaka midnight when it is less than 20 seconds away, so a "today" and "tomorrow" pair stays valid. */
export async function awayFromDhakaMidnight(page?: Page): Promise<void> {
  const dhakaSeconds = (Math.floor(Date.now() / 1000) + 6 * 3600) % 86_400;
  const untilMidnight = 86_400 - dhakaSeconds;
  if (untilMidnight < 20) {
    const wait = (untilMidnight + 2) * 1000;
    if (page) await page.waitForTimeout(wait);
    else await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

/** Registers a synthetic Customer through the API, as the shortest way to an existing User. */
export async function registerByApi(api: APIRequestContext, customer: Customer = syntheticCustomer()): Promise<Customer> {
  const { username, mobile, email, password } = customer;
  expect((await api.post(`${apiUrl}/api/auth/register`, { data: { username, mobile, email, password } })).status())
    .toBe(201);
  return customer;
}

/** Signs in through the API; the caller checks the answer. */
export function signInByApi(api: APIRequestContext, identifier: string, password: string): Promise<APIResponse> {
  return api.post(`${apiUrl}/api/auth/login`, { data: { identifier, password } });
}

/** The MFA status a session response reports (plan T1 actor table; Ticket 06). */
export type MfaStatus = 'NOT_REQUIRED' | 'ENROLLMENT_REQUIRED' | 'VERIFICATION_REQUIRED' | 'VERIFIED';

/**
 * The profile routes for one User over the API, with a Bearer token renewed once the 10-second test access token is
 * more than half spent. A password User signs in again. A session client (an MFA-verified staff session) renews
 * through `POST /api/auth/refresh`, which rotates the refresh token of the same session and so keeps its MFA
 * verification; each renewal checks that the status is unchanged. Concurrent calls share one renewal, because a
 * replayed refresh cookie revokes the session.
 */
export class ProfileApi {
  private token: string | null = null;
  private issuedAt = 0;
  private renewal: Promise<void> | null = null;

  private constructor(
    readonly api: APIRequestContext,
    readonly user: Customer,
    private readonly sessionMfa: MfaStatus | null,
  ) {}

  /** Registers a new synthetic Customer (or `customer`) and returns their client. */
  static async register(api: APIRequestContext, customer?: Customer): Promise<ProfileApi> {
    return new ProfileApi(api, await registerByApi(api, customer), null);
  }

  /** A client for an existing password User. */
  static forUser(api: APIRequestContext, customer: Customer): ProfileApi {
    return new ProfileApi(api, customer, null);
  }

  /**
   * A client on an existing session, such as an MFA-verified staff session. `api` must be this User's own request
   * context, holding the session's refresh cookie (the cookie is per context), and `session` its latest answer.
   */
  static onSession(api: APIRequestContext, customer: Customer,
    session: { accessToken: string; mfa: MfaStatus }): ProfileApi {
    const client = new ProfileApi(api, customer, session.mfa);
    client.remember(session.accessToken, Date.now());
    return client;
  }

  private remember(token: string, issuedAt: number): void {
    this.token = token;
    this.issuedAt = issuedAt;
  }

  private async renew(): Promise<void> {
    const started = Date.now();
    if (this.sessionMfa === null) {
      const response = await signInByApi(this.api, this.user.username, this.user.password);
      expect(response.status()).toBe(200);
      this.remember(((await response.json()) as { accessToken: string }).accessToken, started);
      return;
    }
    const csrf = await this.api.get(`${apiUrl}/api/auth/csrf`);
    expect(csrf.status()).toBe(200);
    const { csrfToken } = await csrf.json() as { csrfToken: string };
    const refreshed = await this.api.post(`${apiUrl}/api/auth/refresh`, { headers: { 'X-XSRF-TOKEN': csrfToken } });
    expect(refreshed.status(), 'the session refresh').toBe(200);
    const session = await refreshed.json() as { accessToken: string; mfa: MfaStatus; user: { username: string } };
    expect(session.user.username).toBe(this.user.username);
    expect(session.mfa, 'a refresh keeps the MFA status').toBe(this.sessionMfa);
    this.remember(session.accessToken, started);
  }

  async bearer(): Promise<string> {
    if (!this.token || Date.now() - this.issuedAt > accessTokenLifetimeMs / 2) {
      this.renewal ??= this.renew().finally(() => { this.renewal = null; });
      await this.renewal;
    }
    return this.token!;
  }

  async headers(extra: Record<string, string> = {}): Promise<Record<string, string>> {
    return { Authorization: `Bearer ${await this.bearer()}`, ...extra };
  }

  async get(path = profilePath): Promise<APIResponse> {
    return this.api.get(`${apiUrl}${path}`, { headers: await this.headers() });
  }

  /** `PUT /api/user/me/profile`; an object is sent as JSON, a string as the raw body with `contentType`. */
  async put(body: unknown, contentType = 'application/json'): Promise<APIResponse> {
    return this.api.put(`${apiUrl}${profilePath}`, {
      headers: await this.headers({ 'Content-Type': contentType }),
      data: typeof body === 'string' ? body : JSON.stringify(body),
    });
  }

  /** `POST /api/user/me/mobile-change`; an object is sent as JSON, a string as the raw body. */
  async stage(body: unknown, contentType = 'application/json'): Promise<APIResponse> {
    return this.api.post(`${apiUrl}${mobileChangePath}`, {
      headers: await this.headers({ 'Content-Type': contentType }),
      data: typeof body === 'string' ? body : JSON.stringify(body),
    });
  }

  async cancel(): Promise<APIResponse> {
    return this.api.delete(`${apiUrl}${mobileChangePath}`, { headers: await this.headers() });
  }

  /** The current profile, checked to be a complete `Profile` answered `200` with `no-store`. */
  async profile(): Promise<Profile> {
    return expectProfile(await this.get(), 200);
  }

  /** Saves the four editable fields at the current version and returns the saved profile. */
  async save(edit: Partial<Pick<Profile, 'fullName' | 'email' | 'dateOfBirth'>> & { currentPassword?: string | null }): Promise<Profile> {
    const current = await this.profile();
    const body = { fullName: current.fullName, email: current.email, dateOfBirth: current.dateOfBirth,
      version: current.version, ...edit };
    const normalized = body.email?.trim().toLowerCase() || null;
    if (!Object.hasOwn(edit, 'currentPassword') && normalized !== current.email) {
      Object.assign(body, { currentPassword: this.user.password });
    }
    return expectProfile(await this.put(body), 200);
  }
}

/** Asserts `no-store` on a profile-route response (Spring may add other directives). */
export function expectNoStore(response: APIResponse): void {
  expect(response.headers()['cache-control'] ?? '').toMatch(/(^|[\s,])no-store($|[\s,])/);
}

/** Asserts a `Profile` body with exactly the contract keys, the status and `no-store`, and returns it. */
export async function expectProfile(response: APIResponse, status: 200 | 202): Promise<Profile> {
  expect(response.status(), await response.text()).toBe(status);
  expectNoStore(response);
  const body = await response.json() as Profile;
  expect(Object.keys(body).sort()).toEqual(profileKeys);
  expect(['ACTIVE', 'CLOSURE_REQUESTED']).toContain(body.accountState);
  expect(Number.isInteger(body.version) && body.version >= 0).toBe(true);
  return body;
}

/**
 * Asserts the bounded error envelope (`code`, `message`, `requestId` and nothing else) with `no-store`, and a
 * non-empty `requestId` equal to the `X-Request-ID` header, and returns it.
 */
export async function expectError(response: APIResponse, status: number, code: string, message?: string):
  Promise<{ code: string; message: string; requestId: string }> {
  expect(response.status(), await response.text()).toBe(status);
  expectNoStore(response);
  const body = await response.json() as { code: string; message: string; requestId: string };
  expect(Object.keys(body).sort()).toEqual(['code', 'message', 'requestId']);
  expect(body.code).toBe(code);
  if (message !== undefined) expect(body.message).toBe(message);
  expect(typeof body.requestId === 'string' && body.requestId.trim().length > 0, 'requestId is non-empty').toBe(true);
  expect(body.requestId).toBe(response.headers()['x-request-id']);
  return body;
}

/** `length` random ASCII digits starting `01`, for mobile format checks (P12: exactly 11 digits). */
export function syntheticDigits(length: number): string {
  return `01${Array.from({ length: length - 2 }, () => randomInt(0, 10)).join('')}`;
}

/** Signs in through the form, waits for `/account`, then opens the profile page and waits for its form. */
export async function openProfile(page: Page, customer: Customer): Promise<void> {
  await signIn(page, customer.username, customer.password);
  await expect(page).toHaveURL('/account');
  await page.goto('/account/profile');
  await expect(page.getByRole('heading', { level: 1, name: 'Profile' })).toBeVisible();
  await expect(page.getByLabel('Full name')).toBeVisible();
}

/** One call a page made to a profile route, as the API answered it. */
export type ProfileCall = { method: string; path: string; status: number; body: string | null };

/**
 * Records the page's calls to the profile routes (CORS preflights left out). A `401` answered to an expired access
 * token is left out too, because the session client refreshes and retries it once; each entry is one real attempt.
 */
export function recordProfileCalls(page: Page): ProfileCall[] {
  const calls: ProfileCall[] = [];
  page.on('response', (response) => {
    const request = response.request();
    const { pathname } = new URL(response.url());
    if (request.method() === 'OPTIONS' || response.status() === 401) return;
    if (!response.url().startsWith(apiUrl) || ![profilePath, mobileChangePath].includes(pathname)) return;
    calls.push({ method: request.method(), path: pathname, status: response.status(), body: request.postData() });
  });
  return calls;
}

/**
 * Records every request the page sends to the profile routes, whatever the answer (CORS preflights left out), as
 * `METHOD path`. Unlike `recordProfileCalls`, it keeps a request answered `401` and one that never got an answer.
 */
export function recordProfileRequests(page: Page): string[] {
  const requests: string[] = [];
  page.on('request', (request) => {
    const { pathname } = new URL(request.url());
    if (request.method() === 'OPTIONS') return;
    if (!request.url().startsWith(apiUrl) || ![profilePath, mobileChangePath].includes(pathname)) return;
    requests.push(`${request.method()} ${pathname}`);
  });
  return requests;
}

/** Decodes URL text, reading `+` as a space; a malformed escape leaves the text as it is. */
function decoded(text: string): string {
  try {
    return decodeURIComponent(text.replace(/\+/g, ' '));
  } catch {
    return text;
  }
}

/** A URL as text to scan: the URL, the whole URL decoded, and its decoded path, query names and values, and fragment. */
export function urlScanText(url: string): string {
  const parts = [url, decoded(url)];
  try {
    const parsed = new URL(url);
    parts.push(decoded(parsed.pathname), decoded(parsed.hash));
    for (const [name, value] of parsed.searchParams) parts.push(name, value);
  } catch {
    // Not an absolute URL: the raw and decoded text are scanned.
  }
  return parts.join('\n');
}

/** A private value as typed, percent-encoded (`encodeURIComponent`) and form-encoded (`+` for a space). */
export function encodedForms(value: string): string[] {
  const percent = encodeURIComponent(value);
  return [...new Set([value, percent, percent.replace(/%20/g, '+')])];
}

/** A User's account state; Ticket 11 has no route that sets it, and Tickets 46/47 own the transitions. */
export type AccountState = 'ACTIVE' | 'CLOSURE_REQUESTED';

/** Sets `users.account_state` for a synthetic User, as the closure tickets will; tests use it to close an account. */
export function setAccountState(username: string, state: AccountState): void {
  const schema = checkedTarget('setAccountState', username);
  const set = psql(`UPDATE ${schema}.users SET account_state = '${state}' WHERE username = '${username}'`
    + ' RETURNING account_state;');
  if (set !== state) throw new Error(`No User ${username} to set ${state} on`);
}

/** A User's profile columns and pending mobile changes, as the database holds them. */
export type StoredProfile = {
  id: string;
  username: string;
  fullName: string | null;
  email: string | null;
  dateOfBirth: string | null;
  mobile: string;
  mobileVerified: boolean;
  profileVersion: number;
  accountState: AccountState;
  pendingChanges: { id: string; newMobile: string }[];
};

/** Reads a synthetic User's stored profile and every `user_mobile_changes` row they own, straight from the database. */
export function storedProfile(username: string): StoredProfile {
  const schema = checkedTarget('storedProfile', username);
  const row = psql(`SELECT json_build_object('id', u.id, 'username', u.username, 'fullName', u.full_name,`
    + ` 'email', u.email, 'dateOfBirth', u.date_of_birth::text, 'mobile', u.mobile, 'mobileVerified', u.mobile_verified,`
    + ` 'profileVersion', u.profile_version, 'accountState', u.account_state, 'pendingChanges', coalesce((SELECT`
    + ` json_agg(json_build_object('id', c.id, 'newMobile', c.new_mobile) ORDER BY c.requested_at, c.id)`
    + ` FROM ${schema}.user_mobile_changes c WHERE c.user_id = u.id), '[]'::json))`
    + ` FROM ${schema}.users u WHERE u.username = '${username}';`);
  if (!row) throw new Error(`No User ${username} to read`);
  return JSON.parse(row) as StoredProfile;
}
