import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ProductList } from '../../../../catalog/ProductList';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('catalog');
  return { title: t('products') };
}
export default function ProductsPage() { return <ProductList />; }
