import 'server-only';
import { boundedError, boundedText, invalidResponse, isRecord, readJsonResponse, apiRequest, endpoint, type ApiFetch } from './api';
import { projectDiscountValue, type DiscountKind, type DiscountTargetType } from './discounts';
import { productImageSrc } from './productImages';

export type PublicCategory = { id: string; name: string };
export type PublicImage = { url: string; altText: string | null; width: number; height: number };
export type PublicDiscount = { targetType: DiscountTargetType; kind: DiscountKind; value: string };
export type PublicPrice = {
  sellingPrice: string; mrp: string | null; price: string; saving: string; discount: PublicDiscount | null;
};
export type PublicCard = {
  id: string; name: string; genericName: string | null; saleUnit: string; image: PublicImage | null; price: PublicPrice;
};
export type PublicCategoryPage = {
  category: PublicCategory; items: PublicCard[]; page: number; size: 24; totalItems: number;
};
export type PublicProductDetails = {
  id: string; name: string; brandName: string | null; genericName: string | null; dosageForm: string | null;
  manufacturer: string | null; saleUnit: string; description: string | null; requireValidation: boolean;
  category: PublicCategory | null; images: PublicImage[]; price: PublicPrice;
};

export const publicCatalogMaxJsonBytes = 256 * 1024;
const defaultApiUrl = 'http://127.0.0.1:8080';
const publicImageApiUrl = process.env.NEXT_PUBLIC_MEDI_WISH_API_URL ?? defaultApiUrl;
const moneyPattern = /^\d{1,7}\.\d{2}$/;
const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const publicIdPattern = requestIdPattern;

function nullableText(value: unknown, maxLength: number): value is string | null {
  return value === null || boundedText(value, maxLength);
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function projectCategory(value: unknown): PublicCategory | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' || !publicIdPattern.test(value.id) || !boundedText(value.name, 80)) return undefined;
  return { id: value.id, name: value.name };
}

function projectImage(value: unknown): PublicImage | undefined {
  if (!isRecord(value) || typeof value.url !== 'string' || !productImageSrc(value.url, publicImageApiUrl)
    || !(value.altText === null || (typeof value.altText === 'string' && value.altText.length >= 1 && value.altText.length <= 160
      && !value.altText.startsWith(' ') && !value.altText.endsWith(' ') && !/[\u0000-\u001f\u007f-\u009f]/.test(value.altText)))
    || !Number.isSafeInteger(value.width) || (value.width as number) < 1 || (value.width as number) > 4096
    || !Number.isSafeInteger(value.height) || (value.height as number) < 1 || (value.height as number) > 4096) return undefined;
  return { url: value.url, altText: value.altText, width: value.width as number, height: value.height as number };
}

function projectPrice(value: unknown): PublicPrice | undefined {
  if (!isRecord(value) || typeof value.sellingPrice !== 'string' || !moneyPattern.test(value.sellingPrice)
    || !(value.mrp === null || (typeof value.mrp === 'string' && moneyPattern.test(value.mrp)))
    || typeof value.price !== 'string' || !moneyPattern.test(value.price)
    || typeof value.saving !== 'string' || !moneyPattern.test(value.saving)) return undefined;
  const discount = value.discount === null ? null : projectDiscountValue(value.discount);
  if (discount === undefined) return undefined;
  return {
    sellingPrice: value.sellingPrice,
    mrp: value.mrp as string | null,
    price: value.price,
    saving: value.saving,
    discount,
  };
}

function projectCard(value: unknown): PublicCard | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' || !publicIdPattern.test(value.id) || !boundedText(value.name, 160)
    || !nullableText(value.genericName, 200) || !boundedText(value.saleUnit, 80)) return undefined;
  const image = value.image === null ? null : projectImage(value.image);
  const price = projectPrice(value.price);
  if (image === undefined || !price) return undefined;
  return { id: value.id, name: value.name, genericName: value.genericName, saleUnit: value.saleUnit, image, price };
}

