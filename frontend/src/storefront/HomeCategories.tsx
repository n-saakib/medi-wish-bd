import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { connection } from 'next/server';
import { CategoryTiles } from './CategoryTiles';
import { categoriesOrNull } from './loaders';

export async function HomeCategories() {
  await connection();
  const categories = await categoriesOrNull();
  if (!categories?.length) return null;
  const t = await getTranslations('storefront');
  return (
    <section aria-labelledby="home-categories-title">
      <div className="section-title">
        <h2 id="home-categories-title">{t('categories')}</h2>
        <Link href="/categories">{t('seeAll')}</Link>
      </div>
      <CategoryTiles categories={categories.slice(0, 8)} />
    </section>
  );
}
