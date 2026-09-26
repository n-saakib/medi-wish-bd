'use client';

import { useTranslations } from 'next-intl';
import { Alert } from '../shell/Alert';
import { useSession } from './SessionProvider';

/** Announces the sign-out result on the page the account page returns to, and lets a failed sign-out be retried. */
export function SignOutNotice() {
  const t = useTranslations('home');
  const tAccount = useTranslations('account');
  const { notice, signingOut, signOut } = useSession();
  if (notice === 'signedOut') return <Alert tone="success" focusOnShow>{t('signedOut')}</Alert>;
  if (notice === 'signOutError') {
    return (
      <Alert tone="danger" focusOnShow>
        {t('signOutError')}{' '}
        <button className="btn btn-secondary" type="button" onClick={() => void signOut()} disabled={signingOut}>
          {signingOut ? tAccount('signingOut') : t('tryAgain')}
        </button>
      </Alert>
    );
  }
  return null;
}
