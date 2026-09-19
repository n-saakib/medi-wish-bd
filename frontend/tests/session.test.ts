import { describe, expect, it } from 'vitest';
import { createSessionClient, UserApiError } from '../src/lib/session.ts';

const profile = { username: 'alice_1', mobile: '01700000000', email: 'alice@example.com', mobileVerified: true };
const responseFor = (accessToken: string) => ({ accessToken, tokenType: 'Bearer', expiresIn: 900, user: profile });
const csrfResponse = (csrfToken = 'csrf') => Response.json({ csrfToken });

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
    await expect(client.signOut()).resolves.toBeUndefined();
    expect(logoutRequest?.credentials).toBe('include');
    expect(logoutRequest?.headers.get('X-XSRF-TOKEN')).toBe('csrf');
    await expect(client.authenticatedFetch('http://127.0.0.1:8080/api/user/me')).rejects.toMatchObject({
      code: 'AUTHENTICATION_REQUIRED', status: 401,
    });

    releaseRefresh();
    await expect(refresh).rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED', status: 401 });
    await expect(client.authenticatedFetch('http://127.0.0.1:8080/api/user/me')).rejects.toMatchObject({
      code: 'AUTHENTICATION_REQUIRED', status: 401,
    });
  });

  it('does not call browser storage APIs while managing the access token', async () => {
    let storageCalls = 0;
    const storage = {
      getItem: () => { storageCalls += 1; return null; },
      setItem: () => { storageCalls += 1; },
      removeItem: () => { storageCalls += 1; },
    };
    Object.assign(globalThis, { localStorage: storage, sessionStorage: storage });
    const client = createSessionClient({ fetch: async () => Response.json(responseFor('access-memory')) });

    await client.signIn('alice_1', 'password');
    client.clearSession();
    expect(storageCalls).toBe(0);
  });

  it('rejects malformed session responses without exposing token details', async () => {
    const client = createSessionClient({ fetch: async () => Response.json({ accessToken: 'x', tokenType: 'Basic', expiresIn: 900, user: profile }) });
    await expect(client.signIn('alice_1', 'password')).rejects.toMatchObject({ code: 'INVALID_RESPONSE', status: 200, message: '' });
    await expect(client.authenticatedFetch('http://127.0.0.1:8080/api/user/me')).rejects.toBeInstanceOf(UserApiError);
  });
});
