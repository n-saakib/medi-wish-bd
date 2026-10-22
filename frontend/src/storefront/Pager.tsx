import Link from 'next/link';
import { useTranslations } from 'next-intl';

export function Pager({ basePath, page, totalPages }: { basePath: string; page: number; totalPages: number }) {
  const t = useTranslations('storefront');
  if (totalPages <= 1) return null;
  const pageHref = (value: number) => value === 1 ? basePath : `${basePath}?page=${value}`;
  return (
    <nav className="store-pager" aria-label={t('pagination')}>
      {page > 1 && <Link className="btn btn-secondary" href={pageHref(page - 1)} rel="prev">{t('previous')}</Link>}
      <span>{t('pageOf', { page, total: totalPages })}</span>
      {page < totalPages && <Link className="btn btn-secondary" href={pageHref(page + 1)} rel="next">{t('next')}</Link>}
    </nav>
  );
}
