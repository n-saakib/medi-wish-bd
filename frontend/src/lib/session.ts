import {
  ApiError,
  apiRequest,
  boundedError,
  boundedText,
  endpoint,
  invalidResponse,
  isRecord,
  readJsonResponse,
  requestFailure,
  type ApiClientOptions,
  type ResponseReader,
} from './api';

export type SessionUser = {
  username: string;
  mobile: string;
  email: string | null;
  mobileVerified: boolean;
};

/** How far a session is from staff access; only Admin and Moderator sessions need an authenticator. */
export type MfaStatus = 'NOT_REQUIRED' | 'ENROLLMENT_REQUIRED' | 'VERIFICATION_REQUIRED' | 'REPLACEMENT_REQUIRED' | 'VERIFIED';

const mfaStatuses: readonly unknown[] = ['NOT_REQUIRED', 'ENROLLMENT_REQUIRED', 'VERIFICATION_REQUIRED', 'REPLACEMENT_REQUIRED', 'VERIFIED'];

export type SessionResponse = {
  accessToken: string;
  user: SessionUser;
  mfa: MfaStatus;
};

export type RestoredSession = {
  user: SessionUser;
  mfa: MfaStatus;
};

/** A pending authenticator setup. The secret is shown once and must stay in component memory only. */
export type MfaEnrollment = {
  enrollmentId: string;
  secret: string;
  otpauthUri: string;
  expiresIn: number;
};

/** The outcome of notifying a verified contact after an authenticator replacement. */
export type ContactNotice = 'SENT' | 'FAILED' | 'NO_VERIFIED_CONTACT' | 'NOT_CONFIGURED';

/** The verified session and once-only backup codes, plus a notice outcome only after replacement. */
export type EnrolledSession = SessionResponse & { backupCodes: string[]; contactNotice: ContactNotice | null };

export type SessionClient = {
  signIn(identifier: string, password: string): Promise<SessionResponse>;
  /**
   * The profile and MFA status when the refresh cookie is accepted, `null` when there is none; a rejected cookie
   * throws a 401 `ApiError`.
   */
  restoreSession(): Promise<RestoredSession | null>;
  authenticatedFetch<T>(path: string, init: RequestInit, readResponse: ResponseReader<T>): Promise<T>;
  /** Starts, or restarts, authenticator setup for a restricted staff session. */
  startMfaEnrollment(): Promise<MfaEnrollment>;
  /** Activates the pending authenticator and replaces the restricted session with an MFA-verified one. */
  verifyMfaEnrollment(enrollmentId: string, code: string): Promise<EnrolledSession>;
  /** Checks an authenticator code and replaces the restricted session with an MFA-verified one. */
  verifyMfa(code: string): Promise<SessionResponse>;
  /** Exchanges a password-only session and one backup code for restricted replacement enrollment. */
  redeemBackupCode(code: string): Promise<SessionResponse>;
  /** Replaces unused backup codes after a fresh authenticator code, retaining the verified session. */
  regenerateBackupCodes(code: string): Promise<string[]>;
  /** Ends the in-memory session at once, then asks the API to revoke the refresh cookie. */
  signOut(): Promise<void>;
};

const maxTokenLength = 4096;
const maxCsrfTokenLength = 512;
const maxUsernameLength = 50;
const maxMobileLength = 30;
const maxEmailLength = 320;
const maxOtpauthUriLength = 512;
const maxEnrollmentLifetimeSeconds = 24 * 60 * 60;
const backupCodeCount = 10;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const totpSecretPattern = /^[A-Z2-7]{32}$/;
const backupCodePattern = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/;
const cookieMutationLockName = 'medi-wish:auth-cookie-mutation';

let tabCookieMutations: Promise<unknown> = Promise.resolve();

/**
 * Shares an exclusive same-origin lock across credentialed refresh-cookie mutations. Web Locks exist only in a
 * secure context (HTTPS or loopback); without them, such as over plain HTTP at a LAN address, the mutations are
 * serialized within this tab only.
 */
function withCookieMutationLock<T>(operation: () => Promise<T>): Promise<T> {
  if (navigator.locks) return navigator.locks.request(cookieMutationLockName, { mode: 'exclusive' }, operation);
  const result = tabCookieMutations.then(operation);
  tabCookieMutations = result.catch(() => undefined);
  return result;
}

export function projectSessionUser(body: unknown): SessionUser | undefined {
  if (!isRecord(body)
      || !boundedText(body.username, maxUsernameLength)
      || !boundedText(body.mobile, maxMobileLength)
      || (body.email !== null && !boundedText(body.email, maxEmailLength))
      || typeof body.mobileVerified !== 'boolean') {
    return undefined;
  }
  return { username: body.username, mobile: body.mobile, email: body.email, mobileVerified: body.mobileVerified };
}

function isMfaStatus(value: unknown): value is MfaStatus {
  return mfaStatuses.includes(value);
}

function projectSession(body: unknown): SessionResponse | undefined {
  if (!isRecord(body) || !boundedText(body.accessToken, maxTokenLength) || !isMfaStatus(body.mfa)) return undefined;
  const user = projectSessionUser(body.user);
  return user && { accessToken: body.accessToken, user, mfa: body.mfa };
}

