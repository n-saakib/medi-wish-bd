import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { PublicCategory } from '../lib/storefront';

/** `current` marks the category link on its own listing: `page` on page 1, `true` on later pages, which it does not open. */
export function Breadcrumb({ category, current }: { category: PublicCategory | null; current?: 'page' | 'true' }) {
  const t = useTranslations('storefront');
  return (
    <nav className="breadcrumb storefront-breadcrumb" aria-label={t('breadcrumb')}>
      <Link href="/">{t('home')}</Link>
      {category && <><span aria-hidden="true">/</span>
        <Link href={`/categories/${category.id}`} aria-current={current}>{category.name}</Link></>}
    </nav>
  );
}
