'use client';

import { type FormEvent, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { registerUser, UserApiError, userErrorMessage } from '../lib/user';
import { Alert } from '../shell/Alert';
import { useSession } from './SessionProvider';
import { useSessionRedirect } from './sessionRedirect';

const emptyRegistration = { username: '', mobile: '', email: '', password: '' };

/**
 * Registers, then signs in with the same credentials so the guest redirect opens /account.
 * If that sign-in fails, the account still exists, so the visitor is sent to /sign-in instead.
 */
export function RegistrationForm() {
  const t = useTranslations('register');
  const tErrors = useTranslations('errors');
  const session = useSession();
  const router = useRouter();
  useSessionRedirect('guest');
  const [registration, setRegistration] = useState(emptyRegistration);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update(field: keyof typeof emptyRegistration, value: string) {
    setRegistration((current) => ({ ...current, [field]: value }));
    setError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const { username, mobile, email, password } = registration;
    setBusy(true);
    setError(null);
    setRegistration((current) => ({ ...current, password: '' }));
    try {
      await registerUser({ username, mobile, email: email || undefined, password });
    } catch (reason) {
      setError(reason instanceof UserApiError && reason.code === 'INVALID_REQUEST'
        ? t('invalid')
        : userErrorMessage(reason, tErrors));
      setBusy(false);
      return;
    }
    try {
      await session.signIn(username, password);
    } catch {
      session.showNotice('accountCreated');
      router.replace('/sign-in');
    }
  }

  return (
    <>
      <h1>{t('title')}</h1>
      {error && <Alert tone="danger">{error}</Alert>}
      {/* POST keeps credentials out of the URL if the form is submitted before hydration. */}
      <form className="stack mt-16" method="post" onSubmit={submit}>
        <div className="field">
          <label htmlFor="register-username">{t('username')}</label>
          <input className="input" id="register-username" name="username" autoComplete="username" required
            minLength={3} maxLength={50} value={registration.username}
            onChange={(event) => update('username', event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="register-mobile">{t('mobile')}</label>
          <input className="input" id="register-mobile" name="mobile" type="tel" inputMode="tel" autoComplete="tel"
            required maxLength={30} value={registration.mobile}
            onChange={(event) => update('mobile', event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="register-email">{t('email')} <span className="muted">{t('optional')}</span></label>
          <input className="input" id="register-email" name="email" type="email" autoComplete="email"
            maxLength={320} value={registration.email}
            onChange={(event) => update('email', event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="register-password">{t('password')}</label>
          <input className="input" id="register-password" name="password" type="password" autoComplete="new-password"
            required minLength={12} maxLength={128} aria-describedby="register-password-hint" value={registration.password}
            onChange={(event) => update('password', event.target.value)} />
          <span className="hint" id="register-password-hint">{t('passwordHint')}</span>
        </div>
        <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
          {busy ? t('submitting') : t('submit')}
        </button>
      </form>
      <p className="center small muted mt-24">{t('haveAccount')} <Link href="/sign-in">{t('signIn')}</Link></p>
    </>
  );
}
