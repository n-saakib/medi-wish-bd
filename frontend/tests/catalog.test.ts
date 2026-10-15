import { describe, expect, it } from 'vitest';
import { errorMessageKey, readJsonResponse } from '../src/lib/api';
import { createCatalogClient, formatTaka, projectProduct } from '../src/lib/catalog';

const product = {
  id: '6c1d9a0e-2b7f-4e11-8d3a-5f0e9b2c7a14', kind: 'MEDICINE', name: 'Napa 500', brandName: 'Napa',
  genericName: 'Paracetamol', dosageForm: 'Tablet 500 mg', manufacturer: 'Beximco',
  categoryId: '0b8e3f52-9c1a-4d67-a2e4-7f3b5c9d1e20', categoryName: 'Pain relief',
  saleUnit: 'Strip of 10 tablets', sellingPrice: '11.50', effectivePrice: '11.50', appliedDiscount: null, mrp: '12.00', active: true,
  requireValidation: false, status: 'ACTIVE', description: null, version: 2,
  updatedAt: '2026-09-27T11:00:00Z', updatedByUsername: 'owner.admin', history: [],
};

describe('catalog money display', () => {
  it.each([
    ['0.01', '৳0.01'],
    ['999.00', '৳999.00'],
    ['1000.00', '৳1,000.00'],
    ['9999999.99', '৳9,999,999.99'],
  ])('formats the API decimal string %s without changing its value', (value, formatted) => {
    expect(formatTaka(value, '৳')).toBe(formatted);
  });
});

describe('catalog response boundary', () => {
  it('keeps the ordinary JSON cap while allowing a bounded catalog page', async () => {
    const page = { items: Array(50).fill({ name: 'a'.repeat(400) }), page: 0, size: 50, totalItems: 50 };
    await expect(readJsonResponse(Response.json(page))).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(readJsonResponse(Response.json(page), 256 * 1024)).resolves.toEqual(page);
  });
  it('accepts the documented Product and keeps exact decimal strings', () => {
    expect(projectProduct(product)).toEqual(product);
  });

  it.each([11.5, '11.5', '10000000.00'])('rejects an invalid selling-price projection %s', (sellingPrice) => {
    expect(projectProduct({ ...product, sellingPrice })).toBeUndefined();
  });

  it.each([null, '12.00'])('rejects a price-history entry without its new selling price, with MRP=%s', async (newMrp) => {
    const history = [{ occurredAt: '2026-09-27T11:00:00Z', actorUsername: 'owner.admin',
      changeType: 'PRICE_CHANGED', oldSellingPrice: null, newSellingPrice: null,
      oldMrp: null, newMrp, oldRequireValidation: false, discount: null, newRequireValidation: false }];
    const authenticatedFetch = async <T>(_: string, _init: RequestInit, read: (response: Response) => Promise<T>): Promise<T> =>
      read(Response.json({ ...product, history }));
    const response = createCatalogClient({ authenticatedFetch }).loadProduct(product.id);
    await expect(response).rejects.toMatchObject({ code: 'INVALID_RESPONSE', status: 200 });
    await expect(response.catch(errorMessageKey)).resolves.toBe('invalidResponse');
  });

  it('accepts created and initial price histories with legitimate null money fields', () => {
    const created = { occurredAt: '2026-09-27T11:00:00Z', actorUsername: 'owner.admin',
      changeType: 'CREATED', oldSellingPrice: null, newSellingPrice: null, oldMrp: null, newMrp: null,
      oldRequireValidation: null, discount: null, newRequireValidation: false };
    const withHistory = { ...product, history: [created, { ...created, changeType: 'PRICE_CHANGED',
      newSellingPrice: '11.50', oldRequireValidation: false }] };
    expect(projectProduct(withHistory)).toEqual(withHistory);
  });

  it.each([[null, true], [false, null], [null, null]])(
    'rejects review-flag history without boolean before/after values (%s to %s)', async (oldRequireValidation, newRequireValidation) => {
      const history = [{ occurredAt: '2026-09-27T11:00:00Z', actorUsername: 'owner.admin',
        changeType: 'REQUIRE_VALIDATION_CHANGED', oldSellingPrice: null, newSellingPrice: null,
        oldMrp: null, newMrp: null, discount: null, oldRequireValidation, newRequireValidation }];
      const authenticatedFetch = async <T>(_: string, _init: RequestInit, read: (response: Response) => Promise<T>): Promise<T> =>
        read(Response.json({ ...product, history }));
      const response = createCatalogClient({ authenticatedFetch }).loadProduct(product.id);
      await expect(response).rejects.toMatchObject({ code: 'INVALID_RESPONSE', status: 200 });
      await expect(response.catch(errorMessageKey)).resolves.toBe('invalidResponse');
    },
  );

  it.each([[false, true], [true, false]])('accepts both review-flag directions (%s to %s) with nullable money',
    (oldRequireValidation, newRequireValidation) => {
      const withHistory = { ...product, history: [{ occurredAt: '2026-09-27T11:00:00Z', actorUsername: 'owner.admin',
        changeType: 'REQUIRE_VALIDATION_CHANGED', oldSellingPrice: null, newSellingPrice: null,
        oldMrp: null, newMrp: null, discount: null, oldRequireValidation, newRequireValidation }] };
      expect(projectProduct(withHistory)).toEqual(withHistory);
    },
  );

  it('rejects an unknown status and an unbounded history', () => {
    expect(projectProduct({ ...product, status: 'SOLD_OUT' })).toBeUndefined();
    expect(projectProduct({ ...product, history: Array(21).fill({}) })).toBeUndefined();
  });
});

