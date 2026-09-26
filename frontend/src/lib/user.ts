import {
  authenticatedFetch as defaultAuthenticatedFetch,
  boundedError,
  createSessionClient,
  invalidResponse,
  requestFailure,
  readJsonResponse,
  projectUserIdentity,
  projectSessionUser,
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

function registeredUserProjection(body: unknown): RegisteredUser | undefined {
  if (body === null || typeof body !== 'object'
      || !('mobileVerificationDeferred' in body) || body.mobileVerificationDeferred !== true) {
    return undefined;
  }
  const identity = projectUserIdentity(body);
  if (!identity) return undefined;
  return {
    ...identity,
    mobileVerificationDeferred: true,
  };
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
  const body = await readJsonResponse(response);
  const user = registeredUserProjection(body);
  if (!user) throw invalidResponse(response.status);
  return user;
}

export async function loadUserProfile(options: UserRequestOptions = {}): Promise<UserProfile> {
  const session = options.session ?? (options.fetch || options.baseUrl
    ? createSessionClient({ baseUrl: options.baseUrl, fetch: options.fetch })
    : undefined);
  try {
    return await (session?.authenticatedFetch ?? defaultAuthenticatedFetch)('/api/user/me', {
      method: 'GET',
      cache: 'no-store',
      redirect: 'error',
    }, async (response) => {
      if (!response.ok) throw await boundedError(response);
      const body = await readJsonResponse(response);
      const user = projectSessionUser(body);
      if (!user) throw invalidResponse(response.status);
      return user;
    });
  } catch (reason) {
    throw reason instanceof UserApiError ? reason : requestFailure();
  }
}
