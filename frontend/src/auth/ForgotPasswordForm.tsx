'use client';

import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ApiError } from '../lib/api';
import { isProfileEmail } from '../lib/identifiers';
import { confirmPasswordReset, requestPasswordReset } from '../lib/passwordReset';
import { Alert } from '../shell/Alert';
import { AuthenticatorCodeField, authenticatorCodeDigits } from './AuthenticatorCodeField';
import { useSession } from './SessionProvider';
import { useSessionRedirect } from './sessionRedirect';

/** The address and secrets live only in this page's React state. */
export function ForgotPasswordForm() {
  const t = useTranslations('forgotPassword');
  const tErrors = useTranslations('errors');
  useSessionRedirect('guest');
  const session = useSession();
  const router = useRouter();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [errors, setErrors] = useState<Partial<Record<'email' | 'code' | 'password', string>>>({});
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'danger'; text: string; serial: number } | null>(null);
  const serial = useRef(0);
  const [busy, setBusy] = useState(false);
  const flight = useRef<object | null>(null);
  const mounted = useRef(true);
  const focus = useRef<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    const clear = () => { setCode(''); setNewPassword(''); };
    window.addEventListener('pagehide', clear);
    return () => { mounted.current = false; flight.current = null; window.removeEventListener('pagehide', clear); };
  }, []);
  useEffect(() => {
    if (focus.current) { document.getElementById(focus.current)?.focus(); focus.current = null; }
  }, [errors, feedback, busy]);
  function show(tone: 'success' | 'danger', text: string) {
    setFeedback({ tone, text, serial: ++serial.current });
  }
  async function send() {
    if (flight.current) return;
    if (!isProfileEmail(email.trim().toLowerCase())) {
      setErrors({ email: t('emailInvalid') }); focus.current = 'reset-email'; return;
    }
    const submittedEmail = email;
    const marker = {}; flight.current = marker; setBusy(true); setErrors({});
    try {
      await requestPasswordReset(submittedEmail);
      if (!mounted.current || flight.current !== marker) return;
      setEmail(submittedEmail); setStep('code'); setCode(''); show('success', t('codeSent'));
    } catch (reason) {
      if (mounted.current && flight.current === marker) show('danger', tErrors(step === 'email' && reason instanceof ApiError && reason.status === 400 ? 'checkDetails' : 'genericError'));
    } finally {
      if (flight.current === marker) { flight.current = null; if (mounted.current) setBusy(false); }
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (flight.current) return;
    if (step === 'email') { await send(); return; }
    const digits = authenticatorCodeDigits(code);
    const next: typeof errors = {};
    if (!digits) next.code = t('codeFormat');
    if (!newPassword.trim() || newPassword.length < 6 || newPassword.length > 30) next.password = t('passwordInvalid');
    setErrors(next);
    if (next.code || next.password) { focus.current = next.code ? 'reset-code' : 'reset-password'; return; }
    const marker = {}; flight.current = marker; setBusy(true); setFeedback(null);
    try {
      await confirmPasswordReset({ email, code: digits!, newPassword });
      if (!mounted.current || flight.current !== marker) return;
      setCode(''); setNewPassword(''); setEmail('');
      session.showNotice('passwordReset'); router.replace('/sign-in');
    } catch (reason) {
      if (!mounted.current || flight.current !== marker) return;
      const invalidCode = reason instanceof ApiError && reason.code === 'CODE_INVALID';
      const invalidRequest = reason instanceof ApiError && reason.status === 400 && reason.code === 'INVALID_REQUEST';
      show('danger', tErrors(invalidCode ? 'codeInvalid' : invalidRequest ? 'checkDetails' : 'genericError'));
      if (invalidCode || invalidRequest) { setCode(''); focus.current = 'reset-code'; }
    } finally {
      if (flight.current === marker) { flight.current = null; if (mounted.current) setBusy(false); }
    }
  }
  return <>
    <h1>{t('title')}</h1>
    {step === 'email' && <p className="muted">{t('intro')}</p>}
    {feedback && <Alert key={feedback.serial} tone={feedback.tone} focusOnShow>{feedback.text}</Alert>}
    <form className="stack mt-16" method="post" noValidate onSubmit={(event) => void submit(event)}>
      {step === 'email' ? <div className="field">
        <label htmlFor="reset-email">{t('email')}</label>
        <input className="input" id="reset-email" type="email" autoComplete="email" maxLength={254} value={email}
          aria-invalid={errors.email ? true : undefined} aria-describedby={errors.email ? 'reset-email-error' : undefined}
          onChange={(event) => { setEmail(event.target.value); setErrors({}); }} />
        {errors.email && <span className="profile-field-error" id="reset-email-error">{errors.email}</span>}
      </div> : <>
        <AuthenticatorCodeField id="reset-code" label={t('code')} value={code} invalid={Boolean(errors.code)} describedBy={errors.code ? 'reset-code-error' : undefined}
          onChange={(value) => { setCode(value); setErrors((current) => ({ ...current, code: undefined })); }} />
        {errors.code && <span className="profile-field-error" id="reset-code-error">{errors.code}</span>}
        <div className="field"><label htmlFor="reset-password">{t('newPassword')}</label>
          <input className="input" id="reset-password" type="password" autoComplete="new-password" maxLength={30}
            value={newPassword} aria-invalid={errors.password ? true : undefined}
            aria-describedby={errors.password ? 'reset-password-hint reset-password-error' : 'reset-password-hint'}
            onChange={(event) => { setNewPassword(event.target.value); setErrors((current) => ({ ...current, password: undefined })); }} />
          {errors.password && <span className="profile-field-error" id="reset-password-error">{errors.password}</span>}
          <span id="reset-password-hint" className="small muted">{t('passwordHint')}</span></div>
      </>}
      <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
        {step === 'email' ? t(busy ? 'sending' : 'sendCode') : t(busy ? 'submitting' : 'submit')}</button>
      {step === 'code' && <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => void send()}>{t('sendNewCode')}</button>}
    </form>
    <p className="center small muted mt-24">{t('help')}</p>
  </>;
}
