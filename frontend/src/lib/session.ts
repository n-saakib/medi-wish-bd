export type SessionUser = {
  username: string;
  mobile: string;
  email: string | null;
  mobileVerified: boolean;
};

export type SessionResponse = {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: SessionUser;
};

export type SessionFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type SessionClientOptions = {
  baseUrl?: string;
  fetch?: SessionFetch;
};

export type SessionClient = {
  signIn(identifier: string, password: string): Promise<SessionResponse>;
  restoreSession(): Promise<SessionUser | null>;
  refreshSession(): Promise<SessionResponse>;
  authenticatedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  signOut(): Promise<void>;
  clearSession(): void;
};

export class UserApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(details: { code: string; message?: string; status: number }) {
    super(details.message ?? '');
    this.name = 'UserApiError';
    this.code = details.code;
    this.status = details.status;
  }
}

const defaultBaseUrl = process.env.NEXT_PUBLIC_MEDI_WISH_API_URL ?? 'http://127.0.0.1:8080';
const maxTokenLength = 4096;
const maxUsernameLength = 128;
const maxMobileLength = 32;
const maxEmailLength = 320;

function endpoint(path: string, baseUrl: string): URL {
  return new URL(path, baseUrl);
}

function boundedText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function isSessionUser(body: unknown): body is SessionUser {
  return body !== null && typeof body === 'object'
    && 'username' in body && boundedText(body.username, maxUsernameLength)
    && 'mobile' in body && boundedText(body.mobile, maxMobileLength)
    && 'email' in body && (body.email === null || boundedText(body.email, maxEmailLength))
    && 'mobileVerified' in body && typeof body.mobileVerified === 'boolean';
}

function isSessionResponse(body: unknown): body is SessionResponse {
  return body !== null && typeof body === 'object'
    && 'accessToken' in body && boundedText(body.accessToken, maxTokenLength)
    && 'tokenType' in body && body.tokenType === 'Bearer'
    && 'expiresIn' in body && typeof body.expiresIn === 'number'
    && Number.isInteger(body.expiresIn) && body.expiresIn > 0 && body.expiresIn <= 86_400
    && 'user' in body && isSessionUser(body.user);
}

export function invalidResponse(status: number): UserApiError {
  return new UserApiError({ code: 'INVALID_RESPONSE', status });
}

export async function boundedError(response: Response): Promise<UserApiError> {
  let code = 'REQUEST_FAILED';
  let message: string | undefined;
  try {
    const body: unknown = await response.json();
    if (body !== null && typeof body === 'object') {
      if ('code' in body && boundedText(body.code, 64)) code = body.code;
      if ('message' in body && typeof body.message === 'string' && body.message.length <= 256) message = body.message;
    }
  } catch {
    // Keep a bounded error when the server response is not JSON.
  }
  return new UserApiError({ code, message, status: response.status });
}

export function requestFailure(): UserApiError {
  return new UserApiError({ code: 'REQUEST_FAILED', status: 0 });
}

async function fetchResponse(fetcher: SessionFetch, input: RequestInfo | URL, init: RequestInit): Promise<Response> {
  try {
    return await fetcher(input, init);
  } catch {
    throw requestFailure();
  }
}

function withCredentials(init: RequestInit | undefined): RequestInit {
  return { ...init, credentials: 'include' };
}

function csrfHeaders(csrfToken: string): Headers {
  return new Headers({ 'X-XSRF-TOKEN': csrfToken });
}

export function createSessionClient(options: SessionClientOptions = {}): SessionClient {
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  const baseUrl = options.baseUrl ?? defaultBaseUrl;
  let accessToken: string | null = null;
  let refreshPromise: Promise<SessionResponse> | undefined;
  let sessionVersion = 0;

  async function bootstrapCsrf(): Promise<string> {
    const response = await fetchResponse(fetcher, endpoint('/api/auth/csrf', baseUrl), {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      redirect: 'error',
    });
    if (!response.ok) throw await boundedError(response);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw invalidResponse(response.status);
    }
    if (body === null || typeof body !== 'object' || !('csrfToken' in body)
        || !boundedText(body.csrfToken, 512)) {
      throw invalidResponse(response.status);
    }
    return body.csrfToken;
  }

  async function parseSession(response: Response): Promise<SessionResponse> {
    if (!response.ok) throw await boundedError(response);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw invalidResponse(response.status);
    }
    if (!isSessionResponse(body)) throw invalidResponse(response.status);
    return body;
  }

  async function performRefresh(version: number): Promise<SessionResponse> {
    const csrfToken = await bootstrapCsrf();
    const response = await fetchResponse(fetcher, endpoint('/api/auth/refresh', baseUrl), {
      method: 'POST',
      headers: csrfHeaders(csrfToken),
      ...withCredentials({ cache: 'no-store', redirect: 'error' }),
    });
    const session = await parseSession(response);
    if (version !== sessionVersion) {
      throw new UserApiError({ code: 'AUTHENTICATION_REQUIRED', status: 401 });
    }
    accessToken = session.accessToken;
    return session;
  }

  async function refreshSession(): Promise<SessionResponse> {
    if (refreshPromise) return refreshPromise;
    const version = sessionVersion;
    const pending = performRefresh(version).catch((reason: unknown) => {
      if (version === sessionVersion) accessToken = null;
      throw reason;
    });
    const flight = pending.finally(() => {
      if (refreshPromise === flight) refreshPromise = undefined;
    });
    refreshPromise = flight;
    return flight;
  }

  async function signIn(identifier: string, password: string): Promise<SessionResponse> {
    const response = await fetchResponse(fetcher, endpoint('/api/auth/login', baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password }),
      ...withCredentials({ cache: 'no-store', redirect: 'error' }),
    });
    const session = await parseSession(response);
    sessionVersion += 1;
    refreshPromise = undefined;
    accessToken = session.accessToken;
    return session;
  }

  async function restoreSession(): Promise<SessionUser | null> {
    try {
      return (await refreshSession()).user;
    } catch (reason) {
      if (reason instanceof UserApiError && reason.status === 401) return null;
      throw reason;
    }
  }

  async function authenticatedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    if (!accessToken) throw new UserApiError({ code: 'AUTHENTICATION_REQUIRED', status: 401 });
    const request = async (): Promise<Response> => {
      const headers = new Headers(init?.headers);
      headers.set('Authorization', `Bearer ${accessToken}`);
      return fetchResponse(fetcher, input, { ...init, headers });
    };
    const response = await request();
    if (response.status !== 401) return response;
    await refreshSession();
    return request();
  }

  async function signOut(): Promise<void> {
    try {
      const csrfToken = await bootstrapCsrf();
      const response = await fetchResponse(fetcher, endpoint('/api/auth/logout', baseUrl), {
        method: 'POST',
        headers: csrfHeaders(csrfToken),
        ...withCredentials({ cache: 'no-store', redirect: 'error' }),
      });
      if (!response.ok) throw await boundedError(response);
    } finally {
      clearSession();
    }
  }

  function clearSession(): void {
    sessionVersion += 1;
    accessToken = null;
    refreshPromise = undefined;
  }

  return { signIn, restoreSession, refreshSession, authenticatedFetch, signOut, clearSession };
}

const defaultClient = createSessionClient();

export const signIn = defaultClient.signIn;
export const restoreSession = defaultClient.restoreSession;
export const refreshSession = defaultClient.refreshSession;
export const authenticatedFetch = defaultClient.authenticatedFetch;
export const signOut = defaultClient.signOut;
export const clearSession = defaultClient.clearSession;
