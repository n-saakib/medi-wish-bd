import { describe, expect, it } from 'vitest';
import { createSessionClient, UserApiError } from '../src/lib/session.ts';
import { loadUserProfile, registerUser, userErrorMessage } from '../src/lib/user.ts';

const profile = { username: 'alice_1', mobile: '01700000000', email: null, mobileVerified: false };
const session = { accessToken: 'access-token', tokenType: 'Bearer', expiresIn: 900, user: profile };

describe('user API boundary', () => {
  it('registers through the public endpoint without inventing OTP behavior', async () => {
    let request: Request | undefined;
    const user = await registerUser({
      username: 'alice_1', mobile: '01700000000', email: 'alice@example.com', password: 'a-very-long-password',
    }, {
      baseUrl: 'http://127.0.0.1:8080',
      fetch: async (input, init) => {
        request = new Request(input, init);
        return Response.json({ username: 'alice_1', mobile: '01700000000', email: 'alice@example.com', mobileVerificationDeferred: true }, { status: 201 });
      },
    });

    expect(user.mobileVerificationDeferred).toBe(true);
    expect(request?.url).toBe('http://127.0.0.1:8080/api/auth/register');
    expect(request?.method).toBe('POST');
    expect(await request?.json()).toEqual({ username: 'alice_1', mobile: '01700000000', email: 'alice@example.com', password: 'a-very-long-password' });
  });

  it('maps bounded API errors without exposing response internals', async () => {
    await expect(registerUser({ username: 'alice_1', mobile: '01700000000', password: 'a-very-long-password' }, {
      fetch: async () => Response.json({ code: 'DUPLICATE_USER', message: 'The username or mobile number is already in use.', requestId: 'safe-1', secret: 'must-not-escape' }, { status: 409 }),
    })).rejects.toMatchObject({
      code: 'DUPLICATE_USER', status: 409, message: 'The username or mobile number is already in use.',
    } satisfies Partial<UserApiError>);
  });

  it('loads a profile through the Bearer session seam and never constructs Basic credentials', async () => {
    let profileRequest: Request | undefined;
    const client = createSessionClient({
      fetch: async (input, init) => {
        const request = new Request(input, init);
        if (request.url.endsWith('/api/auth/login')) return Response.json(session);
        profileRequest = request;
        return Response.json(profile);
      },
    });
    await client.signIn('alice_1', 'pässword-12345');

    await expect(loadUserProfile({ session: client })).resolves.toEqual(profile);
    expect(profileRequest?.headers.get('Authorization')).toBe('Bearer access-token');
    expect(profileRequest?.headers.get('Authorization')).not.toMatch(/^Basic /);
  });

  it('rejects malformed profiles and keeps the translated fallback', async () => {
    const client = createSessionClient({
      fetch: async (input, init) => {
        const request = new Request(input, init);
        if (request.url.endsWith('/api/auth/login')) return Response.json(session);
        return Response.json({ unexpected: true });
      },
    });
    await client.signIn('alice_1', 'password');

    let error: unknown;
    try {
      await loadUserProfile({ session: client });
    } catch (reason) {
      error = reason;
    }

    expect(error).toMatchObject({ code: 'INVALID_RESPONSE', status: 200, message: '' });
    expect(userErrorMessage(error, (key) => ({ genericError: 'translated generic error', invalidResponse: 'translated invalid response' }[key] ?? key)))
      .toBe('translated invalid response');
  });

  it('maps transport failures without exposing the underlying error', async () => {
    await expect(registerUser({ username: 'alice_1', mobile: '01700000000', password: 'a-very-long-password' }, {
      fetch: async () => { throw new Error('network internals must not escape'); },
    })).rejects.toMatchObject({ code: 'REQUEST_FAILED', status: 0, message: '' });
  });
});
