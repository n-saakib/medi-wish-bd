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
  operationTimeoutMs?: number;
};

type ResponseReader<T> = (response: Response) => Promise<T>;

export type SessionClient = {
  signIn(identifier: string, password: string): Promise<SessionResponse>;
  restoreSession(): Promise<SessionUser | null>;
  refreshSession(): Promise<SessionResponse>;
  authenticatedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  authenticatedFetch<T>(input: RequestInfo | URL, init: RequestInit | undefined, readResponse: ResponseReader<T>): Promise<T>;
  signOut(): Promise<void>;
  clearSession(): void;
  isAuthenticated(): boolean;
};

export class UserApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId: string | undefined;

  constructor(details: { code: string; message?: string; status: number; requestId?: string }) {
    super(details.message ?? '');
    this.name = 'UserApiError';
    this.code = details.code;
    this.status = details.status;
    this.requestId = details.requestId;
  }
}

const defaultBaseUrl = process.env.NEXT_PUBLIC_MEDI_WISH_API_URL ?? 'http://127.0.0.1:8080';
const maxTokenLength = 4096;
const maxUsernameLength = 128;
const maxMobileLength = 32;
const maxEmailLength = 320;
const maxRequestIdLength = 128;
const maxJsonResponseBytes = 16 * 1024;
const defaultOperationTimeoutMs = 10_000;
const cookieMutationLockName = 'medi-wish:auth-cookie-mutation';

function endpoint(path: string, baseUrl: string): URL {
  return new URL(path, baseUrl);
}

/** Shares an exclusive same-origin lock across credentialed refresh-cookie mutations when supported. */
function withCrossTabCookieMutationLock<T>(operation: () => Promise<T>): Promise<T> {
  if (typeof navigator === 'undefined' || typeof navigator.locks === 'undefined') return operation();
  return navigator.locks.request(cookieMutationLockName, { mode: 'exclusive' }, operation);
}

function boundedText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

export function projectUserIdentity(body: unknown): Pick<SessionUser, 'username' | 'mobile' | 'email'> | undefined {
  if (body === null || typeof body !== 'object'
      || !('username' in body) || !boundedText(body.username, maxUsernameLength)
      || !('mobile' in body) || !boundedText(body.mobile, maxMobileLength)
      || !('email' in body) || (body.email !== null && !boundedText(body.email, maxEmailLength))) {
    return undefined;
  }
  return {
    username: body.username,
    mobile: body.mobile,
    email: body.email,
  };
}

export function projectSessionUser(body: unknown): SessionUser | undefined {
  if (body === null || typeof body !== 'object'
      || !('mobileVerified' in body) || typeof body.mobileVerified !== 'boolean') {
    return undefined;
  }
  const identity = projectUserIdentity(body);
  return identity ? { ...identity, mobileVerified: body.mobileVerified } : undefined;
}

function sessionProjection(body: unknown): SessionResponse | undefined {
  if (body === null || typeof body !== 'object'
      || !('accessToken' in body) || !boundedText(body.accessToken, maxTokenLength)
      || !('tokenType' in body) || body.tokenType !== 'Bearer'
      || !('expiresIn' in body) || typeof body.expiresIn !== 'number'
      || !Number.isInteger(body.expiresIn) || body.expiresIn <= 0
      || !('user' in body)) {
    return undefined;
  }
  const user = projectSessionUser(body.user);
  if (!user) return undefined;
  return {
    accessToken: body.accessToken,
    tokenType: 'Bearer',
    expiresIn: body.expiresIn,
    user,
  };
}

function boundedRequestId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maxRequestIdLength
    && /^[A-Za-z0-9._:-]+$/.test(value);
}

export function invalidResponse(status: number): UserApiError {
  return new UserApiError({ code: 'INVALID_RESPONSE', status });
}

export async function boundedError(response: Response): Promise<UserApiError> {
  let code = 'REQUEST_FAILED';
  let message: string | undefined;
  let requestId: string | undefined;
  try {
    const body = await readJsonResponse(response);
    if (body !== null && typeof body === 'object') {
      if ('code' in body && boundedText(body.code, 64)) code = body.code;
      if ('message' in body && typeof body.message === 'string' && body.message.length <= 256) message = body.message;
      if ('requestId' in body && boundedRequestId(body.requestId)) requestId = body.requestId;
    }
  } catch (reason) {
    if (reason instanceof UserApiError && reason.code !== 'INVALID_RESPONSE') throw reason;
  }
  if (!requestId) {
    const headerRequestId = response.headers.get('X-Request-ID');
    if (boundedRequestId(headerRequestId)) requestId = headerRequestId;
  }
  return new UserApiError({ code, message, status: response.status, requestId });
}

