'use client';

import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toString as renderQrSvg } from 'qrcode';
import { errorMessageKey } from '../lib/api';
import type { ContactNotice, MfaEnrollment as PendingEnrollment } from '../lib/session';
import { Alert } from '../shell/Alert';
import { authenticatorCodeDigits, AuthenticatorCodeField } from './AuthenticatorCodeField';
import { BackupCodesPanel } from './BackupCodesPanel';
import { useSession } from './SessionProvider';
import { useSessionRedirect } from './sessionRedirect';

type Setup = { enrollment: PendingEnrollment; qrSvg: string | null };

/** A message shown above the form; `serial` remounts its alert so a repeated message is announced again. */
type Feedback = { kind: 'codeFormat' | 'codeRejected' | 'restarted' | 'locked'; text: string; serial: number } | null;

/** Splits the manual key into groups of four so it is easier to type. */
function groupKey(secret: string): string {
  return secret.match(/.{1,4}/g)?.join(' ') ?? secret;
}

/** The QR image is drawn in the browser, so the secret is never sent to a QR service. */
async function drawQr(otpauthUri: string): Promise<string | null> {
  try {
    return await renderQrSvg(otpauthUri, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 });
  } catch {
    return null;
  }
}

/**
 * First-time or replacement authenticator setup for a restricted staff session: QR code and manual key, then the 6-digit code,
 * then the once-only backup codes. The secret and the codes are kept only in this component's state and are
 * dropped on unmount and whenever the page is hidden, so they never reach storage, the URL or the back/forward cache.
 */
