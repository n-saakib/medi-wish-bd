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

export type SessionResponse = {
  accessToken: string;
  user: SessionUser;
};

export type SessionClient = {
  signIn(identifier: string, password: string): Promise<SessionResponse>;
  /** The profile when the refresh cookie is accepted, `null` when there is none; a rejected cookie throws a 401 `ApiError`. */
  restoreSession(): Promise<SessionUser | null>;
  authenticatedFetch<T>(path: string, init: RequestInit, readResponse: ResponseReader<T>): Promise<T>;
  /** Ends the in-memory session at once, then asks the API to revoke the refresh cookie. */
  signOut(): Promise<void>;
};

const maxTokenLength = 4096;
const maxCsrfTokenLength = 512;
const maxUsernameLength = 50;
const maxMobileLength = 30;
const maxEmailLength = 320;
const cookieMutationLockName = 'medi-wish:auth-cookie-mutation';

/** Shares an exclusive same-origin lock across credentialed refresh-cookie mutations. */
function withCookieMutationLock<T>(operation: () => Promise<T>): Promise<T> {
  return navigator.locks.request(cookieMutationLockName, { mode: 'exclusive' }, operation);
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

function projectSession(body: unknown): SessionResponse | undefined {
  if (!isRecord(body) || !boundedText(body.accessToken, maxTokenLength)) return undefined;
  const user = projectSessionUser(body.user);
  return user && { accessToken: body.accessToken, user };
}

async function parseSession(response: Response): Promise<SessionResponse> {
  if (!response.ok) throw await boundedError(response);
  const session = projectSession(await readJsonResponse(response));
  if (!session) throw invalidResponse(response.status);
  return session;
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

  async function restoreSession(): Promise<SessionUser | null> {
    return (await refreshSession())?.user ?? null;
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

  return { signIn, restoreSession, authenticatedFetch, signOut };
}

export const { signIn, restoreSession, authenticatedFetch, signOut } = createSessionClient();
