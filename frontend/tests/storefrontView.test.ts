import { describe, expect, it } from 'vitest';
import type { PublicCategoryPage, PublicProductDetails } from '../src/lib/storefront';
import {
  canonicalUrl,
  categoryMetadata,
  categoriesMetadata,
  isPublicId,
  metaDescription,
  parsePageParam,
  priceBlock,
  productMetadata,
  siteOrigin,
} from '../src/lib/storefrontView';

const productId = '7d1c3a90-2b8e-4c7f-9e11-0a4b5c6d7e01';
const categoryPage: PublicCategoryPage = {
  category: { id: '5f0e1b7a-9a7d-4f0f-8c33-2a7f6c9d2b02', name: 'Fever & pain' },
  items: [], page: 1, size: 24, totalItems: 25,
};
const product: PublicProductDetails = {
  id: productId, name: 'Amoxil-D 500', brandName: 'Amoxil-D', genericName: 'Amoxicillin 500 mg', dosageForm: 'Capsule',
  manufacturer: 'Meghna Labs', saleUnit: 'Strip of 10 capsules', description: null, requireValidation: true,
  category: null, images: [],
  price: { sellingPrice: '150.00', mrp: '160.00', price: '135.00', saving: '15.00', discount: { targetType: 'CATEGORY', kind: 'PERCENTAGE', value: '10' } },
};
const t = ((key: string, values?: Record<string, string | number>) => {
  if (key === 'productDescriptionFallback') return `${values?.name}, ${values?.saleUnit} at Medi Wish.`;
  if (key === 'categoryDescription') return `${values?.name} at Medi Wish: ${values?.count} products.`;
  return key;
}) as never;

describe('storefront route and price projections', () => {
  it.each([
    [undefined, { kind: 'page', apiPage: 0, number: 1 }],
    ['1', { kind: 'redirect' }],
    ['2', { kind: 'page', apiPage: 1, number: 2 }],
    ['999999999', { kind: 'page', apiPage: 999999998, number: 999999999 }],
  ])('maps page query %j', (value, expected) => expect(parsePageParam(value)).toEqual(expected));

  it.each(['0', '-1', '01', '1.5', '1e2', 'abc', '', ' 2', '1000000000', ['2', '3']])(
    'rejects page query %j', (value) => expect(parsePageParam(value)).toEqual({ kind: 'notFound' }),
  );

  it('accepts only lower-case UUID path parameters', () => {
    expect(isPublicId(productId)).toBe(true);
    expect(isPublicId(productId.toUpperCase())).toBe(false);
    expect(isPublicId(`{${productId}}`)).toBe(false);
    expect(isPublicId(productId.slice(1))).toBe(false);
  });

  it('derives discount, struck price and MRP using exact minor units', () => {
    const regular = { sellingPrice: '10.00', mrp: '10.00', price: '10.00', saving: '0.00', discount: null };
    expect(priceBlock(regular)).toEqual({ current: '10.00', struck: null, badge: null, mrp: null });
    expect(priceBlock({ ...regular, sellingPrice: '150.00', price: '135.00', mrp: '160.00', discount: { targetType: 'CATEGORY', kind: 'PERCENTAGE', value: '10' } }))
      .toEqual({ current: '135.00', struck: '150.00', badge: { kind: 'percent', value: '10' }, mrp: '160.00' });
    expect(priceBlock({ ...regular, sellingPrice: '150.00', price: '135.00', discount: { targetType: 'PRODUCT', kind: 'FLAT', value: '15.00' } }).badge)
      .toEqual({ kind: 'amount', value: '15.00' });
    expect(priceBlock({ ...regular, price: '999.99', mrp: '1000.00' }).mrp).toBe('1000.00');
    expect(priceBlock({ ...regular, mrp: null }).mrp).toBeNull();
    expect(priceBlock({ ...regular, mrp: '10.00', price: '10.00', sellingPrice: '15.00', discount: { targetType: 'PRODUCT', kind: 'FLAT', value: '5.00' } }).mrp)
      .toBeNull();
  });
});

describe('storefront metadata', () => {
  it('normalizes whitespace and truncates descriptions at a word boundary', () => {
    expect(metaDescription('  first\n\tsecond   third ', 'fallback')).toBe('first second third');
    const long = `${'alpha '.repeat(30)}tail`;
    expect(metaDescription(long, 'fallback')).toBe(`${'alpha '.repeat(26).trimEnd()}…`);
    expect(metaDescription('x'.repeat(200), 'fallback')).toBe(`${'x'.repeat(159)}…`);
    expect(metaDescription(`${'x'.repeat(158)}${'💊'.repeat(10)}`, 'fallback')).toBe(`${'x'.repeat(158)}…`);
    expect(metaDescription(`${'x'.repeat(157)}${'💊'.repeat(10)}`, 'fallback')).toBe(`${'x'.repeat(157)}💊…`);
    expect(metaDescription('', 'fallback')).toBe('fallback');
    expect(metaDescription(null, 'fallback')).toBe('fallback');
    expect(metaDescription('<script>alert(1)</script>', 'fallback')).toBe('<script>alert(1)</script>');
  });

  it('accepts only bare HTTP origins and creates absolute canonical URLs', () => {
    expect(siteOrigin({})).toBe('http://127.0.0.1:3000');
    expect(siteOrigin({ MEDI_WISH_SITE_URL: 'http://127.0.0.1:3115' })).toBe('http://127.0.0.1:3115');
    expect(siteOrigin({ MEDI_WISH_SITE_URL: 'https://shop.example' })).toBe('https://shop.example');
    for (const value of ['https://shop.example/x', 'ftp://x', 'not a url']) {
      expect(() => siteOrigin({ MEDI_WISH_SITE_URL: value })).toThrow();
    }
    expect(canonicalUrl('/products/test', undefined, { MEDI_WISH_SITE_URL: 'https://shop.example' }))
      .toBe('https://shop.example/products/test');
  });

  it('uses Product names, plain descriptions and page-specific canonical URLs', () => {
    const productMeta = productMetadata(product, t, { MEDI_WISH_SITE_URL: 'http://127.0.0.1:3115' });
    expect(productMeta).toMatchObject({
      title: 'Amoxil-D 500',
      description: 'Amoxil-D 500, Strip of 10 capsules at Medi Wish.',
      alternates: { canonical: `http://127.0.0.1:3115/products/${productId}` },
    });
    expect(categoryMetadata(categoryPage, t, { MEDI_WISH_SITE_URL: 'http://127.0.0.1:3115' }).alternates?.canonical)
      .toBe('http://127.0.0.1:3115/categories/5f0e1b7a-9a7d-4f0f-8c33-2a7f6c9d2b02?page=2');
    expect(categoriesMetadata(t, { MEDI_WISH_SITE_URL: 'https://shop.example' }).alternates?.canonical)
      .toBe('https://shop.example/categories');
  });
});
