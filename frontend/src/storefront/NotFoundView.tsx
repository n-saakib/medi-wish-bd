import Link from 'next/link';
import { useTranslations } from 'next-intl';

export function NotFoundView() {
  const t = useTranslations('storefront');
  return (
    <section className="center not-found-view">
      <h1>{t('notFoundTitle')}</h1>
      <p className="muted">{t('notFoundText')}</p>
      <Link className="btn btn-secondary" href="/">{t('goHome')}</Link>
    </section>
  );
}
