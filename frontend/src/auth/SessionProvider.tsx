'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { ApiError } from '../lib/api';
import {
  authenticatedFetch,
  restoreSession,
  signIn,
  signOut,
  startMfaEnrollment,
  verifyMfa,
  verifyMfaEnrollment,
  type MfaEnrollment,
  type MfaStatus,
  type SessionClient,
  type SessionUser,
} from '../lib/session';

export type SessionSource = Pick<SessionClient, 'signIn' | 'restoreSession' | 'signOut' | 'authenticatedFetch'
  | 'startMfaEnrollment' | 'verifyMfaEnrollment' | 'verifyMfa'>;

/** Feedback that outlives the page that caused it, until the visitor leaves the page that shows it. */
export type SessionNotice = 'sessionExpired' | 'restoreError' | 'accountCreated' | 'signedOut' | 'signOutError' | 'passwordReset';

const noticePages: Record<SessionNotice, string> = {
  sessionExpired: '/sign-in',
  restoreError: '/sign-in',
  accountCreated: '/sign-in',
  passwordReset: '/sign-in',
  signedOut: '/',
  signOutError: '/',
};

export type SessionState = {
  /** Changes when the signed-in session changes, but not on token refresh. */
  generation: number;
  profile: SessionUser | null;
  /** The session's staff-MFA status; set whenever `profile` is. */
  mfa: MfaStatus | null;
  restoring: boolean;
  signingIn: boolean;
  signingOut: boolean;
  notice: SessionNotice | null;
};

export const initialSessionState: SessionState = {
  generation: 0,
  profile: null,
  mfa: null,
  restoring: true,
  signingIn: false,
  signingOut: false,
  notice: null,
};

type SessionAction =
  | { type: 'restore-success'; profile: SessionUser; mfa: MfaStatus }
  | { type: 'restore-empty' }
  | { type: 'restore-error'; notice: 'sessionExpired' | 'restoreError' }
  | { type: 'expire' }
  | { type: 'signin-start' }
  | { type: 'signin-success'; profile: SessionUser; mfa: MfaStatus }
  | { type: 'mfa-verified'; profile: SessionUser; mfa: MfaStatus }
  | { type: 'signin-error' }
  | { type: 'signout-start' }
  | { type: 'signout-success' }
  | { type: 'signout-error' }
  | { type: 'show-notice'; notice: SessionNotice }
  | { type: 'page-change'; pathname: string | null };

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case 'restore-success':
      return { ...state, generation: state.generation + 1, profile: action.profile, mfa: action.mfa, restoring: false };
    case 'restore-empty':
      return { ...state, profile: null, mfa: null, restoring: false };
    case 'restore-error':
      // A restore that fails after, or while, the user signs in must not report a stale failure.
      return { ...state, restoring: false, notice: state.profile || state.signingIn ? state.notice : action.notice };
    case 'expire':
      return { ...state, generation: state.generation + 1, profile: null, mfa: null, notice: 'sessionExpired' };
    case 'signin-start':
      return { ...state, signingIn: true, notice: null };
    case 'signin-success':
      return { ...state, generation: state.generation + 1, profile: action.profile, mfa: action.mfa, restoring: false, signingIn: false, notice: null };
    case 'mfa-verified':
      return { ...state, generation: state.generation + 1, profile: action.profile, mfa: action.mfa };
    case 'signin-error':
      return { ...state, signingIn: false };
    case 'signout-start':
      // Only a failed sign-out's retry starts with a notice, and its alert stays until the retry settles.
      return { ...state, generation: state.generation + 1, signingOut: true };
    case 'signout-success':
      return { ...state, profile: null, mfa: null, signingOut: false, notice: 'signedOut' };
    case 'signout-error':
      // The client has already dropped its in-memory token, so the local session ends either way.
      return { ...state, profile: null, mfa: null, signingOut: false, notice: 'signOutError' };
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
  startMfaEnrollment(): Promise<MfaEnrollment>;
  /** Completes authenticator setup and returns the backup codes, which the caller shows once and then forgets. */
  verifyMfaEnrollment(enrollmentId: string, code: string): Promise<string[]>;
  verifyMfa(code: string): Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

