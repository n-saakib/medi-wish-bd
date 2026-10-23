import { boundedError, invalidResponse, isRecord, readJsonResponse } from './api';
import type { SessionClient } from './session';

export type ProductImage = { id: string; url: string; contentType: 'image/jpeg' | 'image/png'; width: number; height: number;
  byteSize: number; altText: string | null; position: number; version: number; createdAt: string };
export type ProductImageList = { images: ProductImage[]; maxImages: 8 };
export type ImageUpload = { productId: string; id: string; file: File; altText?: string; replaces?: string };
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const pathPattern = /^\/api\/public\/product-images\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(jpg|png)$/;
const apiUrl = process.env.NEXT_PUBLIC_MEDI_WISH_API_URL ?? 'http://127.0.0.1:8080';
function integer(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}
/** Project only the public metadata contract, rejecting unsafe paths and impossible values. */
export function projectProductImage(body: unknown): ProductImage | undefined {
  if (!isRecord(body) || typeof body.id !== 'string' || !idPattern.test(body.id) || typeof body.url !== 'string') return;
  const path = pathPattern.exec(body.url);
  if (!path || path[1] !== body.id || (body.contentType !== 'image/jpeg' && body.contentType !== 'image/png')
    || path[2] !== (body.contentType === 'image/png' ? 'png' : 'jpg')
    || !integer(body.width, 1, 4096) || !integer(body.height, 1, 4096) || !integer(body.byteSize, 1, 3145728)
    || !integer(body.position, 0, 7) || !integer(body.version, 0, Number.MAX_SAFE_INTEGER)
    || !(body.altText === null || (typeof body.altText === 'string' && body.altText.length >= 1 && body.altText.length <= 160
      && !body.altText.startsWith(' ') && !body.altText.endsWith(' ') && !/[\u0000-\u001f\u007f-\u009f]/.test(body.altText)))
    || typeof body.createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(body.createdAt)
    || !Number.isFinite(Date.parse(body.createdAt))) return;
  return { id: body.id, url: body.url, contentType: body.contentType, width: body.width, height: body.height,
    byteSize: body.byteSize, altText: body.altText, position: body.position, version: body.version, createdAt: body.createdAt };
}
export function projectProductImageList(body: unknown): ProductImageList | undefined {
  if (!isRecord(body) || body.maxImages !== 8 || !Array.isArray(body.images) || body.images.length > 8) return;
  const images: ProductImage[] = [];
  for (const item of body.images) {
    const image = projectProductImage(item);
    if (!image || image.position !== images.length || images.some((before) => before.id === image.id)) return;
    images.push(image);
  }
  return { images, maxImages: 8 };
}
export function productImageSrc(url: string, baseUrl = apiUrl): string | null {
  return pathPattern.test(url) ? new URL(url, new URL(baseUrl).origin).href : null;
}
export function precheckImageFile(file: File): 'tooLarge' | 'wrongType' | null {
  if (file.size > 3145728) return 'tooLarge';
  return (file.type === 'image/png' && /\.png$/i.test(file.name))
    || (file.type === 'image/jpeg' && /\.jpe?g$/i.test(file.name)) ? null : 'wrongType';
}
export function imageAlt(image: Pick<ProductImage, 'altText'>, productName: string, index: number,
  t: (key: 'fallbackAlt', values: { name: string; n: number }) => string): string {
  return image.altText ?? t('fallbackAlt', { name: productName, n: index + 1 });
}
/** The shared authenticated client owns credentials, the single refresh and the 10-second timeout. */
export function createProductImageClient(session: Pick<SessionClient, 'authenticatedFetch'>) {
  const root = (productId: string) => `/api/staff/products/${encodeURIComponent(productId)}`;
  async function imageResponse(response: Response, statuses: number[]) {
    if (!statuses.includes(response.status)) {
      if (!response.ok) throw await boundedError(response);
      throw invalidResponse(response.status);
    }
    const image = projectProductImage(await readJsonResponse(response));
    if (!image) throw invalidResponse(response.status);
    return image;
  }
  async function listResponse(response: Response) {
    if (response.status !== 200) {
      if (!response.ok) throw await boundedError(response);
      throw invalidResponse(response.status);
    }
    const list = projectProductImageList(await readJsonResponse(response));
    if (!list) throw invalidResponse(response.status);
    return list;
  }
  return {
    list: (productId: string) => session.authenticatedFetch(`${root(productId)}/images`, { method: 'GET' }, listResponse),
    upload: ({ productId, id, file, altText, replaces }: ImageUpload) => {
      const body = new FormData(); body.append('id', id); body.append('file', file);
      if (altText !== undefined) body.append('altText', altText);
      if (replaces !== undefined) body.append('replaces', replaces);
      return session.authenticatedFetch(`${root(productId)}/images`, { method: 'POST', body }, (response) => imageResponse(response, [200, 201]));
    },
    updateAlt: (productId: string, imageId: string, altText: string | null, version: number) =>
      session.authenticatedFetch(`${root(productId)}/images/${encodeURIComponent(imageId)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ altText, version }),
      }, (response) => imageResponse(response, [200])),
    reorder: ({ productId, imageIds, expectedImageIds }: { productId: string; imageIds: string[]; expectedImageIds: string[] }) =>
      session.authenticatedFetch(`${root(productId)}/image-order`, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageIds, expectedImageIds }) }, listResponse),
    remove: (productId: string, imageId: string) => session.authenticatedFetch(`${root(productId)}/images/${encodeURIComponent(imageId)}`,
      { method: 'DELETE' }, async (response) => {
        if (response.status === 204) return;
        if (!response.ok) throw await boundedError(response);
        throw invalidResponse(response.status);
      }),
  };
}
