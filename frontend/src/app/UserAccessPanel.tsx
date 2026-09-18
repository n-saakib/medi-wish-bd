'use client';

import { FormEvent, useState } from 'react';
import { useTranslations } from 'next-intl';
import { loadUserProfile, registerUser, userErrorMessage } from '../lib/user';

export function UserAccessPanel() {
  const t = useTranslations('account');
  const [registration, setRegistration] = useState({ username: '', mobile: '', email: '', password: '' });
  const [login, setLogin] = useState({ username: '', password: '' });
  const [registrationStatus, setRegistrationStatus] = useState<string | null>(null);
  const [registrationError, setRegistrationError] = useState<string | null>(null);
  const [loginStatus, setLoginStatus] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [registrationBusy, setRegistrationBusy] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);

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
      const profile = await loadUserProfile(login.username, login.password);
      setLoginStatus(t('loginSuccess', { username: profile.username }));
    } catch (reason) {
      setLoginError(userErrorMessage(reason, t));
    } finally {
      setLogin((current) => ({ ...current, password: '' }));
      setLoginBusy(false);
    }
  }

  return (
    <section className="account-panel" aria-labelledby="account-title">
      <h2 id="account-title">{t('title')}</h2>
      <p>{t('description')}</p>
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
          <p className="error" aria-live="assertive" aria-atomic="true">{registrationError ?? ''}</p>
        </form>

        <form onSubmit={submitLogin} aria-labelledby="login-title">
          <h3 id="login-title">{t('loginTitle')}</h3>
          <label htmlFor="login-username">{t('username')}</label>
          <input id="login-username" name="username" autoComplete="username" required value={login.username}
            onChange={(event) => {
              setLogin({ ...login, username: event.target.value });
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
          <button type="submit" disabled={loginBusy}>{t('loginAction')}</button>
          <p className="status" role="status" aria-live="polite" aria-atomic="true">{loginStatus ?? ''}</p>
          <p className="error" aria-live="assertive" aria-atomic="true">{loginError ?? ''}</p>
        </form>
      </div>
    </section>
  );
}
