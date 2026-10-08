'use client';

import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { errorMessageKey } from '../lib/api';
import { Alert } from '../shell/Alert';

type Props = {
  open: boolean;
  disabled: boolean;
  returnFocus: () => void;
  onClose: () => void;
  onSubmit: (mobile: string) => Promise<boolean>;
};

/** The number is sent to the API for validation; no OTP step is available in this ticket. */
export function MobileChangeDialog({ open, disabled, returnFocus, onClose, onSubmit }: Props) {
  const t = useTranslations('profile');
  const tErrors = useTranslations('errors');
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const refocus = useRef(false);
  const [mobile, setMobile] = useState('');
  const [error, setError] = useState<ReturnType<typeof errorMessageKey> | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) {
      refocus.current = false;
      element.close();
      returnFocus();
    }
  }, [open, returnFocus]);

  // A refused number returns focus to the input once it is enabled again, so its linked error is reachable.
  useEffect(() => {
    if (!refocus.current || !input.current || input.current.disabled) return;
    refocus.current = false;
    input.current.focus();
  }, [submitting, disabled]);

  function close() {
    if (submittingRef.current) return;
    setError(null);
    setMobile('');
    onClose();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const staged = await onSubmit(mobile);
      if (!mounted.current || !staged) return;
      setMobile('');
      onClose();
    } catch (reason) {
      if (mounted.current) {
        setError(errorMessageKey(reason));
        refocus.current = true;
      }
    } finally {
      submittingRef.current = false;
      if (mounted.current) setSubmitting(false);
    }
  }

  return (
    <dialog ref={dialog} className="profile-dialog" aria-labelledby="mobile-dialog-title"
      onCancel={(event) => { event.preventDefault(); close(); }}
      onClose={() => { if (open && !submittingRef.current) { onClose(); returnFocus(); } }}>
      <form method="post" onSubmit={(event) => void submit(event)} noValidate className="stack">
        <h2 id="mobile-dialog-title">{t('changeMobileTitle')}</h2>
        {error && <div id="new-mobile-error"><Alert tone="danger">{tErrors(error)}</Alert></div>}
        <div className="field">
          <label htmlFor="new-mobile">{t('newMobile')}</label>
          <input ref={input} className="input" id="new-mobile" type="tel" inputMode="tel" autoComplete="tel"
            aria-invalid={error ? true : undefined} aria-describedby={error ? 'new-mobile-hint new-mobile-error' : 'new-mobile-hint'}
            disabled={disabled || submitting} value={mobile} onChange={(event) => { setMobile(event.target.value); setError(null); }} />
        </div>
        <p id="new-mobile-hint" className="small muted mb-0">{t('mobileHint')}</p>
        <p className="small muted mb-0">{t('mobileExplanation')}</p>
        <div className="profile-actions">
          <button className="btn btn-secondary" type="button" onClick={close} disabled={submitting}>{t('cancel')}</button>
          <button className="btn btn-primary" type="submit" disabled={disabled || submitting}>{t('saveForVerification')}</button>
        </div>
      </form>
    </dialog>
  );
}
