import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { PublicCategory } from '../lib/storefront';

export function CategoryNavLinks({ categories }: { categories: PublicCategory[] }) {
  const t = useTranslations('storefront');
  if (categories.length === 0) return null;
  return (
    <nav className="catnav" aria-label={t('categoryNav')}>
      <div className="container catnav-links">
        {categories.slice(0, 8).map((category) => (
          <Link key={category.id} href={`/categories/${category.id}`}>{category.name}</Link>
        ))}
        <Link href="/categories">{t('allCategories')}</Link>
      </div>
    </nav>
  );
}
