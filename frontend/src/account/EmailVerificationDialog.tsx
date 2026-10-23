'use client';

import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { errorMessageKey } from '../lib/api';
import { AuthenticatorCodeField, authenticatorCodeDigits } from '../auth/AuthenticatorCodeField';
import { Alert } from '../shell/Alert';

type Props = {
  open: boolean; email: string; disabled: boolean;
  returnFocus(): void; onClose(): void;
  onConfirm(code: string): Promise<boolean>; onResend(): Promise<boolean>;
};

/** A native modal keeps the code and resend feedback local to the verification step. */
export function EmailVerificationDialog({ open, email, disabled, returnFocus, onClose, onConfirm, onResend }: Props) {
  const t = useTranslations('profile');
  const tErrors = useTranslations('errors');
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const submittingRef = useRef(false);
  const refocus = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [code, setCode] = useState('');
  const [feedback, setFeedback] = useState<{ tone: 'danger' | 'success'; text: string } | null>(null);
  function clear() { setCode(''); setFeedback(null); }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) {
      refocus.current = false;
      element.close(); clear(); returnFocus();
    }
  }, [open, returnFocus]);
  useEffect(() => {
    if (refocus.current && input.current && !input.current.disabled) { refocus.current = false; input.current.focus(); }
  }, [disabled, submitting, feedback]);
  function close() {
    if (submittingRef.current) return;
    clear(); onClose();
  }
  async function perform(resend: boolean) {
    if (disabled || submittingRef.current) return;
    const digits = authenticatorCodeDigits(code);
    if (!resend && !digits) {
      setFeedback({ tone: 'danger', text: t('codeFormat') }); refocus.current = true; return;
    }
    submittingRef.current = true; setSubmitting(true); setFeedback(null);
    try {
      const applied = resend ? await onResend() : await onConfirm(digits!);
      if (!mounted.current || !applied) return;
      setCode('');
      if (resend) { setFeedback({ tone: 'success', text: t('newCodeSent') }); refocus.current = true; }
      else onClose();
    } catch (reason) {
      if (mounted.current) { setCode(''); setFeedback({ tone: 'danger', text: tErrors(errorMessageKey(reason)) }); refocus.current = true; }
    } finally {
      submittingRef.current = false;
      if (mounted.current) setSubmitting(false);
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void perform(false); }
  const error = feedback?.tone === 'danger';
  return <dialog ref={dialog} className="profile-dialog" aria-labelledby="email-dialog-title"
    onCancel={(event) => { event.preventDefault(); close(); }}
    onClose={() => { if (open && !submittingRef.current && !dialog.current?.open) { clear(); onClose(); returnFocus(); } }}>
    <form className="stack" method="post" noValidate onSubmit={submit}>
      <h2 id="email-dialog-title">{t('verifyEmailTitle')}</h2>
      <p className="muted">{t('verifyEmailIntro', { email })}</p>
      {feedback && <div id="email-verification-feedback"><Alert tone={feedback.tone}>{feedback.text}</Alert></div>}
      <AuthenticatorCodeField id="email-verification-code" inputRef={input} label={t('code')} value={code}
        disabled={disabled || submitting} invalid={error} describedBy={error ? 'email-verification-feedback' : undefined}
        onChange={(value) => { setCode(value); setFeedback(null); }} />
      <div className="profile-actions">
        <button className="btn btn-ghost profile-actions-start" type="button" disabled={disabled || submitting} onClick={() => void perform(true)}>{t('sendNewCode')}</button>
        <button className="btn btn-secondary" type="button" disabled={submitting} onClick={close}>{t('cancel')}</button>
        <button className="btn btn-primary" type="submit" disabled={disabled || submitting}>{t('confirm')}</button>
      </div>
    </form>
  </dialog>;
}