export function projectPublicCategories(value: unknown): PublicCategory[] | undefined {
  if (!isRecord(value) || !Array.isArray(value.categories)) return undefined;
  const categories = value.categories.map(projectCategory);
  return categories.some((category) => !category) ? undefined : categories as PublicCategory[];
}

export function projectPublicCategoryPage(value: unknown): PublicCategoryPage | undefined {
  if (!isRecord(value) || !Array.isArray(value.items) || value.items.length > 24
    || !nonNegativeInteger(value.page) || value.size !== 24 || !nonNegativeInteger(value.totalItems)
    || value.totalItems < value.items.length) return undefined;
  const category = projectCategory(value.category);
  const items = value.items.map(projectCard);
  if (!category || items.some((item) => !item)) return undefined;
  return { category, items: items as PublicCard[], page: value.page, size: 24, totalItems: value.totalItems };
}

export function projectPublicProduct(value: unknown): PublicProductDetails | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' || !publicIdPattern.test(value.id) || !boundedText(value.name, 160)
    || !nullableText(value.brandName, 120) || !nullableText(value.genericName, 200)
    || !nullableText(value.dosageForm, 120) || !nullableText(value.manufacturer, 120)
    || !boundedText(value.saleUnit, 80) || !nullableText(value.description, 4000)
    || typeof value.requireValidation !== 'boolean' || !Array.isArray(value.images) || value.images.length > 8) return undefined;
  const category = value.category === null ? null : projectCategory(value.category);
  const images = value.images.map(projectImage);
  const price = projectPrice(value.price);
  if (category === undefined || images.some((image) => !image) || !price) return undefined;
  return {
    id: value.id,
    name: value.name,
    brandName: value.brandName,
    genericName: value.genericName,
    dosageForm: value.dosageForm,
    manufacturer: value.manufacturer,
    saleUnit: value.saleUnit,
    description: value.description,
    requireValidation: value.requireValidation,
    category,
    images: images as PublicImage[],
    price,
  };
}

/** Resolves the private API origin per invocation so deployments can use an internal runtime URL. */
export function serverApiBaseUrl(): string {
  return process.env.MEDI_WISH_SERVER_API_URL
    ?? process.env.NEXT_PUBLIC_MEDI_WISH_API_URL
    ?? defaultApiUrl;
}

async function readPublicResponse<T>(response: Response, project: (body: unknown) => T | undefined): Promise<T | null> {
  if (response.status === 404) {
    try {
      const body = await readJsonResponse(response.clone());
      const requestId = response.headers.get('X-Request-ID');
      if (isRecord(body) && body.code === 'NOT_FOUND' && typeof body.requestId === 'string'
        && requestIdPattern.test(body.requestId) && body.requestId === requestId) return null;
    } catch {
      // Keep malformed, oversized and unreadable error responses on the bounded error path below.
    }
    throw await boundedError(response);
  }
  if (response.status !== 200) {
    if (!response.ok) throw await boundedError(response);
    throw invalidResponse(response.status);
  }
  const result = project(await readJsonResponse(response, publicCatalogMaxJsonBytes));
  if (result === undefined) throw invalidResponse(response.status);
  return result;
}

export function createStorefrontClient(options: { baseUrl?: string; fetch?: ApiFetch } = {}) {
  const baseUrl = options.baseUrl ?? serverApiBaseUrl();
  const fetcher = options.fetch ?? fetch;
  const get = <T>(path: string, project: (body: unknown) => T | undefined) =>
    apiRequest(fetcher, endpoint(path, baseUrl), { method: 'GET', credentials: 'omit', headers: { Accept: 'application/json' } },
      (response) => readPublicResponse(response, project));
  return {
    categories: () => get('/api/categories', projectPublicCategories),
    categoryPage: (id: string, apiPage: number) => get(
      `/api/categories/${encodeURIComponent(id)}/products?page=${apiPage}`,
      (body) => {
        const page = projectPublicCategoryPage(body);
        return page?.page === apiPage && page.category.id === id ? page : undefined;
      },
    ),
    product: (id: string) => get(`/api/products/${encodeURIComponent(id)}`, (body) => {
      const product = projectPublicProduct(body);
      return product?.id === id ? product : undefined;
    }),
  };
}