describe('catalog API requests', () => {
  it('collects every active category page for the product editor', async () => {
    const seen: string[] = [];
    const category = { id: product.categoryId, name: 'Pain relief', active: true, productCount: 1, version: 0 };
    const authenticatedFetch = async <T>(path: string, _: RequestInit, read: (response: Response) => Promise<T>): Promise<T> => {
      seen.push(path);
      const page = Number(new URL(path, 'http://test').searchParams.get('page'));
      return read(Response.json({ items: page === 0 ? Array(50).fill(category) : [category],
        page, size: 50, totalItems: 51 }));
    };
    const options = await createCatalogClient({ authenticatedFetch }).listCategoryOptions();
    expect(options).toHaveLength(51);
    expect(seen).toEqual([
      '/api/staff/categories?includeInactive=false&page=0&size=50',
      '/api/staff/categories?includeInactive=false&page=1&size=50',
    ]);
  });

  it('keeps pricing on its Admin-only route with precisely three fields', async () => {
    const requests: { path: string; body: unknown }[] = [];
    const authenticatedFetch = async <T>(path: string, init: RequestInit, read: (response: Response) => Promise<T>): Promise<T> => {
      requests.push({ path, body: JSON.parse(String(init.body)) });
      return read(Response.json(product));
    };
    await createCatalogClient({ authenticatedFetch }).updatePricing(product.id, {
      sellingPrice: '11.50', mrp: '12.00', version: 2,
    });
    expect(requests).toEqual([{ path: `/api/staff/products/${product.id}/pricing`,
      body: { sellingPrice: '11.50', mrp: '12.00', version: 2 } }]);
  });
});

describe('catalog discount projections', () => {
  const discount = { targetType: 'CATEGORY', kind: 'PERCENTAGE', value: '10' };
  const event = { occurredAt: '2026-10-01T18:00:00Z', actorUsername: null, oldSellingPrice: null, newSellingPrice: null,
    oldMrp: null, newMrp: null, oldRequireValidation: null, newRequireValidation: null };
  it('accepts the current price and rejects inconsistent or malformed price metadata', () => {
    const priced = { ...product, effectivePrice: '10.35', appliedDiscount: { ...discount, id: product.id, targetName: 'Pain relief', saving: '1.15' } };
    expect(projectProduct(priced)).toEqual(priced);
    expect(projectProduct({ ...priced, sellingPrice: null })).toBeUndefined();
    expect(projectProduct({ ...priced, effectivePrice: '12.5' })).toBeUndefined();
    expect(projectProduct({ ...priced, appliedDiscount: { ...priced.appliedDiscount, saving: 1.15 } })).toBeUndefined();
  });
  it.each(['DISCOUNT_STARTED', 'DISCOUNT_ENDED'])('accepts %s only with a valid discount projection', (changeType) => {
    const withHistory = { ...product, history: [{ ...event, changeType, discount }] };
    expect(projectProduct(withHistory)).toEqual(withHistory);
    expect(projectProduct({ ...product, history: [{ ...event, changeType, discount: null }] })).toBeUndefined();
  });
  it.each([
    { boundary: 'applied', change: { targetType: ['PRODUCT'] } }, { boundary: 'applied', change: { kind: ['FLAT'] } },
    { boundary: 'DISCOUNT_STARTED', change: { targetType: ['PRODUCT'] } }, { boundary: 'DISCOUNT_STARTED', change: { kind: ['FLAT'] } },
    { boundary: 'DISCOUNT_ENDED', change: { targetType: ['PRODUCT'] } }, { boundary: 'DISCOUNT_ENDED', change: { kind: ['FLAT'] } },
  ])('rejects enum arrays in discount metadata %j', async ({ boundary, change }) => {
    const flat = { targetType: 'PRODUCT', kind: 'FLAT', value: '1.00' };
    const applied = { ...flat, id: product.id, targetName: product.name, saving: '1.00' };
    const valid = boundary === 'applied'
      ? { ...product, effectivePrice: '10.50', appliedDiscount: applied }
      : { ...product, history: [{ ...event, changeType: boundary, discount: flat }] };
    const malformed = boundary === 'applied'
      ? { ...valid, appliedDiscount: { ...applied, ...change } }
      : { ...valid, history: [{ ...event, changeType: boundary, discount: { ...flat, ...change } }] };
    expect(projectProduct(valid)).toEqual(valid);
    expect(projectProduct(malformed)).toBeUndefined();
    const authenticatedFetch = async <T>(_: string, _init: RequestInit, read: (response: Response) => Promise<T>) =>
      read(Response.json(malformed));
    await expect(createCatalogClient({ authenticatedFetch }).loadProduct(product.id))
      .rejects.toMatchObject({ code: 'INVALID_RESPONSE', status: 200 });
  });
  it('rejects a stored history entry carrying derived discount metadata', () => {
    expect(projectProduct({ ...product, history: [{ ...event, changeType: 'CATALOG_UPDATED', discount }] })).toBeUndefined();
  });
});
