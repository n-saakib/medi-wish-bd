import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessionClient, type SessionClient } from '../src/lib/session.ts';
import {
  apiRoutes,
  deferred,
  enrollmentBody,
  flushTasks,
  installFakeLocks,
  restoredCustomer,
  sessionBody,
  signedInUser,
  stalledRoute,
  syntheticBackupCodes,
} from './fakeApi.ts';

const lockName = 'medi-wish:auth-cookie-mutation';
const authenticationRequired = { code: 'AUTHENTICATION_REQUIRED', status: 401 };
const requestFailed = { code: 'REQUEST_FAILED', status: 0, message: '' };
const unauthorized = () => Response.json({ code: 'AUTHENTICATION_REQUIRED' }, { status: 401 });
const noContent = () => new Response(null, { status: 204 });
const readJson = (response: Response) => response.json();

let locks: ReturnType<typeof installFakeLocks>;
beforeEach(() => {
  locks = installFakeLocks();
});
afterEach(() => {
  vi.useRealTimers();
  locks.restore();
});

/** A client signed in with `access-old`. */
async function signedInClient(routes: Parameters<typeof apiRoutes>[0] = {}) {
  const api = apiRoutes({ '/api/auth/login': () => Response.json(sessionBody('access-old')), ...routes });
  const client = createSessionClient({ fetch: api.fetch });
  await client.signIn('sana', 'password');
  return { api, client };
}

function loadProfile(client: SessionClient, path = '/api/user/me') {
  return client.authenticatedFetch(path, { method: 'GET' }, readJson);
}

/** The `Authorization` header of each profile request, in order. */
function profileAuthorizations(api: ReturnType<typeof apiRoutes>) {
  return api.requests
    .filter((request) => new URL(request.url).pathname === '/api/user/me')
    .map((request) => request.headers.get('Authorization'));
}

/** A JSON response whose body stays open until `release` settles. */
function blockedJsonResponse(value: unknown, release: Promise<void>): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(JSON.stringify(value)));
      void release.then(() => controller.close());
    },
  });
  return new Response(body, { headers: { 'Content-Type': 'application/json' } });
}

describe('sign-in', () => {
  it('posts the identifier payload with refresh-cookie credentials and keeps only the token and user', async () => {
    const api = apiRoutes({ '/api/auth/login': () => Response.json(sessionBody()) });
    const client = createSessionClient({ baseUrl: 'https://api.example.test', fetch: api.fetch });

    await expect(client.signIn('sana', 'password')).resolves.toEqual({ accessToken: 'synthetic-access-token', user: signedInUser, mfa: 'NOT_REQUIRED' });
    const [request] = api.requests;
    expect(request.url).toBe('https://api.example.test/api/auth/login');
    expect(request.method).toBe('POST');
    expect(request.credentials).toBe('include');
    expect(request.cache).toBe('no-store');
    expect(request.redirect).toBe('error');
    expect(await request.json()).toEqual({ identifier: 'sana', password: 'password' });
  });

  it('keeps only the code and status of a failed sign-in', async () => {
    const client = createSessionClient({
      fetch: apiRoutes({
        '/api/auth/login': () => Response.json({ code: 'AUTHENTICATION_FAILED', message: 'server text' }, { status: 401 }),
      }).fetch,
    });

    await expect(client.signIn('sana', 'wrong')).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED', status: 401, message: '' });
  });

  it('reads a session body of exactly 16 KiB and rejects a larger one', async () => {
    const json = JSON.stringify(sessionBody());
    const clientAnswering = (bytes: number) => createSessionClient({
      fetch: apiRoutes({
        '/api/auth/login': () => new Response(json.padEnd(bytes), { headers: { 'Content-Type': 'application/json' } }),
      }).fetch,
    });

    await expect(clientAnswering(16 * 1024).signIn('sana', 'password')).resolves.toMatchObject({ user: signedInUser });
    await expect(clientAnswering(16 * 1024 + 1).signIn('sana', 'password'))
      .rejects.toMatchObject({ code: 'INVALID_RESPONSE', status: 200 });
  });

  it.each([
    ['an empty token', { ...sessionBody(), accessToken: '' }],
    ['an oversized token', { ...sessionBody(), accessToken: 'x'.repeat(4097) }],
    ['a malformed user', { ...sessionBody(), user: { ...signedInUser, mobileVerified: 'no' } }],
    ['no user', { accessToken: 'synthetic-access-token' }],
  ])('rejects a session response with %s without exposing it', async (_, body) => {
    const client = createSessionClient({ fetch: apiRoutes({ '/api/auth/login': () => Response.json(body) }).fetch });

    await expect(client.signIn('sana', 'password')).rejects.toMatchObject({ code: 'INVALID_RESPONSE', status: 200, message: '' });
  });

  it('serializes concurrent sign-ins so their cookies apply in request order', async () => {
    const firstReleased = deferred();
    const identifiers: string[] = [];
    const client = createSessionClient({
      fetch: apiRoutes({
        '/api/auth/login': async (request) => {
          const { identifier } = await request.json() as { identifier: string };
          identifiers.push(identifier);
          if (identifier === 'first') await firstReleased.promise;
          return Response.json(sessionBody(`${identifier}-access`));
        },
      }).fetch,
    });

    const first = client.signIn('first', 'password');
    const second = client.signIn('second', 'password');
    await flushTasks();
    expect(identifiers).toEqual(['first']);

    firstReleased.resolve();
    await expect(first).resolves.toMatchObject({ accessToken: 'first-access' });
    await expect(second).resolves.toMatchObject({ accessToken: 'second-access' });
    expect(identifiers).toEqual(['first', 'second']);
  });
});

