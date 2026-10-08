import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ProductEditor } from '../../../../../catalog/ProductEditor';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('catalog');
  return { title: t('newProduct') };
}
export default function NewProductPage() { return <ProductEditor />; }
