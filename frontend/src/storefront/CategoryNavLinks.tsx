'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { PublicCategory } from '../lib/storefront';

/** `page` when the page is that bar destination itself; `true` when it only belongs to it (a later page or a Product). */
export type CurrentMark = { href: string; current?: 'page' | 'true' };
type CurrentCategory = { mark: CurrentMark | null; setMark: (mark: CurrentMark | null) => void };
const CurrentCategoryContext = createContext<CurrentCategory>({ mark: null, setMark: () => {} });

/** Holds the bar destination that the rendered store page declares; not-found and error views declare none. */
export function CurrentCategoryProvider({ children }: { children: ReactNode }) {
  const [mark, setMark] = useState<CurrentMark | null>(null);
  return <CurrentCategoryContext value={{ mark, setMark }}>{children}</CurrentCategoryContext>;
}

/** Rendered by a page that really shows a bar destination, so a 404 on the same URL marks nothing. */
export function CurrentCategoryMark({ href, current = 'page' }: CurrentMark) {
  const { setMark } = useContext(CurrentCategoryContext);
  useEffect(() => {
    setMark({ href, current });
    return () => setMark(null);
  }, [href, current, setMark]);
  return null;
}

export function CategoryNavLinks({ categories }: { categories: PublicCategory[] }) {
  const t = useTranslations('storefront');
  const { mark } = useContext(CurrentCategoryContext);
  if (categories.length === 0) return null;
  const links = [
    ...categories.slice(0, 8).map((category) => ({ href: `/categories/${category.id}`, label: category.name })),
    { href: '/categories', label: t('allCategories') },
  ];
  return (
    <nav className="catnav" aria-label={t('categoryNav')}>
      <div className="container catnav-links">
        {links.map(({ href, label }) => (
          <Link key={href} href={href} className={href === mark?.href ? 'is-active' : undefined}
            aria-current={href === mark?.href ? mark.current : undefined}>{label}</Link>
        ))}
      </div>
    </nav>
  );
}
