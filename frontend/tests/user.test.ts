import { describe, expect, it, vi } from 'vitest';
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
      fetch: async () => new Response(JSON.stringify({
        code: 'DUPLICATE_USER',
        message: 'The username or mobile number is already in use.',
        requestId: 'safe-1',
        secret: 'must-not-escape',
      }), { status: 409, headers: { 'Content-Type': 'application/json', 'X-Request-ID': 'header-1' } }),
    })).rejects.toMatchObject({
      code: 'DUPLICATE_USER', status: 409, message: 'The username or mobile number is already in use.', requestId: 'safe-1',
    } satisfies Partial<UserApiError>);
  });

  it('maps a registration response-body transport failure as a request failure', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new TypeError('private body-read detail'));
      },
    });

    await expect(registerUser({
      username: 'alice_1', mobile: '01700000000', password: 'a-very-long-password',
    }, {
      fetch: async () => new Response(body, {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    })).rejects.toMatchObject({ code: 'REQUEST_FAILED', status: 0, message: '' });
  });

  it.each([
    ['missing', undefined],
    ['understated', '1'],
  ] as const)('bounds oversized registration error bodies with %s Content-Length', async (_, contentLength) => {
    let cancelled = false;
    let pulls = 0;
    const payload = new TextEncoder().encode(JSON.stringify({
      code: 'x'.repeat(128),
      message: 'é'.repeat(9 * 1024),
    }));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(payload);
      },
      pull(controller) {
        pulls += 1;
        if (pulls === 2) controller.close();
      },
      cancel() {
        cancelled = true;
      },
    });
    const headers = new Headers({ 'Content-Type': 'application/json' });
    if (contentLength) headers.set('Content-Length', contentLength);

    await expect(registerUser({
      username: 'alice_1', mobile: '01700000000', password: 'a-very-long-password',
    }, {
      fetch: async () => new Response(body, { status: 500, headers }),
    })).rejects.toMatchObject({ code: 'REQUEST_FAILED', status: 500, message: '' });
    expect(cancelled).toBe(true);
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

  it('keeps profile requests on the SessionClient origin', async () => {
    let profileRequest: Request | undefined;
    const client = createSessionClient({
      baseUrl: 'https://api.example.test',
      fetch: async (input, init) => {
        const request = new Request(input, init);
        if (request.url.endsWith('/api/auth/login')) return Response.json(session);
        profileRequest = request;
        return Response.json({ ...profile, diagnostic: 'must-not-escape' });
      },
    });
    await client.signIn('alice_1', 'password');

    await expect(loadUserProfile({ session: client, baseUrl: 'https://wrong.example.test' })).resolves.toEqual(profile);
    expect(profileRequest?.url).toBe('https://api.example.test/api/user/me');
    expect(profileRequest?.headers.get('Authorization')).toBe('Bearer access-token');
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

  it('distinguishes malformed profile JSON from a response body that exceeds the deadline', async () => {
    const malformedClient = createSessionClient({
      fetch: async (input) => String(input).endsWith('/api/auth/login')
        ? Response.json(session)
        : new Response('{', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    });
    await malformedClient.signIn('alice_1', 'password');
    await expect(loadUserProfile({ session: malformedClient }))
      .rejects.toMatchObject({ code: 'INVALID_RESPONSE', status: 200, message: '' });

    vi.useFakeTimers();
    try {
      let profileRequestStartedResolve!: () => void;
      const profileRequestStarted = new Promise<void>((resolve) => { profileRequestStartedResolve = resolve; });
      const stalledClient = createSessionClient({
        operationTimeoutMs: 50,
        fetch: async (input, init) => {
          const request = new Request(input, init);
          if (request.url.endsWith('/api/auth/login')) return Response.json(session);
          const body = new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{'));
              request.signal.addEventListener('abort', () => {
                controller.error(new DOMException('aborted', 'AbortError'));
              }, { once: true });
            },
          });
          profileRequestStartedResolve();
          return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
        },
      });
      await stalledClient.signIn('alice_1', 'password');
      let outcome: { status: 'resolved' } | { status: 'rejected'; reason: unknown } | undefined;
      const pending = loadUserProfile({ session: stalledClient }).then(
        () => { outcome = { status: 'resolved' }; },
        (reason: unknown) => { outcome = { status: 'rejected', reason }; },
      );
      await profileRequestStarted;
      await vi.advanceTimersByTimeAsync(50);
      for (let attempt = 0; attempt < 10 && outcome === undefined; attempt += 1) await Promise.resolve();

      expect(outcome).toEqual({
        status: 'rejected',
        reason: expect.objectContaining({ code: 'REQUEST_FAILED', status: 0, message: '' }),
      });
      await pending;
    } finally {
      vi.useRealTimers();
    }
  });

  it('retains bounded API errors while parsing the authenticated response', async () => {
    const client = createSessionClient({
      fetch: async (input) => {
        if (String(input).endsWith('/api/auth/login')) return Response.json(session);
        return Response.json({
          code: 'PROFILE_FORBIDDEN',
          message: 'Profile access is not available.',
          requestId: 'profile-1',
          secret: 'must-not-escape',
        }, { status: 403 });
      },
    });
    await client.signIn('alice_1', 'password');

    await expect(loadUserProfile({ session: client })).rejects.toMatchObject({
      code: 'PROFILE_FORBIDDEN',
      status: 403,
      message: 'Profile access is not available.',
      requestId: 'profile-1',
    });
  });

  it('projects only the documented profile fields', async () => {
    const client = createSessionClient({
      fetch: async (input, init) => {
        const request = new Request(input, init);
        if (request.url.endsWith('/api/auth/login')) return Response.json({ ...session, internal: 'hidden' });
        return Response.json({ ...profile, internal: 'hidden' });
      },
    });
    await client.signIn('alice_1', 'password');

    await expect(loadUserProfile({ session: client })).resolves.toEqual(profile);
  });

  it('maps transport failures without exposing the underlying error', async () => {
    await expect(registerUser({ username: 'alice_1', mobile: '01700000000', password: 'a-very-long-password' }, {
      fetch: async () => { throw new Error('network internals must not escape'); },
    })).rejects.toMatchObject({ code: 'REQUEST_FAILED', status: 0, message: '' });
  });
});
