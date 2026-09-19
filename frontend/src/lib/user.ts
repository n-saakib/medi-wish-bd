import {
  authenticatedFetch as defaultAuthenticatedFetch,
  boundedError,
  createSessionClient,
  invalidResponse,
  requestFailure,
  UserApiError,
  type SessionClient,
  type SessionFetch,
  type SessionUser,
} from './session';

export type RegistrationInput = {
  username: string;
  mobile: string;
  email?: string;
  password: string;
};

export type RegisteredUser = {
  username: string;
  mobile: string;
  email: string | null;
  mobileVerificationDeferred: boolean;
};

export type UserProfile = SessionUser;
export { UserApiError } from './session';

export function userErrorMessage(reason: unknown, translate: (key: string) => string): string {
  if (reason instanceof UserApiError && reason.message) return reason.message;
  if (reason instanceof UserApiError && reason.code === 'INVALID_RESPONSE') return translate('invalidResponse');
  return translate('genericError');
}

type UserRequestOptions = {
  baseUrl?: string;
  fetch?: SessionFetch;
  session?: SessionClient;
};

const defaultBaseUrl = process.env.NEXT_PUBLIC_MEDI_WISH_API_URL ?? 'http://127.0.0.1:8080';

function endpoint(path: string, baseUrl: string): URL {
  return new URL(path, baseUrl);
}

function isRegisteredUser(body: unknown): body is RegisteredUser {
  return body !== null && typeof body === 'object'
    && 'username' in body && typeof body.username === 'string' && body.username.length > 0 && body.username.length <= 128
    && 'mobile' in body && typeof body.mobile === 'string' && body.mobile.length > 0 && body.mobile.length <= 32
    && 'email' in body && (body.email === null || (typeof body.email === 'string' && body.email.length <= 320))
    && 'mobileVerificationDeferred' in body && body.mobileVerificationDeferred === true;
}

export async function registerUser(
  input: RegistrationInput,
  options: UserRequestOptions = {},
): Promise<RegisteredUser> {
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  let response: Response;
  try {
    response = await fetcher(endpoint('/api/auth/register', options.baseUrl ?? defaultBaseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      cache: 'no-store',
      redirect: 'error',
    });
  } catch {
    throw requestFailure();
  }
  if (!response.ok) throw await boundedError(response);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw invalidResponse(response.status);
  }
  if (!isRegisteredUser(body)) throw invalidResponse(response.status);
  return body;
}

export async function loadUserProfile(options: UserRequestOptions = {}): Promise<UserProfile> {
  const session = options.session ?? (options.fetch || options.baseUrl
    ? createSessionClient({ baseUrl: options.baseUrl, fetch: options.fetch })
    : undefined);
  let response: Response;
  try {
    response = await (session?.authenticatedFetch ?? defaultAuthenticatedFetch)(endpoint('/api/user/me', options.baseUrl ?? defaultBaseUrl), {
      method: 'GET',
      cache: 'no-store',
      redirect: 'error',
    });
  } catch (reason) {
    throw reason instanceof UserApiError ? reason : requestFailure();
  }
  if (!response.ok) throw await boundedError(response);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw invalidResponse(response.status);
  }
  if (body === null || typeof body !== 'object'
    || !('username' in body) || typeof body.username !== 'string' || body.username.length === 0 || body.username.length > 128
    || !('mobile' in body) || typeof body.mobile !== 'string' || body.mobile.length === 0 || body.mobile.length > 32
    || !('email' in body) || (body.email !== null && (typeof body.email !== 'string' || body.email.length > 320))
    || !('mobileVerified' in body) || typeof body.mobileVerified !== 'boolean') {
    throw invalidResponse(response.status);
  }
  return body as UserProfile;
}
