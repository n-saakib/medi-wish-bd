'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useSession } from '../auth/SessionProvider';
import { useSessionRedirect } from '../auth/sessionRedirect';
import type { SessionUser } from '../lib/session';
import { loadUserProfile } from '../lib/user';
import { Alert } from '../shell/Alert';

/**
 * The signed-in user's current profile from the API, with a sign-out button. Signing out ends on the home page,
 * which announces the result; a profile request that is still unauthorized after one refresh expires the session.
 */
export function AccountSummary() {
  const t = useTranslations('account');
  const tErrors = useTranslations('errors');
  const session = useSession();
  useSessionRedirect('account');
  const { profile, authenticatedFetch } = session;
  const [account, setAccount] = useState<SessionUser | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (!profile) return;
    let current = true;
    loadUserProfile({ authenticatedFetch }).then(
      (loaded) => {
        if (current) setAccount(loaded);
      },
      () => {
        if (current) setLoadFailed(true);
      },
    );
    return () => {
      current = false;
    };
  }, [profile, authenticatedFetch]);

  if (!profile || (!account && !loadFailed)) {
    return profile || session.restoring ? <p className="muted" role="status">{t('checking')}</p> : null;
  }

  return (
    <section className="card card-pad stack" aria-labelledby="account-title">
      <h1 id="account-title">{t('title')}</h1>
      {account
        ? <dl className="dl">
          <dt>{t('username')}</dt>
          <dd>{account.username}</dd>
          <dt>{t('mobile')}</dt>
          <dd>{account.mobile}</dd>
          {account.email && <>
            <dt>{t('email')}</dt>
            <dd>{account.email}</dd>
          </>}
        </dl>
        : <Alert tone="danger">{tErrors('genericError')}</Alert>}
      {account && <div><Link className="btn btn-secondary" href="/account/profile">{t('editProfile')}</Link></div>}
      <div>
        <button className="btn btn-secondary" type="button" onClick={() => void session.signOut()} disabled={session.signingOut}>
          {session.signingOut ? t('signingOut') : t('signOut')}
        </button>
      </div>
    </section>
  );
}
