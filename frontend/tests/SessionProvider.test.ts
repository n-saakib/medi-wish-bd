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
import { sessionRedirect } from '../src/auth/sessionRedirect';
import { createSessionSource, renderWithSession, signedInUser, unmountAll } from './renderWithSession';

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
    const session = await mountProvider(createSessionSource({ restoreSession: vi.fn().mockResolvedValue(signedInUser) }));
    expect(session.current()).toMatchObject({ profile: signedInUser, restoring: false, notice: null });
  });

  it('stays quietly signed out when no session existed', async () => {
    const session = await mountProvider();
    expect(session.current()).toMatchObject({ profile: null, restoring: false, notice: null });
  });

  it('reports an expired session only when an in-memory session was lost', async () => {
    const session = await mountProvider(createSessionSource({ isAuthenticated: vi.fn().mockReturnValue(true) }));
    expect(session.current()).toMatchObject({ profile: null, restoring: false, notice: 'sessionExpired' });
  });

  it('reports a restore failure without exposing its detail', async () => {
    const session = await mountProvider(createSessionSource({
      restoreSession: vi.fn().mockRejectedValue(new Error('private failure detail')),
    }));
    expect(session.current()).toMatchObject({ profile: null, restoring: false, notice: 'restoreError' });
  });
});

describe('SessionProvider actions', () => {
  it('signs in, shares the profile and clears an earlier notice', async () => {
    const source = createSessionSource({ isAuthenticated: vi.fn().mockReturnValue(true) });
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
    const source = createSessionSource({ restoreSession: vi.fn().mockResolvedValue(signedInUser) });
    const session = await mountProvider(source);

    await act(async () => session.current().signOut());

    expect(source.signOut).toHaveBeenCalledOnce();
    expect(session.current()).toMatchObject({ profile: null, signingOut: false, notice: 'signedOut' });
  });

  it('ends the local session and records a failure when sign-out cannot be confirmed', async () => {
    const session = await mountProvider(createSessionSource({
      restoreSession: vi.fn().mockResolvedValue(signedInUser),
      signOut: vi.fn().mockRejectedValue(new Error('private failure detail')),
    }));

    await act(async () => session.current().signOut());

    expect(session.current()).toMatchObject({ profile: null, signingOut: false, notice: 'signOutError' });
  });
});

describe('sessionReducer stale-result guards', () => {
  it('suppresses a restore error that arrives while sign-in is pending', () => {
    const signingIn = sessionReducer(initialSessionState, { type: 'signin-start' });
    const restoreFailed = sessionReducer(signingIn, { type: 'restore-error' });
    const signedIn = sessionReducer(restoreFailed, { type: 'signin-success', profile: signedInUser });

    expect(restoreFailed.notice).toBeNull();
    expect(signedIn).toMatchObject({ profile: signedInUser, restoring: false, notice: null });
  });

  it('ignores a restore error that arrives after sign-in succeeded', () => {
    const signedIn = sessionReducer(
      sessionReducer(initialSessionState, { type: 'signin-start' }),
      { type: 'signin-success', profile: signedInUser },
    );
    const lateFailure = sessionReducer(signedIn, { type: 'restore-error' });

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
  const signedIn: SessionState = { ...restored, profile: signedInUser };

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
