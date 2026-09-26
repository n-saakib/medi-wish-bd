'use client';

import { useTranslations } from 'next-intl';
import { useSession } from '../auth/SessionProvider';
import { useSessionRedirect } from '../auth/sessionRedirect';

/** Read-only profile for the signed-in user. Signing out ends on the home page, which announces the result. */
export function AccountSummary() {
  const t = useTranslations('account');
  const session = useSession();
  useSessionRedirect('account');
  const { profile } = session;

  if (!profile) {
    return session.restoring ? <p className="muted" role="status">{t('checking')}</p> : null;
  }

  return (
    <section className="card card-pad stack" aria-labelledby="account-title">
      <h1 id="account-title">{t('title')}</h1>
      <dl className="dl">
        <dt>{t('username')}</dt>
        <dd>{profile.username}</dd>
        <dt>{t('mobile')}</dt>
        <dd>{profile.mobile}</dd>
        {profile.email && <>
          <dt>{t('email')}</dt>
          <dd>{profile.email}</dd>
        </>}
      </dl>
      <div>
        <button className="btn btn-secondary" type="button" onClick={() => void session.signOut()} disabled={session.signingOut}>
          {session.signingOut ? t('signingOut') : t('signOut')}
        </button>
      </div>
    </section>
  );
}
