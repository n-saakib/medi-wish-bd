import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { connection } from 'next/server';
import { notFound, redirect } from 'next/navigation';
import { Breadcrumb } from '../../../../storefront/Breadcrumb';
import { EmptyState } from '../../../../storefront/EmptyState';
import { Pager } from '../../../../storefront/Pager';
import { ProductCard } from '../../../../storefront/ProductCard';
import { loadCategoryPage } from '../../../../storefront/loaders';
import { categoryMetadata, isPublicId, parsePageParam } from '../../../../lib/storefrontView';

export type CategoryPageProps = {
  params: Promise<{ categoryId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function resolvePage({ params, searchParams }: CategoryPageProps) {
  await connection();
  const { categoryId } = await params;
  if (!isPublicId(categoryId)) notFound();
  const page = parsePageParam((await searchParams).page);
  if (page.kind === 'redirect') redirect(`/categories/${categoryId}`);
  if (page.kind === 'notFound') notFound();
  const data = await loadCategoryPage(categoryId, page.apiPage);
  if (!data) notFound();
  return { data, page };
}

export async function generateMetadata(props: CategoryPageProps): Promise<Metadata> {
  const { data } = await resolvePage(props);
  return categoryMetadata(data, await getTranslations('storefront'));
}

export default async function CategoryPage(props: CategoryPageProps) {
  const { data, page } = await resolvePage(props);
  const t = await getTranslations('storefront');
  const totalPages = Math.ceil(data.totalItems / data.size);
  return (
    <main className="container page">
      <Breadcrumb category={data.category} />
      <div className="section-title category-heading">
        <h1>{data.category.name}</h1>
        <p className="small muted mb-0">{t('productCount', { count: data.totalItems })}</p>
      </div>
      {data.items.length === 0
        ? <EmptyState title={t('emptyTitle')} text={t('emptyText')} href="/categories" linkText={t('browseCategories')} />
        : <div className="product-grid">{data.items.map((product) => <ProductCard key={product.id} product={product} />)}</div>}
      <Pager basePath={`/categories/${data.category.id}`} page={page.number} totalPages={totalPages} />
    </main>
  );
}
