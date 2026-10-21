'use client';

import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { errorMessageKey } from '../lib/api';
import { Alert } from '../shell/Alert';
import { Icon } from '../shell/Icon';
import { backupCodeInput } from './backupCode';
import { useSession } from './SessionProvider';

type Props = { open: boolean; onClose(): void; returnFocus(): void };

/** Password-bound recovery with a once-only backup code; success continues to new-authenticator setup. */
export function BackupCodeDialog({ open, onClose, returnFocus }: Props) {
  const t = useTranslations('staffMfa');
  const errors = useTranslations('errors');
  const session = useSession();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const flight = useRef(false);
  const serial = useRef(0);
  const [code, setCode] = useState('');
  const [feedback, setFeedback] = useState<{ text: string; locked: boolean; serial: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const locked = feedback?.locked ?? false;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      element.showModal();
      input.current?.focus();
    }
    if (!open && element.open) {
      element.close();
      returnFocus();
    }
  }, [open, returnFocus]);

  // The request disables the field; refocus only after it is available for another attempt.
  useEffect(() => {
    if (feedback && !locked && !submitting) input.current?.focus();
  }, [feedback, locked, submitting]);

  function close() {
    if (flight.current) return;
    setCode('');
    setFeedback(null);
    onClose();
  }

  function trapFocus(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== 'Tab') return;
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled), [tabindex="0"]')];
    const first = controls[0];
    const last = controls.at(-1);
    if ((!event.shiftKey && document.activeElement === last) || (event.shiftKey && document.activeElement === first)) {
      event.preventDefault();
      (event.shiftKey ? last : first)?.focus();
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (flight.current || locked) return;
    const normalized = backupCodeInput(code);
    if (!normalized) {
      setFeedback({ text: t('backupCodeFormat'), locked: false, serial: ++serial.current });
      input.current?.focus();
      return;
    }
    flight.current = true;
    setSubmitting(true);
    setFeedback(null);
    try {
      await session.redeemBackupCode(normalized);
    } catch (reason) {
      if (mounted.current) {
        const key = errorMessageKey(reason);
        setFeedback({ text: errors(key), locked: key === 'tooManyAttempts', serial: ++serial.current });
      }
    } finally {
      flight.current = false;
      if (mounted.current) {
        setCode('');
        setSubmitting(false);
      }
    }
  }

  return <dialog ref={dialog} className="profile-dialog" aria-labelledby="backup-dialog-title"
    onKeyDown={trapFocus} onCancel={(event) => { event.preventDefault(); close(); }}
    // A delayed close event from a previous opening must not close the reopened dialog.
    onClose={() => { if (open && !flight.current && !dialog.current?.open) { close(); returnFocus(); } }}>
    <div className="row-between">
      <h2 id="backup-dialog-title">{t('backupDialogTitle')}</h2>
      <button type="button" className="icon-btn" aria-label={t('close')} onClick={close} disabled={submitting}><Icon name="x" /></button>
    </div>
    <form className="stack" method="post" noValidate onSubmit={(event) => void submit(event)}>
      <div className="field">
        <label htmlFor="backup-code">{t('backupCodeLabel')}</label>
        <input ref={input} id="backup-code" className="input mono" value={code} autoComplete="off"
          spellCheck={false} autoCapitalize="characters" placeholder={t('backupCodePlaceholder')}
          aria-invalid={feedback ? true : undefined}
          aria-describedby={feedback ? 'backup-code-hint backup-code-error' : 'backup-code-hint'}
          disabled={submitting || locked} onChange={(event) => { setCode(event.target.value); if (!locked) setFeedback(null); }} />
      </div>
      <p id="backup-code-hint" className="small muted mb-0">{t('backupDialogHint')}</p>
      {feedback && <div id="backup-code-error"><Alert key={feedback.serial} tone="danger" focusOnShow={locked}>{feedback.text}</Alert></div>}
      <div className="profile-actions">
        <button className="btn btn-secondary" type="button" disabled={submitting} onClick={close}>{t('cancel')}</button>
        <button className="btn btn-primary" type="submit" disabled={submitting || locked}>{t(submitting ? 'continuing' : 'continue')}</button>
      </div>
    </form>
  </dialog>;
}
