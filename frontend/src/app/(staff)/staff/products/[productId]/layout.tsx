import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

/** Titles the Product page; the page itself is a client component, which cannot export metadata. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('catalog');
  return { title: t('editProduct') };
}
export default function ProductLayout({ children }: { children: React.ReactNode }) { return children; }
