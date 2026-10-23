import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { ApiError, type ApiFetch } from '../src/lib/api';
import {
  createStorefrontClient,
  projectPublicCategories,
  projectPublicCategoryPage,
  projectPublicProduct,
  publicCatalogMaxJsonBytes,
  serverApiBaseUrl,
} from '../src/lib/storefront';

const categoryId = '5f0e1b7a-9a7d-4f0f-8c33-2a7f6c9d2b02';
const productId = '7d1c3a90-2b8e-4c7f-9e11-0a4b5c6d7e01';
const imageId = '2e7a9c11-5b3d-4f8e-a0c2-9d8e7f6a5b01';
const category = { id: categoryId, name: 'Fever & pain' };
const price = {
  sellingPrice: '12.00', mrp: '12.00', price: '10.80', saving: '1.20',
  discount: { targetType: 'CATEGORY', kind: 'PERCENTAGE', value: '10' },
};
const card = {
  id: productId,
  name: 'Paracetin 500',
  genericName: 'Paracetamol 500 mg',
  saleUnit: 'Strip of 10 tablets',
  image: { url: `/api/public/product-images/${imageId}.jpg`, altText: null, width: 800, height: 800 },
  price,
};
const categoryPage = { category, items: [card], page: 0, size: 24, totalItems: 25 };
const productDetails = {
  id: productId,
  name: 'Amoxil-D 500',
  brandName: 'Amoxil-D',
  genericName: 'Amoxicillin 500 mg',
  dosageForm: 'Capsule',
  manufacturer: 'Meghna Labs',
  saleUnit: 'Strip of 10 capsules',
  description: 'A penicillin antibiotic for bacterial infections.\nIt does not work for colds or flu.',
  requireValidation: true,
  category: { id: '0b9c2f2e-4a51-4d1e-9a65-3f1e2d7c1a01', name: 'Antibiotics' },
  images: [
    { url: `/api/public/product-images/${imageId}.jpg`, altText: 'Front of the box', width: 800, height: 800 },
    { url: '/api/public/product-images/4c5d6e7f-8091-4a2b-9c3d-4e5f6a7b8c02.png', altText: null, width: 600, height: 600 },
  ],
  price: { sellingPrice: '150.00', mrp: '160.00', price: '135.00', saving: '15.00', discount: { targetType: 'CATEGORY', kind: 'PERCENTAGE', value: '10' } },
};

afterEach(() => vi.unstubAllEnvs());

describe('public catalog projections', () => {
  it('projects each accepted API example into public fields only', () => {
    expect(projectPublicCategories({ categories: [category] })).toEqual([category]);
    expect(projectPublicCategoryPage(categoryPage)).toEqual(categoryPage);
    expect(projectPublicProduct(productDetails)).toEqual(productDetails);
  });

  it('drops staff and unknown fields at every response boundary', () => {
    expect(projectPublicCategories({ categories: [{ ...category, active: true, version: 3, actor: 'staff' }] }))
      .toEqual([category]);
    expect(projectPublicCategoryPage({
      ...categoryPage,
      updatedBy: 'staff',
      category: { ...category, active: true, version: 3 },
      items: [{ ...card, status: 'ACTIVE', active: true, version: 4, updatedBy: 'staff' }],
    })).toEqual(categoryPage);
    expect(projectPublicProduct({ ...productDetails, status: 'ACTIVE', active: true, version: 4, updatedBy: 'staff' }))
      .toEqual(productDetails);
  });

  it.each([
    ['non-UUID id', { items: [{ ...card, id: 'not-a-uuid' }] }],
    ['money without two decimal places', { items: [{ ...card, price: { ...price, price: '10.8' } }] }],
    ['unexpected page size', { size: 20 }],
    ['more than 24 cards', { items: Array.from({ length: 25 }, () => card) }],
    ['total below the returned count', { totalItems: 0 }],
    ['zero percentage discount', { items: [{ ...card, price: { ...price, discount: { ...price.discount, value: '0' } } }] }],
    ['untrusted image origin', { items: [{ ...card, image: { ...card.image, url: 'https://evil.example/x.jpg' } }] }],
    ['unsupported public image extension', { items: [{ ...card, image: { ...card.image, url: '/api/public/product-images/x.gif' } }] }],
    ['uppercase category id', { category: { ...category, id: categoryId.toUpperCase() } }],
  ])('rejects a malformed category page: %s', (_name, change) => {
    expect(projectPublicCategoryPage({ ...categoryPage, ...change })).toBeUndefined();
  });

  it('rejects details with more than eight images or an oversized description', () => {
    expect(projectPublicProduct({ ...productDetails, images: Array.from({ length: 9 }, () => productDetails.images[0]) }))
      .toBeUndefined();
    expect(projectPublicProduct({ ...productDetails, description: 'x'.repeat(4001) })).toBeUndefined();
  });

  it('rejects malformed public image metadata using the inherited image limits', () => {
    expect(projectPublicProduct({ ...productDetails, images: [{ ...productDetails.images[0], altText: '' }] })).toBeUndefined();
    expect(projectPublicProduct({ ...productDetails, images: [{ ...productDetails.images[0], altText: 'Front\nlabel' }] })).toBeUndefined();
    expect(projectPublicProduct({ ...productDetails, images: [{ ...productDetails.images[0], width: 4097 }] })).toBeUndefined();
  });
});

