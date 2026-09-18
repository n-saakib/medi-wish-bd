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

export type UserProfile = {
  username: string;
  mobile: string;
  email: string | null;
  mobileVerified: boolean;
};

export type UserApiErrorDetails = {
  code: string;
  message?: string;
  status: number;
};

export class UserApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(details: UserApiErrorDetails) {
    super(details.message);
    this.name = 'UserApiError';
    this.code = details.code;
    this.status = details.status;
  }
}

export function userErrorMessage(reason: unknown, translate: (key: string) => string): string {
  if (reason instanceof UserApiError && reason.message) return reason.message;
  if (reason instanceof UserApiError && reason.code === 'INVALID_RESPONSE') return translate('invalidResponse');
  return translate('genericError');
}

type UserRequestOptions = {
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
};

const defaultBaseUrl = process.env.NEXT_PUBLIC_MEDI_WISH_API_URL ?? 'http://127.0.0.1:8080';

function endpoint(path: string, baseUrl: string): URL {
  return new URL(path, baseUrl);
}

async function boundedError(response: Response): Promise<UserApiError> {
  let code = 'REQUEST_FAILED';
  let message: string | undefined;
  try {
    const body: unknown = await response.json();
    if (body !== null && typeof body === 'object') {
      if ('code' in body && typeof body.code === 'string' && body.code.length <= 64) code = body.code;
      if ('message' in body && typeof body.message === 'string' && body.message.length <= 256) message = body.message;
    }
  } catch {
    // Keep a generic bounded message when the server response is not JSON.
  }
  return new UserApiError({ code, message, status: response.status });
}

function invalidResponse(status: number): UserApiError {
  return new UserApiError({
    code: 'INVALID_RESPONSE',
    status,
  });
}

function isRegisteredUser(body: unknown): body is RegisteredUser {
  return body !== null && typeof body === 'object'
    && 'username' in body && typeof body.username === 'string'
    && 'mobile' in body && typeof body.mobile === 'string'
    && 'email' in body && (typeof body.email === 'string' || body.email === null)
    && 'mobileVerificationDeferred' in body && body.mobileVerificationDeferred === true;
}

function isUserProfile(body: unknown): body is UserProfile {
  return body !== null && typeof body === 'object'
    && 'username' in body && typeof body.username === 'string'
    && 'mobile' in body && typeof body.mobile === 'string'
    && 'email' in body && (typeof body.email === 'string' || body.email === null)
    && 'mobileVerified' in body && typeof body.mobileVerified === 'boolean';
}

export async function registerUser(
  input: RegistrationInput,
  options: UserRequestOptions = {},
): Promise<RegisteredUser> {
  const fetcher = options.fetch ?? globalThis.fetch;
  const response = await fetcher(endpoint('/api/auth/register', options.baseUrl ?? defaultBaseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    cache: 'no-store',
    redirect: 'error',
  });
  if (!response.ok) throw await boundedError(response);
  const body: unknown = await response.json();
  if (!isRegisteredUser(body)) throw invalidResponse(response.status);
  return body;
}

function basicAuthorization(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `Basic ${globalThis.btoa(binary)}`;
}

export async function loadUserProfile(
  username: string,
  password: string,
  options: UserRequestOptions = {},
): Promise<UserProfile> {
  const fetcher = options.fetch ?? globalThis.fetch;
  const response = await fetcher(endpoint('/api/user/me', options.baseUrl ?? defaultBaseUrl), {
    headers: { Authorization: basicAuthorization(username, password) },
    cache: 'no-store',
    redirect: 'error',
  });
  if (!response.ok) throw await boundedError(response);
  const body: unknown = await response.json();
  if (!isUserProfile(body)) throw invalidResponse(response.status);
  return body;
}
