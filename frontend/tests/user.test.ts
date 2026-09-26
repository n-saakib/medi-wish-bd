import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSessionClient } from '../src/lib/session.ts';
import { loadUserProfile, registerUser, type RegistrationInput } from '../src/lib/user.ts';
import { apiRoutes, sessionBody, signedInUser, stalledRoute } from './fakeApi.ts';

const registration: RegistrationInput = {
  username: 'sana', mobile: '01700000000', email: 'sana@example.com', password: 'a-very-long-password',
};

afterEach(() => {
  vi.useRealTimers();
});

describe('registration', () => {
  it('posts the registration to the public endpoint', async () => {
    const api = apiRoutes({ '/api/auth/register': () => new Response(null, { status: 201 }) });

    await expect(registerUser(registration, { baseUrl: 'https://api.example.test', fetch: api.fetch })).resolves.toBeUndefined();
    const [request] = api.requests;
    expect(request.url).toBe('https://api.example.test/api/auth/register');
    expect(request.method).toBe('POST');
    expect(request.headers.get('Content-Type')).toBe('application/json');
    expect(await request.json()).toEqual(registration);
  });

  it.each([
    ['an empty body', null],
    ['a registered user', JSON.stringify({ username: 'sana', mobileVerificationDeferred: false })],
    ['a non-JSON body', 'created'],
  ])('accepts a 201 with %s', async (_, body) => {
    const api = apiRoutes({ '/api/auth/register': () => new Response(body, { status: 201 }) });

    await expect(registerUser(registration, { fetch: api.fetch })).resolves.toBeUndefined();
  });

  it('rejects a success status other than 201', async () => {
    const api = apiRoutes({ '/api/auth/register': () => Response.json({}) });

    await expect(registerUser(registration, { fetch: api.fetch })).rejects.toMatchObject({ code: 'REQUEST_FAILED', status: 200 });
  });

  it('keeps only the code and status of an API error', async () => {
    const api = apiRoutes({
      '/api/auth/register': () => Response.json({
        code: 'DUPLICATE_USER', message: 'server text', requestId: 'safe-1', secret: 'must-not-escape',
      }, { status: 409 }),
    });

    const failure = await registerUser(registration, { fetch: api.fetch }).catch((reason: unknown) => reason);
    expect(failure).toMatchObject({ name: 'ApiError', code: 'DUPLICATE_USER', status: 409, message: '' });
    expect(Object.keys(failure as object).sort()).toEqual(['code', 'name', 'status']);
  });

  it('replaces an overlong error code with the generic request failure', async () => {
    const api = apiRoutes({ '/api/auth/register': () => Response.json({ code: 'X'.repeat(65) }, { status: 400 }) });

    await expect(registerUser(registration, { fetch: api.fetch })).rejects.toMatchObject({ code: 'REQUEST_FAILED', status: 400 });
  });

  it('reports a failure to read the error body as a request failure', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new TypeError('private body-read detail'));
      },
    });
    const api = apiRoutes({ '/api/auth/register': () => new Response(body, { status: 409 }) });

    await expect(registerUser(registration, { fetch: api.fetch })).rejects.toMatchObject({ code: 'REQUEST_FAILED', status: 0, message: '' });
  });

  it.each([
    ['missing', undefined],
    ['understated', '1'],
  ] as const)('bounds an oversized error body with %s Content-Length', async (_, contentLength) => {
    let cancelled = false;
    let pulls = 0;
    const payload = new TextEncoder().encode(JSON.stringify({ code: 'x'.repeat(128), message: 'é'.repeat(9 * 1024) }));
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
    const api = apiRoutes({ '/api/auth/register': () => new Response(body, { status: 500, headers }) });

    await expect(registerUser(registration, { fetch: api.fetch })).rejects.toMatchObject({ code: 'REQUEST_FAILED', status: 500, message: '' });
    expect(cancelled).toBe(true);
  });

  it('reports a transport failure without its detail', async () => {
    const api = apiRoutes({ '/api/auth/register': () => { throw new Error('network internals must not escape'); } });

    await expect(registerUser(registration, { fetch: api.fetch })).rejects.toMatchObject({ code: 'REQUEST_FAILED', status: 0, message: '' });
  });

  it('abandons a registration the API does not answer within 10 seconds', async () => {
    vi.useFakeTimers();
    const api = apiRoutes({ '/api/auth/register': stalledRoute });
    const settled = vi.fn();

    const registering = registerUser(registration, { fetch: api.fetch });
    registering.then(settled, settled);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(registering).rejects.toMatchObject({ code: 'REQUEST_FAILED', status: 0 });
  });
});

describe('profile', () => {
  async function signedInClient(profileRoute: Parameters<typeof apiRoutes>[0][string]) {
    const api = apiRoutes({ '/api/auth/login': () => Response.json(sessionBody()), '/api/user/me': profileRoute });
    const client = createSessionClient({ baseUrl: 'https://api.example.test', fetch: api.fetch });
    await client.signIn('sana', 'password');
    return { api, client };
  }

  it('loads the documented profile fields from the session origin with the Bearer token', async () => {
    const { api, client } = await signedInClient(() => Response.json({ ...signedInUser, internal: 'hidden' }));

    await expect(loadUserProfile(client)).resolves.toEqual(signedInUser);
    const profileRequest = api.requests.at(-1);
    expect(profileRequest?.url).toBe('https://api.example.test/api/user/me');
    expect(profileRequest?.method).toBe('GET');
    expect(profileRequest?.headers.get('Authorization')).toBe('Bearer synthetic-access-token');
  });

  it.each([
    ['a malformed profile', () => Response.json({ unexpected: true })],
    ['malformed JSON', () => new Response('{', { headers: { 'Content-Type': 'application/json' } })],
  ])('rejects %s as an invalid response', async (_, profileRoute) => {
    const { client } = await signedInClient(profileRoute);

    await expect(loadUserProfile(client)).rejects.toMatchObject({ code: 'INVALID_RESPONSE', status: 200, message: '' });
  });

  it('keeps only the code and status of a profile error', async () => {
    const { client } = await signedInClient(() => Response.json({ code: 'ACCESS_DENIED', message: 'server text' }, { status: 403 }));

    await expect(loadUserProfile(client)).rejects.toMatchObject({ code: 'ACCESS_DENIED', status: 403, message: '' });
  });

  it('abandons a profile body that is still arriving after 10 seconds', async () => {
    const { client } = await signedInClient((request) => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{'));
        request.signal.addEventListener('abort', () => controller.error(request.signal.reason), { once: true });
      },
    }), { headers: { 'Content-Type': 'application/json' } }));
    vi.useFakeTimers();

    const loading = loadUserProfile(client);
    const rejected = expect(loading).rejects.toMatchObject({ code: 'REQUEST_FAILED', status: 0, message: '' });
    await vi.advanceTimersByTimeAsync(10_000);
    await rejected;
  });
});