export function requestFailure(): UserApiError {
  return new UserApiError({ code: 'REQUEST_FAILED', status: 0 });
}

export async function readJsonResponse(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw invalidResponse(response.status);

  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maxJsonResponseBytes) {
        void reader.cancel().catch(() => undefined);
        throw invalidResponse(response.status);
      }
      chunks.push(value);
    }
  } catch (reason) {
    if (reason instanceof UserApiError) throw reason;
    throw requestFailure();
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw invalidResponse(response.status);
  }
}

async function fetchResponse(
  fetcher: SessionFetch,
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs?: number,
): Promise<Response>;
async function fetchResponse<T>(
  fetcher: SessionFetch,
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number | undefined,
  readResponse: ResponseReader<T>,
): Promise<T>;
async function fetchResponse<T>(
  fetcher: SessionFetch,
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs?: number,
  readResponse?: ResponseReader<T>,
): Promise<Response | T> {
  let controller: AbortController | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let callerAbortListener: (() => void) | undefined;
  const callerSignal = init.signal !== undefined
    ? init.signal ?? undefined
    : typeof Request !== 'undefined' && input instanceof Request ? input.signal : undefined;
  let requestInit = init;
  if (timeoutMs !== undefined && typeof AbortController !== 'undefined') {
    controller = new AbortController();
    if (callerSignal?.aborted) {
      controller.abort(callerSignal.reason);
    } else if (callerSignal) {
      callerAbortListener = () => controller?.abort(callerSignal.reason);
      callerSignal.addEventListener('abort', callerAbortListener, { once: true });
    }
    requestInit = { ...init, signal: controller.signal };
    timeout = setTimeout(() => controller?.abort(), timeoutMs);
  }
  try {
    if (callerSignal?.aborted) throw requestFailure();
    let response: Response;
    try {
      response = await fetcher(input, requestInit);
    } catch {
      throw requestFailure();
    }
    if (callerSignal?.aborted || controller?.signal.aborted) throw requestFailure();
    if (!readResponse) return response;
    let result: T;
    try {
      result = await readResponse(response);
    } catch (reason) {
      if (callerSignal?.aborted || controller?.signal.aborted) throw requestFailure();
      throw reason;
    }
    if (callerSignal?.aborted || controller?.signal.aborted) throw requestFailure();
    return result;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    if (callerSignal && callerAbortListener) callerSignal.removeEventListener('abort', callerAbortListener);
  }
}

type AuthenticatedFetchResult<T> =
  | { kind: 'response'; response: Response }
  | { kind: 'value'; value: T; sessionEpoch: number; invalidated: boolean };

function withCredentials(init: RequestInit | undefined): RequestInit {
  return { ...init, credentials: 'include' };
}

function csrfHeaders(csrfToken: string): Headers {
  return new Headers({ 'X-XSRF-TOKEN': csrfToken });
}

