'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer } from 'react';
import { usePathname } from 'next/navigation';
import type { UserProfile } from '../lib/user';
import {
  isAuthenticated,
  restoreSession,
  signIn,
  signOut,
  type SessionClient,
} from '../lib/session';

export type SessionSource = Pick<SessionClient, 'signIn' | 'restoreSession' | 'signOut' | 'isAuthenticated'>;

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
  profile: UserProfile | null;
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
  | { type: 'restore-success'; profile: UserProfile }
  | { type: 'restore-empty'; expired: boolean }
  | { type: 'restore-error' }
  | { type: 'signin-start' }
  | { type: 'signin-success'; profile: UserProfile }
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
      return { ...state, profile: null, restoring: false, notice: action.expired ? 'sessionExpired' : state.notice };
    case 'restore-error':
      // A restore that fails after, or while, the user signs in must not report a stale failure.
      return { ...state, restoring: false, notice: state.profile || state.signingIn ? state.notice : 'restoreError' };
    case 'signin-start':
      return { ...state, signingIn: true, notice: null };
    case 'signin-success':
      return { ...state, profile: action.profile, restoring: false, signingIn: false, notice: null };
    case 'signin-error':
      return { ...state, signingIn: false };
    case 'signout-start':
      return { ...state, signingOut: true, notice: null };
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

export type SessionContextValue = SessionState & {
  signIn(identifier: string, password: string): Promise<UserProfile>;
  signOut(): Promise<void>;
  showNotice(notice: SessionNotice): void;
};

const SessionContext = createContext<SessionContextValue | null>(null);

const defaultSource: SessionSource = { signIn, restoreSession, signOut, isAuthenticated };

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
    const hadSession = source.isAuthenticated();
    void source.restoreSession()
      .then((profile) => {
        if (!mounted) return;
        dispatch(profile ? { type: 'restore-success', profile } : { type: 'restore-empty', expired: hadSession });
      })
      .catch(() => {
        if (mounted) dispatch({ type: 'restore-error' });
      });
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

  const showNotice = useCallback((notice: SessionNotice) => dispatch({ type: 'show-notice', notice }), []);

  const value = useMemo(() => ({
    ...state,
    signIn: signInWithPassword,
    signOut: signOutOfSession,
    showNotice,
  }), [state, signInWithPassword, signOutOfSession, showNotice]);

  return <SessionContext value={value}>{children}</SessionContext>;
}

export function useSession(): SessionContextValue {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession must be used inside SessionProvider');
  return session;
}
