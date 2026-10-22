import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { PublicCategory } from '../lib/storefront';

export function Breadcrumb({ category }: { category: PublicCategory | null }) {
  const t = useTranslations('storefront');
  return (
    <nav className="breadcrumb" aria-label={t('breadcrumb')}>
      <Link href="/">{t('home')}</Link>
      {category && <><span aria-hidden="true">/</span><Link href={`/categories/${category.id}`}>{category.name}</Link></>}
    </nav>
  );
}