describe('restore', () => {
  it('bootstraps the CSRF token and restores the user through refresh', async () => {
    const api = apiRoutes({
      '/api/auth/csrf': () => Response.json({ csrfToken: 'csrf+value' }),
      '/api/auth/refresh': () => Response.json(sessionBody()),
    });

    await expect(createSessionClient({ fetch: api.fetch }).restoreSession()).resolves.toEqual({ user: signedInUser, mfa: 'NOT_REQUIRED' });
    const [csrf, refresh] = api.requests;
    expect(api.paths()).toEqual(['/api/auth/csrf', '/api/auth/refresh']);
    expect(csrf.credentials).toBe('include');
    expect(refresh.credentials).toBe('include');
    expect(refresh.headers.get('X-XSRF-TOKEN')).toBe('csrf+value');
    expect(refresh.headers.get('Authorization')).toBeNull();
  });

  it('restores nothing when the browser has no refresh cookie', async () => {
    const client = createSessionClient({ fetch: apiRoutes({ '/api/auth/refresh': noContent }).fetch });

    await expect(client.restoreSession()).resolves.toBeNull();
  });

  it('rejects an expired refresh cookie with a 401', async () => {
    const client = createSessionClient({ fetch: apiRoutes({ '/api/auth/refresh': unauthorized }).fetch });

    await expect(client.restoreSession()).rejects.toMatchObject(authenticationRequired);
  });

  it.each([
    ['an error status', { '/api/auth/refresh': () => Response.json({ code: 'INTERNAL_ERROR' }, { status: 500 }) }, { code: 'INTERNAL_ERROR', status: 500 }],
    ['a failed CSRF bootstrap', { '/api/auth/csrf': () => Response.json({ code: 'ACCESS_DENIED' }, { status: 403 }) }, { code: 'ACCESS_DENIED', status: 403 }],
    ['a missing CSRF token', { '/api/auth/csrf': () => Response.json({}) }, { code: 'INVALID_RESPONSE', status: 200 }],
    ['a malformed session',{ '/api/auth/refresh': () => Response.json({ accessToken: 'token' }) }, { code: 'INVALID_RESPONSE', status: 200 }],
    ['a transport failure', { '/api/auth/refresh': () => { throw new TypeError('offline'); } }, requestFailed],
  ])('rethrows a restore that fails with %s', async (_, routes, failure) => {
    const client = createSessionClient({ fetch: apiRoutes(routes).fetch });

    await expect(client.restoreSession()).rejects.toMatchObject(failure);
  });

  it('shares one refresh between concurrent restores', async () => {
    const refreshReleased = deferred();
    const api = apiRoutes({
      '/api/auth/refresh': async () => {
        await refreshReleased.promise;
        return Response.json(sessionBody());
      },
    });
    const client = createSessionClient({ fetch: api.fetch });

    const restores = Promise.all([client.restoreSession(), client.restoreSession()]);
    await flushTasks();
    refreshReleased.resolve();
    await expect(restores).resolves.toEqual([restoredCustomer, restoredCustomer]);
    expect(api.paths()).toEqual(['/api/auth/csrf', '/api/auth/refresh']);
  });
});

