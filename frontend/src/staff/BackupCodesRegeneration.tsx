'use client';

import Link from 'next/link';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AuthenticatorCodeField, authenticatorCodeDigits } from '../auth/AuthenticatorCodeField';
import { BackupCodesPanel } from '../auth/BackupCodesPanel';
import { useSession } from '../auth/SessionProvider';
import { useSessionRedirect } from '../auth/sessionRedirect';
import { errorMessageKey } from '../lib/api';
import { Alert } from '../shell/Alert';

/** A verified staff member exchanges a fresh TOTP for ten backup codes shown only in this page view. */
export function BackupCodesRegeneration() {
  const t = useTranslations('staffMfa.regenerate');
  const mfa = useTranslations('staffMfa');
  const errors = useTranslations('errors');
  const session = useSession();
  const verified = session.profile !== null && session.mfa === 'VERIFIED';
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [feedback, setFeedback] = useState<{ text: string; locked: boolean; serial: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const serial = useRef(0);
  const displayEpoch = useRef(0);
  useSessionRedirect('staff', { enabled: !submitting && !(codes && verified) });

  useEffect(() => {
    function forgetCodes() {
      displayEpoch.current += 1;
      setCodes(null);
      setCode('');
    }
    window.addEventListener('pagehide', forgetCodes);
    return () => {
      displayEpoch.current += 1;
      window.removeEventListener('pagehide', forgetCodes);
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || feedback?.locked) return;
    const digits = authenticatorCodeDigits(code);
    if (!digits) {
      setFeedback({ text: mfa('codeFormat'), locked: false, serial: ++serial.current });
      input.current?.focus();
      return;
    }
    const epoch = displayEpoch.current;
    setSubmitting(true);
    setFeedback(null);
    try {
      const nextCodes = await session.regenerateBackupCodes(digits);
      if (epoch === displayEpoch.current) setCodes(nextCodes);
    } catch (reason) {
      const key = errorMessageKey(reason);
      if (epoch === displayEpoch.current) {
        setFeedback({ text: errors(key), locked: key === 'tooManyAttempts', serial: ++serial.current });
      }
    } finally {
      setCode('');
      setSubmitting(false);
    }
  }

  // An invalid-code retry focuses the field after the request has finished.
  useEffect(() => {
    if (feedback && !feedback.locked && !submitting) input.current?.focus();
  }, [feedback, submitting]);

  if (codes && verified) return <BackupCodesPanel codes={codes} steps={false} onSaved={() => setCodes(null)} />;
  if (!verified) return session.restoring || session.profile ? <p className="muted" role="status">{mfa('checking')}</p> : null;
  const locked = feedback?.locked ?? false;
  return <>
    <h1>{t('title')}</h1>
    <p className="muted">{t('intro')}</p>
    {feedback && <Alert key={feedback.serial} tone="danger" focusOnShow={locked}>{feedback.text}</Alert>}
    <form className="stack mt-16" method="post" onSubmit={(event) => void submit(event)}>
      <AuthenticatorCodeField id="backup-codes-code" label={t('codeLabel')} value={code}
        disabled={submitting || locked} inputRef={input} onChange={(value) => {
          setCode(value);
          if (!locked) setFeedback(null);
        }} />
      <button className="btn btn-primary btn-block" type="submit" disabled={submitting || locked}>
        {t(submitting ? 'submitting' : 'submit')}
      </button>
    </form>
    <p className="center mt-24"><Link className="btn btn-secondary" href="/staff">{t('back')}</Link></p>
  </>;
}
