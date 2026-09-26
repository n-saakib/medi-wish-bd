'use client';

import { type FormEvent, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { errorMessageKey } from '../lib/api';
import { Alert } from '../shell/Alert';
import { type SessionNotice, useSession } from './SessionProvider';
import { useSessionRedirect } from './sessionRedirect';

/** Identifier-and-password sign-in. Success lands on /account through the guest redirect. */
export function SignInForm() {
  const t = useTranslations('signIn');
  const tErrors = useTranslations('errors');
  const session = useSession();
  useSessionRedirect('guest');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const identifierRef = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await session.signIn(identifier, password);
    } catch (reason) {
      setError(tErrors(errorMessageKey(reason)));
      identifierRef.current?.focus();
    } finally {
      setPassword('');
    }
  }

  return (
    <>
      <h1>{t('title')}</h1>
      {error
        ? <Alert tone="danger">{error}</Alert>
        : <SignInNotice notice={session.notice} />}
      {/* POST keeps credentials out of the URL if the form is submitted before hydration. */}
      <form className="stack mt-16" method="post" onSubmit={submit}>
        <div className="field">
          <label htmlFor="sign-in-identifier">{t('identifier')}</label>
          <input ref={identifierRef} className="input" id="sign-in-identifier" name="identifier" autoComplete="username"
            required value={identifier} onChange={(event) => { setIdentifier(event.target.value); setError(null); }} />
        </div>
        <div className="field">
          <label htmlFor="sign-in-password">{t('password')}</label>
          <input className="input" id="sign-in-password" name="password" type="password" autoComplete="current-password"
            required value={password} onChange={(event) => { setPassword(event.target.value); setError(null); }} />
        </div>
        <button className="btn btn-primary btn-block" type="submit" disabled={session.signingIn}>
          {session.signingIn ? t('submitting') : t('submit')}
        </button>
      </form>
      <p className="center small muted mt-24">{t('newHere')} <Link href="/register">{t('createAccount')}</Link></p>
    </>
  );
}

function SignInNotice({ notice }: { notice: SessionNotice | null }) {
  const t = useTranslations('signIn');
  switch (notice) {
    case 'sessionExpired':
      return <Alert tone="warn" focusOnShow>{t('sessionExpired')}</Alert>;
    case 'restoreError':
      return <Alert tone="danger" focusOnShow>{t('restoreError')}</Alert>;
    case 'accountCreated':
      return <Alert tone="success" focusOnShow>{t('accountCreated')}</Alert>;
    default:
      return null;
  }
}