describe('cookie-mutation lock', () => {
  it('holds the shared lock for every sign-in, refresh and logout request', async () => {
    const api = apiRoutes({
      '/api/auth/login': () => Response.json(sessionBody()),
      '/api/auth/refresh': () => Response.json(sessionBody()),
      '/api/auth/logout': noContent,
    });
    const heldDuringRequest: boolean[] = [];
    const client = createSessionClient({
      fetch: (input, init) => {
        heldDuringRequest.push(locks.held());
        return api.fetch(input, init);
      },
    });

    await client.signIn('sana', 'password');
    await client.restoreSession();
    await client.signOut();
    expect(api.paths()).toEqual([
      '/api/auth/login', '/api/auth/csrf', '/api/auth/refresh', '/api/auth/csrf', '/api/auth/logout',
    ]);
    expect(heldDuringRequest).toEqual(Array(5).fill(true));
    expect(locks.names).toEqual(Array(3).fill(lockName));
  });

  it.each([
    ['sign-in', (client: SessionClient) => client.signIn('sana', 'password'), ['/api/auth/login']],
    ['refresh', (client: SessionClient) => client.restoreSession(), ['/api/auth/csrf', '/api/auth/refresh']],
  ])('makes another client wait until a %s response body is read', async (_, start, pathsBeforeRelease) => {
    const bodyReleased = deferred();
    let blocked = false;
    const answer = () => {
      if (blocked) return Response.json(sessionBody());
      blocked = true;
      return blockedJsonResponse(sessionBody(), bodyReleased.promise);
    };
    const api = apiRoutes({ '/api/auth/login': answer, '/api/auth/refresh': answer });

    const first = start(createSessionClient({ fetch: api.fetch }));
    const restore = createSessionClient({ fetch: api.fetch }).restoreSession();
    await flushTasks();
    expect(api.paths()).toEqual(pathsBeforeRelease);

    bodyReleased.resolve();
    await first;
    await expect(restore).resolves.toEqual(restoredCustomer);
    expect(api.paths()).toEqual([...pathsBeforeRelease, '/api/auth/csrf', '/api/auth/refresh']);
  });

  it('makes another client wait until a logout is answered', async () => {
    const logoutReleased = deferred();
    const api = apiRoutes({
      '/api/auth/logout': async () => {
        await logoutReleased.promise;
        return noContent();
      },
      '/api/auth/refresh': noContent,
    });

    const signOut = createSessionClient({ fetch: api.fetch }).signOut();
    const restore = createSessionClient({ fetch: api.fetch }).restoreSession();
    await flushTasks();
    expect(api.paths()).toEqual(['/api/auth/csrf', '/api/auth/logout']);

    logoutReleased.resolve();
    await expect(Promise.all([signOut, restore])).resolves.toEqual([undefined, null]);
    expect(api.paths()).toEqual(['/api/auth/csrf', '/api/auth/logout', '/api/auth/csrf', '/api/auth/refresh']);
  });
});

describe('without Web Locks', () => {
  // An insecure context, such as plain HTTP at a LAN address, has no `navigator.locks`.
  beforeEach(() => {
    locks.restore();
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
  });

  it('serializes a sign-in and a restore within the tab', async () => {
    const loginReleased = deferred();
    const api = apiRoutes({
      '/api/auth/login': async () => {
        await loginReleased.promise;
        return Response.json(sessionBody());
      },
      '/api/auth/refresh': () => Response.json(sessionBody()),
    });

    const signIn = createSessionClient({ fetch: api.fetch }).signIn('sana', 'password');
    const restore = createSessionClient({ fetch: api.fetch }).restoreSession();
    await flushTasks();
    expect(api.paths()).toEqual(['/api/auth/login']);

    loginReleased.resolve();
    await signIn;
    await expect(restore).resolves.toEqual(restoredCustomer);
    expect(api.paths()).toEqual(['/api/auth/login', '/api/auth/csrf', '/api/auth/refresh']);
  });

  it('makes a sign-out wait for a refresh in flight', async () => {
    const refreshReleased = deferred();
    const api = apiRoutes({
      '/api/auth/refresh': async () => {
        await refreshReleased.promise;
        return Response.json(sessionBody());
      },
      '/api/auth/logout': noContent,
    });

    const restore = createSessionClient({ fetch: api.fetch }).restoreSession();
    const signOut = createSessionClient({ fetch: api.fetch }).signOut();
    await flushTasks();
    expect(api.paths()).toEqual(['/api/auth/csrf', '/api/auth/refresh']);

    refreshReleased.resolve();
    await expect(Promise.all([restore, signOut])).resolves.toEqual([restoredCustomer, undefined]);
    expect(api.paths()).toEqual(['/api/auth/csrf', '/api/auth/refresh', '/api/auth/csrf', '/api/auth/logout']);
  });

  it('runs the next mutation after a failed one', async () => {
    const api = apiRoutes({ '/api/auth/login': unauthorized, '/api/auth/refresh': noContent });

    await expect(createSessionClient({ fetch: api.fetch }).signIn('sana', 'wrong')).rejects.toMatchObject(authenticationRequired);
    await expect(createSessionClient({ fetch: api.fetch }).restoreSession()).resolves.toBeNull();
  });
});

