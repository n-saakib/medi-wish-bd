import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Icon } from './Icon';

export function Logo() {
  const t = useTranslations('header');
  return (
    <Link className="logo" href="/">
      <span className="logo-mark"><Icon name="plus" /></span>
      <span>{t('brand')}</span>
    </Link>
  );
}
