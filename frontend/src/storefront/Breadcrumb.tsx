import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { PublicCategory } from '../lib/storefront';

/** `current` marks the category link as the page being viewed (the category page itself). */
export function Breadcrumb({ category, current = false }: { category: PublicCategory | null; current?: boolean }) {
  const t = useTranslations('storefront');
  return (
    <nav className="breadcrumb" aria-label={t('breadcrumb')}>
      <Link href="/">{t('home')}</Link>
      {category && <><span aria-hidden="true">/</span>
        <Link href={`/categories/${category.id}`} aria-current={current ? 'page' : undefined}>{category.name}</Link></>}
    </nav>
  );
}
