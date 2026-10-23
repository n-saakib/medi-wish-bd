// @vitest-environment jsdom

import { act, createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  initialSessionState,
  sessionReducer,
  useSession,
  type SessionContextValue,
  type SessionState,
} from '../src/auth/SessionProvider';
import { sessionRedirect, type SessionGuard } from '../src/auth/sessionRedirect';
import { ApiError } from '../src/lib/api';
import { createSessionClient, type MfaStatus } from '../src/lib/session';
import {
  apiRoutes,
  deferred,
  flushTasks,
  installFakeLocks,
  restoredCustomer,
  restoredStaff,
  sessionBody,
  signedInUser,
  syntheticBackupCodes,
} from './fakeApi';
import { createSessionSource, renderWithSession, unmountAll } from './renderWithSession';

// jsdom has no Web Locks; the fake gives the real session client the cross-tab lock a secure context has.
installFakeLocks();

const expired = new ApiError('AUTHENTICATION_REQUIRED', 401);

afterEach(unmountAll);

async function mountProvider(source = createSessionSource()): Promise<{ current: () => SessionContextValue }> {
  let latest: SessionContextValue | undefined;
  function SessionProbe() {
    latest = useSession();
    return null;
  }
  await renderWithSession(createElement(SessionProbe), source);
  return {
    current: () => {
      if (!latest) throw new Error('The session probe did not render');
      return latest;
    },
  };
}

describe('SessionProvider restore', () => {
  it('shares the restored profile once the refresh cookie is accepted', async () => {
    const session = await mountProvider(createSessionSource({ restoreSession: vi.fn().mockResolvedValue(restoredCustomer) }));
    expect(session.current()).toMatchObject({ profile: signedInUser, restoring: false, notice: null });
  });

  it('stays quietly signed out when no session existed', async () => {
    const session = await mountProvider();
    expect(session.current()).toMatchObject({ profile: null, restoring: false, notice: null });
  });

  it('reports an expired session when the API rejects the refresh cookie', async () => {
    const client = createSessionClient({
      fetch: apiRoutes({ '/api/auth/refresh': () => Response.json({ code: 'AUTHENTICATION_REQUIRED' }, { status: 401 }) }).fetch,
    });
    const session = await mountProvider(client);
    expect(session.current()).toMatchObject({ profile: null, restoring: false, notice: 'sessionExpired' });
  });

  it.each([
    ['an unexpected error', new Error('private failure detail')],
    ['an API error other than 401', new ApiError('INTERNAL_ERROR', 500)],
  ])('reports a restore failure from %s without exposing its detail', async (_, failure) => {
    const session = await mountProvider(createSessionSource({ restoreSession: vi.fn().mockRejectedValue(failure) }));
    expect(session.current()).toMatchObject({ profile: null, restoring: false, notice: 'restoreError' });
  });
});

