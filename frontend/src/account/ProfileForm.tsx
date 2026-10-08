'use client';

import { type FormEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSession } from '../auth/SessionProvider';
import { useSessionRedirect } from '../auth/sessionRedirect';
import { ApiError, errorMessageKey, type ErrorMessageKey } from '../lib/api';
import { isProfileEmail } from '../lib/identifiers';
import { cancelMobileChange, loadProfile, saveProfile, stageMobileChange, type Profile } from '../lib/profile';
import { Alert } from '../shell/Alert';
import { MobileChangeDialog } from './MobileChangeDialog';

type Draft = { fullName: string; email: string; dateOfBirth: string };
type Field = keyof Draft;
type Busy = 'load' | 'save' | 'stage' | 'cancel' | null;
type Notice = 'saved' | 'mobileChangeCancelled';

const fullNameMaxLength = 100;
const fieldIds: Record<Field, string> = {
  fullName: 'profile-full-name', email: 'profile-email', dateOfBirth: 'profile-date-of-birth',
};

function draftOf(profile: Profile): Draft {
  return { fullName: profile.fullName ?? '', email: profile.email ?? '', dateOfBirth: profile.dateOfBirth ?? '' };
}

function todayInDhaka(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** A session boundary discards the previous User's editor state and outstanding UI callbacks. */
export function ProfileForm() {
  const session = useSession();
  const t = useTranslations('profile');
  useSessionRedirect('account');
  if (!session.profile || session.signingOut || (session.mfa !== 'NOT_REQUIRED' && session.mfa !== 'VERIFIED')) {
    return session.restoring ? <p role="status" className="muted">{t('loading')}</p> : null;
  }
  return <ProfileEditor key={session.generation} />;
}

/** Edits one saved profile version while mobile commands preserve the unsaved draft. */
function ProfileEditor() {
  const t = useTranslations('profile');
  const tErrors = useTranslations('errors');
  const session = useSession();
  const authenticatedFetch = session.authenticatedFetch;
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loadedGeneration, setLoadedGeneration] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft>({ fullName: '', email: '', dateOfBirth: '' });
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<ErrorMessageKey | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Field, string>>>({});
  const [dialogOpen, setDialogOpen] = useState(false);
  const changeButton = useRef<HTMLButtonElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const focusField = useRef<Field | null>(null);
  const active = useRef(true);
  const flight = useRef<object | null>(null);
  const currentSession = useRef({ generation: session.generation, signedIn: Boolean(session.profile) });
  useLayoutEffect(() => {
    currentSession.current = { generation: session.generation, signedIn: Boolean(session.profile) && !session.signingOut };
  }, [session.generation, session.profile, session.signingOut]);

  // The first invalid field is focused after its error is linked and once it is enabled again.
  useEffect(() => {
    const input = focusField.current && document.getElementById(fieldIds[focusField.current]);
    if (!(input instanceof HTMLInputElement) || input.disabled) return;
    focusField.current = null;
    input.focus();
  }, [fieldErrors, busy]);

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; flight.current = null; };
  }, []);

  const run = useCallback(async <T,>(kind: Exclude<Busy, null>, action: () => Promise<T>,
    apply: (result: T) => void, onError?: (reason: unknown) => void): Promise<boolean> => {
    if (flight.current || !currentSession.current.signedIn) return false;
    const owner = currentSession.current.generation;
    const marker = {};
    flight.current = marker;
    setBusy(kind);
    try {
      const result = await action();
      if (active.current && flight.current === marker && currentSession.current.signedIn
        && currentSession.current.generation === owner) {
        apply(result);
        return true;
      }
      return false;
    } catch (reason) {
      if (active.current && flight.current === marker && currentSession.current.signedIn
        && currentSession.current.generation === owner) {
        if (reason instanceof ApiError && reason.code === 'ACCOUNT_CLOSING') {
          setProfile((current) => current && { ...current, accountState: 'CLOSURE_REQUESTED' });
          setDialogOpen(false);
        }
        if (onError) onError(reason);
        else setError(errorMessageKey(reason));
      }
      throw reason;
    } finally {
      if (flight.current === marker) {
        flight.current = null;
        if (active.current && currentSession.current.signedIn && currentSession.current.generation === owner) setBusy(null);
      }
    }
  }, []);

  const refresh = useCallback(async () => {
    setError(null);
    setNotice(null);
    try {
      await run('load', () => loadProfile({ authenticatedFetch }), (loaded) => {
        setProfile(loaded);
        setLoadedGeneration(session.generation);
        setDraft(draftOf(loaded));
        setFieldErrors({});
      }, (reason) => {
        setLoadedGeneration(session.generation);
        setError(errorMessageKey(reason));
      });
    } catch { /* run displays a bounded error. */ }
  }, [run, authenticatedFetch, session.generation]);

  useEffect(() => {
    if (!session.profile || session.signingOut || (session.mfa !== 'NOT_REQUIRED' && session.mfa !== 'VERIFIED')) return;
    let cancelled = false;
    void Promise.resolve().then(() => { if (!cancelled) void refresh(); });
    return () => { cancelled = true; flight.current = null; };
  }, [session.generation, session.profile, session.mfa, session.signingOut, refresh]);

  function update(field: Field, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
    setError(null);
    setNotice(null);
  }

  function validate(): boolean {
    const next: Partial<Record<Field, string>> = {};
    const name = draft.fullName.trim();
    if (name.length > fullNameMaxLength) next.fullName = t('fullNameInvalid');
    const email = draft.email.trim().toLowerCase();
    if (email && !isProfileEmail(email)) next.email = t('emailInvalid');
    const dob = draft.dateOfBirth;
    if (dob && (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || dob < '1900-01-01' || dob > todayInDhaka())) {
      next.dateOfBirth = t('dateOfBirthInvalid');
    }
    setFieldErrors(next);
    focusField.current = (Object.keys(next) as Field[])[0] ?? null;
    return focusField.current === null;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile || loadedGeneration !== session.generation || profile.accountState !== 'ACTIVE'
      || flight.current || !dirty || !validate()) return;
    setError(null);
    setNotice(null);
    try {
      await run('save', () => saveProfile({ authenticatedFetch }, {
        fullName: draft.fullName.trim() || null,
        email: draft.email.trim() || null,
        dateOfBirth: draft.dateOfBirth || null,
        version: profile.version,
      }), (updated) => {
        setProfile(updated);
        setDraft(draftOf(updated));
        setNotice('saved');
      });
    } catch { /* run displays a bounded error. */ }
  }

  async function stage(mobile: string) {
    return run('stage', () => stageMobileChange({ authenticatedFetch }, mobile), (updated) => {
      // Mobile commands return a whole profile, but another tab may have saved its fields and version.
      setProfile((current) => current && ({ ...current,
        mobile: updated.mobile, mobileVerified: updated.mobileVerified, pendingMobile: updated.pendingMobile,
      }));
      setNotice(null);
    }, (reason) => { throw reason; });
  }

  async function cancel() {
    if (!profile || loadedGeneration !== session.generation || flight.current) return;
    setError(null);
    setNotice(null);
    try {
      await run('cancel', () => cancelMobileChange({ authenticatedFetch }), () => {
        setProfile((current) => current && { ...current, pendingMobile: null });
        setNotice('mobileChangeCancelled');
      });
    } catch { /* run displays a bounded error. */ }
  }

  const shownProfile = loadedGeneration === session.generation ? profile : null;
  const dirty = shownProfile !== null && (draft.fullName !== (shownProfile.fullName ?? '')
    || draft.email !== (shownProfile.email ?? '') || draft.dateOfBirth !== (shownProfile.dateOfBirth ?? ''));
  const closing = shownProfile?.accountState === 'CLOSURE_REQUESTED';
  if (!session.profile || (session.mfa !== 'NOT_REQUIRED' && session.mfa !== 'VERIFIED')) {
    return session.restoring ? <p role="status" className="muted">{t('loading')}</p> : null;
  }
  if (loadedGeneration !== session.generation) {
    return <section className="card card-pad stack profile-card"><h1>{t('title')}</h1>
      <p role="status" className="muted">{t('loading')}</p></section>;
  }

  return (
    <section className="card card-pad stack profile-card" aria-labelledby="profile-title">
      <h1 ref={title} id="profile-title" tabIndex={-1}>{t('title')}</h1>
      {!shownProfile && !error && <p role="status" className="muted">{t('loading')}</p>}
      {notice && <Alert tone="success" focusOnShow>{t(notice)}</Alert>}
      {closing && <Alert tone="warn">{tErrors('accountClosing')}</Alert>}
      {error && !closing && <Alert tone="danger" focusOnShow>{tErrors(error)}</Alert>}
      {(error === 'staleUpdate' || (!shownProfile && error)) &&
        <button className="btn btn-secondary" type="button" disabled={busy !== null}
          onClick={() => { title.current?.focus(); void refresh(); }}>{t('reload')}</button>}
      {shownProfile && <>
        <form className="stack" method="post" onSubmit={(event) => void submit(event)} noValidate>
          <div className="field">
            <span className="profile-label">{t('username')}</span>
            <span>{shownProfile.username}</span>
          </div>
          <div className="field">
            <label htmlFor="profile-full-name">{t('fullName')}</label>
            <input className="input" id="profile-full-name" autoComplete="name" maxLength={fullNameMaxLength} value={draft.fullName}
              disabled={closing || busy === 'save'} aria-invalid={fieldErrors.fullName ? true : undefined}
              aria-describedby={fieldErrors.fullName ? 'profile-full-name-error' : undefined}
              onChange={(event) => update('fullName', event.target.value)} />
            {fieldErrors.fullName && <span id="profile-full-name-error" className="profile-field-error">{fieldErrors.fullName}</span>}
          </div>
          <div className="field">
            <span className="profile-label">{t('mobile')}</span>
            <div className="profile-mobile-row"><span>{shownProfile.mobile}</span>
              <span className={`chip ${shownProfile.mobileVerified ? 'chip-success' : 'chip-muted'}`}>
                {shownProfile.mobileVerified ? t('verified') : t('notVerified')}
              </span>
              <button ref={changeButton} className="btn btn-ghost" type="button"
                onClick={() => setDialogOpen(true)} disabled={closing || busy !== null}>{t('change')}</button>
            </div>
            {shownProfile.pendingMobile && <div className="profile-pending">
              <p>{t('pendingNote', { mobile: shownProfile.pendingMobile })}</p>
              <button className="btn btn-ghost" type="button" onClick={() => void cancel()}
                disabled={closing || busy !== null}>{t('cancelChange')}</button>
            </div>}
          </div>
          <div className="field">
            <label htmlFor="profile-email">{t('email')} <span className="muted">{t('optional')}</span></label>
            <input className="input" id="profile-email" type="email" autoComplete="email" value={draft.email}
              disabled={closing || busy === 'save'} aria-invalid={fieldErrors.email ? true : undefined}
              aria-describedby={fieldErrors.email ? 'profile-email-error' : undefined}
              onChange={(event) => update('email', event.target.value)} />
            {fieldErrors.email && <span id="profile-email-error" className="profile-field-error">{fieldErrors.email}</span>}
          </div>
          <div className="field">
            <label htmlFor="profile-date-of-birth">{t('dateOfBirth')} <span className="muted">{t('optional')}</span></label>
            <input className="input" id="profile-date-of-birth" type="date" value={draft.dateOfBirth}
              disabled={closing || busy === 'save'} aria-invalid={fieldErrors.dateOfBirth ? true : undefined}
              aria-describedby={fieldErrors.dateOfBirth ? 'profile-date-of-birth-error' : undefined}
              onChange={(event) => update('dateOfBirth', event.target.value)} />
            {fieldErrors.dateOfBirth && <span id="profile-date-of-birth-error" className="profile-field-error">{fieldErrors.dateOfBirth}</span>}
          </div>
          <button className="btn btn-primary" type="submit"
            disabled={closing || busy !== null || !dirty}>{busy === 'save' ? t('saving') : t('saveChanges')}</button>
        </form>
        <MobileChangeDialog open={dialogOpen} disabled={closing || busy !== null}
          returnFocus={() => {
            if (changeButton.current && !changeButton.current.disabled) changeButton.current.focus();
            else title.current?.focus();
          }} onClose={() => setDialogOpen(false)} onSubmit={stage} />
      </>}
    </section>
  );
}
