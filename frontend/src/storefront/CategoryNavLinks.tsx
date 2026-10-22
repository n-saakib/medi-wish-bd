'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { PublicCategory } from '../lib/storefront';

type CurrentCategory = { href: string | null; setHref: (href: string | null) => void };
const CurrentCategoryContext = createContext<CurrentCategory>({ href: null, setHref: () => {} });

/** Holds the bar destination that the rendered store page declares; not-found and error views declare none. */
export function CurrentCategoryProvider({ children }: { children: ReactNode }) {
  const [href, setHref] = useState<string | null>(null);
  return <CurrentCategoryContext value={{ href, setHref }}>{children}</CurrentCategoryContext>;
}

/** Rendered by a page that really shows a bar destination, so a 404 on the same URL marks nothing. */
export function CurrentCategoryMark({ href }: { href: string }) {
  const { setHref } = useContext(CurrentCategoryContext);
  useEffect(() => {
    setHref(href);
    return () => setHref(null);
  }, [href, setHref]);
  return null;
}

export function CategoryNavLinks({ categories }: { categories: PublicCategory[] }) {
  const t = useTranslations('storefront');
  const { href: current } = useContext(CurrentCategoryContext);
  if (categories.length === 0) return null;
  const links = [
    ...categories.slice(0, 8).map((category) => ({ href: `/categories/${category.id}`, label: category.name })),
    { href: '/categories', label: t('allCategories') },
  ];
  return (
    <nav className="catnav" aria-label={t('categoryNav')}>
      <div className="container catnav-links">
        {links.map(({ href, label }) => (
          <Link key={href} href={href} className={href === current ? 'is-active' : undefined}
            aria-current={href === current ? 'page' : undefined}>{label}</Link>
        ))}
      </div>
    </nav>
  );
}
