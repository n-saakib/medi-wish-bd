import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { connection } from 'next/server';
import { CurrentCategoryMark } from '../../../storefront/CategoryNavLinks';
import { CategoryTiles } from '../../../storefront/CategoryTiles';
import { EmptyState } from '../../../storefront/EmptyState';
import { loadCategories } from '../../../storefront/loaders';
import { categoriesMetadata } from '../../../lib/storefrontView';

export async function generateMetadata(): Promise<Metadata> {
  await connection();
  return categoriesMetadata(await getTranslations('storefront'));
}

export default async function CategoriesPage() {
  await connection();
  const [categories, t] = await Promise.all([loadCategories(), getTranslations('storefront')]);
  if (categories === null) throw new Error('Public category list answered not found.');
  return (
    <main className="container page">
      <CurrentCategoryMark href="/categories" />
      <h1>{t('categoriesTitle')}</h1>
      {categories.length > 0
        ? <CategoryTiles categories={categories} />
        : <EmptyState title={t('noCategories')} text={t('noCategoriesText')} href="/" linkText={t('goHome')} />}
    </main>
  );
}
