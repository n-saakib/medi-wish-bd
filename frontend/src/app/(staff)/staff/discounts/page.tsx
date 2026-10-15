import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { DiscountManager } from '../../../../catalog/DiscountManager';
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('discounts');
  return { title: t('title') };
}
export default function DiscountsPage() { return <DiscountManager />; }
