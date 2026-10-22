import type { APIResponse } from '@playwright/test';
import { describe, expect, it } from 'vitest';
import {
  badgeText, canonical, copyPattern, normalizedMain, publicDetailsKeys, publicProductKeys, expectPublicCard, expectPublicCategoryPage, expectPublicJson, expectPublicNotFound,
  expectPublicPrice, expectPublicProduct, firstCategories, malformedIds, normalizedText, orderedNames, pageCount, pageOf,
  pageTitle, paisa, productCount, publicOrder, showsMrp, taka, withoutProductId, type PublicCard, type PublicPriceView,
  type PublicProduct,
} from './browser/storefrontSupport';

const productId = '0000000a-0000-4000-8000-00000000ab17';
const categoryId = '00000000-0000-4000-8000-000000000171';
const plain: PublicPriceView = { sellingPrice: '120.00', mrp: null, price: '120.00', saving: '0.00', discount: null };
const percent: PublicPriceView = {
  sellingPrice: '150.00', mrp: '160.00', price: '135.00', saving: '15.00',
  discount: { targetType: 'PRODUCT', kind: 'PERCENTAGE', value: '10' },
};
const flat: PublicPriceView = {
  sellingPrice: '150.00', mrp: null, price: '135.00', saving: '15.00',
  discount: { targetType: 'CATEGORY', kind: 'FLAT', value: '15.00' },
};
const card: PublicCard = {
  id: productId, name: 'Synthetic tablet', genericName: 'Paracetamol', saleUnit: 'Strip of 10', image: null, price: plain,
};
const details: PublicProduct = {
  id: productId, name: 'Synthetic tablet', brandName: 'Brand', genericName: 'Paracetamol', dosageForm: 'Tablet',
  manufacturer: 'Maker', saleUnit: 'Strip of 10', description: 'Line one\nLine two', requireValidation: true,
  category: { id: categoryId, name: 'Pain relief' },
  images: [{ url: `/api/public/product-images/${categoryId}.png`, altText: null, width: 640, height: 480 }],
  price: percent,
};

function reply(body: unknown, status = 200, headers: Record<string, string | undefined> = {}): APIResponse {
  return {
    status: () => status,
    url: () => 'http://127.0.0.1:18115/api/test',
    headers: () => ({ 'cache-control': 'no-store', 'content-type': 'application/json', 'x-request-id': 'fixture-17', ...headers }),
    json: async () => body,
  } as unknown as APIResponse;
}

describe('Ticket 17 storefront display fixtures', () => {
  it.each([
    ['0.01', '৳0.01'], ['135.00', '৳135.00'], ['1000.00', '৳1,000.00'], ['1234567.50', '৳1,234,567.50'],
  ])('formats %s as %s', (amount, shown) => expect(taka(amount)).toBe(shown));

  it('builds badge, page, count and title text', () => {
    expect(badgeText(percent.discount!)).toBe('10% OFF');
    expect(badgeText(flat.discount!)).toBe('৳15.00 OFF');
    expect(pageOf(2, 3)).toBe('Page 2 of 3');
    expect([productCount(1), productCount(0), productCount(25)]).toEqual(['1 product', '0 products', '25 products']);
    expect(pageTitle('Pain relief')).toBe('Pain relief · Medi Wish');
    expect(canonical('/categories/x?page=2')).toBe('http://127.0.0.1:3115/categories/x?page=2');
    expect(normalizedText('  a \n\t b  ')).toBe('a b');
  });

  it('matches copy with either apostrophe, exactly', () => {
    const pattern = copyPattern('We couldn’t find that page.');
    expect(pattern.test('We couldn’t find that page.')).toBe(true);
    expect(pattern.test("We couldn't find that page.")).toBe(true);
    expect(pattern.test('We couldn’t find that pageX')).toBe(false);
    expect(pattern.test('Oh. We couldn’t find that page.')).toBe(false);
    expect(copyPattern('a (b) [c] $d').test('a (b) [c] $d')).toBe(true);
    expect(normalizedMain).toBeTypeOf('function');
    expect(publicDetailsKeys).toBe(publicProductKeys);
  });

  it('shows the MRP only when it is above the current price', () => {
    expect(showsMrp(plain)).toBe(false);
    expect(showsMrp(percent)).toBe(true);
    expect(showsMrp({ ...plain, mrp: '120.00' })).toBe(false);
    expect(paisa('1000.05')).toBe(100005n);
    expect(() => paisa('1.5')).toThrow();
  });

  it('counts pages with an empty category as one page', () => {
    expect([0, 1, 24, 25, 48, 49].map(pageCount)).toEqual([1, 1, 1, 2, 2, 3]);
  });
});

