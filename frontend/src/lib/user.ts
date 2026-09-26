import { apiRequest, boundedError, endpoint, invalidResponse, readJsonResponse, type ApiClientOptions } from './api';
import { projectSessionUser, type SessionClient, type SessionUser } from './session';

export type RegistrationInput = {
  username: string;
  mobile: string;
  email?: string;
  password: string;
};

/** Registers a Customer. Any 201 means the account exists; the response body is not needed. */
export async function registerUser(input: RegistrationInput, options: ApiClientOptions = {}): Promise<void> {
  await apiRequest(options.fetch ?? fetch, endpoint('/api/auth/register', options.baseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }, async (response) => {
    if (response.status !== 201) throw await boundedError(response);
  });
}

/** Loads the signed-in user's current profile with the session's Bearer token. */
export function loadUserProfile(session: Pick<SessionClient, 'authenticatedFetch'>): Promise<SessionUser> {
  return session.authenticatedFetch('/api/user/me', { method: 'GET' }, async (response) => {
    if (!response.ok) throw await boundedError(response);
    const user = projectSessionUser(await readJsonResponse(response));
    if (!user) throw invalidResponse(response.status);
    return user;
  });
}