describe('SessionProvider actions', () => {
  it('signs in, shares the profile and clears an earlier notice', async () => {
    const source = createSessionSource({ restoreSession: vi.fn().mockRejectedValue(expired) });
    const session = await mountProvider(source);
    expect(session.current().notice).toBe('sessionExpired');

    await act(async () => {
      await expect(session.current().signIn('sana', 'synthetic-password')).resolves.toEqual(signedInUser);
    });

    expect(source.signIn).toHaveBeenCalledWith('sana', 'synthetic-password');
    expect(session.current()).toMatchObject({ profile: signedInUser, signingIn: false, notice: null });
  });

  it('rethrows a failed sign-in so the form can report it, and stays signed out', async () => {
    const failure = new Error('private failure detail');
    const session = await mountProvider(createSessionSource({ signIn: vi.fn().mockRejectedValue(failure) }));

    await act(async () => {
      await expect(session.current().signIn('sana', 'wrong-password')).rejects.toBe(failure);
    });

    expect(session.current()).toMatchObject({ profile: null, signingIn: false });
  });

  it('signs out and records the result for the home page', async () => {
    const source = createSessionSource({ restoreSession: vi.fn().mockResolvedValue(restoredCustomer) });
    const session = await mountProvider(source);

    await act(async () => session.current().signOut());

    expect(source.signOut).toHaveBeenCalledOnce();
    expect(session.current()).toMatchObject({ profile: null, signingOut: false, notice: 'signedOut' });
  });

  it('ends the local session and records a failure when sign-out cannot be confirmed', async () => {
    const session = await mountProvider(createSessionSource({
      restoreSession: vi.fn().mockResolvedValue(restoredCustomer),
      signOut: vi.fn().mockRejectedValue(new Error('private failure detail')),
    }));

    await act(async () => session.current().signOut());

    expect(session.current()).toMatchObject({ profile: null, signingOut: false, notice: 'signOutError' });
  });

  it('ends the session when a protected request is still unauthorized', async () => {
    const session = await mountProvider(createSessionSource({
      restoreSession: vi.fn().mockResolvedValue(restoredCustomer),
      authenticatedFetch: vi.fn().mockRejectedValue(expired),
    }));

    await act(async () => {
      await expect(session.current().authenticatedFetch('/api/user/me', { method: 'GET' }, vi.fn())).rejects.toBe(expired);
    });

    expect(session.current()).toMatchObject({ profile: null, notice: 'sessionExpired' });
  });

  it('keeps the session when a protected request fails for another reason', async () => {
    const failure = new ApiError('INTERNAL_ERROR', 500);
    const session = await mountProvider(createSessionSource({
      restoreSession: vi.fn().mockResolvedValue(restoredCustomer),
      authenticatedFetch: vi.fn().mockRejectedValue(failure),
    }));

    await act(async () => {
      await expect(session.current().authenticatedFetch('/api/user/me', { method: 'GET' }, vi.fn())).rejects.toBe(failure);
    });

    expect(session.current()).toMatchObject({ profile: signedInUser, notice: null });
  });

  it.each([
    ['keeps the sign-out result', false, { profile: null, notice: 'signedOut' }],
    ['keeps a newer sign-in', true, { profile: signedInUser, notice: null }],
  ])('%s when a request started before sign-out finishes afterwards', async (_, signInAgain, expected) => {
    const heldProfile = deferred<Response>();
    const client = createSessionClient({
      fetch: apiRoutes({
        '/api/auth/refresh': () => Response.json(sessionBody('access-old')),
        '/api/user/me': () => heldProfile.promise,
        '/api/auth/logout': () => new Response(null, { status: 204 }),
        '/api/auth/login': () => Response.json(sessionBody('access-new')),
      }).fetch,
    });
    const session = await mountProvider(client);
    let olderRequest!: Promise<unknown>;
    await act(async () => {
      olderRequest = session.current().authenticatedFetch('/api/user/me', { method: 'GET' }, (response) => response.json());
      await flushTasks();
    });

    await act(async () => session.current().signOut());
    if (signInAgain) await act(async () => void await session.current().signIn('sana', 'synthetic-password'));
    await act(async () => {
      heldProfile.resolve(Response.json(signedInUser));
      await expect(olderRequest).rejects.toMatchObject({ status: 401 });
    });

    expect(session.current()).toMatchObject(expected);
  });

  it('ends the session when a request started before a failed sign-in is still unauthorized', async () => {
    const heldProfile = deferred<Response>();
    let refreshes = 0;
    const client = createSessionClient({
      fetch: apiRoutes({
        '/api/auth/refresh': () => (refreshes++ === 0
          ? Response.json(sessionBody('access-old'))
          : Response.json({ code: 'AUTHENTICATION_REQUIRED' }, { status: 401 })),
        '/api/user/me': () => heldProfile.promise,
        '/api/auth/login': () => Response.json({ code: 'AUTHENTICATION_FAILED' }, { status: 401 }),
      }).fetch,
    });
    const session = await mountProvider(client);
    let olderRequest!: Promise<unknown>;
    await act(async () => {
      olderRequest = session.current().authenticatedFetch('/api/user/me', { method: 'GET' }, (response) => response.json());
      await flushTasks();
    });

    await act(async () => {
      await expect(session.current().signIn('sana', 'wrong-password')).rejects.toMatchObject({ status: 401 });
    });
    await act(async () => {
      heldProfile.resolve(Response.json({ code: 'AUTHENTICATION_REQUIRED' }, { status: 401 }));
      await expect(olderRequest).rejects.toMatchObject({ status: 401 });
    });

    expect(session.current()).toMatchObject({ profile: null, notice: 'sessionExpired' });
  });
});

describe('sessionReducer stale-result guards', () => {
  it('suppresses a restore error that arrives while sign-in is pending', () => {
    const signingIn = sessionReducer(initialSessionState, { type: 'signin-start' });
    const restoreFailed = sessionReducer(signingIn, { type: 'restore-error', notice: 'restoreError' });
    const signedIn = sessionReducer(restoreFailed, { type: 'signin-success', profile: signedInUser, mfa: 'NOT_REQUIRED' });

    expect(restoreFailed.notice).toBeNull();
    expect(signedIn).toMatchObject({ profile: signedInUser, restoring: false, notice: null });
  });

  it('ignores a restore error that arrives after sign-in succeeded', () => {
    const signedIn = sessionReducer(
      sessionReducer(initialSessionState, { type: 'signin-start' }),
      { type: 'signin-success', profile: signedInUser, mfa: 'NOT_REQUIRED' },
    );
    const lateFailure = sessionReducer(signedIn, { type: 'restore-error', notice: 'restoreError' });

    expect(lateFailure).toMatchObject({ profile: signedInUser, restoring: false, notice: null });
  });
});