describe('authenticated requests', () => {
  it('sends the Bearer token to the API origin and returns what the reader returns', async () => {
    const { api, client } = await signedInClient({ '/api/user/me': () => Response.json(signedInUser) });

    await expect(loadProfile(client)).resolves.toEqual(signedInUser);
    const profileRequest = api.requests.at(-1);
    expect(profileRequest?.url).toBe('http://127.0.0.1:8080/api/user/me');
    expect(profileRequest?.headers.get('Authorization')).toBe('Bearer access-old');
    expect(profileRequest?.cache).toBe('no-store');
  });

  it.each(['https://attacker.example/api/user/me', '//attacker.example/api/user/me'])(
    'rejects the off-origin path %s before fetching',
    async (path) => {
      const { api, client } = await signedInClient();

      await expect(loadProfile(client, path)).rejects.toMatchObject(requestFailed);
      expect(api.paths()).toEqual(['/api/auth/login']);
    },
  );

  it('refreshes first when no access token is in memory', async () => {
    const api = apiRoutes({
      '/api/auth/refresh': () => Response.json(sessionBody('access-restored')),
      '/api/user/me': () => Response.json(signedInUser),
    });

    await expect(loadProfile(createSessionClient({ fetch: api.fetch }))).resolves.toEqual(signedInUser);
    expect(api.paths()).toEqual(['/api/auth/csrf', '/api/auth/refresh', '/api/user/me']);
    expect(profileAuthorizations(api)).toEqual(['Bearer access-restored']);
  });

  it('fails without sending the request when there is no session to refresh', async () => {
    const api = apiRoutes({ '/api/auth/refresh': noContent });

    await expect(loadProfile(createSessionClient({ fetch: api.fetch }))).rejects.toMatchObject(authenticationRequired);
    expect(api.paths()).toEqual(['/api/auth/csrf', '/api/auth/refresh']);
  });

  it('does not refresh again when a request is unauthorized right after the first refresh', async () => {
    const api = apiRoutes({
      '/api/auth/refresh': () => Response.json(sessionBody('access-restored')),
      '/api/user/me': unauthorized,
    });

    await expect(loadProfile(createSessionClient({ fetch: api.fetch }))).rejects.toMatchObject(authenticationRequired);
    expect(api.paths()).toEqual(['/api/auth/csrf', '/api/auth/refresh', '/api/user/me']);
  });

  it('retries an expired request once with the refreshed token', async () => {
    const { api, client } = await signedInClient({
      '/api/auth/refresh': () => Response.json(sessionBody('access-new')),
      '/api/user/me': (request) => request.headers.get('Authorization') === 'Bearer access-new'
        ? Response.json(signedInUser)
        : unauthorized(),
    });

    await expect(loadProfile(client)).resolves.toEqual(signedInUser);
    expect(profileAuthorizations(api)).toEqual(['Bearer access-old', 'Bearer access-new']);
  });

  it('ends the session without a retry when the refresh cookie is gone', async () => {
    const { api, client } = await signedInClient({ '/api/auth/refresh': noContent, '/api/user/me': unauthorized });

    await expect(loadProfile(client)).rejects.toMatchObject(authenticationRequired);
    expect(profileAuthorizations(api)).toEqual(['Bearer access-old']);
  });

  it('ends the session when the retried request is still unauthorized, until the next sign-in', async () => {
    let logins = 0;
    const { api, client } = await signedInClient({
      '/api/auth/login': () => Response.json(sessionBody((logins += 1) === 1 ? 'access-old' : 'access-later')),
      '/api/auth/refresh': () => Response.json(sessionBody('access-rejected')),
      '/api/user/me': (request) => request.headers.get('Authorization') === 'Bearer access-later'
        ? Response.json(signedInUser)
        : unauthorized(),
    });
    const readResponse = vi.fn(readJson);

    await expect(client.authenticatedFetch('/api/user/me', { method: 'GET' }, readResponse))
      .rejects.toMatchObject(authenticationRequired);
    expect(readResponse).not.toHaveBeenCalled();
    await client.signIn('sana', 'password');
    await expect(loadProfile(client)).resolves.toEqual(signedInUser);
    expect(profileAuthorizations(api)).toEqual(['Bearer access-old', 'Bearer access-rejected', 'Bearer access-later']);
    expect(api.paths().filter((path) => path === '/api/auth/refresh')).toHaveLength(1);
  });

  it('shares one refresh between concurrent expired requests and retries each once', async () => {
    const bothExpired = deferred();
    const expiredAnswered = deferred();
    let expired = 0;
    const { api, client } = await signedInClient({
      '/api/auth/refresh': () => Response.json(sessionBody('access-new')),
      '/api/user/me': async (request) => {
        if (request.headers.get('Authorization') === 'Bearer access-new') {
          return Response.json({ call: new URL(request.url).searchParams.get('call') });
        }
        if ((expired += 1) === 2) bothExpired.resolve();
        await expiredAnswered.promise;
        return unauthorized();
      },
    });

    const requests = Promise.all([loadProfile(client, '/api/user/me?call=first'), loadProfile(client, '/api/user/me?call=second')]);
    await bothExpired.promise;
    expiredAnswered.resolve();
    await expect(requests).resolves.toEqual([{ call: 'first' }, { call: 'second' }]);
    expect(profileAuthorizations(api)).toEqual(['Bearer access-old', 'Bearer access-old', 'Bearer access-new', 'Bearer access-new']);
    expect(api.paths().filter((path) => path === '/api/auth/refresh')).toHaveLength(1);
  });

  it('keeps a newer sign-in that finishes after an older request ends the session', async () => {
    const retryStarted = deferred();
    const retryAnswered = deferred();
    const laterLoginStarted = deferred();
    const laterLoginAnswered = deferred();
    let logins = 0;
    const { client } = await signedInClient({
      '/api/auth/login': async () => {
        if ((logins += 1) === 1) return Response.json(sessionBody('access-old'));
        laterLoginStarted.resolve();
        await laterLoginAnswered.promise;
        return Response.json(sessionBody('access-later'));
      },
      '/api/auth/refresh': () => Response.json(sessionBody('access-retried')),
      '/api/user/me': async (request) => {
        const authorization = request.headers.get('Authorization');
        if (authorization === 'Bearer access-later') return Response.json(signedInUser);
        if (authorization === 'Bearer access-retried') {
          retryStarted.resolve();
          await retryAnswered.promise;
        }
        return unauthorized();
      },
    });

    const olderRequest = loadProfile(client);
    await retryStarted.promise;
    const laterSignIn = client.signIn('sana', 'password');
    await laterLoginStarted.promise;
    retryAnswered.resolve();
    await expect(olderRequest).rejects.toMatchObject(authenticationRequired);

    laterLoginAnswered.resolve();
    await expect(laterSignIn).resolves.toMatchObject({ accessToken: 'access-later' });
    await expect(loadProfile(client)).resolves.toEqual(signedInUser);
  });

  it('rejects another request result once a retried 401 ends the session', async () => {
    const secondRetryStarted = deferred();
    const secondRetryAnswered = deferred();
    let retries = 0;
    const { client } = await signedInClient({
      '/api/auth/refresh': () => Response.json(sessionBody('access-retried')),
      '/api/user/me': async (request) => {
        if (request.headers.get('Authorization') === 'Bearer access-old') return unauthorized();
        if ((retries += 1) === 1) {
          await secondRetryStarted.promise;
          return unauthorized();
        }
        secondRetryStarted.resolve();
        await secondRetryAnswered.promise;
        return Response.json(signedInUser);
      },
    });

    const rejectedRequest = loadProfile(client, '/api/user/me?call=rejected');
    const staleRequest = loadProfile(client, '/api/user/me?call=stale');
    await expect(rejectedRequest).rejects.toMatchObject(authenticationRequired);
    secondRetryAnswered.resolve();
    await expect(staleRequest).rejects.toMatchObject(authenticationRequired);
  });

  it('rejects a response still being read when a separate refresh fails', async () => {
    const readerStarted = deferred();
    const readerReleased = deferred();
    const { api, client } = await signedInClient({
      '/api/auth/refresh': unauthorized,
      '/api/user/me': () => Response.json(signedInUser),
    });

    const profileRequest = client.authenticatedFetch('/api/user/me', { method: 'GET' }, async (response) => {
      readerStarted.resolve();
      await readerReleased.promise;
      return response.json();
    });
    await readerStarted.promise;
    await expect(client.restoreSession()).rejects.toMatchObject(authenticationRequired);
    readerReleased.resolve();
    await expect(profileRequest).rejects.toMatchObject(authenticationRequired);
    expect(profileAuthorizations(api)).toEqual(['Bearer access-old']);
  });
});

