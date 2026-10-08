'use client';

import { type FormEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { errorMessageKey } from '../lib/api';
import { isMobile, isProfileEmail, isUsername } from '../lib/identifiers';
import { registerUser } from '../lib/user';
import { Alert } from '../shell/Alert';
import { useSession } from './SessionProvider';
import { useSessionRedirect } from './sessionRedirect';

const emptyRegistration = { username: '', mobile: '', email: '', password: '' };
type Field = keyof typeof emptyRegistration;

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
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Field, string>>>({});
  // The first refused field is focused once its message is linked to it.
  const focusField = useRef<Field | null>(null);

  useEffect(() => {
    if (!focusField.current) return;
    document.getElementById(`register-${focusField.current}`)?.focus();
    focusField.current = null;
  }, [fieldErrors]);

  function update(field: Field, value: string) {
    setRegistration((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
    setError(null);
  }

  /** The API's rules after its own trimming and lower-casing, so each refused field is named before sending. */
  function validate(): boolean {
    const found: Partial<Record<Field, string>> = {};
    if (!isUsername(registration.username.trim().toLowerCase())) found.username = t('usernameInvalid');
    if (!isMobile(registration.mobile.trim())) found.mobile = t('mobileInvalid');
    const email = registration.email.trim().toLowerCase();
    if (email && !isProfileEmail(email)) found.email = t('emailInvalid');
    if (!registration.password.trim() || registration.password.length < 6 || registration.password.length > 30) {
      found.password = t('passwordInvalid');
    }
    setFieldErrors(found);
    focusField.current = (Object.keys(found) as Field[])[0] ?? null;
    return focusField.current === null;
  }

  function described(field: Field, hint?: string): string | undefined {
    return [fieldErrors[field] ? `register-${field}-error` : null, hint].filter(Boolean).join(' ') || undefined;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const { username, mobile, email, password } = registration;
    setError(null);
    if (!validate()) return;
    setBusy(true);
    setError(null);
    setRegistration((current) => ({ ...current, password: '' }));
    try {
      await registerUser({ username, mobile, email: email || undefined, password });
    } catch (reason) {
      setError(tErrors(errorMessageKey(reason)));
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
      {error && <Alert tone="danger" focusOnShow>{error}</Alert>}
      {/* POST keeps credentials out of the URL if the form is submitted before hydration. noValidate lets the
          form name every refused field itself instead of the browser stopping at the first one. */}
      <form className="stack mt-16" method="post" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="register-username">{t('username')}</label>
          <input className="input" id="register-username" name="username" autoComplete="username" required
            minLength={3} maxLength={20} value={registration.username}
            aria-invalid={fieldErrors.username ? true : undefined} aria-describedby={described('username')}
            onChange={(event) => update('username', event.target.value)} />
          {fieldErrors.username && <span id="register-username-error" className="field-error">{fieldErrors.username}</span>}
        </div>
        <div className="field">
          <label htmlFor="register-mobile">{t('mobile')}</label>
          <input className="input" id="register-mobile" name="mobile" type="tel" inputMode="numeric" autoComplete="tel"
            required maxLength={11} value={registration.mobile}
            aria-invalid={fieldErrors.mobile ? true : undefined} aria-describedby={described('mobile')}
            onChange={(event) => update('mobile', event.target.value)} />
          {fieldErrors.mobile && <span id="register-mobile-error" className="field-error">{fieldErrors.mobile}</span>}
        </div>
        <div className="field">
          <label htmlFor="register-email">{t('email')} <span className="muted">{t('optional')}</span></label>
          <input className="input" id="register-email" name="email" type="email" autoComplete="email"
            maxLength={254} value={registration.email}
            aria-invalid={fieldErrors.email ? true : undefined} aria-describedby={described('email')}
            onChange={(event) => update('email', event.target.value)} />
          {fieldErrors.email && <span id="register-email-error" className="field-error">{fieldErrors.email}</span>}
        </div>
        <div className="field">
          <label htmlFor="register-password">{t('password')}</label>
          <input className="input" id="register-password" name="password" type="password" autoComplete="new-password"
            required minLength={6} maxLength={30} value={registration.password}
            aria-invalid={fieldErrors.password ? true : undefined} aria-describedby={described('password', fieldErrors.password ? undefined : 'register-password-hint')}
            onChange={(event) => update('password', event.target.value)} />
          {/* The error repeats the hint's rule, so it replaces the hint while shown. */}
          {fieldErrors.password ? <span id="register-password-error" className="field-error">{fieldErrors.password}</span>
            : <span className="hint" id="register-password-hint">{t('passwordHint')}</span>}
        </div>
        <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
          {busy ? t('submitting') : t('submit')}
        </button>
      </form>
      <p className="center small muted mt-24">{t('haveAccount')} <Link href="/sign-in">{t('signIn')}</Link></p>
    </>
  );
}