describe('public catalog client', () => {
  it('maps only the correlated NOT_FOUND response to null for all three reads', async () => {
    const fetcher: ApiFetch = async () => Response.json(
      { code: 'NOT_FOUND', message: 'bounded', requestId: productId },
      { status: 404, headers: { 'X-Request-ID': productId } },
    );
    const client = createStorefrontClient({ baseUrl: 'https://api.example.test', fetch: fetcher });
    await expect(client.categories()).resolves.toBeNull();
    await expect(client.categoryPage(categoryId, 0)).resolves.toBeNull();
    await expect(client.product(productId)).resolves.toBeNull();
  });

  it('throws bounded API errors for other 404 codes and server failures', async () => {
    for (const status of [404, 500, 503]) {
      const code = status === 404 ? 'ACCESS_DENIED' : 'REQUEST_FAILED';
      const client = createStorefrontClient({
        baseUrl: 'https://api.example.test',
        fetch: async () => Response.json({ code, message: 'not surfaced' }, { status }),
      });
      await expect(client.categories()).rejects.toMatchObject({ name: 'ApiError', status, code });
    }
  });

  it('does not turn an uncorrelated not-found error into a page 404', async () => {
    const client = createStorefrontClient({
      baseUrl: 'https://api.example.test',
      fetch: async () => Response.json(
        { code: 'NOT_FOUND', message: 'bounded', requestId: productId },
        { status: 404, headers: { 'X-Request-ID': '2e7a9c11-5b3d-4f8e-a0c2-9d8e7f6a5b01' } },
      ),
    });
    await expect(client.product(productId)).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });

  it('turns network and abort errors into ApiError instead of not-found', async () => {
    for (const reason of [new TypeError('offline'), new DOMException('aborted', 'AbortError')]) {
      const client = createStorefrontClient({ baseUrl: 'https://api.example.test', fetch: async () => { throw reason; } });
      await expect(client.categories()).rejects.toBeInstanceOf(ApiError);
      await expect(client.categories()).rejects.toMatchObject({ status: 0 });
    }
  });

  it('requests the selected zero-based category page without cookies or credentials', async () => {
    let requestUrl: URL | undefined;
    let requestInit: RequestInit | undefined;
    const client = createStorefrontClient({
      baseUrl: 'https://api.example.test',
      fetch: async (url, init) => {
        requestUrl = url;
        requestInit = init;
        return Response.json({ ...categoryPage, page: 1 });
      },
    });
    await client.categoryPage(categoryId, 1);
    expect(requestUrl?.toString()).toBe(`https://api.example.test/api/categories/${categoryId}/products?page=1`);
    expect(requestInit).toMatchObject({ method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error' });
    expect(new Headers(requestInit?.headers).has('Authorization')).toBe(false);
    expect(new Headers(requestInit?.headers).has('Cookie')).toBe(false);
  });

  it('rejects a category page whose projected category does not match the requested ID', async () => {
    const client = createStorefrontClient({
      baseUrl: 'https://api.example.test',
      fetch: async () => Response.json({ ...categoryPage, category: { ...category, id: productId } }),
    });
    await expect(client.categoryPage(categoryId, 0)).rejects.toMatchObject({ code: 'INVALID_RESPONSE', status: 200 });
  });

  it('rejects Product details whose projected ID does not match the requested ID', async () => {
    const client = createStorefrontClient({
      baseUrl: 'https://api.example.test',
      fetch: async () => Response.json({ ...productDetails, id: categoryId }),
    });
    await expect(client.product(productId)).rejects.toMatchObject({ code: 'INVALID_RESPONSE', status: 200 });
  });

  it('rejects a body one byte over the public JSON limit', async () => {
    const oversized = new Response(new Uint8Array(publicCatalogMaxJsonBytes + 1), { status: 200 });
    const client = createStorefrontClient({ baseUrl: 'https://api.example.test', fetch: async () => oversized });
    await expect(client.categories()).rejects.toMatchObject({ code: 'INVALID_RESPONSE', status: 200 });
  });

  it('selects the server-only API URL at request time with public and local fallbacks', () => {
    vi.stubEnv('MEDI_WISH_SERVER_API_URL', 'http://catalog.internal:8080');
    vi.stubEnv('NEXT_PUBLIC_MEDI_WISH_API_URL', 'https://public.example.test');
    expect(serverApiBaseUrl()).toBe('http://catalog.internal:8080');
    vi.stubEnv('MEDI_WISH_SERVER_API_URL', undefined);
    expect(serverApiBaseUrl()).toBe('https://public.example.test');
    vi.stubEnv('NEXT_PUBLIC_MEDI_WISH_API_URL', undefined);
    expect(serverApiBaseUrl()).toBe('http://127.0.0.1:8080');
  });
});
