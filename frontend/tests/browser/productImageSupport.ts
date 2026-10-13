import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { expect, type APIRequestContext, type APIResponse, type Page } from '@playwright/test';
import { apiMessages, expectJson, openProduct, type ApiActor } from './catalogSupport';
import { apiUrl, checkedTarget, frontendUrl } from './testApi';
import { maxImageBytes } from './imageFixtures';

export type ImageView = {
  id: string; url: string; contentType: 'image/png' | 'image/jpeg'; width: number; height: number;
  byteSize: number; altText: string | null; position: number; version: number; createdAt: string;
};
export type ImageList = { images: ImageView[]; maxImages: number };
export const imageKeys = ['altText', 'byteSize', 'contentType', 'createdAt', 'height', 'id', 'position', 'url', 'version', 'width'];
export const imageMessages = {
  ...apiMessages,
  IMAGE_INVALID: 'The file is not a valid JPG or PNG image within the size limits.',
  IMAGE_LIMIT_REACHED: 'This Product already has the maximum number of images.',
  STORAGE_UNAVAILABLE: 'Images cannot be saved right now. Try again shortly.',
} as const;
export type ImageErrorCode = keyof typeof imageMessages;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Exact public projection; storage keys, original filenames, hashes and actor ids are never permitted. */
export function expectImage(image: ImageView): void {
  expect(Object.keys(image).sort()).toEqual(imageKeys);
  expect(image.id).toMatch(uuid);
  expect(['image/png', 'image/jpeg']).toContain(image.contentType);
  expect(image.url).toBe(`/api/public/product-images/${image.id}.${image.contentType === 'image/png' ? 'png' : 'jpg'}`);
  for (const size of [image.width, image.height]) {
    expect(Number.isInteger(size)).toBe(true);
    expect(size).toBeGreaterThanOrEqual(1);
    expect(size).toBeLessThanOrEqual(4096);
  }
  expect(Number.isInteger(image.byteSize)).toBe(true);
  expect(image.byteSize).toBeGreaterThanOrEqual(1);
  expect(image.byteSize).toBeLessThanOrEqual(maxImageBytes);
  expect(Number.isSafeInteger(image.version)).toBe(true);
  expect(image.version).toBeGreaterThanOrEqual(0);
  expect(Number.isInteger(image.position)).toBe(true);
  expect(image.position).toBeGreaterThanOrEqual(0);
  expect(image.position).toBeLessThan(8);
  expect(image.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  expect(Number.isNaN(Date.parse(image.createdAt))).toBe(false);
  if (image.altText !== null) {
    expect(typeof image.altText).toBe('string');
    expect(image.altText.length).toBeGreaterThan(0);
    expect(image.altText.length).toBeLessThanOrEqual(160);
    // Java String.trim() removes only U+0000–U+0020; NBSP/BOM are accepted catalog text.
    expect(image.altText.charCodeAt(0)).toBeGreaterThan(0x20);
    expect(image.altText.charCodeAt(image.altText.length - 1)).toBeGreaterThan(0x20);
    expect([...image.altText].some((c) => c.charCodeAt(0) < 32 || (c.charCodeAt(0) >= 127 && c.charCodeAt(0) <= 159))).toBe(false);
  }
}

export async function expectImageError(response: APIResponse, status: number, code: ImageErrorCode): Promise<void> {
  expect(response.status(), `HTTP status for ${code}`).toBe(status);
  const body = await response.json() as Record<string, unknown>;
  expect(Object.keys(body).sort()).toEqual(['code', 'message', 'requestId']);
  expect(body.code).toBe(code);
  expect(body.message).toBe(imageMessages[code]);
  expect(typeof body.requestId).toBe('string');
  expect(String(body.requestId)).not.toBe('');
  expect(response.headers()['x-request-id']).toBe(body.requestId);
  expect(response.headers()['cache-control']).toBe('no-store');
}

/** All successful staff image routes preserve response correlation and prevent caching. */
export function expectImageSuccess(response: APIResponse): void {
  expect(response.ok()).toBe(true);
  expect(response.headers()['x-request-id']).toBeTruthy();
  expect(response.headers()['cache-control']).toBe('no-store');
}
async function checkImageSuccess(response: APIResponse): Promise<APIResponse> {
  if (response.ok()) expectImageSuccess(response);
  return response;
}

export type UploadOptions = {
  id?: string; name?: string; mimeType?: string; altText?: string; replaces?: string;
  extraParts?: Record<string, string | { name: string; mimeType: string; buffer: Buffer }>;
};
export function imagesRoute(productId: string): string { return `/api/staff/products/${productId}/images`; }
export async function uploadImage(api: APIRequestContext, actor: ApiActor, productId: string, bytes: Buffer,
                                  options: UploadOptions = {}): Promise<APIResponse> {
  return checkImageSuccess(await api.post(imagesRoute(productId), {
    headers: await actor.authorization(),
    multipart: {
      id: options.id ?? randomUUID(),
      file: { name: options.name ?? 'front.png', mimeType: options.mimeType ?? 'image/png', buffer: bytes },
      ...(options.altText !== undefined ? { altText: options.altText } : {}),
      ...(options.replaces !== undefined ? { replaces: options.replaces } : {}),
      ...options.extraParts,
    },
  }));
}
export async function listImages(actor: ApiActor, productId: string): Promise<ImageList> {
  const response = await actor.get(imagesRoute(productId));
  expectImageSuccess(response);
  const body = await expectJson<ImageList>(response, 200);
  expect(Object.keys(body).sort()).toEqual(['images', 'maxImages']);
  expect(body.maxImages).toBe(8);
  expect(body.images.length).toBeLessThanOrEqual(8);
  body.images.forEach((image, index) => { expectImage(image); expect(image.position).toBe(index); });
  expect(new Set(body.images.map((image) => image.id)).size).toBe(body.images.length);
  return body;
}
export async function updateAlt(actor: ApiActor, productId: string, image: ImageView, altText: string | null): Promise<APIResponse> {
  return checkImageSuccess(await actor.put(`${imagesRoute(productId)}/${image.id}`, { altText, version: image.version }));
}
export async function reorderImages(actor: ApiActor, productId: string, imageIds: string[], expectedImageIds = imageIds):
  Promise<APIResponse> {
  return checkImageSuccess(await actor.put(`/api/staff/products/${productId}/image-order`, { imageIds, expectedImageIds }));
}
export async function removeImage(actor: ApiActor, productId: string, imageId: string): Promise<APIResponse> {
  return checkImageSuccess(await actor.send('DELETE', `${imagesRoute(productId)}/${imageId}`));
}
export function publicImage(url: string): string {
  const match = /^\/api\/public\/product-images\/([^/]+)\.(png|jpg)$/.exec(url);
  if (!match || !uuid.test(match[1])) throw new Error('Not a public image path');
  return new URL(url, apiUrl).href;
}
export function optimizerUrl(publicUrl: string, w = 640, q = 75): string {
  const url = new URL('/_next/image', frontendUrl);
  url.search = new URLSearchParams({ url: publicUrl.startsWith('/') ? publicImage(publicUrl) : publicUrl,
    w: String(w), q: String(q) }).toString();
  return url.href;
}
export function optimizedImage(api: APIRequestContext, publicUrl: string, w = 640, q = 75): Promise<APIResponse> {
  return api.get(optimizerUrl(publicUrl, w, q), { headers: { Accept: 'image/webp,*/*' } });
}

/** Only the harness-owned test namespace is ever inspected; symlinks are refused. */
export function storageDirectory(): string {
  const schema = checkedTarget('storageDirectory');
  const directory = process.env.MEDI_WISH_TEST_STORAGE_DIR ?? '';
  const expected = path.resolve(import.meta.dirname, '../../../backend/target/test-object-storage',
    `test-browser-${schema.slice('mw_browser_'.length)}`);
  if (!path.isAbsolute(directory) || path.resolve(directory) !== expected) {
    throw new Error('Image tests require the harness-owned test-browser storage namespace');
  }
  if (existsSync(directory) && realpathSync(directory) !== path.resolve(directory)) {
    throw new Error('Image storage namespace must not be a symbolic link');
  }
  return directory;
}
export function storageFiles(): string[] {
  const root = storageDirectory();
  if (!existsSync(root)) return [];
  const files: string[] = [];
  function walk(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('Unexpected symbolic link in image storage');
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files.push(path.relative(root, full).split(path.sep).join('/'));
    }
  }
  walk(root);
  return files.sort();
}
export function imagePath(productId: string, image: Pick<ImageView, 'id' | 'contentType'>): string {
  if (!uuid.test(productId) || !uuid.test(image.id)) throw new Error('Image object paths require lowercase UUIDs');
  if (!['image/png', 'image/jpeg'].includes(image.contentType)) throw new Error('Unsupported image object type');
  const object = path.join(storageDirectory(), 'products', productId,
    `${image.id}.${image.contentType === 'image/png' ? 'png' : 'jpg'}`);
  for (let candidate = object; candidate !== path.dirname(candidate); candidate = path.dirname(candidate)) {
    if (existsSync(candidate) && realpathSync(candidate) !== path.resolve(candidate)) {
      throw new Error('Image object paths must not cross a symbolic link');
    }
  }
  return object;
}
export async function openImages(page: Page, product: { id: string; name: string }): Promise<void> {
  await openProduct(page, product);
  await expect(page.getByRole('heading', { name: 'Images', exact: true })).toBeVisible();
}