describe('sign-out', () => {
  it('revokes the refresh cookie with the CSRF token and forgets the access token', async () => {
    const { api, client } = await signedInClient({ '/api/auth/logout': noContent, '/api/auth/refresh': noContent });

    await expect(client.signOut()).resolves.toBeUndefined();
    const logout = api.requests.at(-1);
    expect(logout?.method).toBe('POST');
    expect(logout?.credentials).toBe('include');
    expect(logout?.headers.get('X-XSRF-TOKEN')).toBe('csrf');

    await expect(loadProfile(client)).rejects.toMatchObject(authenticationRequired);
    expect(api.paths()).toEqual([
      '/api/auth/login', '/api/auth/csrf', '/api/auth/logout', '/api/auth/csrf', '/api/auth/refresh',
    ]);
  });

  it.each([
    ['an error status', () => Response.json({ code: 'INTERNAL_ERROR' }, { status: 500 }), { code: 'INTERNAL_ERROR', status: 500 }],
    ['a transport failure', () => { throw new TypeError('offline'); }, requestFailed],
  ])('rejects a logout that fails with %s but still forgets the access token', async (_, logout, failure) => {
    const { api, client } = await signedInClient({ '/api/auth/logout': logout, '/api/auth/refresh': noContent });

    await expect(client.signOut()).rejects.toMatchObject(failure);
    await expect(loadProfile(client)).rejects.toMatchObject(authenticationRequired);
    expect(profileAuthorizations(api)).toEqual([]);
  });

  it('discards a refresh that finishes after sign-out, never retries with it and refreshes afresh later', async () => {
    const refreshStarted = deferred();
    const refreshAnswered = deferred();
    let refreshes = 0;
    const { api, client } = await signedInClient({
      '/api/auth/refresh': async () => {
        if ((refreshes += 1) > 1) return noContent();
        refreshStarted.resolve();
        await refreshAnswered.promise;
        return Response.json(sessionBody('access-late'));
      },
      '/api/auth/logout': noContent,
      '/api/user/me': unauthorized,
    });

    const request = loadProfile(client);
    await refreshStarted.promise;
    const signOut = client.signOut();
    const laterRestore = client.restoreSession();
    refreshAnswered.resolve();
    await expect(request).rejects.toMatchObject(authenticationRequired);
    await expect(signOut).resolves.toBeUndefined();
    await expect(laterRestore).resolves.toBeNull();
    await expect(loadProfile(client)).rejects.toMatchObject(authenticationRequired);
    expect(profileAuthorizations(api)).toEqual(['Bearer access-old']);
  });

  it('rejects a sign-in still in flight when sign-out starts', async () => {
    const loginStarted = deferred();
    const loginAnswered = deferred();
    const api = apiRoutes({
      '/api/auth/login': async () => {
        loginStarted.resolve();
        await loginAnswered.promise;
        return Response.json(sessionBody('access-stale'));
      },
      '/api/auth/logout': noContent,
      '/api/auth/refresh': noContent,
    });
    const client = createSessionClient({ fetch: api.fetch });

    const signIn = client.signIn('sana', 'password');
    await loginStarted.promise;
    const signOut = client.signOut();
    loginAnswered.resolve();
    await expect(signIn).rejects.toMatchObject(authenticationRequired);
    await signOut;
    await expect(loadProfile(client)).rejects.toMatchObject(authenticationRequired);
    expect(profileAuthorizations(api)).toEqual([]);
  });

  it('does not start a sign-in queued before sign-out', async () => {
    const refreshStarted = deferred();
    const refreshAnswered = deferred();
    const api = apiRoutes({
      '/api/auth/refresh': async () => {
        refreshStarted.resolve();
        await refreshAnswered.promise;
        return Response.json(sessionBody('access-stale'));
      },
      '/api/auth/login': () => Response.json(sessionBody('access-stale')),
      '/api/auth/logout': noContent,
    });
    const client = createSessionClient({ fetch: api.fetch });

    const restore = client.restoreSession();
    await refreshStarted.promise;
    const signIn = client.signIn('sana', 'password');
    const signOut = client.signOut();
    refreshAnswered.resolve();
    await expect(restore).rejects.toMatchObject(authenticationRequired);
    await expect(signIn).rejects.toMatchObject(authenticationRequired);
    await signOut;
    expect(api.paths()).not.toContain('/api/auth/login');
  });
});