function isBackupCode(value: unknown): value is string {
  return typeof value === 'string' && backupCodePattern.test(value);
}

function projectEnrolledSession(body: unknown): EnrolledSession | undefined {
  const session = projectSession(body);
  if (!session || !isRecord(body) || !Array.isArray(body.backupCodes)) return undefined;
  const backupCodes: unknown[] = body.backupCodes;
  if (backupCodes.length !== backupCodeCount || !backupCodes.every(isBackupCode)) return undefined;
  const contactNotice = body.contactNotice;
  if (contactNotice !== undefined && contactNotice !== 'SENT' && contactNotice !== 'FAILED'
      && contactNotice !== 'NO_VERIFIED_CONTACT' && contactNotice !== 'NOT_CONFIGURED') return undefined;
  return { ...session, backupCodes: backupCodes.filter(isBackupCode), contactNotice: contactNotice ?? null };
}

function isEnrollmentLifetime(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0 && (value as number) <= maxEnrollmentLifetimeSeconds;
}

function projectMfaEnrollment(body: unknown): MfaEnrollment | undefined {
  if (!isRecord(body)
      || typeof body.enrollmentId !== 'string' || !uuidPattern.test(body.enrollmentId)
      || typeof body.secret !== 'string' || !totpSecretPattern.test(body.secret)
      || !boundedText(body.otpauthUri, maxOtpauthUriLength) || !body.otpauthUri.startsWith('otpauth://totp/')
      || !isEnrollmentLifetime(body.expiresIn)) {
    return undefined;
  }
  return { enrollmentId: body.enrollmentId, secret: body.secret, otpauthUri: body.otpauthUri, expiresIn: body.expiresIn };
}

async function parseSession(response: Response): Promise<SessionResponse> {
  return parseProjected(response, projectSession);
}

async function parseProjected<T>(response: Response, project: (body: unknown) => T | undefined): Promise<T> {
  if (!response.ok) throw await boundedError(response);
  const projected = project(await readJsonResponse(response));
  if (!projected) throw invalidResponse(response.status);
  return projected;
}

function authenticationRequired(): ApiError {
  return new ApiError('AUTHENTICATION_REQUIRED', 401);
}