describe('Ticket 17 ordering fixtures', () => {
  it('makes names whose lower-case order differs from byte order', () => {
    const names = orderedNames('Shelf', 30);
    expect(names.slice(0, 4)).toEqual(['Shelf aa', 'Shelf Ab', 'Shelf ac', 'Shelf Ad']);
    expect(names[26]).toBe('Shelf ba');
    expect(new Set(names.map((name) => name.toLowerCase())).size).toBe(30);
    expect([...names].sort()).not.toEqual(names);
    const items = names.map((name, index) => ({ id: `id-${String(99 - index)}`, name }));
    expect(publicOrder([...items].reverse()).map((item) => item.name)).toEqual(names);
    expect(() => orderedNames('x', 677)).toThrow();
  });

  it('orders equal names by id', () => {
    const sorted = publicOrder([{ id: 'b', name: 'Same' }, { id: 'a', name: 'same' }]);
    expect(sorted.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('takes the first eight categories for the bar', () => {
    const categories = Array.from({ length: 10 }, (_, index) => ({ id: String(index), name: `C${index}` }));
    expect(firstCategories(categories).map((category) => category.id)).toEqual(['0', '1', '2', '3', '4', '5', '6', '7']);
    expect(firstCategories(categories.slice(0, 3))).toHaveLength(3);
  });

  it('lists malformed ids, including an upper-case UUID', () => {
    const ids = malformedIds(productId);
    expect(ids.upper).toBe(productId.toUpperCase());
    expect(ids.short).toHaveLength(35);
    expect(ids.long).toHaveLength(37);
  });
});

describe('Ticket 17 public contract guards', () => {
  it('accepts consistent prices and rejects inconsistent ones', () => {
    for (const price of [plain, percent, flat]) expect(() => expectPublicPrice(price)).not.toThrow();
    expect(() => expectPublicPrice({ ...percent, saving: '14.00' })).toThrow();
    expect(() => expectPublicPrice({ ...plain, saving: '1.00', price: '119.00' })).toThrow();
    expect(() => expectPublicPrice({ ...flat, discount: { ...flat.discount!, value: '10.00' } })).toThrow();
    expect(() => expectPublicPrice({ ...plain, mrp: '100.00' })).toThrow();
    expect(() => expectPublicPrice({ ...plain, productId } as PublicPriceView)).toThrow();
  });

  it('rejects staff fields and malformed cards', () => {
    expect(() => expectPublicCard(card)).not.toThrow();
    expect(() => expectPublicCard({ ...card, version: 0 } as PublicCard)).toThrow();
    expect(() => expectPublicCard({ ...card, id: productId.toUpperCase() })).toThrow();
    expect(() => expectPublicCard({ ...card, image: { url: '/images/x.png', altText: null, width: 1, height: 1 } }))
      .toThrow();
  });

  it('checks the page envelope and item count', () => {
    const view = { category: { id: categoryId, name: 'Pain relief' }, items: [card], page: 0, size: 24, totalItems: 1 };
    expect(() => expectPublicCategoryPage(view, 0)).not.toThrow();
    expect(() => expectPublicCategoryPage({ ...view, totalItems: 2 }, 0)).toThrow();
    expect(() => expectPublicCategoryPage({ ...view, size: 20 }, 0)).toThrow();
    expect(() => expectPublicCategoryPage({ ...view, items: [], totalItems: 0 }, 0)).not.toThrow();
    expect(() => expectPublicCategoryPage({ ...view, items: [card, card], totalItems: 2 }, 0)).toThrow();
  });

  it('checks the details shape', () => {
    expect(() => expectPublicProduct(details)).not.toThrow();
    expect(() => expectPublicProduct({ ...details, category: null, genericName: null, dosageForm: null })).not.toThrow();
    expect(() => expectPublicProduct({ ...details, active: true } as PublicProduct)).toThrow();
  });

  it('drops only productId from the Ticket 16 price body', () => {
    expect(withoutProductId({ productId, ...percent })).toEqual(percent);
  });

  it('asserts public headers', async () => {
    await expect(expectPublicJson(reply({ categories: [] }))).resolves.toEqual({ categories: [] });
    await expect(expectPublicJson(reply({}, 200, { 'cache-control': 'private' }))).rejects.toThrow();
    await expect(expectPublicJson(reply({}, 200, { 'set-cookie': 'a=b' }))).rejects.toThrow();
    await expect(expectPublicJson(reply({}, 200, { 'x-request-id': 'bad id' }))).rejects.toThrow();
    await expect(expectPublicJson(reply({}, 404))).rejects.toThrow();
  });

  it('asserts the exact not-found envelope', async () => {
    const body = { code: 'NOT_FOUND', message: 'The requested resource was not found.', requestId: 'fixture-17' };
    await expect(expectPublicNotFound(reply(body, 404))).resolves.toEqual({ code: body.code, message: body.message });
    await expect(expectPublicNotFound(reply({ ...body, requestId: 'other' }, 404))).rejects.toThrow();
    for (const requestId of ['bad id', 'x'.repeat(65)]) {
      await expect(expectPublicNotFound(reply({ ...body, requestId }, 404, { 'x-request-id': requestId })))
        .rejects.toThrow();
    }
    await expect(expectPublicNotFound(reply({ ...body, detail: 'inactive' }, 404))).rejects.toThrow();
    await expect(expectPublicNotFound(reply(body, 400))).rejects.toThrow();
  });
});
