import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { CategoryManager } from '../../../../catalog/CategoryManager';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('categories');
  return { title: t('title') };
}
export default function CategoriesPage() { return <CategoryManager />; }