const defaultSource: SessionSource = {
  signIn,
  restoreSession,
  signOut,
  authenticatedFetch,
  startMfaEnrollment,
  verifyMfaEnrollment,
  verifyMfa,
};

type SessionProviderProps = {
  children: React.ReactNode;
  source?: SessionSource;
};

/** Restores the refresh-cookie session once on load and shares the signed-in state across pages. */
export function SessionProvider({ children, source = defaultSource }: SessionProviderProps) {
  const [state, dispatch] = useReducer(sessionReducer, initialSessionState);
  const pathname = usePathname();
  // Counts successful sign-ins and started sign-outs, so a request started before one cannot expire the session
  // that follows it. A failed sign-in leaves the session as it was, so it does not count.
  const sessionChanges = useRef(0);

  useEffect(() => dispatch({ type: 'page-change', pathname }), [pathname]);

  useEffect(() => {
    let mounted = true;
    void source.restoreSession().then(
      (restored) => {
        if (!mounted) return;
        dispatch(restored ? { type: 'restore-success', profile: restored.user, mfa: restored.mfa } : { type: 'restore-empty' });
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
      const { user, mfa } = await source.signIn(identifier, password);
      sessionChanges.current += 1;
      dispatch({ type: 'signin-success', profile: user, mfa });
      return user;
    } catch (reason) {
      dispatch({ type: 'signin-error' });
      throw reason;
    }
  }, [source]);

  const signOutOfSession = useCallback(async () => {
    sessionChanges.current += 1;
    dispatch({ type: 'signout-start' });
    try {
      await source.signOut();
      dispatch({ type: 'signout-success' });
    } catch {
      dispatch({ type: 'signout-error' });
    }
  }, [source]);

  // A protected request that is still unauthorized after its single refresh ends the session here too.
  const expireWhenUnauthorized = useCallback(<T,>(request: () => Promise<T>): Promise<T> => {
    const changesAtStart = sessionChanges.current;
    return request().catch((reason: unknown) => {
      if (isSessionExpired(reason) && sessionChanges.current === changesAtStart) dispatch({ type: 'expire' });
      throw reason;
    });
  }, []);

  const authenticatedFetchOrExpire = useCallback<SessionClient['authenticatedFetch']>(
    (path, init, readResponse) => expireWhenUnauthorized(() => source.authenticatedFetch(path, init, readResponse)),
    [source, expireWhenUnauthorized],
  );

  const startEnrollment = useCallback(
    () => expireWhenUnauthorized(() => source.startMfaEnrollment()),
    [source, expireWhenUnauthorized],
  );

  const verifyEnrollment = useCallback(async (enrollmentId: string, code: string) => {
    const { user, mfa, backupCodes } = await expireWhenUnauthorized(() => source.verifyMfaEnrollment(enrollmentId, code));
    sessionChanges.current += 1;
    dispatch({ type: 'mfa-verified', profile: user, mfa });
    return backupCodes;
  }, [source, expireWhenUnauthorized]);

  const verifyChallenge = useCallback(async (code: string) => {
    const { user, mfa } = await expireWhenUnauthorized(() => source.verifyMfa(code));
    sessionChanges.current += 1;
    dispatch({ type: 'mfa-verified', profile: user, mfa });
  }, [source, expireWhenUnauthorized]);

  const showNotice = useCallback((notice: SessionNotice) => dispatch({ type: 'show-notice', notice }), []);

  const value = useMemo(() => ({
    ...state,
    signIn: signInWithPassword,
    signOut: signOutOfSession,
    authenticatedFetch: authenticatedFetchOrExpire,
    showNotice,
    startMfaEnrollment: startEnrollment,
    verifyMfaEnrollment: verifyEnrollment,
    verifyMfa: verifyChallenge,
  }), [state, signInWithPassword, signOutOfSession, authenticatedFetchOrExpire, showNotice, startEnrollment,
    verifyEnrollment, verifyChallenge]);

  return <SessionContext value={value}>{children}</SessionContext>;
}

export function useSession(): SessionContextValue {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession must be used inside SessionProvider');
  return session;
}