export function MfaEnrollment() {
  const t = useTranslations('staffMfa');
  const tErrors = useTranslations('errors');
  const session = useSession();
  const { startMfaEnrollment, verifyMfaEnrollment } = session;
  const [setup, setSetup] = useState<Setup | null>(null);
  const [startFailed, setStartFailed] = useState(false);
  const [code, setCode] = useState('');
  const [feedback, setFeedbackState] = useState<Feedback>(null);
  const feedbackSerial = useRef(0);
  const [submitting, setSubmitting] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [contactNotice, setContactNotice] = useState<ContactNotice | null>(null);
  const [replacement, setReplacement] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);
  // Only the latest start request may show its secret; an older response is ignored.
  const latestStart = useRef(0);
  const displayEpoch = useRef(0);
  // The start still in flight; a StrictMode re-run of the mount effect reuses it instead of superseding it.
  const pendingStart = useRef<Promise<PendingEnrollment> | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const needsEnrollment = !session.restoring && (session.mfa === 'ENROLLMENT_REQUIRED' || session.mfa === 'REPLACEMENT_REQUIRED');
  const canShowCodes = session.profile !== null && session.mfa === 'VERIFIED';
  const needsEnrollmentRef = useRef(needsEnrollment);

  // Verification turns the session VERIFIED; the redirect waits until the backup codes are saved.
  useSessionRedirect('mfa-enrollment', { enabled: !submitting && !(backupCodes && canShowCodes) });

  const start = useCallback((reusePending = false) => {
    const request = ++latestStart.current;
    const pending = (reusePending && pendingStart.current) || startMfaEnrollment();
    pendingStart.current = pending;
    const settled = () => {
      if (pendingStart.current === pending) pendingStart.current = null;
    };
    void pending.then(settled, settled);
    void pending.then(
      async (enrollment) => {
        const qrSvg = await drawQr(enrollment.otpauthUri);
        if (request === latestStart.current) {
          setReplacement(session.mfa === 'REPLACEMENT_REQUIRED');
          setSetup({ enrollment, qrSvg });
        }
      },
      () => {
        if (request === latestStart.current) setStartFailed(true);
      },
    );
  }, [startMfaEnrollment, session.mfa]);

  useEffect(() => {
    needsEnrollmentRef.current = needsEnrollment;
    if (!needsEnrollment) return;
    start(true);
    return () => {
      latestStart.current += 1;
    };
  }, [needsEnrollment, start]);

  useEffect(() => () => { displayEpoch.current += 1; }, []);

  useEffect(() => {
    function forgetSecrets() {
      displayEpoch.current += 1;
      latestStart.current += 1;
      setSetup(null);
      setBackupCodes(null);
      setCode('');
    }
    // A page restored from the back/forward cache starts a fresh setup instead of showing the old secret.
    function restart(event: PageTransitionEvent) {
      if (event.persisted && needsEnrollmentRef.current) start();
    }
    window.addEventListener('pagehide', forgetSecrets);
    window.addEventListener('pageshow', restart);
    return () => {
      window.removeEventListener('pagehide', forgetSecrets);
      window.removeEventListener('pageshow', restart);
    };
  }, [start]);

  function setFeedback(next: Omit<NonNullable<Feedback>, 'serial'> | null) {
    setFeedbackState(next && { ...next, serial: ++feedbackSerial.current });
  }

  function retryStart() {
    setStartFailed(false);
    setSetup(null);
    start();
    // The retry button is removed, so focus returns to the heading instead of the page body.
    headingRef.current?.focus();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!setup || submitting || feedback?.kind === 'locked') return;
    const digits = authenticatorCodeDigits(code);
    if (!digits) {
      setFeedback({ kind: 'codeFormat', text: t('codeFormat') });
      codeRef.current?.focus();
      return;
    }
    const epoch = displayEpoch.current;
    setSubmitting(true);
    setFeedback(null);
    try {
      const result = await verifyMfaEnrollment(setup.enrollment.enrollmentId, digits);
      if (epoch !== displayEpoch.current) return;
      setSetup(null);
      setCode('');
      setBackupCodes(result.backupCodes);
      setContactNotice(result.contactNotice);
    } catch (reason) {
      if (epoch !== displayEpoch.current) return;
      const key = errorMessageKey(reason);
      setCode('');
      if (key === 'mfaEnrollmentStale') {
        setSetup(null);
        setFeedback({ kind: 'restarted', text: t('enrollmentRestarted') });
        start();
      } else if (key === 'tooManyAttempts') {
        setFeedback({ kind: 'locked', text: tErrors(key) });
      } else {
        setFeedback({ kind: 'codeRejected', text: tErrors(key) });
        codeRef.current?.focus();
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (backupCodes && canShowCodes) return <BackupCodesPanel codes={backupCodes}
    notice={replacement ? contactNotice : undefined} onSaved={() => setBackupCodes(null)} />;

  if (!session.profile || (!needsEnrollment && !setup)) {
    return session.restoring || session.profile ? <p className="muted" role="status">{t('checking')}</p> : null;
  }

  const locked = feedback?.kind === 'locked';
  return (
    <>
      <div className="steps-mini" aria-hidden="true"><span className="is-done" /><span /></div>
      <h1 ref={headingRef} tabIndex={-1}>{t(replacement ? 'replaceTitle' : 'enrollTitle')}</h1>
      <p className="muted">{t(replacement ? 'replaceIntro' : 'enrollIntro')}</p>
      {feedback && <EnrollmentFeedback key={feedback.serial} feedback={feedback} />}
      {startFailed
        ? <div className="mt-16 stack">
          <Alert tone="danger" focusOnShow>{tErrors('genericError')}</Alert>
          <button className="btn btn-secondary" type="button" onClick={retryStart}>{t('tryAgain')}</button>
        </div>
        : setup
          ? <div className="center mt-16">
            {setup.qrSvg && <div className="qr" role="img" aria-label={t('qrLabel')}
              dangerouslySetInnerHTML={{ __html: setup.qrSvg }} />}
            <details className="disclosure small mt-8">
              <summary>{t('cantScan')}</summary>
              <p className="mb-0">{t('manualKeyHint')}</p>
              <code className="mono">{groupKey(setup.enrollment.secret)}</code>
            </details>
          </div>
          : <p className="muted mt-16" role="status">{t('preparing')}</p>}
      <form className="stack mt-24" method="post" onSubmit={submit}>
        <AuthenticatorCodeField id="mfa-enroll-code" label={t('codeLabel')} value={code} disabled={locked}
          inputRef={codeRef} onChange={(value) => {
            setCode(value);
            if (!locked) setFeedback(null);
          }} />
        <button className="btn btn-primary btn-block" type="submit" disabled={!setup || submitting || locked}>
          {submitting ? t('verifying') : t('verify')}
        </button>
      </form>
    </>
  );
}

function EnrollmentFeedback({ feedback }: { feedback: NonNullable<Feedback> }) {
  switch (feedback.kind) {
    case 'restarted':
      return <Alert tone="warn" focusOnShow>{feedback.text}</Alert>;
    case 'locked':
      return <Alert tone="danger" focusOnShow>{feedback.text}</Alert>;
    default:
      // The code field takes focus for a retry; the alert role still announces the message.
      return <Alert tone="danger">{feedback.text}</Alert>;
  }
}