export function createSessionClient(options: ApiClientOptions = {}): SessionClient {
  const fetcher = options.fetch ?? fetch;
  const apiOrigin = endpoint('/', options.baseUrl).origin;
  let accessToken: string | null = null;
  let refreshPromise: Promise<SessionResponse | null> | undefined;
  let sessionEpoch = 0;
  let cookieMutationEpoch = 0;

  function send<T>(path: string, init: RequestInit, readResponse: ResponseReader<T>): Promise<T> {
    return apiRequest(fetcher, endpoint(path, options.baseUrl), init, readResponse);
  }

  function bootstrapCsrf(): Promise<string> {
    return send('/api/auth/csrf', { method: 'GET', credentials: 'include' }, async (response) => {
      if (!response.ok) throw await boundedError(response);
      const body = await readJsonResponse(response);
      if (!isRecord(body) || !boundedText(body.csrfToken, maxCsrfTokenLength)) throw invalidResponse(response.status);
      return body.csrfToken;
    });
  }

  function requireCurrentCookieMutation(epoch: number): void {
    if (epoch !== cookieMutationEpoch) throw authenticationRequired();
  }

  /** Forgets the access token and makes results of requests that used it stale. */
  function dropAccessToken(): void {
    if (accessToken === null) return;
    accessToken = null;
    sessionEpoch += 1;
  }

  async function performRefresh(epoch: number): Promise<SessionResponse | null> {
    requireCurrentCookieMutation(epoch);
    const csrfToken = await bootstrapCsrf();
    requireCurrentCookieMutation(epoch);
    const session = await send('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-XSRF-TOKEN': csrfToken },
    }, async (response) => response.status === 204 ? null : parseSession(response));
    requireCurrentCookieMutation(epoch);
    if (session) accessToken = session.accessToken;
    else dropAccessToken();
    return session;
  }

  function refreshSession(): Promise<SessionResponse | null> {
    if (refreshPromise) return refreshPromise;
    const mutationEpoch = cookieMutationEpoch;
    const flight = withCookieMutationLock(() => performRefresh(mutationEpoch))
      .catch((reason: unknown) => {
        dropAccessToken();
        throw reason;
      })
      .finally(() => {
        if (refreshPromise === flight) refreshPromise = undefined;
      });
    refreshPromise = flight;
    return flight;
  }

  function signIn(identifier: string, password: string): Promise<SessionResponse> {
    const mutationEpoch = cookieMutationEpoch;
    return withCookieMutationLock(async () => {
      requireCurrentCookieMutation(mutationEpoch);
      const session = await send('/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
      }, parseSession);
      requireCurrentCookieMutation(mutationEpoch);
      sessionEpoch += 1;
      accessToken = session.accessToken;
      return session;
    });
  }

  async function restoreSession(): Promise<RestoredSession | null> {
    const session = await refreshSession();
    return session && { user: session.user, mfa: session.mfa };
  }

  /**
   * Sends a Bearer request to the API origin. Without an access token it refreshes first; a 401 is refreshed and
   * retried once, and a 401 after that single refresh ends the in-memory session.
   */
  async function authenticatedFetch<T>(path: string, init: RequestInit, readResponse: ResponseReader<T>): Promise<T> {
    const url = endpoint(path, options.baseUrl);
    if (url.origin !== apiOrigin) throw requestFailure();
    const requestEpoch = sessionEpoch;
    let refreshed = accessToken === null;
    if (refreshed) await refreshSession();
    for (;;) {
      const token = accessToken;
      if (sessionEpoch !== requestEpoch || token === null) throw authenticationRequired();
      const headers = new Headers(init.headers);
      headers.set('Authorization', `Bearer ${token}`);
      const result = await apiRequest(fetcher, url, { ...init, headers }, async (response) =>
        response.status === 401 ? undefined : { value: await readResponse(response) });
      if (sessionEpoch !== requestEpoch) throw authenticationRequired();
      if (result) return result.value;
      if (refreshed) {
        if (accessToken === token) dropAccessToken();
        throw authenticationRequired();
      }
      refreshed = true;
      await refreshSession();
    }
  }

  /**
   * Posts an authenticator or backup code with the restricted session's Bearer token. On success the API revokes that session
   * and sets a new refresh cookie, so the exchange holds the cookie-mutation lock, and the new access token makes the
   * results of requests that used the old one stale, as a sign-in does.
   */
  async function replaceWithVerifiedSession<T extends SessionResponse>(
    path: string,
    body: Record<string, string>,
    project: (body: unknown) => T | undefined,
  ): Promise<T> {
    if (accessToken === null) await refreshSession();
    const mutationEpoch = cookieMutationEpoch;
    const requestEpoch = sessionEpoch;
    return withCookieMutationLock(async () => {
      requireCurrentCookieMutation(mutationEpoch);
      const token = accessToken;
      if (token === null || sessionEpoch !== requestEpoch) throw authenticationRequired();
      let session: T;
      try {
        session = await send(path, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        }, (response) => parseProjected(response, project));
      } catch (reason) {
        if (reason instanceof ApiError && reason.status === 401 && accessToken === token) dropAccessToken();
        throw reason;
      }
      requireCurrentCookieMutation(mutationEpoch);
      sessionEpoch += 1;
      accessToken = session.accessToken;
      return session;
    });
  }

  function startMfaEnrollment(): Promise<MfaEnrollment> {
    return authenticatedFetch('/api/auth/mfa/enrollment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }, async (response) => {
      if (response.status !== 201) throw await boundedError(response);
      const enrollment = projectMfaEnrollment(await readJsonResponse(response));
      if (!enrollment) throw invalidResponse(response.status);
      return enrollment;
    });
  }

  function verifyMfaEnrollment(enrollmentId: string, code: string): Promise<EnrolledSession> {
    return replaceWithVerifiedSession('/api/auth/mfa/enrollment/verify', { enrollmentId, code }, projectEnrolledSession);
  }

  function verifyMfa(code: string): Promise<SessionResponse> {
    return replaceWithVerifiedSession('/api/auth/mfa/verify', { code }, projectSession);
  }

  function redeemBackupCode(code: string): Promise<SessionResponse> {
    return replaceWithVerifiedSession('/api/auth/mfa/recovery', { backupCode: code }, projectSession);
  }

  function regenerateBackupCodes(code: string): Promise<string[]> {
    return authenticatedFetch('/api/auth/mfa/backup-codes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    }, async (response) => {
      if (!response.ok) throw await boundedError(response);
      if (response.status !== 200) throw invalidResponse(response.status);
      const body = await readJsonResponse(response);
      if (!isRecord(body) || !Array.isArray(body.backupCodes)
          || body.backupCodes.length !== backupCodeCount || !body.backupCodes.every(isBackupCode)) {
        throw invalidResponse(response.status);
      }
      return body.backupCodes.filter(isBackupCode);
    });
  }

  async function signOut(): Promise<void> {
    // Results of pending requests, refreshes and sign-ins become stale, so none can revive the session.
    sessionEpoch += 1;
    cookieMutationEpoch += 1;
    accessToken = null;
    refreshPromise = undefined;
    await withCookieMutationLock(async () => {
      const csrfToken = await bootstrapCsrf();
      await send('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
        headers: { 'X-XSRF-TOKEN': csrfToken },
      }, async (response) => {
        if (!response.ok) throw await boundedError(response);
      });
    });
  }

  return { signIn, restoreSession, authenticatedFetch, startMfaEnrollment, verifyMfaEnrollment, verifyMfa,
    redeemBackupCode, regenerateBackupCodes, signOut };
}

export const {
  signIn,
  restoreSession,
  authenticatedFetch,
  startMfaEnrollment,
  verifyMfaEnrollment,
  verifyMfa,
  redeemBackupCode,
  regenerateBackupCodes,
  signOut,
} = createSessionClient();
