import type { Metadata } from 'next';
import type { useTranslations } from 'next-intl';
import { moneyCents } from './catalog';
import type { PublicCategoryPage, PublicPrice, PublicProductDetails } from './storefront';

export type PageParam = { kind: 'page'; apiPage: number; number: number } | { kind: 'redirect' } | { kind: 'notFound' };
type StorefrontTranslator = ReturnType<typeof useTranslations<'storefront'>>;
/** Lets tests pass a plain object instead of Next's full `ProcessEnv`, which requires `NODE_ENV`. */
type SiteEnvironment = Readonly<Record<string, string | undefined>>;

const lowerCaseUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const visiblePagePattern = /^(?:[2-9]|[1-9][0-9]{1,8})$/;

export function parsePageParam(value: string | string[] | undefined): PageParam {
  if (value === undefined) return { kind: 'page', apiPage: 0, number: 1 };
  if (typeof value !== 'string') return { kind: 'notFound' };
  if (value === '1') return { kind: 'redirect' };
  if (!visiblePagePattern.test(value)) return { kind: 'notFound' };
  const number = Number(value);
  return { kind: 'page', apiPage: number - 1, number };
}

export function isPublicId(value: unknown): value is string {
  return typeof value === 'string' && lowerCaseUuid.test(value);
}

export function priceBlock(price: PublicPrice): {
  current: string;
  struck: string | null;
  badge: { kind: 'percent' | 'amount'; value: string } | null;
  mrp: string | null;
} {
  const currentMrp = price.mrp === null ? null : moneyCents(price.mrp);
  const currentPrice = moneyCents(price.price);
  return {
    current: price.price,
    struck: price.discount ? price.sellingPrice : null,
    badge: price.discount
      ? { kind: price.discount.kind === 'PERCENTAGE' ? 'percent' : 'amount', value: price.discount.value }
      : null,
    mrp: typeof currentMrp === 'bigint' && typeof currentPrice === 'bigint' && currentMrp > currentPrice ? price.mrp : null,
  };
}

export function metaDescription(text: string | null, fallback: string): string {
  const normalized = text?.replace(/\s+/g, ' ').trim() ?? '';
  if (!normalized) return fallback;
  if (normalized.length <= 160) return normalized;
  const lastUnit = normalized.charCodeAt(158);
  const prefix = normalized.slice(0, lastUnit >= 0xd800 && lastUnit <= 0xdbff ? 158 : 159);
  const boundary = prefix.lastIndexOf(' ');
  return `${(boundary > 0 ? prefix.slice(0, boundary) : prefix).trimEnd()}…`;
}

export function siteOrigin(env: SiteEnvironment = process.env): string {
  const configured = env.MEDI_WISH_SITE_URL;
  if (configured === undefined) return 'http://127.0.0.1:3000';
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error('MEDI_WISH_SITE_URL must be an HTTP origin.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('MEDI_WISH_SITE_URL must be an HTTP origin.');
  }
  return url.origin;
}

export function canonicalUrl(path: string, page?: number, env: SiteEnvironment = process.env): string {
  const url = new URL(path, `${siteOrigin(env)}/`);
  if (page !== undefined && page > 1) url.searchParams.set('page', String(page));
  return url.toString();
}

export function productMetadata(details: PublicProductDetails, t: StorefrontTranslator, env: SiteEnvironment = process.env): Metadata {
  const fallback = t('productDescriptionFallback', { name: details.name, saleUnit: details.saleUnit });
  return {
    title: details.name,
    description: metaDescription(details.description, fallback),
    alternates: { canonical: canonicalUrl(`/products/${details.id}`, undefined, env) },
  };
}

export function categoryMetadata(page: PublicCategoryPage, t: StorefrontTranslator, env: SiteEnvironment = process.env): Metadata {
  return {
    title: page.category.name,
    description: metaDescription(null, t('categoryDescription', { name: page.category.name, count: page.totalItems })),
    alternates: { canonical: canonicalUrl(`/categories/${page.category.id}`, page.page + 1, env) },
  };
}

export function categoriesMetadata(t: StorefrontTranslator, env: SiteEnvironment = process.env): Metadata {
  return {
    title: t('categoriesTitle'),
    description: t('categoriesDescription'),
    alternates: { canonical: canonicalUrl('/categories', undefined, env) },
  };
}
