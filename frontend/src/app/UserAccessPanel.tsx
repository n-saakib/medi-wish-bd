'use client';

import { FormEvent, useEffect, useReducer, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { registerUser, userErrorMessage, type UserProfile } from '../lib/user';
import {
  isAuthenticated,
  restoreSession,
  signIn,
  signOut,
  type SessionClient,
} from '../lib/session';

export type UserAccessPanelSession = Pick<SessionClient, 'signIn' | 'restoreSession' | 'signOut' | 'isAuthenticated'>;

type UserAccessPanelState = {
  profile: UserProfile | null;
  restoring: boolean;
  restoreError: string | null;
  sessionExpired: boolean;
  loginBusy: boolean;
  loginStatus: string | null;
  loginError: string | null;
  signOutBusy: boolean;
  signOutStatus: string | null;
  signOutError: string | null;
};

export const initialUserAccessPanelState: UserAccessPanelState = {
  profile: null,
  restoring: true,
  restoreError: null,
  sessionExpired: false,
  loginBusy: false,
  loginStatus: null,
  loginError: null,
  signOutBusy: false,
  signOutStatus: null,
  signOutError: null,
};

type UserAccessPanelAction =
  | { type: 'restore-start' }
  | { type: 'restore-success'; profile: UserProfile }
  | { type: 'restore-empty'; expired: boolean }
  | { type: 'restore-error'; message: string }
  | { type: 'login-start' }
  | { type: 'login-success'; profile: UserProfile; message: string }
  | { type: 'login-error'; message: string }
  | { type: 'login-edit' }
  | { type: 'login-finished' }
  | { type: 'signout-start' }
  | { type: 'signout-success'; message: string }
  | { type: 'signout-error'; message: string }
  | { type: 'signout-finished' };

export function userAccessPanelReducer(
  state: UserAccessPanelState,
  action: UserAccessPanelAction,
): UserAccessPanelState {
  switch (action.type) {
    case 'restore-start':
      return { ...state, restoring: true, restoreError: null };
    case 'restore-success':
      return { ...state, profile: action.profile, restoring: false, restoreError: null, sessionExpired: false };
    case 'restore-empty':
      return { ...state, profile: null, restoring: false, restoreError: null, sessionExpired: action.expired };
    case 'restore-error':
      return { ...state, restoring: false, restoreError: state.profile || state.loginBusy ? null : action.message };
    case 'login-start':
      return {
        ...state,
        loginBusy: true,
        loginStatus: null,
        loginError: null,
        restoreError: null,
        sessionExpired: false,
      };
    case 'login-success':
      return {
        ...state,
        profile: action.profile,
        restoring: false,
        loginBusy: false,
        loginStatus: action.message,
        loginError: null,
        restoreError: null,
        sessionExpired: false,
      };
    case 'login-error':
      return { ...state, loginBusy: false, loginError: action.message, loginStatus: null };
    case 'login-edit':
      return { ...state, loginError: null, loginStatus: null, sessionExpired: false };
    case 'login-finished':
      return { ...state, loginBusy: false };
    case 'signout-start':
      return { ...state, loginStatus: null, signOutBusy: true, signOutStatus: null, signOutError: null };
    case 'signout-success':
      return { ...state, profile: null, signOutBusy: false, signOutStatus: action.message, signOutError: null };
    case 'signout-error':
      return { ...state, profile: null, signOutBusy: false, signOutStatus: null, signOutError: action.message };
    case 'signout-finished':
      return { ...state, signOutBusy: false };
    default:
      return state;
  }
}

const defaultSession: UserAccessPanelSession = {
  signIn,
  restoreSession,
  signOut,
  isAuthenticated,
};

type UserAccessPanelProps = {
  session?: UserAccessPanelSession;
};

export function UserAccessPanel({ session = defaultSession }: UserAccessPanelProps = {}) {
  const t = useTranslations('account');
  const [registration, setRegistration] = useState({ username: '', mobile: '', email: '', password: '' });
  const [login, setLogin] = useState({ identifier: '', password: '' });
  const [state, dispatch] = useReducer(userAccessPanelReducer, initialUserAccessPanelState);
  const [registrationStatus, setRegistrationStatus] = useState<string | null>(null);
  const [registrationError, setRegistrationError] = useState<string | null>(null);
  const [registrationBusy, setRegistrationBusy] = useState(false);
  const loginIdentifierRef = useRef<HTMLInputElement>(null);
  const sessionStatusRef = useRef<HTMLParagraphElement>(null);
  const signOutStatusRef = useRef<HTMLParagraphElement>(null);
  const signOutErrorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    let mounted = true;
    const hadSession = session.isAuthenticated();
    dispatch({ type: 'restore-start' });
    void session.restoreSession()
      .then((restored) => {
        if (!mounted) return;
        dispatch(restored
          ? { type: 'restore-success', profile: restored }
          : { type: 'restore-empty', expired: hadSession });
      })
      .catch(() => {
        if (mounted) dispatch({ type: 'restore-error', message: t('restoreError') });
      });
    return () => {
      mounted = false;
    };
  }, [session, t]);

  useEffect(() => {
    if (state.sessionExpired) sessionStatusRef.current?.focus();
  }, [state.sessionExpired]);

  async function submitRegistration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRegistrationBusy(true);
    setRegistrationError(null);
    setRegistrationStatus(null);
    try {
      const result = await registerUser({
        username: registration.username,
        mobile: registration.mobile,
        email: registration.email || undefined,
        password: registration.password,
      });
      setRegistrationStatus(t('registrationSuccess', { username: result.username }));
    } catch (reason) {
      setRegistrationError(userErrorMessage(reason, t));
    } finally {
      setRegistration((current) => ({ ...current, password: '' }));
      setRegistrationBusy(false);
    }
  }

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    dispatch({ type: 'login-start' });
    try {
      const result = await session.signIn(login.identifier, login.password);
      dispatch({
        type: 'login-success',
        profile: result.user,
        message: t('loginSuccess', { username: result.user.username }),
      });
    } catch (reason) {
      dispatch({ type: 'login-error', message: userErrorMessage(reason, t) });
      loginIdentifierRef.current?.focus();
    } finally {
      setLogin((current) => ({ ...current, password: '' }));
      dispatch({ type: 'login-finished' });
    }
  }

  async function submitSignOut() {
    dispatch({ type: 'signout-start' });
    try {
      await session.signOut();
      dispatch({ type: 'signout-success', message: t('signedOut') });
      signOutStatusRef.current?.focus();
    } catch (reason) {
      dispatch({ type: 'signout-error', message: userErrorMessage(reason, t) });
      signOutErrorRef.current?.focus();
    } finally {
      dispatch({ type: 'signout-finished' });
    }
  }

  return (
    <section className="account-panel" aria-labelledby="account-title" aria-busy={state.restoring || state.signOutBusy}>
      <h2 id="account-title">{t('title')}</h2>
      <p>{t('description')}</p>
      {state.restoring && <p className="status" role="status" aria-live="polite">{t('restoreStatus')}</p>}
      <p id="session-status" ref={sessionStatusRef} tabIndex={-1} className="status" role="status" aria-live="polite" aria-atomic="true">
        {state.sessionExpired ? t('sessionExpired') : ''}
      </p>
      <p className="error" role="alert" aria-live="assertive" aria-atomic="true">{state.restoreError ?? ''}</p>
      {state.profile && (
        <div className="account-profile" aria-labelledby="profile-title">
          <h3 id="profile-title">{t('signedInAs', { username: state.profile.username })}</h3>
          <p>{state.profile.mobile}</p>
          {state.profile.email && <p>{state.profile.email}</p>}
          <button type="button" onClick={submitSignOut} disabled={state.signOutBusy}>
            {state.signOutBusy ? t('signingOut') : t('signOutAction')}
          </button>
        </div>
      )}
      <p ref={signOutStatusRef} tabIndex={-1} className="status" role="status" aria-live="polite" aria-atomic="true">{state.signOutStatus ?? ''}</p>
      <p ref={signOutErrorRef} tabIndex={-1} className="error" role="alert" aria-live="assertive" aria-atomic="true">{state.signOutError ?? ''}</p>
      <div className="account-grid">
        <form method="post" onSubmit={submitRegistration} aria-labelledby="register-title">
          <h3 id="register-title">{t('registerTitle')}</h3>
          <label htmlFor="register-username">{t('username')}</label>
          <input id="register-username" name="username" autoComplete="username" required value={registration.username}
            onChange={(event) => {
              setRegistration({ ...registration, username: event.target.value });
              setRegistrationError(null);
              setRegistrationStatus(null);
            }} />
          <label htmlFor="register-mobile">{t('mobile')}</label>
          <input id="register-mobile" name="mobile" type="tel" autoComplete="tel" required value={registration.mobile}
            onChange={(event) => {
              setRegistration({ ...registration, mobile: event.target.value });
              setRegistrationError(null);
              setRegistrationStatus(null);
            }} />
          <label htmlFor="register-email">{t('emailOptional')}</label>
          <input id="register-email" name="email" type="email" autoComplete="email" value={registration.email}
            onChange={(event) => {
              setRegistration({ ...registration, email: event.target.value });
              setRegistrationError(null);
              setRegistrationStatus(null);
            }} />
          <label htmlFor="register-password">{t('password')}</label>
          <input id="register-password" name="password" type="password" autoComplete="new-password" minLength={12} required value={registration.password}
            onChange={(event) => {
              setRegistration({ ...registration, password: event.target.value });
              setRegistrationError(null);
              setRegistrationStatus(null);
            }} />
          <button type="submit" disabled={registrationBusy}>{t('registerAction')}</button>
          <p className="status" role="status" aria-live="polite" aria-atomic="true">{registrationStatus ?? ''}</p>
          <p className="error" role="alert" aria-live="assertive" aria-atomic="true">{registrationError ?? ''}</p>
        </form>

        <form method="post" onSubmit={submitLogin} aria-labelledby="login-title">
          <h3 id="login-title">{t('loginTitle')}</h3>
          <label htmlFor="login-identifier">{t('identifier')}</label>
          <input ref={loginIdentifierRef} id="login-identifier" name="identifier" autoComplete="username" required value={login.identifier}
            onChange={(event) => {
              setLogin({ ...login, identifier: event.target.value });
              dispatch({ type: 'login-edit' });
            }} />
          <label htmlFor="login-password">{t('password')}</label>
          <input id="login-password" name="password" type="password" autoComplete="current-password" required value={login.password}
            onChange={(event) => {
              setLogin({ ...login, password: event.target.value });
              dispatch({ type: 'login-edit' });
            }} />
          <button type="submit" disabled={state.loginBusy}>{state.loginBusy ? t('signingIn') : t('loginAction')}</button>
          <p className="status" role="status" aria-live="polite" aria-atomic="true">{state.loginStatus ?? ''}</p>
          <p className="error" role="alert" aria-live="assertive" aria-atomic="true">{state.loginError ?? ''}</p>
        </form>
      </div>
    </section>
  );
}