it.each([
  ['sign-in', '/api/auth/login', (client: SessionClient) => client.signIn('sana', 'password')],
  ['refresh', '/api/auth/refresh', (client: SessionClient) => client.restoreSession()],
  ['logout', '/api/auth/logout', (client: SessionClient) => client.signOut()],
])('abandons a %s request the API does not answer within 10 seconds', async (_, path, start) => {
  vi.useFakeTimers();
  const client = createSessionClient({ fetch: apiRoutes({ [path]: stalledRoute }).fetch });
  const settled = vi.fn();

  const operation = start(client);
  operation.then(settled, settled);
  await vi.advanceTimersByTimeAsync(9_999);
  expect(settled).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await expect(operation).rejects.toMatchObject(requestFailed);
});

it('keeps the access token out of browser storage', async () => {
  let storageCalls = 0;
  const storage = {
    getItem: () => { storageCalls += 1; return null; },
    setItem: () => { storageCalls += 1; },
    removeItem: () => { storageCalls += 1; },
  };
  const localStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const sessionStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  try {
    Object.assign(globalThis, { localStorage: storage, sessionStorage: storage });
    const { client } = await signedInClient({ '/api/auth/logout': noContent });

    await client.signOut();
    expect(storageCalls).toBe(0);
  } finally {
    if (localStorageDescriptor) Object.defineProperty(globalThis, 'localStorage', localStorageDescriptor);
    else Reflect.deleteProperty(globalThis, 'localStorage');
    if (sessionStorageDescriptor) Object.defineProperty(globalThis, 'sessionStorage', sessionStorageDescriptor);
    else Reflect.deleteProperty(globalThis, 'sessionStorage');
  }
});

describe('staff MFA status', () => {
  it.each(['NOT_REQUIRED', 'ENROLLMENT_REQUIRED', 'VERIFICATION_REQUIRED', 'VERIFIED'] as const)(
    'keeps the %s status from sign-in and refresh',
    async (mfa) => {
      const api = apiRoutes({
        '/api/auth/login': () => Response.json(sessionBody('access-old', mfa)),
        '/api/auth/refresh': () => Response.json(sessionBody('access-new', mfa)),
      });

      await expect(createSessionClient({ fetch: api.fetch }).signIn('sana', 'password')).resolves.toMatchObject({ mfa });
      await expect(createSessionClient({ fetch: api.fetch }).restoreSession()).resolves.toEqual({ user: signedInUser, mfa });
    },
  );

  it.each([
    ['an unknown status', { ...sessionBody(), mfa: 'SKIPPED' }],
    ['a lower-case status', { ...sessionBody(), mfa: 'verified' }],
    ['no status', { accessToken: 'synthetic-access-token', user: signedInUser }],
  ])('rejects a session response with %s', async (_, body) => {
    const api = apiRoutes({ '/api/auth/login': () => Response.json(body), '/api/auth/refresh': () => Response.json(body) });

    await expect(createSessionClient({ fetch: api.fetch }).signIn('sana', 'password'))
      .rejects.toMatchObject({ code: 'INVALID_RESPONSE', status: 200 });
    await expect(createSessionClient({ fetch: api.fetch }).restoreSession())
      .rejects.toMatchObject({ code: 'INVALID_RESPONSE', status: 200 });
  });
});

