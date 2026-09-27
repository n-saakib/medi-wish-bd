export type ApiFetch = (input: URL, init: RequestInit) => Promise<Response>;

export type ResponseReader<T> = (response: Response) => Promise<T>;

/** Where a client sends its requests; tests inject both. */
export type ApiClientOptions = {
  baseUrl?: string;
  fetch?: ApiFetch;
};

/** A bounded API failure: the API's error code, or a client code, and the HTTP status (0 when no response arrived). */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number) {
    super();
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

const apiBaseUrl = process.env.NEXT_PUBLIC_MEDI_WISH_API_URL ?? 'http://127.0.0.1:8080';
const operationTimeoutMs = 10_000;
const maxJsonResponseBytes = 16 * 1024;
const maxErrorCodeLength = 64;

export type ErrorMessageKey = 'authenticationFailed' | 'duplicateUser' | 'mfaRequired' | 'mfaCodeInvalid'
  | 'mfaEnrollmentStale' | 'tooManyAttempts' | 'invalidResponse' | 'genericError';

/** The `errors` message key for a failure. Codes the UI does not tell apart share the generic message. */
export function errorMessageKey(reason: unknown): ErrorMessageKey {
  switch (reason instanceof ApiError ? reason.code : undefined) {
    case 'AUTHENTICATION_FAILED':
      return 'authenticationFailed';
    case 'DUPLICATE_USER':
      return 'duplicateUser';
    case 'MFA_REQUIRED':
      return 'mfaRequired';
    case 'MFA_CODE_INVALID':
      return 'mfaCodeInvalid';
    case 'MFA_ENROLLMENT_STALE':
      return 'mfaEnrollmentStale';
    case 'TOO_MANY_ATTEMPTS':
      return 'tooManyAttempts';
    case 'INVALID_RESPONSE':
      return 'invalidResponse';
    default:
      return 'genericError';
  }
}

export function endpoint(path: string, baseUrl = apiBaseUrl): URL {
  return new URL(path, baseUrl);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function boundedText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

export function requestFailure(): ApiError {
  return new ApiError('REQUEST_FAILED', 0);
}

export function invalidResponse(status: number): ApiError {
  return new ApiError('INVALID_RESPONSE', status);
}

/** Reads at most 16 KiB of JSON, whatever `Content-Length` claims. */
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
    if (reason instanceof ApiError) throw reason;
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

/** Keeps only the error code and status of a failed response; the API's `message` text is never read. */
export async function boundedError(response: Response): Promise<ApiError> {
  let code = 'REQUEST_FAILED';
  try {
    const body = await readJsonResponse(response);
    if (isRecord(body) && boundedText(body.code, maxErrorCodeLength)) code = body.code;
  } catch (reason) {
    if (reason instanceof ApiError && reason.code !== 'INVALID_RESPONSE') throw reason;
  }
  return new ApiError(code, response.status);
}

/** Sends one uncached API request and reads its response, both within one operation timeout. */
export async function apiRequest<T>(
  fetcher: ApiFetch,
  url: URL,
  init: RequestInit,
  readResponse: ResponseReader<T>,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), operationTimeoutMs);
  try {
    let response: Response;
    try {
      response = await fetcher(url, { ...init, cache: 'no-store', redirect: 'error', signal: controller.signal });
    } catch {
      throw requestFailure();
    }
    return await readResponse(response);
  } finally {
    clearTimeout(timeout);
  }
}
