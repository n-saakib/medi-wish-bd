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
  onSubmit: (mobile: string) => Promise<void>;
};

/** The number is sent to the API for validation; no OTP step is available in this ticket. */
export function MobileChangeDialog({ open, disabled, returnFocus, onClose, onSubmit }: Props) {
  const t = useTranslations('profile');
  const tErrors = useTranslations('errors');
  const dialog = useRef<HTMLDialogElement>(null);
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
      element.close();
      returnFocus();
    }
  }, [open, returnFocus]);

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
      await onSubmit(mobile);
      if (!mounted.current) return;
      setMobile('');
      onClose();
    } catch (reason) {
      if (mounted.current) setError(errorMessageKey(reason));
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
        {error && <Alert tone="danger">{tErrors(error)}</Alert>}
        <div className="field">
          <label htmlFor="new-mobile">{t('newMobile')}</label>
          <input className="input" id="new-mobile" type="tel" inputMode="tel" autoComplete="tel"
            disabled={disabled || submitting} value={mobile} onChange={(event) => { setMobile(event.target.value); setError(null); }} />
        </div>
        <p className="small muted mb-0">{t('mobileExplanation')}</p>
        <div className="profile-actions">
          <button className="btn btn-secondary" type="button" onClick={close} disabled={submitting}>{t('cancel')}</button>
          <button className="btn btn-primary" type="submit" disabled={disabled || submitting}>{t('saveForVerification')}</button>
        </div>
      </form>
    </dialog>
  );
}
