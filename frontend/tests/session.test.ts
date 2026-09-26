import { describe, expect, it } from 'vitest';
import { createSessionClient, readJsonResponse, UserApiError } from '../src/lib/session.ts';

const profile = { username: 'alice_1', mobile: '01700000000', email: 'alice@example.com', mobileVerified: true };
const responseFor = (accessToken: string, expiresIn = 900) => ({ accessToken, tokenType: 'Bearer', expiresIn, user: profile });
const csrfResponse = (csrfToken = 'csrf') => Response.json({ csrfToken });

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function blockedJsonResponse(value: unknown, release: Promise<void>): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(JSON.stringify(value)));
      void release.then(() => controller.close());
    },
  });
  return new Response(body, { headers: { 'Content-Type': 'application/json' } });
}

describe('browser session client', () => {
  it('signs in with the fixed identifier payload and refresh-cookie credentials', async () => {
    let request: Request | undefined;
    const client = createSessionClient({
      baseUrl: 'http://127.0.0.1:8080',
      fetch: async (input, init) => {
        request = new Request(input, init);
        return Response.json(responseFor('access-1'));
      },
    });

    await expect(client.signIn('alice@example.com', 'password')).resolves.toMatchObject({ accessToken: 'access-1', tokenType: 'Bearer' });
    expect(request?.url).toBe('http://127.0.0.1:8080/api/auth/login');
    expect(request?.method).toBe('POST');
    expect(request?.credentials).toBe('include');
    expect(await request?.json()).toEqual({ identifier: 'alice@example.com', password: 'password' });
  });

  it('accepts positive integer session lifetimes longer than one day', async () => {
    const client = createSessionClient({
      fetch: async () => Response.json(responseFor('access-long-lived', 86_401)),
    });

    await expect(client.signIn('alice_1', 'password')).resolves.toMatchObject({ expiresIn: 86_401 });
  });

  it.each([0, -1, 1.5])('rejects non-positive or non-integer session lifetimes (%s)', async (expiresIn) => {
    const client = createSessionClient({
      fetch: async () => Response.json(responseFor('access-invalid-lifetime', expiresIn)),
    });

    await expect(client.signIn('alice_1', 'password')).rejects.toMatchObject({ code: 'INVALID_RESPONSE', status: 200 });
  });

  it('accepts a valid JSON response exactly at the 16 KiB byte limit', async () => {
    const json = JSON.stringify(responseFor('access-at-limit'));
    const maxBytes = 16 * 1024;
    const jsonBytes = new TextEncoder().encode(json).byteLength;
    const body = `${json}${' '.repeat(maxBytes - jsonBytes)}`;
    const client = createSessionClient({
      fetch: async () => new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    });

    await expect(client.signIn('alice_1', 'password')).resolves.toMatchObject({ accessToken: 'access-at-limit' });
  });

  it('bootstraps the CSRF nonce and restores through refresh', async () => {
    const requests: Request[] = [];
    const client = createSessionClient({
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        return request.url.endsWith('/api/auth/csrf') ? csrfResponse('csrf+value') : Response.json(responseFor('access-2'));
      },
    });

    await expect(client.restoreSession()).resolves.toEqual(profile);
    expect(requests.map((request) => request.url)).toEqual([
      'http://127.0.0.1:8080/api/auth/csrf',
      'http://127.0.0.1:8080/api/auth/refresh',
    ]);
    expect(requests[0].credentials).toBe('include');
    expect(requests[1].credentials).toBe('include');
    expect(requests[1].headers.get('X-XSRF-TOKEN')).toBe('csrf+value');
    expect(requests[1].headers.get('Authorization')).toBeNull();
  });

  it('serializes refresh-cookie rotation across independent session clients', async () => {
    const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    let refreshGeneration = 0;
    let activeRefreshes = 0;
    let maxActiveRefreshes = 0;
    const lockNames: string[] = [];
    let lockTail = Promise.resolve();
    const locks = {
      request: async (name: string, options: { mode: string }, callback: (lock: object) => Promise<unknown>) => {
        lockNames.push(name);
        expect(options.mode).toBe('exclusive');
        const earlier = lockTail;
        let release!: () => void;
        lockTail = new Promise<void>((resolve) => { release = resolve; });
        await earlier;
        try {
          return await callback({});
        } finally {
          release();
        }
      },
    };
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks } });

    try {
      const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        if (request.url.endsWith('/api/auth/csrf')) return csrfResponse();

        const generationAtStart = refreshGeneration;
        activeRefreshes += 1;
        maxActiveRefreshes = Math.max(maxActiveRefreshes, activeRefreshes);
        await Promise.resolve();
        activeRefreshes -= 1;
        if (generationAtStart !== refreshGeneration) {
          return Response.json({ code: 'AUTHENTICATION_REQUIRED' }, { status: 401 });
        }
        refreshGeneration += 1;
        return Response.json(responseFor('access-' + refreshGeneration));
      };
      const firstClient = createSessionClient({ fetch });
      const secondClient = createSessionClient({ fetch });

      await expect(Promise.all([firstClient.restoreSession(), secondClient.restoreSession()]))
        .resolves.toEqual([profile, profile]);
      expect(refreshGeneration).toBe(2);
      expect(maxActiveRefreshes).toBe(1);
      expect(lockNames).toEqual(['medi-wish:auth-cookie-mutation', 'medi-wish:auth-cookie-mutation']);
    } finally {
      if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
      else Reflect.deleteProperty(globalThis, 'navigator');
    }
  });

  it('serializes sign-in, refresh, and logout cookie mutations through full response parsing', async () => {
    const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    const lockNames: string[] = [];
    const lockRequests = Array.from({ length: 4 }, () => deferred());
    const csrfStarts = Array.from({ length: 3 }, () => deferred());
    const loginBodyRelease = deferred();
    const loginStarted = deferred();
    const refreshBodyRelease = deferred();
    const refreshStarted = deferred();
    const logoutRelease = deferred();
    const logoutStarted = deferred();
    const requests: string[] = [];
    const requestsOutsideLock: string[] = [];
    let csrfCount = 0;
    let activeLocks = 0;
    let lockTail = Promise.resolve();
    const locks = {
      request: async (name: string, options: { mode: string }, callback: (lock: object) => Promise<unknown>) => {
        lockNames.push(name);
        lockRequests[lockNames.length - 1]?.resolve();
        expect(options.mode).toBe('exclusive');
        const earlier = lockTail;
        let release!: () => void;
        lockTail = new Promise<void>((resolve) => { release = resolve; });
        await earlier;
        activeLocks += 1;
        try {
          return await callback({});
        } finally {
          activeLocks -= 1;
          release();
        }
      },
    };
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks } });

    const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      requests.push(path);
      if (activeLocks !== 1) requestsOutsideLock.push(path);
      if (path.endsWith('/api/auth/csrf')) {
        csrfStarts[csrfCount++]?.resolve();
        return csrfResponse();
      }
      if (path.endsWith('/api/auth/login')) {
        loginStarted.resolve();
        return blockedJsonResponse(responseFor('access-login'), loginBodyRelease.promise);
      }
      if (path.endsWith('/api/auth/refresh')) {
        refreshStarted.resolve();
        return blockedJsonResponse(responseFor('access-refresh'), refreshBodyRelease.promise);
      }
      if (path.endsWith('/api/auth/logout')) {
        logoutStarted.resolve();
        await logoutRelease.promise;
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected session request: ${path}`);
    };

    const firstClient = createSessionClient({ fetch });
    const secondClient = createSessionClient({ fetch });
    const pending: Promise<unknown>[] = [];
    try {
      const signIn = firstClient.signIn('alice_1', 'password');
      pending.push(signIn);
      await loginStarted.promise;

      const refresh = secondClient.refreshSession();
      pending.push(refresh);
      const refreshAdmission = await Promise.race([
        lockRequests[1].promise.then(() => 'queued'),
        csrfStarts[0].promise.then(() => 'csrf-started-before-login-finished'),
      ]);
      expect(refreshAdmission).toBe('queued');
      expect(requests).toEqual(['/api/auth/login']);

      loginBodyRelease.resolve();
      await refreshStarted.promise;
      const signOut = firstClient.signOut();
      pending.push(signOut);
      const signOutAdmission = await Promise.race([
        lockRequests[2].promise.then(() => 'queued'),
        csrfStarts[1].promise.then(() => 'csrf-started-before-refresh-finished'),
        logoutStarted.promise.then(() => 'logout-started-without-lock'),
      ]);
      expect(signOutAdmission).toBe('queued');
      expect(requests).toEqual(['/api/auth/login', '/api/auth/csrf', '/api/auth/refresh']);

      refreshBodyRelease.resolve();
      await logoutStarted.promise;
      const nextRefresh = secondClient.refreshSession();
      pending.push(nextRefresh);
      const nextRefreshAdmission = await Promise.race([
        lockRequests[3].promise.then(() => 'queued'),
        csrfStarts[2].promise.then(() => 'csrf-started-before-logout-finished'),
      ]);
      expect(nextRefreshAdmission).toBe('queued');
      expect(requests).toEqual([
        '/api/auth/login', '/api/auth/csrf', '/api/auth/refresh', '/api/auth/csrf', '/api/auth/logout',
      ]);

      logoutRelease.resolve();
      await Promise.all(pending);
      expect(lockNames).toEqual(Array(4).fill('medi-wish:auth-cookie-mutation'));
      expect(requests).toEqual([
        '/api/auth/login', '/api/auth/csrf', '/api/auth/refresh', '/api/auth/csrf', '/api/auth/logout',
        '/api/auth/csrf', '/api/auth/refresh',
      ]);
      expect(requestsOutsideLock).toEqual([]);
    } finally {
      loginBodyRelease.resolve();
      refreshBodyRelease.resolve();
      logoutRelease.resolve();
      await Promise.allSettled(pending);
      if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
      else Reflect.deleteProperty(globalThis, 'navigator');
    }
  });

  it('shares one refresh request between concurrent callers', async () => {
    let refreshCalls = 0;
    let releaseRefresh!: () => void;
    let refreshStartedResolve!: () => void;
    const refreshReleased = new Promise<void>((resolve) => { releaseRefresh = resolve; });
    const refreshStarted = new Promise<void>((resolve) => { refreshStartedResolve = resolve; });
    const client = createSessionClient({
      fetch: async (input, init) => {
        const request = new Request(input, init);
        if (request.url.endsWith('/api/auth/csrf')) return csrfResponse();
        refreshCalls += 1;
        refreshStartedResolve();
        await refreshReleased;
        return Response.json(responseFor('access-shared'));
      },
    });

    const first = client.refreshSession();
    const second = client.refreshSession();
    await refreshStarted;
    expect(refreshCalls).toBe(1);
    releaseRefresh();
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  });

  it('shares one in-flight refresh across concurrent expired requests and retries each once', async () => {
    let refreshCalls = 0;
    let initialRequestCount = 0;
    let releaseInitialResponses!: () => void;
    let releaseRefresh!: () => void;
    let initialRequestsStartedResolve!: () => void;
    let refreshStartedResolve!: () => void;
    const initialResponsesReleased = new Promise<void>((resolve) => { releaseInitialResponses = resolve; });
    const refreshReleased = new Promise<void>((resolve) => { releaseRefresh = resolve; });
    const initialRequestsStarted = new Promise<void>((resolve) => { initialRequestsStartedResolve = resolve; });
    const refreshStarted = new Promise<void>((resolve) => { refreshStartedResolve = resolve; });
    const attempts: Array<{ requestId: string | null; authorization: string | null }> = [];
    const client = createSessionClient({
      fetch: async (input, init) => {
        const request = new Request(input, init);
        if (request.url.endsWith('/api/auth/login')) return Response.json(responseFor('access-old'));
        if (request.url.endsWith('/api/auth/csrf')) return csrfResponse();
        if (request.url.endsWith('/api/auth/refresh')) {
          refreshCalls += 1;
          refreshStartedResolve();
          await refreshReleased;
          return Response.json(responseFor('access-new'));
        }

        const attempt = {
          requestId: new URL(request.url).searchParams.get('request'),
          authorization: request.headers.get('Authorization'),
        };
        attempts.push(attempt);
        if (attempt.authorization === 'Bearer access-old') {
          initialRequestCount += 1;
          if (initialRequestCount === 2) initialRequestsStartedResolve();
          await initialResponsesReleased;
          return new Response(null, { status: 401 });
        }
        return Response.json({ requestId: attempt.requestId });
      },
    });
    await client.signIn('alice_1', 'password');

    const first = client.authenticatedFetch('http://127.0.0.1:8080/api/user/me?request=first');
    const second = client.authenticatedFetch('http://127.0.0.1:8080/api/user/me?request=second');
    await initialRequestsStarted;
    releaseInitialResponses();
    await refreshStarted;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(refreshCalls).toBe(1);
    releaseRefresh();

    await expect(Promise.all([first, second])).resolves.toMatchObject([
      { status: 200 },
      { status: 200 },
    ]);
    expect(refreshCalls).toBe(1);
    expect(attempts.filter(({ requestId }) => requestId === 'first')).toEqual([
      { requestId: 'first', authorization: 'Bearer access-old' },
      { requestId: 'first', authorization: 'Bearer access-new' },
    ]);
    expect(attempts.filter(({ requestId }) => requestId === 'second')).toEqual([
      { requestId: 'second', authorization: 'Bearer access-old' },
      { requestId: 'second', authorization: 'Bearer access-new' },
    ]);
  });

  it('retries one expired-access request after refresh and never loops on a second 401', async () => {
    const authorizationHeaders: string[] = [];
    let profileCalls = 0;
    const client = createSessionClient({
      fetch: async (input, init) => {
        const request = new Request(input, init);
        if (request.url.endsWith('/api/auth/login')) return Response.json(responseFor('access-old'));
        if (request.url.endsWith('/api/auth/csrf')) return csrfResponse();
        if (request.url.endsWith('/api/auth/refresh')) return Response.json(responseFor('access-new'));
        profileCalls += 1;
        authorizationHeaders.push(request.headers.get('Authorization') ?? '');
        return new Response(null, { status: 401 });
      },
    });
    await client.signIn('alice_1', 'password');

    await expect(client.authenticatedFetch('http://127.0.0.1:8080/api/user/me')).resolves.toMatchObject({ status: 401 });
    expect(profileCalls).toBe(2);
    expect(authorizationHeaders).toEqual(['Bearer access-old', 'Bearer access-new']);
  });

  it('replays a body-bearing Request when one expired-access request is retried', async () => {
    const attempts: Array<{ authorization: string | null; body: string }> = [];
    const client = createSessionClient({
      fetch: async (input, init) => {
        const request = new Request(input, init);
        if (request.url.endsWith('/api/auth/login')) return Response.json(responseFor('access-old'));
        if (request.url.endsWith('/api/auth/csrf')) return csrfResponse();
        if (request.url.endsWith('/api/auth/refresh')) return Response.json(responseFor('access-new'));
        const attempt = { authorization: request.headers.get('Authorization'), body: await request.text() };
        attempts.push(attempt);
        return attempts.length === 1 ? new Response(null, { status: 401 }) : Response.json({ saved: true });
      },
    });
    await client.signIn('alice_1', 'password');

    const action = new Request('http://127.0.0.1:8080/api/user/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"note":"synthetic"}',
    });
    await expect(client.authenticatedFetch(action)).resolves.toMatchObject({ status: 200 });
    expect(attempts).toEqual([
      { authorization: 'Bearer access-old', body: '{"note":"synthetic"}' },
      { authorization: 'Bearer access-new', body: '{"note":"synthetic"}' },
    ]);
  });

  it('rejects a pre-aborted authenticated request without dispatching it', async () => {
    let profileCalls = 0;
    const client = createSessionClient({
      fetch: async (input, init) => {
        const request = new Request(input, init);
        if (request.url.endsWith('/api/auth/login')) return Response.json(responseFor('access-abort'));
        profileCalls += 1;
        return Response.json(profile);
      },
    });
    await client.signIn('alice_1', 'password');
    const initController = new AbortController();
    initController.abort();
    const requestController = new AbortController();
    requestController.abort();

    await expect(client.authenticatedFetch('http://127.0.0.1:8080/api/user/me', { signal: initController.signal }))
      .rejects.toMatchObject({ code: 'REQUEST_FAILED', status: 0, message: '' });
    await expect(client.authenticatedFetch(
      new Request('http://127.0.0.1:8080/api/user/me', { signal: requestController.signal }),
    ))
      .rejects.toMatchObject({ code: 'REQUEST_FAILED', status: 0, message: '' });
    expect(profileCalls).toBe(0);
  });

  it('aborts an in-flight authenticated request when its caller signal aborts', async () => {
    let requestStartedResolve!: () => void;
    let releaseResponse!: () => void;
    let requestSignal: AbortSignal | undefined;
    const requestStarted = new Promise<void>((resolve) => { requestStartedResolve = resolve; });
    const client = createSessionClient({
      fetch: async (input, init) => {
        const request = new Request(input, init);
        if (request.url.endsWith('/api/auth/login')) return Response.json(responseFor('access-abort'));
        return new Promise<Response>((resolve) => {
          requestSignal = request.signal;
          releaseResponse = () => resolve(Response.json(profile));
          requestStartedResolve();
        });
      },
    });
    await client.signIn('alice_1', 'password');
    const controller = new AbortController();
    const input = new Request('http://127.0.0.1:8080/api/user/me', { signal: controller.signal });
    const request = client.authenticatedFetch(input);
    await requestStarted;
    controller.abort();
    const wasAborted = requestSignal?.aborted;
    releaseResponse();

    await expect(request).rejects.toMatchObject({ code: 'REQUEST_FAILED', status: 0, message: '' });
    expect(wasAborted).toBe(true);
  });

  it('reports body-read cancellation even when its reason resembles malformed JSON', async () => {
    let bodyStartedResolve!: () => void;
    const bodyStarted = new Promise<void>((resolve) => { bodyStartedResolve = resolve; });
    const client = createSessionClient({
      fetch: async (input, init) => {
        const request = new Request(input, init);
        if (request.url.endsWith('/api/auth/login')) return Response.json(responseFor('access-abort'));
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            request.signal.addEventListener('abort', () => controller.error(request.signal.reason), { once: true });
            bodyStartedResolve();
          },
        });
        return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
    });
    await client.signIn('alice_1', 'password');
    const controller = new AbortController();
    const request = client.authenticatedFetch(
      'http://127.0.0.1:8080/api/user/me',
      { signal: controller.signal },
      readJsonResponse,
    );
    await bodyStarted;
    controller.abort(new SyntaxError('caller cancellation'));

    await expect(request).rejects.toMatchObject({ code: 'REQUEST_FAILED', status: 0, message: '' });
  });

  it('does not dispatch an expired-access retry after its caller cancels during refresh', async () => {
    let refreshStartedResolve!: () => void;
    let releaseRefresh!: () => void;
    const refreshStarted = new Promise<void>((resolve) => { refreshStartedResolve = resolve; });
    const refreshReleased = new Promise<void>((resolve) => { releaseRefresh = resolve; });
    let profileRequestStartedResolve!: () => void;
    const profileRequestStarted = new Promise<void>((resolve) => { profileRequestStartedResolve = resolve; });
    let profileCalls = 0;
    const client = createSessionClient({
      fetch: async (input, init) => {
        const request = new Request(input, init);
        if (request.url.endsWith('/api/auth/login')) return Response.json(responseFor('access-old'));
        if (request.url.endsWith('/api/auth/csrf')) return csrfResponse();
        if (request.url.endsWith('/api/auth/refresh')) {
          refreshStartedResolve();
          await refreshReleased;
          return Response.json(responseFor('access-new'));
        }
        profileCalls += 1;
        profileRequestStartedResolve();
        return new Response(null, { status: 401 });
      },
    });
    await client.signIn('alice_1', 'password');
    const refresh = client.refreshSession();
    await refreshStarted;
    const controller = new AbortController();
    const request = client.authenticatedFetch('http://127.0.0.1:8080/api/user/me', { signal: controller.signal });
    let requestSettledBeforeRefresh: boolean | undefined;
    const requestOutcome = request.then(
      () => ({ status: 'resolved' as const }),
      (reason: unknown) => ({ status: 'rejected' as const, reason }),
    ).finally(() => { requestSettledBeforeRefresh = true; });
    await profileRequestStarted;
    controller.abort();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const settledBeforeRefreshWasReleased = requestSettledBeforeRefresh === true;
    releaseRefresh();

    await expect(refresh).resolves.toMatchObject({ accessToken: 'access-new' });
    await expect(requestOutcome).resolves.toMatchObject({
      status: 'rejected',
      reason: { code: 'REQUEST_FAILED', status: 0, message: '' },
    });
    expect(settledBeforeRefreshWasReleased).toBe(true);
    expect(profileCalls).toBe(1);
    expect(client.isAuthenticated()).toBe(true);
  });

  it('returns the native Response when no response reader is supplied', async () => {
    const profileResponse = Response.json(profile);
    const client = createSessionClient({
      fetch: async (input) => String(input).endsWith('/api/auth/login')
        ? Response.json(responseFor('access-response'))
        : profileResponse,
    });
    await client.signIn('alice_1', 'password');

    const response = await client.authenticatedFetch('http://127.0.0.1:8080/api/user/me');
    expect(response).toBe(profileResponse);
    await expect(response.json()).resolves.toEqual(profile);
  });

  it('clears a rejected retry token and accepts a later explicit sign-in', async () => {
    const authorizationHeaders: string[] = [];
    let signInCalls = 0;
    const client = createSessionClient({
      fetch: async (input, init) => {
        const request = new Request(input, init);
        if (request.url.endsWith('/api/auth/login')) {
          signInCalls += 1;
          return Response.json(responseFor(signInCalls === 1 ? 'access-old' : 'access-later'));
        }
        if (request.url.endsWith('/api/auth/csrf')) return csrfResponse();
        if (request.url.endsWith('/api/auth/refresh')) return Response.json(responseFor('access-rejected'));

        const authorization = request.headers.get('Authorization') ?? '';
        authorizationHeaders.push(authorization);
        return authorization === 'Bearer access-later'
          ? Response.json(profile)
          : new Response(null, { status: 401 });
      },
    });
    await client.signIn('alice_1', 'password');

    await expect(client.authenticatedFetch('http://127.0.0.1:8080/api/user/me'))
      .resolves.toMatchObject({ status: 401 });
    expect(client.isAuthenticated()).toBe(false);

    await expect(client.signIn('alice_1', 'password')).resolves.toMatchObject({ accessToken: 'access-later' });
    expect(client.isAuthenticated()).toBe(true);
    await expect(client.authenticatedFetch('http://127.0.0.1:8080/api/user/me'))
      .resolves.toMatchObject({ status: 200 });
    expect(authorizationHeaders).toEqual([
      'Bearer access-old',
      'Bearer access-rejected',
      'Bearer access-later',
    ]);
  });

  it('does not cancel a newer sign-in queued while an authenticated retry is pending', async () => {
    let loginCalls = 0;
    let signalRetryStarted!: () => void;
    let releaseRetry!: () => void;
    let signalSecondLoginStarted!: () => void;
    let releaseSecondLogin!: () => void;
    const retryStarted = new Promise<void>((resolve) => { signalRetryStarted = resolve; });
    const retryResponse = new Promise<void>((resolve) => { releaseRetry = resolve; });
    const secondLoginStarted = new Promise<void>((resolve) => { signalSecondLoginStarted = resolve; });
    const secondLoginResponse = new Promise<void>((resolve) => { releaseSecondLogin = resolve; });
    const client = createSessionClient({
      fetch: async (input, init) => {
        const request = new Request(input, init);
        if (request.url.endsWith('/api/auth/login')) {
          loginCalls += 1;
          if (loginCalls === 1) return Response.json(responseFor('access-old'));
          signalSecondLoginStarted();
          await secondLoginResponse;
          return Response.json(responseFor('access-later'));
        }
        if (request.url.endsWith('/api/auth/csrf')) return csrfResponse();
        if (request.url.endsWith('/api/auth/refresh')) return Response.json(responseFor('access-retried'));

        const authorization = request.headers.get('Authorization');
        if (authorization === 'Bearer access-old') return new Response(null, { status: 401 });
        if (authorization === 'Bearer access-retried') {
          signalRetryStarted();
          await retryResponse;
          return new Response(null, { status: 401 });
        }
        return Response.json(profile);
      },
    });
    await client.signIn('alice_1', 'password');

    const oldRequest = client.authenticatedFetch('http://127.0.0.1:8080/api/user/me');
    await retryStarted;
    const laterSignIn = client.signIn('bob_2', 'password');
    await secondLoginStarted;
    releaseRetry();

    await expect(oldRequest).resolves.toMatchObject({ status: 401 });
    releaseSecondLogin();
    await expect(laterSignIn).resolves.toMatchObject({ accessToken: 'access-later' });
    expect(client.isAuthenticated()).toBe(true);
    await expect(client.authenticatedFetch('http://127.0.0.1:8080/api/user/me'))
      .resolves.toMatchObject({ status: 200 });
  });

  it('invalidates another request result after a retried 401 rejects the session', async () => {
    let retryCalls = 0;
    let signalSecondRetryStarted!: () => void;
    let releaseSecondRetry!: () => void;
    const secondRetryStarted = new Promise<void>((resolve) => { signalSecondRetryStarted = resolve; });
    const secondRetryResponse = new Promise<void>((resolve) => { releaseSecondRetry = resolve; });
    const client = createSessionClient({
      fetch: async (input, init) => {
        const request = new Request(input, init);
        if (request.url.endsWith('/api/auth/login')) return Response.json(responseFor('access-old'));
        if (request.url.endsWith('/api/auth/csrf')) return csrfResponse();
        if (request.url.endsWith('/api/auth/refresh')) return Response.json(responseFor('access-retried'));
        if (request.headers.get('Authorization') === 'Bearer access-old') {
          return new Response(null, { status: 401 });
        }

        retryCalls += 1;
        if (retryCalls === 1) {
          await secondRetryStarted;
          return new Response(null, { status: 401 });
        }
        signalSecondRetryStarted();
        await secondRetryResponse;
        return Response.json(profile);
      },
    });
    await client.signIn('alice_1', 'password');

    const rejectedRequest = client.authenticatedFetch('http://127.0.0.1:8080/api/user/me?call=rejected');
    const staleRequest = client.authenticatedFetch('http://127.0.0.1:8080/api/user/me?call=stale');
    await secondRetryStarted;

    await expect(rejectedRequest).resolves.toMatchObject({ status: 401 });
    expect(client.isAuthenticated()).toBe(false);
    releaseSecondRetry();
    await expect(staleRequest).rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED', status: 401 });
  });

  it('rejects off-origin authenticated requests before invoking fetch', async () => {
    let fetchCalls = 0;
    const client = createSessionClient({
      baseUrl: 'https://api.example.test',
      fetch: async () => {
        fetchCalls += 1;
        return Response.json(responseFor('access-origin-guard'));
      },
    });
    const offOriginInputs: Array<RequestInfo | URL> = [
      'https://attacker.example/api/user/me',
      new URL('https://attacker.example/api/user/me'),
      new Request('https://attacker.example/api/user/me'),
    ];
    await client.signIn('alice_1', 'password');
    fetchCalls = 0;

    for (const input of offOriginInputs) {
      await expect(client.authenticatedFetch(input)).rejects.toMatchObject({ code: 'REQUEST_FAILED', status: 0 });
    }
    expect(fetchCalls).toBe(0);
  });

  it('rechecks a mutable request URL before an authenticated retry', async () => {
    const userProfileUrl = new URL('http://127.0.0.1:8080/api/user/me');
    const requestUrls: string[] = [];
    let profileCalls = 0;
    const client = createSessionClient({
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requestUrls.push(request.url);
        if (request.url.endsWith('/api/auth/login')) return Response.json(responseFor('access-old'));
        if (request.url.endsWith('/api/auth/csrf')) return csrfResponse();
        if (request.url.endsWith('/api/auth/refresh')) return Response.json(responseFor('access-new'));
        profileCalls += 1;
        userProfileUrl.href = 'https://attacker.example/api/user/me';
        return new Response(null, { status: 401 });
      },
    });
    await client.signIn('alice_1', 'password');

    await expect(client.authenticatedFetch(userProfileUrl)).rejects.toMatchObject({ code: 'REQUEST_FAILED', status: 0 });
    expect(profileCalls).toBe(1);
    expect(requestUrls).not.toContain('https://attacker.example/api/user/me');
  });

  it('does not retry with a cleared session after refresh succeeds', async () => {
    let refreshStartedResolve!: () => void;
    let releaseRefresh!: (response: Response) => void;
    let retrySeamResolve!: () => void;
    const refreshStarted = new Promise<void>((resolve) => { refreshStartedResolve = resolve; });
    const refreshResponse = new Promise<Response>((resolve) => { releaseRefresh = resolve; });
    const retrySeamReached = new Promise<void>((resolve) => { retrySeamResolve = resolve; });
    const authorizationHeaders: string[] = [];
    let profileCalls = 0;
    const clientResponse = new Response(null, { status: 401 });
    Object.defineProperty(clientResponse, 'status', {
      configurable: true,
      get: () => {
        retrySeamResolve();
        return 401;
      },
    });
    const client = createSessionClient({
      fetch: async (input, init) => {
        const request = new Request(input, init);
        if (request.url.endsWith('/api/auth/login')) return Response.json(responseFor('access-old'));
        if (request.url.endsWith('/api/auth/csrf')) return csrfResponse();
        if (request.url.endsWith('/api/auth/refresh')) {
          refreshStartedResolve();
          return refreshResponse;
        }
        profileCalls += 1;
        authorizationHeaders.push(request.headers.get('Authorization') ?? '');
        return clientResponse;
      },
    });

    await client.signIn('alice_1', 'password');
    const refresh = client.refreshSession();
    await refreshStarted;
    const clearAfterRefresh = refresh.then(() => client.clearSession());

    const request = client.authenticatedFetch('http://127.0.0.1:8080/api/user/me');
    await retrySeamReached;
    releaseRefresh(Response.json(responseFor('access-new')));

    await expect(request).rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED', status: 401 });
    await clearAfterRefresh;
    expect(profileCalls).toBe(1);
    expect(authorizationHeaders).toEqual(['Bearer access-old']);
  });

  it('returns absent sessions quietly and clears memory after logout failure', async () => {
    const client = createSessionClient({
      fetch: async (input) => {
        const url = String(input);
        if (url.endsWith('/api/auth/csrf')) return csrfResponse();
        if (url.endsWith('/api/auth/refresh')) return Response.json({ code: 'AUTHENTICATION_REQUIRED' }, { status: 401 });
        throw new Error('logout transport down');
      },
    });
    await expect(client.restoreSession()).resolves.toBeNull();
    await expect(client.signOut()).rejects.toMatchObject({ code: 'REQUEST_FAILED', status: 0 });
    await expect(client.authenticatedFetch('http://127.0.0.1:8080/api/user/me')).rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED', status: 401 });
  });

  it('clears a signed-in client after logout transport failure without dispatching later authenticated requests', async () => {
    const requests: Request[] = [];
    const client = createSessionClient({
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        if (request.url.endsWith('/api/auth/login')) return Response.json(responseFor('access-before-logout-failure'));
        if (request.url.endsWith('/api/auth/csrf')) return csrfResponse();
        if (request.url.endsWith('/api/auth/logout')) throw new TypeError('network unavailable');
        throw new Error(`Unexpected session request: ${request.url}`);
      },
    });

    await client.signIn('alice_1', 'password');
    expect(client.isAuthenticated()).toBe(true);

    await expect(client.signOut()).rejects.toMatchObject({ code: 'REQUEST_FAILED', status: 0 });

    expect(client.isAuthenticated()).toBe(false);
    await expect(client.authenticatedFetch('http://127.0.0.1:8080/api/user/me'))
      .rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED', status: 401 });
    expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
      '/api/auth/login',
      '/api/auth/csrf',
      '/api/auth/logout',
    ]);
  });

  it('rejects an in-flight authenticated response after a separate refresh fails', async () => {
    let signalProfileReader!: () => void;
    let releaseProfileReader!: () => void;
    const profileReaderStarted = new Promise<void>((resolve) => { signalProfileReader = resolve; });
    const profileReaderReleased = new Promise<void>((resolve) => { releaseProfileReader = resolve; });
    let profileCalls = 0;
    const client = createSessionClient({
      fetch: async (input, init) => {
        const request = new Request(input, init);
        if (request.url.endsWith('/api/auth/login')) return Response.json(responseFor('access-current'));
        if (request.url.endsWith('/api/auth/csrf')) return csrfResponse();
        if (request.url.endsWith('/api/auth/refresh')) {
          return Response.json({ code: 'AUTHENTICATION_REQUIRED' }, { status: 401 });
        }
        profileCalls += 1;
        return Response.json(profile);
      },
    });
    await client.signIn('alice_1', 'password');

    const profileRequest = client.authenticatedFetch(
      'http://127.0.0.1:8080/api/user/me',
      undefined,
      async (response) => {
        signalProfileReader();
        await profileReaderReleased;
        return response.json();
      },
    );
    await profileReaderStarted;

    await expect(client.refreshSession()).rejects.toMatchObject({ status: 401 });
    expect(client.isAuthenticated()).toBe(false);
    releaseProfileReader();
    await expect(profileRequest).rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED', status: 401 });
    expect(profileCalls).toBe(1);
  });

  it('keeps logout clearing effective when an earlier refresh finishes afterward', async () => {
    let releaseRefresh!: () => void;
    let refreshStartedResolve!: () => void;
    const refreshReleased = new Promise<void>((resolve) => { releaseRefresh = resolve; });
    const refreshStarted = new Promise<void>((resolve) => { refreshStartedResolve = resolve; });
    let logoutRequest: Request | undefined;
    const client = createSessionClient({
      fetch: async (input, init) => {
        const request = new Request(input, init);
        if (request.url.endsWith('/api/auth/login')) return Response.json(responseFor('access-before-refresh'));
        if (request.url.endsWith('/api/auth/csrf')) return csrfResponse();
        if (request.url.endsWith('/api/auth/refresh')) {
          refreshStartedResolve();
          await refreshReleased;
          return Response.json(responseFor('access-after-logout'));
        }
        logoutRequest = request;
        return new Response(null, { status: 204 });
      },
    });

    await client.signIn('alice_1', 'password');
    const refresh = client.refreshSession();
    await refreshStarted;
    const logout = client.signOut();
    releaseRefresh();
    await expect(refresh).rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED', status: 401 });
    await expect(logout).resolves.toBeUndefined();
    expect(logoutRequest?.credentials).toBe('include');
    expect(logoutRequest?.headers.get('X-XSRF-TOKEN')).toBe('csrf');
    await expect(client.authenticatedFetch('http://127.0.0.1:8080/api/user/me')).rejects.toMatchObject({
      code: 'AUTHENTICATION_REQUIRED', status: 401,
    });
    await expect(client.authenticatedFetch('http://127.0.0.1:8080/api/user/me')).rejects.toMatchObject({
      code: 'AUTHENTICATION_REQUIRED', status: 401,
    });
  });

  it('rejects a delayed sign-in after the caller clears the session', async () => {
    let releaseLogin!: () => void;
    let loginStartedResolve!: () => void;
    const loginReleased = new Promise<void>((resolve) => { releaseLogin = resolve; });
    const loginStarted = new Promise<void>((resolve) => { loginStartedResolve = resolve; });
    const client = createSessionClient({
      fetch: async (input, init) => {
        const request = new Request(input, init);
        if (request.url.endsWith('/api/auth/login')) {
          loginStartedResolve();
          await loginReleased;
          return Response.json(responseFor('stale-access'));
        }
        return Response.json(responseFor('unexpected-access'));
      },
    });

    const login = client.signIn('alice_1', 'password');
    await loginStarted;
    client.clearSession();
    releaseLogin();

    await expect(login).rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED', status: 401 });
    await expect(client.authenticatedFetch('http://127.0.0.1:8080/api/user/me')).rejects.toMatchObject({
      code: 'AUTHENTICATION_REQUIRED', status: 401,
    });
  });

  it('does not start a queued sign-in after the caller clears the session', async () => {
    let releaseRefresh!: () => void;
    let refreshStartedResolve!: () => void;
    const refreshReleased = new Promise<void>((resolve) => { releaseRefresh = resolve; });
    const refreshStarted = new Promise<void>((resolve) => { refreshStartedResolve = resolve; });
    let loginCalls = 0;
    const client = createSessionClient({
      fetch: async (input) => {
        const url = String(input);
        if (url.endsWith('/api/auth/csrf')) return csrfResponse();
        if (url.endsWith('/api/auth/refresh')) {
          refreshStartedResolve();
          await refreshReleased;
          return Response.json(responseFor('stale-refresh'));
        }
        loginCalls += 1;
        return Response.json(responseFor('stale-login'));
      },
    });

    const refresh = client.refreshSession();
    await refreshStarted;
    const login = client.signIn('alice_1', 'password');
    client.clearSession();
    releaseRefresh();

    await expect(refresh).rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED', status: 401 });
    await expect(login).rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED', status: 401 });
    expect(loginCalls).toBe(0);
  });

  it('serializes concurrent sign-ins so cookie responses apply in request order', async () => {
    const requests: string[] = [];
    let releaseFirst!: () => void;
    const firstReleased = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const client = createSessionClient({
      fetch: async (input, init) => {
        const request = new Request(input, init);
        if (request.url.endsWith('/api/auth/login')) {
          const body = await request.json() as { identifier: string };
          requests.push(body.identifier);
          if (body.identifier === 'first') await firstReleased;
          return Response.json(responseFor(body.identifier === 'first' ? 'first-access' : 'second-access'));
        }
        return Response.json(responseFor('unexpected-access'));
      },
    });

    const first = client.signIn('first', 'password');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const second = client.signIn('second', 'password');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(requests).toEqual(['first']);

    releaseFirst();
    await expect(first).resolves.toMatchObject({ accessToken: 'first-access' });
    await expect(second).resolves.toMatchObject({ accessToken: 'second-access' });
    expect(requests).toEqual(['first', 'second']);
  });

  it('does not call browser storage APIs while managing the access token', async () => {
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
      const client = createSessionClient({ fetch: async () => Response.json(responseFor('access-memory')) });

      await client.signIn('alice_1', 'password');
      client.clearSession();
      expect(storageCalls).toBe(0);
    } finally {
      if (localStorageDescriptor) Object.defineProperty(globalThis, 'localStorage', localStorageDescriptor);
      else Reflect.deleteProperty(globalThis, 'localStorage');
      if (sessionStorageDescriptor) Object.defineProperty(globalThis, 'sessionStorage', sessionStorageDescriptor);
      else Reflect.deleteProperty(globalThis, 'sessionStorage');
    }
  });

  it('rejects malformed session responses without exposing token details', async () => {
    const client = createSessionClient({ fetch: async () => Response.json({ accessToken: 'x', tokenType: 'Basic', expiresIn: 900, user: profile }) });
    await expect(client.signIn('alice_1', 'password')).rejects.toMatchObject({ code: 'INVALID_RESPONSE', status: 200, message: '' });
    await expect(client.authenticatedFetch('http://127.0.0.1:8080/api/user/me')).rejects.toBeInstanceOf(UserApiError);
  });
});