describe('sessionReducer notice lifetime', () => {
  const signedOut = sessionReducer(initialSessionState, { type: 'signout-success' });
  const accountCreated = sessionReducer(initialSessionState, { type: 'show-notice', notice: 'accountCreated' });

  it('keeps a notice while the visitor arrives on the page that shows it', () => {
    expect(sessionReducer(signedOut, { type: 'page-change', pathname: '/' }).notice).toBe('signedOut');
    expect(sessionReducer(accountCreated, { type: 'page-change', pathname: '/sign-in' }).notice).toBe('accountCreated');
  });

  it('drops a notice once the visitor moves to another page, so it is not repeated later', () => {
    const leftHome = sessionReducer(signedOut, { type: 'page-change', pathname: '/sign-in' });

    expect(leftHome.notice).toBeNull();
    expect(sessionReducer(accountCreated, { type: 'page-change', pathname: '/register' }).notice).toBeNull();
    // A later visit to the account page then asks for sign-in instead of returning home.
    expect(sessionRedirect('account', { ...leftHome, restoring: false })).toBe('/sign-in');
  });
});

describe('sessionRedirect', () => {
  const restored: SessionState = { ...initialSessionState, restoring: false };
  const signedIn: SessionState = { ...restored, profile: signedInUser, mfa: 'NOT_REQUIRED' };

  it('waits for the restore before moving anyone', () => {
    expect(sessionRedirect('account', initialSessionState)).toBeNull();
    expect(sessionRedirect('guest', { ...initialSessionState, profile: signedInUser })).toBeNull();
  });

  it('sends signed-out visitors from the account page to sign-in', () => {
    expect(sessionRedirect('account', restored)).toBe('/sign-in');
    expect(sessionRedirect('account', { ...restored, notice: 'sessionExpired' })).toBe('/sign-in');
  });

  it('keeps signed-in users on the account page, including while sign-out is pending', () => {
    expect(sessionRedirect('account', signedIn)).toBeNull();
    expect(sessionRedirect('account', { ...restored, signingOut: true })).toBeNull();
    expect(sessionRedirect('staff', { ...restored, signingOut: true })).toBeNull();
  });

  it('returns home after sign-out, whether or not the server confirmed it', () => {
    expect(sessionRedirect('account', { ...restored, notice: 'signedOut' })).toBe('/');
    expect(sessionRedirect('account', { ...restored, notice: 'signOutError' })).toBe('/');
  });

  it('sends signed-in users away from sign-in and registration', () => {
    expect(sessionRedirect('guest', signedIn)).toBe('/account');
    expect(sessionRedirect('guest', restored)).toBeNull();
  });
});

describe('sessionRedirect staff-MFA routing table', () => {
  const restored: SessionState = { ...initialSessionState, restoring: false };
  const statuses: MfaStatus[] = ['NOT_REQUIRED', 'ENROLLMENT_REQUIRED', 'VERIFICATION_REQUIRED', 'VERIFIED'];
  // Columns: no profile, then each status in the order above; null means the page stays.
  const table: Record<SessionGuard, (string | null)[]> = {
    guest: [null, '/account', '/staff/mfa/enroll', '/staff/mfa', '/staff'],
    account: ['/sign-in', null, '/staff/mfa/enroll', '/staff/mfa', null],
    'mfa-enrollment': ['/sign-in', '/account', null, '/staff/mfa', '/staff'],
    'mfa-challenge': ['/sign-in', '/account', '/staff/mfa/enroll', null, '/staff'],
    staff: ['/sign-in', '/account', '/staff/mfa/enroll', '/staff/mfa', null],
  };
  const cells = Object.entries(table).flatMap(([guard, targets]) => [
    [guard, 'no profile', targets[0]],
    ...statuses.map((status, index) => [guard, status, targets[index + 1]]),
  ]) as [SessionGuard, MfaStatus | 'no profile', string | null][];

  it.each(cells)('guard %s with %s goes to %s', (guard, status, target) => {
    const state: SessionState = status === 'no profile'
      ? restored
      : { ...restored, profile: signedInUser, mfa: status };

    expect(sessionRedirect(guard, state)).toBe(target);
    // Nothing moves while the refresh-cookie restore is still running.
    expect(sessionRedirect(guard, { ...state, restoring: true })).toBeNull();
  });

  it('sends a staff page to sign-in, not home, once sign-out finishes', () => {
    for (const guard of ['mfa-enrollment', 'mfa-challenge', 'staff'] as const) {
      expect(sessionRedirect(guard, { ...restored, notice: 'signedOut' })).toBe('/sign-in');
    }
  });
});

