'use client';

import { type FormEvent, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { errorMessageKey } from '../lib/api';
import { Alert } from '../shell/Alert';
import { authenticatorCodeDigits, AuthenticatorCodeField } from './AuthenticatorCodeField';
import { useSession } from './SessionProvider';
import { useSessionRedirect } from './sessionRedirect';

/** A message shown above the form; `serial` remounts its alert so a repeated message is announced again. */
type Feedback = { text: string; locked: boolean; serial: number } | null;

/** The authenticator code a returning staff member enters after their password. Success lands on /staff. */
export function MfaChallenge() {
  const t = useTranslations('staffMfa');
  const tErrors = useTranslations('errors');
  const session = useSession();
  useSessionRedirect('mfa-challenge');
  const [code, setCode] = useState('');
  const [feedback, setFeedbackState] = useState<Feedback>(null);
  const [submitting, setSubmitting] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);
  const feedbackSerial = useRef(0);
  const locked = feedback?.locked ?? false;

  function setFeedback(text: string, isLocked = false) {
    setFeedbackState({ text, locked: isLocked, serial: ++feedbackSerial.current });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || locked) return;
    const digits = authenticatorCodeDigits(code);
    if (!digits) {
      setFeedback(t('codeFormat'));
      codeRef.current?.focus();
      return;
    }
    setSubmitting(true);
    setFeedbackState(null);
    try {
      await session.verifyMfa(digits);
    } catch (reason) {
      const key = errorMessageKey(reason);
      if (key === 'tooManyAttempts') {
        setFeedback(tErrors(key), true);
      } else {
        setFeedback(tErrors(key));
        codeRef.current?.focus();
      }
    } finally {
      setCode('');
      setSubmitting(false);
    }
  }

  if (session.mfa !== 'VERIFICATION_REQUIRED') {
    return session.restoring || session.profile ? <p className="muted" role="status">{t('checking')}</p> : null;
  }

  return (
    <>
      <h1>{t('challengeTitle')}</h1>
      <p className="muted">{t('challengeIntro')}</p>
      {feedback && (
        <Alert key={feedback.serial} tone="danger" focusOnShow={feedback.locked}>{feedback.text}</Alert>
      )}
      <form className="stack mt-16" method="post" onSubmit={submit}>
        <AuthenticatorCodeField id="mfa-challenge-code" label={t('challengeCodeLabel')} value={code} disabled={locked}
          inputRef={codeRef} onChange={(value) => {
            setCode(value);
            if (!locked) setFeedbackState(null);
          }} />
        <button className="btn btn-primary btn-block" type="submit" disabled={submitting || locked}>
          {submitting ? t('verifying') : t('verify')}
        </button>
      </form>
      <p className="center mt-24">
        <button className="btn btn-ghost" type="button" onClick={() => void session.signOut()} disabled={session.signingOut}>
          {session.signingOut ? t('signingOut') : t('signOut')}
        </button>
      </p>
    </>
  );
}
