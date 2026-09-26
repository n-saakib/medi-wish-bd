import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Icon } from './Icon';
import { Logo } from './Logo';

/** Header for the sign-in and registration pages: logo plus a way back home. */
export function AuthHeader() {
  const t = useTranslations('header');
  return (
    <header className="auth-header">
      <div className="container">
        <Logo />
        <Link className="btn btn-ghost" href="/"><Icon name="chevronLeft" className="icon-s" /><span className="label-text">{t('backHome')}</span></Link>
      </div>
    </header>
  );
}