describe('MFA enrollment start', () => {
  const secret = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

  it('posts an empty JSON body with the Bearer token and keeps only the enrollment fields', async () => {
    const { api, client } = await signedInClient({
      '/api/auth/mfa/enrollment': () => Response.json({ ...enrollmentBody(secret), extra: 'ignored' }, { status: 201 }),
    });

    await expect(client.startMfaEnrollment()).resolves.toEqual(enrollmentBody(secret));
    const request = api.requests.at(-1);
    expect(request?.method).toBe('POST');
    expect(request?.headers.get('Authorization')).toBe('Bearer access-old');
    expect(request?.headers.get('Content-Type')).toBe('application/json');
    expect(request?.headers.get('X-XSRF-TOKEN')).toBeNull();
    expect(await request?.json()).toEqual({});
  });

  it.each([
    ['a malformed enrollment id', { ...enrollmentBody(secret), enrollmentId: 'not-a-uuid' }],
    ['a short secret', { ...enrollmentBody(secret), secret: secret.slice(1) }],
    ['a lower-case secret', { ...enrollmentBody(secret), secret: secret.toLowerCase() }],
    ['a secret outside Base32', { ...enrollmentBody(secret), secret: `${secret.slice(0, 31)}1` }],
    ['an https URI', { ...enrollmentBody(secret), otpauthUri: `https://qr.example/?secret=${secret}` }],
    ['an oversized URI', { ...enrollmentBody(secret), otpauthUri: `otpauth://totp/${'x'.repeat(512)}` }],
    ['a zero lifetime', { ...enrollmentBody(secret), expiresIn: 0 }],
    ['a fractional lifetime', { ...enrollmentBody(secret), expiresIn: 1.5 }],
  ])('rejects an enrollment with %s without exposing the secret', async (_, body) => {
    const { client } = await signedInClient({ '/api/auth/mfa/enrollment': () => Response.json(body, { status: 201 }) });

    const failure: unknown = await client.startMfaEnrollment().catch((reason: unknown) => reason);
    expect(failure).toMatchObject({ code: 'INVALID_RESPONSE', status: 201, message: '' });
    expect(`${JSON.stringify(failure)} ${String(failure)}`).not.toContain(secret);
  });

  it('keeps only the code and status of a refused start', async () => {
    const { client } = await signedInClient({
      '/api/auth/mfa/enrollment': () => Response.json({ code: 'ACCESS_DENIED', message: 'server text' }, { status: 403 }),
    });

    await expect(client.startMfaEnrollment()).rejects.toMatchObject({ code: 'ACCESS_DENIED', status: 403, message: '' });
  });
});

