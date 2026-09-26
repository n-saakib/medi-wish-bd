'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer } from 'react';
import { usePathname } from 'next/navigation';
import { ApiError } from '../lib/api';
import {
  authenticatedFetch,
  restoreSession,
  signIn,
  signOut,
  type SessionClient,
  type SessionUser,
} from '../lib/session';

export type SessionSource = Pick<SessionClient, 'signIn' | 'restoreSession' | 'signOut' | 'authenticatedFetch'>;

/** Feedback that outlives the page that caused it, until the visitor leaves the page that shows it. */
export type SessionNotice = 'sessionExpired' | 'restoreError' | 'accountCreated' | 'signedOut' | 'signOutError';

const noticePages: Record<SessionNotice, string> = {
  sessionExpired: '/sign-in',
  restoreError: '/sign-in',
  accountCreated: '/sign-in',
  signedOut: '/',
  signOutError: '/',
};

export type SessionState = {
  profile: SessionUser | null;
  restoring: boolean;
  signingIn: boolean;
  signingOut: boolean;
  notice: SessionNotice | null;
};

export const initialSessionState: SessionState = {
  profile: null,
  restoring: true,
  signingIn: false,
  signingOut: false,
  notice: null,
};

type SessionAction =
  | { type: 'restore-success'; profile: SessionUser }
  | { type: 'restore-empty' }
  | { type: 'restore-error'; notice: 'sessionExpired' | 'restoreError' }
  | { type: 'expire' }
  | { type: 'signin-start' }
  | { type: 'signin-success'; profile: SessionUser }
  | { type: 'signin-error' }
  | { type: 'signout-start' }
  | { type: 'signout-success' }
  | { type: 'signout-error' }
  | { type: 'show-notice'; notice: SessionNotice }
  | { type: 'page-change'; pathname: string | null };

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case 'restore-success':
      return { ...state, profile: action.profile, restoring: false };
    case 'restore-empty':
      return { ...state, profile: null, restoring: false };
    case 'restore-error':
      // A restore that fails after, or while, the user signs in must not report a stale failure.
      return { ...state, restoring: false, notice: state.profile || state.signingIn ? state.notice : action.notice };
    case 'expire':
      return { ...state, profile: null, notice: 'sessionExpired' };
    case 'signin-start':
      return { ...state, signingIn: true, notice: null };
    case 'signin-success':
      return { ...state, profile: action.profile, restoring: false, signingIn: false, notice: null };
    case 'signin-error':
      return { ...state, signingIn: false };
    case 'signout-start':
      // Only a failed sign-out's retry starts with a notice, and its alert stays until the retry settles.
      return { ...state, signingOut: true };
    case 'signout-success':
      return { ...state, profile: null, signingOut: false, notice: 'signedOut' };
    case 'signout-error':
      // The client has already dropped its in-memory token, so the local session ends either way.
      return { ...state, profile: null, signingOut: false, notice: 'signOutError' };
    case 'show-notice':
      return { ...state, notice: action.notice };
    case 'page-change':
      // Arriving on the notice's page shows it; any other page drops it so it is not repeated later.
      return state.notice && noticePages[state.notice] !== action.pathname ? { ...state, notice: null } : state;
    default:
      return state;
  }
}

/** A 401 from the API means the refresh cookie, or the session behind it, is no longer accepted. */
function isSessionExpired(reason: unknown): boolean {
  return reason instanceof ApiError && reason.status === 401;
}

export type SessionContextValue = SessionState & Pick<SessionClient, 'authenticatedFetch'> & {
  signIn(identifier: string, password: string): Promise<SessionUser>;
  signOut(): Promise<void>;
  showNotice(notice: SessionNotice): void;
};

const SessionContext = createContext<SessionContextValue | null>(null);

const defaultSource: SessionSource = { signIn, restoreSession, signOut, authenticatedFetch };

type SessionProviderProps = {
  children: React.ReactNode;
  source?: SessionSource;
};

/** Restores the refresh-cookie session once on load and shares the signed-in state across pages. */
export function SessionProvider({ children, source = defaultSource }: SessionProviderProps) {
  const [state, dispatch] = useReducer(sessionReducer, initialSessionState);
  const pathname = usePathname();

  useEffect(() => dispatch({ type: 'page-change', pathname }), [pathname]);

  useEffect(() => {
    let mounted = true;
    void source.restoreSession().then(
      (profile) => {
        if (mounted) dispatch(profile ? { type: 'restore-success', profile } : { type: 'restore-empty' });
      },
      (reason: unknown) => {
        if (mounted) dispatch({ type: 'restore-error', notice: isSessionExpired(reason) ? 'sessionExpired' : 'restoreError' });
      },
    );
    return () => {
      mounted = false;
    };
  }, [source]);

  const signInWithPassword = useCallback(async (identifier: string, password: string) => {
    dispatch({ type: 'signin-start' });
    try {
      const { user } = await source.signIn(identifier, password);
      dispatch({ type: 'signin-success', profile: user });
      return user;
    } catch (reason) {
      dispatch({ type: 'signin-error' });
      throw reason;
    }
  }, [source]);

  const signOutOfSession = useCallback(async () => {
    dispatch({ type: 'signout-start' });
    try {
      await source.signOut();
      dispatch({ type: 'signout-success' });
    } catch {
      dispatch({ type: 'signout-error' });
    }
  }, [source]);

  // A protected request that is still unauthorized after its single refresh ends the session here too.
  const authenticatedFetchOrExpire = useCallback<SessionClient['authenticatedFetch']>(
    (path, init, readResponse) => source.authenticatedFetch(path, init, readResponse).catch((reason: unknown) => {
      if (isSessionExpired(reason)) dispatch({ type: 'expire' });
      throw reason;
    }),
    [source],
  );

  const showNotice = useCallback((notice: SessionNotice) => dispatch({ type: 'show-notice', notice }), []);

  const value = useMemo(() => ({
    ...state,
    signIn: signInWithPassword,
    signOut: signOutOfSession,
    authenticatedFetch: authenticatedFetchOrExpire,
    showNotice,
  }), [state, signInWithPassword, signOutOfSession, authenticatedFetchOrExpire, showNotice]);

  return <SessionContext value={value}>{children}</SessionContext>;
}

export function useSession(): SessionContextValue {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession must be used inside SessionProvider');
  return session;
}
