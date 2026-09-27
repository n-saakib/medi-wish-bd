'use client';

import { useTranslations } from 'next-intl';
import { useSession } from '../auth/SessionProvider';
import { Icon } from './Icon';
import { Logo } from './Logo';

/** Staff header: the logo and, once a session is known, a sign-out button. Staff navigation arrives with Ticket 48. */
export function StaffHeader() {
  const t = useTranslations('header');
  const { profile, signingOut, signOut } = useSession();
  return (
    <header className="staff-top">
      <div className="container">
        <Logo />
        {profile && (
          <button className="icon-btn" type="button" aria-label={t('signOut')} title={t('signOut')}
            onClick={() => void signOut()} disabled={signingOut}>
            <Icon name="logout" />
          </button>
        )}
      </div>
    </header>
  );
}