export function createSessionClient(options: SessionClientOptions = {}): SessionClient {
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  const baseUrl = options.baseUrl ?? defaultBaseUrl;
  const operationTimeoutMs = Number.isFinite(options.operationTimeoutMs)
    && (options.operationTimeoutMs ?? 0) > 0
    ? Math.min(options.operationTimeoutMs as number, 60_000)
    : defaultOperationTimeoutMs;
  let accessToken: string | null = null;
  let refreshPromise: Promise<SessionResponse> | undefined;
  let sessionEpoch = 0;
  let cookieMutationEpoch = 0;
  let cookieMutationTail: Promise<void> = Promise.resolve();

  function enqueueCookieMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = cookieMutationTail.then(operation, operation);
    cookieMutationTail = result.then(() => undefined, () => undefined);
    return result;
  }

  async function bootstrapCsrf(): Promise<string> {
    return fetchResponse(fetcher, endpoint('/api/auth/csrf', baseUrl), {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      redirect: 'error',
    }, operationTimeoutMs, async (response) => {
      if (!response.ok) throw await boundedError(response);
      const body = await readJsonResponse(response);
      if (body === null || typeof body !== 'object' || !('csrfToken' in body)
          || !boundedText(body.csrfToken, 512)) {
        throw invalidResponse(response.status);
      }
      return body.csrfToken;
    });
  }

  async function parseSession(response: Response): Promise<SessionResponse> {
    if (!response.ok) throw await boundedError(response);
    const body = await readJsonResponse(response);
    const session = sessionProjection(body);
    if (!session) throw invalidResponse(response.status);
    return session;
  }

  function requireCurrentCookieMutation(epoch: number): void {
    if (epoch !== cookieMutationEpoch) {
      throw new UserApiError({ code: 'AUTHENTICATION_REQUIRED', status: 401 });
    }
  }

  async function performRefresh(epoch: number): Promise<SessionResponse> {
    requireCurrentCookieMutation(epoch);
    const csrfToken = await bootstrapCsrf();
    requireCurrentCookieMutation(epoch);
    const session = await fetchResponse(fetcher, endpoint('/api/auth/refresh', baseUrl), {
      method: 'POST',
      headers: csrfHeaders(csrfToken),
      ...withCredentials({ cache: 'no-store', redirect: 'error' }),
    }, operationTimeoutMs, parseSession);
    requireCurrentCookieMutation(epoch);
    accessToken = session.accessToken;
    return session;
  }

  async function refreshSession(): Promise<SessionResponse> {
    if (refreshPromise) return refreshPromise;
    const mutationEpoch = cookieMutationEpoch;
    const pending = enqueueCookieMutation(async () => {
      return withCrossTabCookieMutationLock(() => performRefresh(mutationEpoch));
    }).catch((reason: unknown) => {
      if (accessToken !== null) {
        accessToken = null;
        sessionEpoch += 1;
      }
      throw reason;
    });
    const flight = pending.finally(() => {
      if (refreshPromise === flight) refreshPromise = undefined;
    });
    refreshPromise = flight;
    return flight;
  }

  async function signIn(identifier: string, password: string): Promise<SessionResponse> {
    const mutationEpoch = cookieMutationEpoch;
    return enqueueCookieMutation(async () => {
      return withCrossTabCookieMutationLock(async () => {
        requireCurrentCookieMutation(mutationEpoch);
        const session = await fetchResponse(fetcher, endpoint('/api/auth/login', baseUrl), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier, password }),
          ...withCredentials({ cache: 'no-store', redirect: 'error' }),
        }, operationTimeoutMs, parseSession);
        requireCurrentCookieMutation(mutationEpoch);
        sessionEpoch += 1;
        accessToken = session.accessToken;
        return session;
      });
    });
  }

  async function restoreSession(): Promise<SessionUser | null> {
    try {
      return (await refreshSession()).user;
    } catch (reason) {
      if (reason instanceof UserApiError && reason.status === 401) return null;
      throw reason;
    }
  }

  async function authenticatedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  async function authenticatedFetch<T>(
    input: RequestInfo | URL,
    init: RequestInit | undefined,
    readResponse: ResponseReader<T>,
  ): Promise<T>;
  async function authenticatedFetch<T>(
    input: RequestInfo | URL,
    init?: RequestInit,
    readResponse?: ResponseReader<T>,
  ): Promise<Response | T> {
    const requestEpoch = sessionEpoch;
    const requestToken = accessToken;
    if (!requestToken) throw new UserApiError({ code: 'AUTHENTICATION_REQUIRED', status: 401 });
    const sessionOrigin = new URL(baseUrl).origin;
    let requestTemplate: Request | undefined;
    const request = async <Result>(
      token: string,
      responseReader?: ResponseReader<Result>,
      retryUnauthorized = false,
    ): Promise<AuthenticatedFetchResult<Result>> => {
      let targetUrl: URL;
      try {
        const inputUrl = typeof input === 'string' ? input : 'url' in input ? input.url : input.href;
        targetUrl = new URL(inputUrl, baseUrl);
      } catch {
        throw requestFailure();
      }
      if (targetUrl.origin !== sessionOrigin) throw requestFailure();
      const requestInput: RequestInfo | URL = typeof input !== 'string' && 'url' in input ? input : targetUrl;
      try {
        requestTemplate ??= new Request(requestInput, init);
      } catch {
        throw requestFailure();
      }
      let attempt: Request;
      try {
        attempt = requestTemplate.clone();
        attempt.headers.set('Authorization', `Bearer ${token}`);
      } catch {
        throw requestFailure();
      }
      if (!responseReader) {
        const response = await fetchResponse(fetcher, attempt, {}, operationTimeoutMs);
        return { kind: 'response', response };
      }
      return fetchResponse(fetcher, attempt, {}, operationTimeoutMs, async (response) => {
        if (retryUnauthorized && response.status === 401) return { kind: 'response', response };
        const invalidated = response.status === 401 && accessToken === token;
        if (invalidated) {
          accessToken = null;
          sessionEpoch += 1;
        }
        const responseEpoch = sessionEpoch;
        const value = await responseReader(response);
        return { kind: 'value', value, sessionEpoch: responseEpoch, invalidated };
      });
    };
    const hasExpectedResponseEpoch = (responseEpoch: number, invalidated: boolean) =>
      sessionEpoch === responseEpoch
      && responseEpoch === requestEpoch + (invalidated ? 1 : 0);
    const initial = await request(requestToken, readResponse, true);
    if (initial.kind === 'value') {
      if (!hasExpectedResponseEpoch(initial.sessionEpoch, initial.invalidated)) {
        throw new UserApiError({ code: 'AUTHENTICATION_REQUIRED', status: 401 });
      }
      return initial.value;
    }
    const response = initial.response;
    if (sessionEpoch !== requestEpoch) {
      throw new UserApiError({ code: 'AUTHENTICATION_REQUIRED', status: 401 });
    }
    if (response.status !== 401) return response;
    const callerSignal = requestTemplate?.signal;
    if (callerSignal?.aborted) throw requestFailure();
    const refresh = refreshSession();
    if (!callerSignal) {
      await refresh;
    } else {
      let callerAbortListener: (() => void) | undefined;
      try {
        await Promise.race([
          refresh,
          new Promise<never>((_, reject) => {
            callerAbortListener = () => reject(requestFailure());
            if (callerSignal.aborted) callerAbortListener();
            else callerSignal.addEventListener('abort', callerAbortListener, { once: true });
          }),
        ]);
      } finally {
        if (callerAbortListener) callerSignal.removeEventListener('abort', callerAbortListener);
      }
    }
    const retryToken = accessToken;
    if (sessionEpoch !== requestEpoch || !retryToken) {
      throw new UserApiError({ code: 'AUTHENTICATION_REQUIRED', status: 401 });
    }
    const retry = await request(retryToken, readResponse);
    if (retry.kind === 'value') {
      if (!hasExpectedResponseEpoch(retry.sessionEpoch, retry.invalidated)) {
        throw new UserApiError({ code: 'AUTHENTICATION_REQUIRED', status: 401 });
      }
      return retry.value;
    }
    const retryResponse = retry.response;
    if (sessionEpoch !== requestEpoch) {
      throw new UserApiError({ code: 'AUTHENTICATION_REQUIRED', status: 401 });
    }
    if (retryResponse.status === 401 && accessToken === retryToken) {
      accessToken = null;
      sessionEpoch += 1;
    }
    return retryResponse;
  }

  async function signOut(): Promise<void> {
    clearSession();
    return enqueueCookieMutation(async () => {
      return withCrossTabCookieMutationLock(async () => {
        const csrfToken = await bootstrapCsrf();
        await fetchResponse(fetcher, endpoint('/api/auth/logout', baseUrl), {
          method: 'POST',
          headers: csrfHeaders(csrfToken),
          ...withCredentials({ cache: 'no-store', redirect: 'error' }),
        }, operationTimeoutMs, async (response) => {
          if (!response.ok) throw await boundedError(response);
        });
      });
    });
  }

  function clearSession(): void {
    sessionEpoch += 1;
    cookieMutationEpoch += 1;
    accessToken = null;
    refreshPromise = undefined;
  }

  function isAuthenticated(): boolean {
    return accessToken !== null;
  }

  return {
    signIn,
    restoreSession,
    refreshSession,
    authenticatedFetch,
    signOut,
    clearSession,
    isAuthenticated,
  };
}

const defaultClient = createSessionClient();

export const signIn = defaultClient.signIn;
export const restoreSession = defaultClient.restoreSession;
export const refreshSession = defaultClient.refreshSession;
export const authenticatedFetch = defaultClient.authenticatedFetch;
export const signOut = defaultClient.signOut;
export const clearSession = defaultClient.clearSession;
export const isAuthenticated = defaultClient.isAuthenticated;
