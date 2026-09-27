import { expect } from 'vitest';
import type { MfaStatus } from '../src/lib/session';

export const signedInUser = {
  username: 'sana',
  mobile: '01700000000',
  email: null,
  mobileVerified: false,
};

/** The body the API returns for a sign-in or refresh; a Customer's session needs no authenticator. */
export function sessionBody(accessToken = 'synthetic-access-token', mfa: MfaStatus = 'NOT_REQUIRED') {
  return { accessToken, tokenType: 'Bearer', expiresIn: 900, user: signedInUser, mfa };
}

/** What `restoreSession` yields for a signed-in Customer. */
export const restoredCustomer = { user: signedInUser, mfa: 'NOT_REQUIRED' } as const;

/** What `restoreSession` yields for a staff session with the given MFA status. */
export function restoredStaff(mfa: MfaStatus) {
  return { user: signedInUser, mfa };
}

/** A synthetic pending enrollment, as `POST /api/auth/mfa/enrollment` returns it. */
export function enrollmentBody(secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', enrollmentId = '5f0c9e1a-2b3c-4d5e-8f90-a1b2c3d4e5f6') {
  return {
    enrollmentId,
    secret,
    otpauthUri: `otpauth://totp/Medi%20Wish:sana?secret=${secret}&issuer=Medi%20Wish&algorithm=SHA1&digits=6&period=30`,
    expiresIn: 600,
  };
}

/** Ten synthetic backup codes in the `XXXX-XXXX` shape. */
export const syntheticBackupCodes = [
  '7QKD-M2XA', 'P9TR-4GWE', 'ZC3N-8HVB', 'K5JF-Q7YY', 'R2GM-6DPS',
  'W8EX-3TNC', 'B4MH-9VQK', 'N6YP-2ZRA', 'H3JW-5KXM', 'T7BC-4NPQ',
];

/** A promise plus the functions that settle it, to hold a request open mid-test. */
export function deferred<T = void>(): { promise: Promise<T>; resolve(value: T): void; reject(reason: unknown): void } {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets every pending promise callback run. */
export function flushTasks(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

type Route = (request: Request) => Response | Promise<Response>;

/** Never answers, like a stalled server; rejects as `fetch` does once the operation timeout aborts it. */
export const stalledRoute: Route = (request) => new Promise<Response>((_, reject) => {
  request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true });
});

/**
 * A fake `fetch` answering each API path from its route. The CSRF bootstrap is routed by default, and every
 * request is recorded; an unrouted path fails the request.
 */
export function apiRoutes(routes: Record<string, Route>) {
  const requests: Request[] = [];
  const allRoutes: Record<string, Route> = { '/api/auth/csrf': () => Response.json({ csrfToken: 'csrf' }), ...routes };
  return {
    requests,
    paths: () => requests.map((request) => new URL(request.url).pathname),
    fetch: async (input: URL, init: RequestInit) => {
      const request = new Request(input, init);
      requests.push(request);
      const route = allRoutes[new URL(request.url).pathname];
      if (!route) throw new Error(`Unexpected request: ${request.url}`);
      return route(request);
    },
  };
}

/**
 * Replaces `navigator.locks` with a recording exclusive lock that grants requests in order, like the browser's.
 * `held()` reports whether an operation currently holds it; `restore()` puts the original back.
 */
export function installFakeLocks() {
  const previous = Object.getOwnPropertyDescriptor(navigator, 'locks');
  const names: string[] = [];
  let holders = 0;
  let tail = Promise.resolve();
  const locks = {
    request: async (name: string, options: { mode: string }, callback: () => Promise<unknown>) => {
      names.push(name);
      expect(options.mode).toBe('exclusive');
      const earlier = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => { release = resolve; });
      await earlier;
      holders += 1;
      try {
        return await callback();
      } finally {
        holders -= 1;
        release();
      }
    },
  };
  Object.defineProperty(navigator, 'locks', { configurable: true, value: locks });
  return {
    names,
    held: () => holders === 1,
    restore() {
      if (previous) Object.defineProperty(navigator, 'locks', previous);
      else Reflect.deleteProperty(navigator, 'locks');
    },
  };
}
