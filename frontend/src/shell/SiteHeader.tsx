'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useSession } from '../auth/SessionProvider';
import { Icon } from './Icon';
import { Logo } from './Logo';

/** Store header: logo plus a Sign in link, or the signed-in username linking to the account page. */
export function SiteHeader() {
  const t = useTranslations('header');
  const { profile, restoring } = useSession();
  return (
    <header className="site-header">
      <div className="container bar">
        <Logo />
        <nav className="header-actions" aria-label={t('accountNav')}>
          {!restoring && (
            <Link className="header-link" href={profile ? '/account' : '/sign-in'}>
              <Icon name="user" /><span className="label-text">{profile ? profile.username : t('signIn')}</span>
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
