'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { registerUser, userErrorMessage, type UserProfile } from '../lib/user';
import { restoreSession, signIn, signOut } from '../lib/session';

export function UserAccessPanel() {
  const t = useTranslations('account');
  const [registration, setRegistration] = useState({ username: '', mobile: '', email: '', password: '' });
  const [login, setLogin] = useState({ identifier: '', password: '' });
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [registrationStatus, setRegistrationStatus] = useState<string | null>(null);
  const [registrationError, setRegistrationError] = useState<string | null>(null);
  const [loginStatus, setLoginStatus] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [registrationBusy, setRegistrationBusy] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const restoreStarted = useRef(false);

  useEffect(() => {
    if (restoreStarted.current) return;
    restoreStarted.current = true;
    let mounted = true;
    void restoreSession()
      .then((restored) => {
        if (mounted && restored) setProfile(restored);
      })
      .catch(() => {
        // A reload without a session is normal; the sign-in form remains available.
      })
      .finally(() => {
        if (mounted) setRestoring(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

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
    setLoginBusy(true);
    setLoginError(null);
    setLoginStatus(null);
    try {
      const session = await signIn(login.identifier, login.password);
      setProfile(session.user);
      setLoginStatus(t('loginSuccess', { username: session.user.username }));
    } catch (reason) {
      setLoginError(userErrorMessage(reason, t));
    } finally {
      setLogin((current) => ({ ...current, password: '' }));
      setLoginBusy(false);
    }
  }

  async function submitSignOut() {
    setSignOutBusy(true);
    setLoginError(null);
    try {
      await signOut();
      setProfile(null);
      setLoginStatus(t('signedOut'));
    } catch (reason) {
      setProfile(null);
      setLoginError(userErrorMessage(reason, t));
    } finally {
      setSignOutBusy(false);
    }
  }

  return (
    <section className="account-panel" aria-labelledby="account-title" aria-busy={restoring}>
      <h2 id="account-title">{t('title')}</h2>
      <p>{t('description')}</p>
      {restoring && <p className="status" role="status" aria-live="polite">{t('restoreStatus')}</p>}
      {profile && (
        <div className="account-profile" aria-labelledby="profile-title">
          <h3 id="profile-title">{t('signedInAs', { username: profile.username })}</h3>
          <p>{profile.mobile}</p>
          {profile.email && <p>{profile.email}</p>}
          <button type="button" onClick={submitSignOut} disabled={signOutBusy}>
            {signOutBusy ? t('signingOut') : t('signOutAction')}
          </button>
        </div>
      )}
      <div className="account-grid">
        <form onSubmit={submitRegistration} aria-labelledby="register-title">
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

        <form onSubmit={submitLogin} aria-labelledby="login-title">
          <h3 id="login-title">{t('loginTitle')}</h3>
          <label htmlFor="login-identifier">{t('identifier')}</label>
          <input id="login-identifier" name="identifier" autoComplete="username" required value={login.identifier}
            onChange={(event) => {
              setLogin({ ...login, identifier: event.target.value });
              setLoginError(null);
              setLoginStatus(null);
            }} />
          <label htmlFor="login-password">{t('password')}</label>
          <input id="login-password" name="password" type="password" autoComplete="current-password" required value={login.password}
            onChange={(event) => {
              setLogin({ ...login, password: event.target.value });
              setLoginError(null);
              setLoginStatus(null);
            }} />
          <button type="submit" disabled={loginBusy}>{loginBusy ? t('signingIn') : t('loginAction')}</button>
          <p className="status" role="status" aria-live="polite" aria-atomic="true">{loginStatus ?? ''}</p>
          <p className="error" role="alert" aria-live="assertive" aria-atomic="true">{loginError ?? ''}</p>
        </form>
      </div>
    </section>
  );
}
