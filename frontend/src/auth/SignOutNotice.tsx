'use client';

import { useTranslations } from 'next-intl';
import { Alert } from '../shell/Alert';
import { useSession } from './SessionProvider';

/** Announces the sign-out result on the page the account page returns to. */
export function SignOutNotice() {
  const t = useTranslations('home');
  const { notice } = useSession();
  if (notice === 'signedOut') return <Alert tone="success" focusOnShow>{t('signedOut')}</Alert>;
  if (notice === 'signOutError') return <Alert tone="danger" focusOnShow>{t('signOutError')}</Alert>;
  return null;
}
