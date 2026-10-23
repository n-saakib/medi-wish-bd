import { apiRequest, boundedError, endpoint, type ApiClientOptions } from './api';

function post(path: string, body: object, status: number, options: ApiClientOptions): Promise<void> {
  return apiRequest(options.fetch ?? fetch, endpoint(path, options.baseUrl), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }, async (response) => {
    if (response.status !== status) throw await boundedError(response);
  });
}

/** Requests a code without revealing whether the address belongs to an eligible account. */
export function requestPasswordReset(email: string, options: ApiClientOptions = {}): Promise<void> {
  return post('/api/auth/password-reset/request', { email: email.trim() }, 202, options);
}

/** Changes the password without creating a session; the password is sent exactly as typed. */
export function confirmPasswordReset(input: { email: string; code: string; newPassword: string }, options: ApiClientOptions = {}): Promise<void> {
  return post('/api/auth/password-reset/confirm', { email: input.email.trim(), code: input.code, newPassword: input.newPassword }, 204, options);
}
