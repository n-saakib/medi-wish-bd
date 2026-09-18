import { describe, expect, it } from 'vitest';
import { UserApiError, loadUserProfile, registerUser, userErrorMessage } from '../src/lib/user.ts';

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

  it('uses Basic authentication only for the in-memory profile request', async () => {
    let request: Request | undefined;
    const profile = await loadUserProfile('alice_1', 'pässword-12345', {
      fetch: async (input, init) => {
        request = new Request(input, init);
        return Response.json({ username: 'alice_1', mobile: '01700000000', email: null, mobileVerified: false });
      },
    });

    expect(profile.username).toBe('alice_1');
    expect(request?.headers.get('Authorization')).toMatch(/^Basic /);
    expect(request?.url).toBe('http://127.0.0.1:8080/api/user/me');
  });

  it('leaves missing API error text to the translated UI fallback', async () => {
    let error: unknown;
    try {
      await registerUser({ username: 'alice_1', mobile: '01700000000', password: 'a-very-long-password' }, {
        fetch: async () => new Response(null, { status: 503 }),
      });
    } catch (reason) {
      error = reason;
    }

    expect(error).toBeInstanceOf(UserApiError);
    expect(error).toMatchObject({ code: 'REQUEST_FAILED', status: 503, message: '' });
    expect(userErrorMessage(error, (key) => ({ genericError: 'translated generic error', invalidResponse: 'translated invalid response' }[key] ?? key)))
      .toBe('translated generic error');
  });

  it('uses the translated fallback for an invalid response without changing its code/status', async () => {
    let error: unknown;
    try {
      await registerUser({ username: 'alice_1', mobile: '01700000000', password: 'a-very-long-password' }, {
        fetch: async () => Response.json({ unexpected: true }, { status: 200 }),
      });
    } catch (reason) {
      error = reason;
    }

    expect(error).toMatchObject({ code: 'INVALID_RESPONSE', status: 200, message: '' });
    expect(userErrorMessage(error, (key) => ({ genericError: 'translated generic error', invalidResponse: 'translated invalid response' }[key] ?? key)))
      .toBe('translated invalid response');
  });
});