describe('SessionProvider staff MFA', () => {
  it('shares the MFA status from the restore and from sign-in', async () => {
    const source = createSessionSource({
      restoreSession: vi.fn().mockResolvedValue(restoredStaff('VERIFICATION_REQUIRED')),
      signIn: vi.fn().mockResolvedValue({ accessToken: 'access', user: signedInUser, mfa: 'ENROLLMENT_REQUIRED' }),
    });
    const session = await mountProvider(source);
    expect(session.current()).toMatchObject({ profile: signedInUser, mfa: 'VERIFICATION_REQUIRED' });

    await act(async () => void await session.current().signIn('sana', 'synthetic-password'));

    expect(session.current()).toMatchObject({ profile: signedInUser, mfa: 'ENROLLMENT_REQUIRED' });
  });

  it('marks the session verified and returns the backup codes after enrollment', async () => {
    const source = createSessionSource({
      restoreSession: vi.fn().mockResolvedValue(restoredStaff('ENROLLMENT_REQUIRED')),
      verifyMfaEnrollment: vi.fn().mockResolvedValue({
        accessToken: 'access-verified', user: signedInUser, mfa: 'VERIFIED', backupCodes: syntheticBackupCodes,
      }),
    });
    const session = await mountProvider(source);

    await act(async () => {
      await expect(session.current().verifyMfaEnrollment('enrollment', '287082')).resolves.toEqual(syntheticBackupCodes);
    });

    expect(source.verifyMfaEnrollment).toHaveBeenCalledWith('enrollment', '287082');
    expect(session.current()).toMatchObject({ profile: signedInUser, mfa: 'VERIFIED' });
    expect(session.current()).not.toHaveProperty('backupCodes');
  });

  it('marks the session verified after a challenge code', async () => {
    const source = createSessionSource({
      restoreSession: vi.fn().mockResolvedValue(restoredStaff('VERIFICATION_REQUIRED')),
      verifyMfa: vi.fn().mockResolvedValue({ accessToken: 'access-verified', user: signedInUser, mfa: 'VERIFIED' }),
    });
    const session = await mountProvider(source);

    await act(async () => session.current().verifyMfa('287082'));

    expect(session.current()).toMatchObject({ mfa: 'VERIFIED' });
  });

  it('keeps the restricted session when a code is rejected', async () => {
    const rejected = new ApiError('MFA_CODE_INVALID', 400);
    const session = await mountProvider(createSessionSource({
      restoreSession: vi.fn().mockResolvedValue(restoredStaff('VERIFICATION_REQUIRED')),
      verifyMfa: vi.fn().mockRejectedValue(rejected),
    }));

    await act(async () => {
      await expect(session.current().verifyMfa('000000')).rejects.toBe(rejected);
    });

    expect(session.current()).toMatchObject({ profile: signedInUser, mfa: 'VERIFICATION_REQUIRED', notice: null });
  });

  it.each([
    ['enrollment start', (session: SessionContextValue) => session.startMfaEnrollment()],
    ['enrollment verification', (session: SessionContextValue) => session.verifyMfaEnrollment('enrollment', '287082')],
    ['challenge verification', (session: SessionContextValue) => session.verifyMfa('287082')],
  ])('ends the session when the %s is unauthorized', async (_, call) => {
    const session = await mountProvider(createSessionSource({
      restoreSession: vi.fn().mockResolvedValue(restoredStaff('ENROLLMENT_REQUIRED')),
    }));

    await act(async () => {
      await expect(call(session.current())).rejects.toMatchObject({ status: 401 });
    });

    expect(session.current()).toMatchObject({ profile: null, mfa: null, notice: 'sessionExpired' });
  });

  it('clears the MFA status on sign-out', async () => {
    const session = await mountProvider(createSessionSource({ restoreSession: vi.fn().mockResolvedValue(restoredStaff('VERIFIED')) }));

    await act(async () => session.current().signOut());

    expect(session.current()).toMatchObject({ profile: null, mfa: null });
  });
});

it('keeps the reset notice only on sign-in', () => {
  const reset = sessionReducer(initialSessionState, { type: 'show-notice', notice: 'passwordReset' });
  expect(sessionReducer(reset, { type: 'page-change', pathname: '/sign-in' }).notice).toBe('passwordReset');
  for (const pathname of ['/', '/forgot-password']) expect(sessionReducer(reset, { type: 'page-change', pathname }).notice).toBeNull();
});