describe('MFA verification', () => {
  const enrollmentId = '5f0c9e1a-2b3c-4d5e-8f90-a1b2c3d4e5f6';
  const enrolledBody = () => ({ ...sessionBody('access-verified', 'VERIFIED'), backupCodes: syntheticBackupCodes });

  it('verifies enrollment in the cookie lock with the restricted token, then uses the verified token', async () => {
    let lockHeld = false;
    const { api, client } = await signedInClient({
      '/api/auth/mfa/enrollment/verify': () => {
        lockHeld = locks.held();
        return Response.json(enrolledBody());
      },
      '/api/user/me': () => Response.json(signedInUser),
    });

    await expect(client.verifyMfaEnrollment(enrollmentId, '287082')).resolves.toEqual({
      accessToken: 'access-verified',
      user: signedInUser,
      mfa: 'VERIFIED',
      backupCodes: syntheticBackupCodes,
    });
    const verify = api.requests.at(-1);
    expect(lockHeld).toBe(true);
    expect(verify?.credentials).toBe('include');
    expect(verify?.headers.get('Authorization')).toBe('Bearer access-old');
    expect(verify?.headers.get('X-XSRF-TOKEN')).toBeNull();
    expect(await verify?.json()).toEqual({ enrollmentId, code: '287082' });

    await loadProfile(client);
    expect(profileAuthorizations(api)).toEqual(['Bearer access-verified']);
  });

  it('verifies a challenge code, stores the new token and makes older requests stale', async () => {
    const heldProfile = deferred<Response>();
    const { api, client } = await signedInClient({
      '/api/auth/mfa/verify': () => Response.json(sessionBody('access-verified', 'VERIFIED')),
      '/api/user/me': (request) => request.headers.get('Authorization') === 'Bearer access-old'
        ? heldProfile.promise
        : Response.json(signedInUser),
    });
    const olderRequest = loadProfile(client);
    await flushTasks();

    await expect(client.verifyMfa('287082')).resolves.toEqual({ accessToken: 'access-verified', user: signedInUser, mfa: 'VERIFIED' });
    const verify = api.requests.find((request) => new URL(request.url).pathname === '/api/auth/mfa/verify');
    expect(await verify?.json()).toEqual({ code: '287082' });
    heldProfile.resolve(Response.json(signedInUser));
    await expect(olderRequest).rejects.toMatchObject(authenticationRequired);
    await expect(loadProfile(client)).resolves.toEqual(signedInUser);
    expect(profileAuthorizations(api)).toEqual(['Bearer access-old', 'Bearer access-verified']);
  });

  it('refreshes first when no access token is in memory', async () => {
    const api = apiRoutes({
      '/api/auth/refresh': () => Response.json(sessionBody('access-restricted', 'VERIFICATION_REQUIRED')),
      '/api/auth/mfa/verify': () => Response.json(sessionBody('access-verified', 'VERIFIED')),
    });

    await expect(createSessionClient({ fetch: api.fetch }).verifyMfa('287082')).resolves.toMatchObject({ mfa: 'VERIFIED' });
    expect(api.paths()).toEqual(['/api/auth/csrf', '/api/auth/refresh', '/api/auth/mfa/verify']);
    expect(api.requests.at(-1)?.headers.get('Authorization')).toBe('Bearer access-restricted');
  });

  it.each([
    ['nine codes', syntheticBackupCodes.slice(1)],
    ['eleven codes', [...syntheticBackupCodes, 'AAAA-BBBB']],
    ['an oversized code', [...syntheticBackupCodes.slice(1), 'AAAA-BBBBB']],
    ['a code without the separator', [...syntheticBackupCodes.slice(1), 'AAAABBBB']],
    ['a lower-case code', [...syntheticBackupCodes.slice(1), 'aaaa-bbbb']],
    ['a non-string code', [...syntheticBackupCodes.slice(1), 12345678]],
    ['no codes', undefined],
  ])('rejects an enrollment result with %s', async (_, backupCodes) => {
    const { client } = await signedInClient({
      '/api/auth/mfa/enrollment/verify': () => Response.json({ ...enrolledBody(), backupCodes }),
    });

    const failure: unknown = await client.verifyMfaEnrollment(enrollmentId, '287082').catch((reason: unknown) => reason);
    expect(failure).toMatchObject({ code: 'INVALID_RESPONSE', status: 200, message: '' });
    expect(JSON.stringify(failure)).not.toContain(syntheticBackupCodes[1]);
  });

  it('ignores backup codes on a challenge result', async () => {
    const { client } = await signedInClient({ '/api/auth/mfa/verify': () => Response.json(enrolledBody()) });

    expect(await client.verifyMfa('287082')).not.toHaveProperty('backupCodes');
  });

  it.each([
    ['MFA_CODE_INVALID', 400],
    ['MFA_ENROLLMENT_STALE', 409],
    ['TOO_MANY_ATTEMPTS', 429],
  ])('keeps only the code and status of %s and the current token', async (code, status) => {
    const { api, client } = await signedInClient({
      '/api/auth/mfa/enrollment/verify': () => Response.json({ code, message: 'server text' }, { status }),
      '/api/user/me': () => Response.json(signedInUser),
    });

    await expect(client.verifyMfaEnrollment(enrollmentId, '000000')).rejects.toMatchObject({ code, status, message: '' });
    await loadProfile(client);
    expect(profileAuthorizations(api)).toEqual(['Bearer access-old']);
  });

  it('forgets the token when the restricted session is no longer accepted', async () => {
    const { api, client } = await signedInClient({ '/api/auth/mfa/verify': unauthorized, '/api/auth/refresh': noContent });

    await expect(client.verifyMfa('287082')).rejects.toMatchObject(authenticationRequired);
    await expect(loadProfile(client)).rejects.toMatchObject(authenticationRequired);
    expect(api.paths().slice(-2)).toEqual(['/api/auth/csrf', '/api/auth/refresh']);
  });

  it('does not send a verification still queued when sign-out starts', async () => {
    const refreshAnswered = deferred<Response>();
    const { api, client } = await signedInClient({
      '/api/auth/refresh': () => refreshAnswered.promise,
      '/api/auth/logout': noContent,
      '/api/auth/mfa/verify': () => Response.json(sessionBody('access-verified', 'VERIFIED')),
    });

    // Another tab's refresh holds the cookie-mutation lock, so the verification waits behind it.
    const otherTab = createSessionClient({ fetch: api.fetch }).restoreSession();
    await flushTasks();
    const verify = client.verifyMfa('287082');
    const signOut = client.signOut();
    refreshAnswered.resolve(Response.json(sessionBody('access-other')));
    await otherTab;
    await signOut;
    await expect(verify).rejects.toMatchObject(authenticationRequired);
    expect(api.paths()).not.toContain('/api/auth/mfa/verify');
  });
});
