import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { APIRequestContext } from '@playwright/test';
import {
  createCategory, createProduct, equipmentDraft, expect, expectJson, getProduct, test, type ApiActor,
} from './catalogSupport';
import { pngFixture, validJpeg, validPng } from './imageFixtures';
import {
  expectImage, expectImageError, expectImageSuccess, imagePath, listImages, optimizedImage, optimizerUrl, publicImage, removeImage, reorderImages,
  storageDirectory, storageFiles, updateAlt, uploadImage, type ImageView,
} from './productImageSupport';
import { apiLogPath, apiUrl, frontendUrl } from './testApi';
import { blockedRequests, race, withProductLock } from './productImageConcurrencySupport';

const recoveryTags = ['@t15', '@t15-T6', '@regression'];

async function product(actor: ApiActor) {
  return createProduct(actor, equipmentDraft((await createCategory(actor)).id));
}

async function added(api: APIRequestContext, actor: ApiActor, productId: string,
                     options: { id?: string; replaces?: string; altText?: string } = {}): Promise<ImageView> {
  const image = await expectJson<ImageView>(await uploadImage(api, actor, productId, validPng(), options), 201);
  expectImage(image);
  return image;
}


function productFiles(productId: string): string[] {
  return storageFiles().filter((file) => file.replaceAll('\\', '/').startsWith(`products/${productId}/`));
}

async function expectLive(api: APIRequestContext, image: ImageView): Promise<void> {
  const response = await api.get(publicImage(image.url));
  expect(response.status()).toBe(200);
  expect((await response.body()).length).toBe(image.byteSize);
}

test('E2E-15-09 optimizer emits WebP only for the exact public image allowlist',
  { tag: ['@t15', '@t15-T5', '@security'] }, async ({ api, actors, page }) => {
    const admin = await actors('admin');
    const item = await product(admin);
    const image = await added(api, admin, item.id);
    const jpeg = await expectJson<ImageView>(await uploadImage(api, admin, item.id, validJpeg(),
      { name: 'front.jpg', mimeType: 'image/jpeg' }), 201);
    expectImage(jpeg);
    const url = publicImage(image.url);
    await page.goto('/');
    for (const source of [image, jpeg]) {
      const allowed = await optimizedImage(api, publicImage(source.url));
      expect(allowed.status()).toBe(200);
      expect(allowed.headers()['content-type']).toBe('image/webp');
      const body = await allowed.body();
      expect(body.subarray(0, 4).toString()).toBe('RIFF');
      expect(body.subarray(8, 12).toString()).toBe('WEBP');
      expect(body.readUInt32LE(4) + 8).toBe(body.length);
      const decoded = await page.evaluate(async ({ original, optimized }) => {
        const pixels = async (bytes: number[]) => {
          const bitmap = await createImageBitmap(new Blob([Uint8Array.from(bytes)]));
          try {
            const canvas = document.createElement('canvas');
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            const context = canvas.getContext('2d');
            if (!context) throw new Error('No independent image decode context');
            context.drawImage(bitmap, 0, 0);
            return { width: bitmap.width, height: bitmap.height,
              data: context.getImageData(0, 0, bitmap.width, bitmap.height).data };
          } finally { bitmap.close(); }
        };
        const expected = await pixels(original);
        const actual = await pixels(optimized);
        if (actual.data.length !== expected.data.length) throw new Error('Optimizer pixel count changed');
        let rgbDifference = 0;
        let alphaMismatches = 0;
        for (let offset = 0; offset < expected.data.length; offset += 1) {
          if (offset % 4 === 3) alphaMismatches += Number(actual.data[offset] !== expected.data[offset]);
          else rgbDifference += Math.abs(actual.data[offset] - expected.data[offset]);
        }
        return { width: actual.width, height: actual.height, alphaMismatches,
          meanRgbDifference: rgbDifference / (expected.data.length / 4 * 3) };
      }, { original: [...(source === image ? validPng() : validJpeg())], optimized: [...body] });
      // withoutEnlargement retains these fixtures' dimensions; WebP q75 is deliberately lossy.
      expect({ width: decoded.width, height: decoded.height }).toEqual({ width: source.width, height: source.height });
      expect(decoded.alphaMismatches).toBe(0);
      // Pinned-codec means are 46.65 for this noisy PNG and 1.17 for this flat JPEG, in both browsers.
      expect(decoded.meanRgbDifference, 'optimizer preserves this uploaded fixture content')
        .toBeLessThanOrEqual(source === image ? 55 : 3);
      expect(allowed.headers()['x-request-id']).toBeUndefined();
    }

    // A reachable wrong-port source distinguishes allowlist refusal from a failed upstream fetch.
    let connections = 0;
    const listener = createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'image/png' });
      response.end(validPng());
    });
    listener.on('connection', () => { connections += 1; });
    listener.listen(0, '127.0.0.1');
    await once(listener, 'listening');
    try {
      const address = listener.address();
      if (!address || typeof address === 'string') throw new Error('No controlled image listener address');
      const reachable = new URL(url);
      reachable.port = String(address.port);
      const response = await optimizedImage(api, reachable.href);
      expect(response.status(), 'reachable upstream with a disallowed port').toBe(400);
      expect(connections, 'optimizer refused the URL before any outbound connection').toBe(0);
    } finally {
      const closed = once(listener, 'close');
      listener.close();
      await closed;
    }

    const refused: [string, string, number, number][] = [
      ['protected API path', `${apiUrl}/api/staff/products`, 640, 75],
      ['external host', 'https://example.com/api/public/product-images/photo.png', 640, 75],
      ['cloud metadata', 'http://169.254.169.254/latest/meta-data/', 640, 75],
      ['upstream query', `${url}?x=1`, 640, 75],
      ['same-origin relative path', '/staff/products', 640, 75],
      ['same-origin absolute path', `${frontendUrl}/staff/products`, 640, 75],
      ['alternate loopback host', url.replace('127.0.0.1', 'localhost'), 640, 75],
      ['wrong upstream port', url.replace(new URL(apiUrl).origin, 'http://127.0.0.1:18116'), 640, 75],
      ['wrong upstream protocol', url.replace('http:', 'https:'), 640, 75],
      ['unaccepted quality', url, 640, 50],
      ['unaccepted width', url, 641, 75],
    ];
    for (const [label, upstream, width, quality] of refused) {
      const requestUrl = new URL(optimizerUrl(url, width, quality));
      requestUrl.searchParams.set('url', upstream);
      const response = await api.get(requestUrl.href,
        { headers: { Accept: 'image/webp,*/*' } });
      expect(response.status(), label).toBe(400);
      expect(response.headers()['x-request-id'], label).toBeUndefined();
      expect(response.headers()['content-type'] ?? '', label).not.toMatch(/application\/json|^image\//);
      expect(await response.text(), label).not.toContain('"requestId"');
    }
  });

for (const scenario of [
  { label: 'remove PNG', original: 'png', replacement: undefined },
  { label: 'remove JPEG', original: 'jpg', replacement: undefined },
  { label: 'replace PNG with JPEG', original: 'png', replacement: 'jpg' },
  { label: 'replace JPEG with PNG', original: 'jpg', replacement: 'png' },
] as const) {
  test(`E2E-15-25 built optimizer has a 60-second bound and immediate ${scenario.label} takedown`,
    { tag: ['@t15', '@t15-T5', '@regression'] }, async ({ api, actors, page }) => {
      const admin = await actors('admin');
      const item = await product(admin);
      const upload = async (format: 'png' | 'jpg', replaces?: string) => {
        const image = await expectJson<ImageView>(await uploadImage(api, admin, item.id,
          format === 'png' ? validPng() : validJpeg(), {
            name: `front.${format}`, mimeType: format === 'png' ? 'image/png' : 'image/jpeg', replaces,
          }), 201);
        expectImage(image);
        expect(image).toMatchObject({ contentType: format === 'png' ? 'image/png' : 'image/jpeg',
          width: format === 'png' ? 32 : 8, height: format === 'png' ? 24 : 6 });
        expect(path.basename(imagePath(item.id, image))).toBe(`${image.id}.${format}`);
        return image;
      };
      const image = await upload(scenario.original);
      const oldPath = imagePath(item.id, image);
      expect(existsSync(oldPath)).toBe(true);
      const origin = await api.get(publicImage(image.url));
      expect(origin.status()).toBe(200);
      expect(origin.headers()['cache-control']).toBe('public, max-age=60');
      for (let request = 0; request < 2; request += 1) {
        const response = await optimizedImage(api, publicImage(image.url), 640, 75);
        expect(response.status()).toBe(200);
        expect(response.headers()['content-type']).toBe('image/webp');
        expect(response.headers()['x-nextjs-cache']).toBe('MISS');
        expect(response.headers()['cache-control']).toBe('public, max-age=60, must-revalidate');
      }
      let replacement: ImageView | undefined;
      if (!scenario.replacement) expect((await removeImage(admin, item.id, image.id)).status()).toBe(204);
      else replacement = await upload(scenario.replacement, image.id);
      // Check the exact key immediately after the mutation, before issuing any other request.
      expect(existsSync(oldPath), 'the request already deleted the retired object').toBe(false);
      // The very next optimizer request must fail. Polling would conceal a stale optimizer cache.
      expect((await optimizedImage(api, publicImage(image.url), 640, 75)).status()).toBe(404);
      await expectImageError(await api.get(publicImage(image.url)), 404, 'NOT_FOUND');
      expect((await listImages(admin, item.id)).images).toEqual(replacement ? [replacement] : []);
      expect(productFiles(item.id)).toEqual(replacement
        ? [`products/${item.id}/${path.basename(imagePath(item.id, replacement))}`] : []);
      if (replacement) {
        expect(replacement.id).not.toBe(image.id);
        expect(replacement.position).toBe(image.position);
        const stored = readFileSync(imagePath(item.id, replacement));
        const response = await api.get(publicImage(replacement.url));
        expect(response.status()).toBe(200);
        expect(response.headers()['content-type']).toBe(replacement.contentType);
        expect(await response.body()).toEqual(stored);
        const optimized = await optimizedImage(api, publicImage(replacement.url));
        expect(optimized.status()).toBe(200);
        expect(optimized.headers()['content-type']).toBe('image/webp');
        await page.goto('/');
        const dimensions = await page.evaluate(async (bytes) => {
          const decoded = await createImageBitmap(new Blob([Uint8Array.from(bytes)], { type: 'image/webp' }));
          try { return { width: decoded.width, height: decoded.height }; }
          finally { decoded.close(); }
        }, [...await optimized.body()]);
        expect(dimensions).toEqual({ width: replacement.width, height: replacement.height });
      }
    });
}

test('E2E-15-26 concurrent uploads serialize the last image slot without a loser file',
  { tag: recoveryTags }, async ({ api, actors }) => {
    const [admin, moderator] = await Promise.all([actors('admin'), actors('moderator')]);
    const item = await product(admin);
    for (let index = 0; index < 7; index += 1) await added(api, admin, item.id);
    const ids = [randomUUID(), randomUUID()];
    const responses = await race([item.id], [
      () => uploadImage(api, admin, item.id, validPng(), { id: ids[0] }),
      () => uploadImage(api, moderator, item.id, validPng(), { id: ids[1] }),
    ]);
    expect(responses.map((response) => response.status()).sort()).toEqual([201, 409]);
    await expectImageError(responses.find((response) => response.status() === 409)!, 409, 'IMAGE_LIMIT_REACHED');
    const images = (await listImages(admin, item.id)).images;
    expect(images).toHaveLength(8);
    expect(images.map((image) => image.position)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(ids.filter((id) => images.some((image) => image.id === id))).toHaveLength(1);
    expect(productFiles(item.id)).toHaveLength(8);
    for (const image of images) expect(existsSync(imagePath(item.id, image))).toBe(true);
  });

test('E2E-15-27 concurrent identical uploads replay successfully at the last slot',
  { tag: recoveryTags }, async ({ api, actors }) => {
    const [admin, moderator] = await Promise.all([actors('admin'), actors('moderator')]);
    const item = await product(admin);
    for (let index = 0; index < 7; index += 1) await added(api, admin, item.id);
    const id = randomUUID();
    const responses = await race([item.id], [
      () => uploadImage(api, admin, item.id, validPng(), { id, altText: 'Same synthetic view' }),
      () => uploadImage(api, moderator, item.id, validPng(), { id, altText: 'Same synthetic view' }),
    ]);
    expect(responses.map((response) => response.status()).sort()).toEqual([200, 201]);
    expect(await responses[0].json()).toEqual(await responses[1].json());
    const images = (await listImages(admin, item.id)).images;
    expect(images).toHaveLength(8);
    const matches = images.filter((image) => image.id === id);
    expect(matches).toHaveLength(1);
    expect(productFiles(item.id)).toHaveLength(8);
    await expectLive(api, matches[0]);
  });

test('E2E-15-27 concurrent identical replacements replay despite a retired target at capacity',
  { tag: recoveryTags }, async ({ api, actors }) => {
    const [admin, moderator] = await Promise.all([actors('admin'), actors('moderator')]);
    const item = await product(admin);
    const initial: ImageView[] = [];
    for (let index = 0; index < 8; index += 1) initial.push(await added(api, admin, item.id));
    const beforeProduct = await getProduct(admin, item.id);
    const original = initial[3];
    const initialBytes = initial.map((image) => readFileSync(imagePath(item.id, image)));
    const bytes = validPng();
    const options = { id: randomUUID(), replaces: original.id, altText: 'Same synthetic replacement' };
    const responses = await race([item.id], [
      () => uploadImage(api, admin, item.id, bytes, options),
      () => uploadImage(api, moderator, item.id, bytes, options),
    ]);
    expect(responses.map((response) => response.status()).sort()).toEqual([200, 201]);
    const replacement = await expectJson<ImageView>(responses[0], responses[0].status());
    expectImage(replacement);
    expect(await expectJson<ImageView>(responses[1], responses[1].status())).toEqual(replacement);
    expect(replacement).toMatchObject({ id: options.id, position: original.position,
      altText: options.altText, contentType: original.contentType, width: original.width,
      height: original.height, byteSize: initialBytes[3].length });
    const expected = initial.map((image) => image.id === original.id ? replacement : image);
    expect((await listImages(admin, item.id)).images).toEqual(expected);
    expect(productFiles(item.id)).toEqual(expected.map((image) =>
      `products/${item.id}/${path.basename(imagePath(item.id, image))}`).sort());
    expect(existsSync(imagePath(item.id, original))).toBe(false);
    await expectImageError(await api.get(publicImage(original.url)), 404, 'NOT_FOUND');
    for (const [index, image] of expected.entries()) {
      // Each initial upload independently established the runtime's sanitized bytes for this same input.
      expect(readFileSync(imagePath(item.id, image))).toEqual(initialBytes[index]);
      const live = await api.get(publicImage(image.url));
      expect(live.status()).toBe(200);
      expect(await live.body()).toEqual(initialBytes[index]);
    }
    await expectImageError(await uploadImage(api, admin, item.id, bytes, { id: original.id }), 409, 'ID_CONFLICT');
    expect(await expectJson<ImageView>(await uploadImage(api, moderator, item.id, bytes, options), 200))
      .toEqual(replacement);
    expect((await listImages(admin, item.id)).images).toEqual(expected);
    expect(productFiles(item.id)).toEqual(expected.map((image) =>
      `products/${item.id}/${path.basename(imagePath(item.id, image))}`).sort());
    expect(await getProduct(admin, item.id)).toEqual(beforeProduct);
  });

test('E2E-15-28 conflicting reorders from the same view preserve only the winner order',
  { tag: recoveryTags }, async ({ api, actors }) => {
    const [admin, moderator] = await Promise.all([actors('admin'), actors('moderator')]);
    const item = await product(admin);
    const beforeProduct = await getProduct(admin, item.id);
    const initial: ImageView[] = [];
    for (let index = 0; index < 3; index += 1) initial.push(await added(api, admin, item.id));
    const ids = initial.map((image) => image.id);
    const orders = [[ids[1], ids[0], ids[2]], [ids[2], ids[0], ids[1]]];
    const responses = await race([item.id], [
      () => reorderImages(admin, item.id, orders[0], ids),
      () => reorderImages(moderator, item.id, orders[1], ids),
    ]);
    expect(responses.map((response) => response.status()).sort()).toEqual([200, 409]);
    await expectImageError(responses.find((response) => response.status() === 409)!, 409, 'STALE_UPDATE');
    const winner = responses.findIndex((response) => response.status() === 200);
    const after = await listImages(admin, item.id);
    expect(after.images.map((image) => image.id)).toEqual(orders[winner]);
    expect(after.images.map((image) => image.position)).toEqual([0, 1, 2]);
    expect(await getProduct(admin, item.id)).toEqual(beforeProduct);
  });

test('E2E-15-29 concurrent descriptions consume one image version and leave Product unchanged',
  { tag: recoveryTags }, async ({ api, actors }) => {
    const [admin, moderator] = await Promise.all([actors('admin'), actors('moderator')]);
    const item = await product(admin);
    const image = await added(api, admin, item.id);
    const before = await getProduct(admin, item.id);
    const texts = ['Synthetic front', 'Synthetic rear'];
    const responses = await race([item.id], [
      () => updateAlt(admin, item.id, image, texts[0]),
      () => updateAlt(moderator, item.id, image, texts[1]),
    ]);
    expect(responses.map((response) => response.status()).sort()).toEqual([200, 409]);
    await expectImageError(responses.find((response) => response.status() === 409)!, 409, 'STALE_UPDATE');
    const stored = (await listImages(admin, item.id)).images[0];
    expect(stored.altText).toBe(texts[responses.findIndex((response) => response.status() === 200)]);
    expect(stored.version).toBe(image.version + 1);
    expect(await getProduct(admin, item.id)).toEqual(before);
    await expectLive(api, stored);
  });

test('E2E-15-30 remove and reorder overlap without gaps or resurrecting a retired image',
  { tag: recoveryTags }, async ({ api, actors }) => {
    const [admin, moderator] = await Promise.all([actors('admin'), actors('moderator')]);
    const item = await product(admin);
    const initial: ImageView[] = [];
    for (let index = 0; index < 3; index += 1) initial.push(await added(api, admin, item.id));
    const ids = initial.map((image) => image.id);
    const responses = await race([item.id], [
      () => removeImage(admin, item.id, ids[1]),
      () => reorderImages(moderator, item.id, [...ids].reverse(), ids),
    ]);
    expect(responses[0].status()).toBe(204);
    expect([200, 409]).toContain(responses[1].status());
    if (responses[1].status() === 409) await expectImageError(responses[1], 409, 'STALE_UPDATE');
    const after = (await listImages(admin, item.id)).images;
    expect(after.map((image) => image.id)).toEqual(responses[1].status() === 200 ? [ids[2], ids[0]] : [ids[0], ids[2]]);
    expect(after.map((image) => image.position)).toEqual([0, 1]);
    expect(existsSync(imagePath(item.id, initial[1]))).toBe(false);
    await expectImageError(await api.get(publicImage(initial[1].url)), 404, 'NOT_FOUND');
    for (const image of after) await expectLive(api, image);
  });

for (const format of ['png', 'jpg'] as const) {
  for (const operation of ['remove', 'replace'] as const) {
    test(`E2E-15-31 ${operation} retires a ${format} identity across formats and Products`,
      { tag: recoveryTags }, async ({ api, actors }) => {
        const admin = await actors('admin');
        const original = await product(admin);
        const other = await product(admin);
        const beforeProducts = [await getProduct(admin, original.id), await getProduct(admin, other.id)];
        const retired = await expectJson<ImageView>(await uploadImage(api, admin, original.id,
          format === 'png' ? validPng() : validJpeg(),
          { name: `front.${format}`, mimeType: format === 'png' ? 'image/png' : 'image/jpeg' }), 201);
        expectImage(retired);
        let replacement: ImageView | undefined;
        if (operation === 'remove') expect((await removeImage(admin, original.id, retired.id)).status()).toBe(204);
        else {
          replacement = await expectJson<ImageView>(await uploadImage(api, admin, original.id,
            format === 'png' ? validJpeg() : validPng(), { replaces: retired.id,
              name: format === 'png' ? 'rear.jpg' : 'rear.png',
              mimeType: format === 'png' ? 'image/jpeg' : 'image/png' }), 201);
          expectImage(replacement);
        }
        const before = [await listImages(admin, original.id), await listImages(admin, other.id)];
        expect(before[0].images).toEqual(replacement ? [replacement] : []);
        expect(before[1].images).toEqual([]);
        const files = [productFiles(original.id), productFiles(other.id)];
        const existing = before[0].images.map((image) => ({ image, bytes: readFileSync(imagePath(original.id, image)) }));
        for (const [index, productId] of [original.id, other.id].entries()) {
          for (const retryFormat of ['png', 'jpg'] as const) {
            await expectImageError(await uploadImage(api, admin, productId,
              retryFormat === 'png' ? validPng() : validJpeg(), { id: retired.id,
                name: `retry.${retryFormat}`, mimeType: retryFormat === 'png' ? 'image/png' : 'image/jpeg' }),
            409, 'ID_CONFLICT');
            expect(await listImages(admin, productId)).toEqual(before[index]);
            expect(productFiles(productId)).toEqual(files[index]);
            expect(await getProduct(admin, productId)).toEqual(beforeProducts[index]);
          }
        }
        for (const { image, bytes } of existing) {
          expect(readFileSync(imagePath(original.id, image))).toEqual(bytes);
          const response = await api.get(publicImage(image.url));
          expect(response.status()).toBe(200);
          expect(await response.body()).toEqual(bytes);
        }
        for (const extension of ['png', 'jpg'] as const) {
          const url = `${apiUrl}/api/public/product-images/${retired.id}.${extension}`;
          await expectImageError(await api.get(url), 404, 'NOT_FOUND');
          expect((await optimizedImage(api, url)).status()).toBe(404);
          for (const productId of [original.id, other.id]) {
            expect(existsSync(imagePath(productId, { id: retired.id,
              contentType: extension === 'png' ? 'image/png' : 'image/jpeg' }))).toBe(false);
          }
        }
        expect(await listImages(admin, original.id)).toEqual(before[0]);
      });
  }
}

test('E2E-15-32 same identity racing across Products leaves one row and no losing object',
  { tag: recoveryTags }, async ({ api, actors }) => {
    const [admin, moderator] = await Promise.all([actors('admin'), actors('moderator')]);
    const items = [await product(admin), await product(admin)];
    const id = randomUUID();
    const responses = await race(items.map((item) => item.id), [
      () => uploadImage(api, admin, items[0].id, validPng(), { id }),
      () => uploadImage(api, moderator, items[1].id, validPng(), { id }),
    ]);
    expect(responses.map((response) => response.status()).sort()).toEqual([201, 409]);
    await expectImageError(responses.find((response) => response.status() === 409)!, 409, 'ID_CONFLICT');
    const winner = responses.findIndex((response) => response.status() === 201);
    for (let index = 0; index < items.length; index += 1) {
      const images = (await listImages(admin, items[index].id)).images;
      expect(images).toHaveLength(index === winner ? 1 : 0);
      expect(productFiles(items[index].id)).toHaveLength(index === winner ? 1 : 0);
      if (images.length) { expect(images[0].id).toBe(id); await expectLive(api, images[0]); }
    }
  });

test('E2E-15-33 a real local-storage write failure is bounded and the same intent retries safely',
  { tag: recoveryTags }, async ({ api, actors }) => {
    const admin = await actors('admin');
    const item = await product(admin);
    const id = randomUUID();
    // imagePath checks the run-owned namespace before we derive its Product directory.
    const file = imagePath(item.id, { id, contentType: 'image/png' });
    const directory = path.dirname(file);
    expect(existsSync(directory)).toBe(false);
    mkdirSync(path.dirname(directory), { recursive: true });
    writeFileSync(directory, 'synthetic storage blocker', { flag: 'wx' });
    try {
      await expectImageError(await uploadImage(api, admin, item.id, validPng(), { id }), 503, 'STORAGE_UNAVAILABLE');
      expect((await listImages(admin, item.id)).images).toEqual([]);
      await expectImageError(await api.get(`${apiUrl}/api/public/product-images/${id}.png`), 404, 'NOT_FOUND');
    } finally {
      unlinkSync(directory);
    }
    const image = await added(api, admin, item.id, { id });
    expect(image.id).toBe(id);
    expect(productFiles(item.id)).toHaveLength(1);
    expect(await expectJson<ImageView>(await uploadImage(api, admin, item.id, validPng(), { id }), 200)).toEqual(image);
    await expectLive(api, image);
  });

test('E2E-15-34 a missing local object returns private 404 while metadata and other objects survive',
  { tag: recoveryTags }, async ({ api, actors }) => {
    const admin = await actors('admin');
    const item = await product(admin);
    const missing = await added(api, admin, item.id);
    const kept = await added(api, admin, item.id);
    const before = await listImages(admin, item.id);
    const file = imagePath(item.id, missing);
    const bytes = readFileSync(file);
    const hidden = `${file}.hidden-${randomUUID()}`;
    renameSync(file, hidden);
    try {
      await expectImageError(await api.get(publicImage(missing.url)), 404, 'NOT_FOUND');
      expect((await optimizedImage(api, publicImage(missing.url))).status()).toBe(404);
      expect(await listImages(admin, item.id)).toEqual(before);
      await expectLive(api, kept);
    } finally {
      renameSync(hidden, file);
    }
    const restored = await api.get(publicImage(missing.url));
    expect(restored.status()).toBe(200);
    expect(await restored.body()).toEqual(bytes);
  });

test('E2E-15-35 a lost HTTP upload response commits once and replays the same stored image',
  { tag: recoveryTags }, async ({ api, actors, playwright }) => {
    const admin = await actors('admin');
    const item = await product(admin);
    const id = randomUUID();
    const headers = await admin.authorization();
    const disconnected = await playwright.request.newContext({ baseURL: apiUrl });
    try {
      await withProductLock([item.id], async (pid) => {
        const lost = disconnected.post(`/api/staff/products/${item.id}/images`, {
          headers,
          multipart: { id, altText: 'Lost synthetic response',
            file: { name: 'front.png', mimeType: 'image/png', buffer: validPng() } },
        });
        const outcome = lost.then(() => 'answered', () => 'connection lost');
        await blockedRequests(pid, 1);
        // Disconnect only after server receipt, before the existing 3-second JDBC timeout.
        await disconnected.dispose({ reason: 'Synthetic lost HTTP response' });
        expect(await outcome).toBe('connection lost');
      });
    } finally {
      await disconnected.dispose();
    }
    await expect.poll(async () => (await listImages(admin, item.id)).images.map((image) => image.id),
      { message: 'the server committed despite losing its HTTP response', timeout: 10_000 }).toEqual([id]);
    const stored = (await listImages(admin, item.id)).images[0];
    const replay = await expectJson<ImageView>(await uploadImage(api, admin, item.id, validPng(),
      { id, altText: 'Lost synthetic response' }), 200);
    expect(replay).toEqual(stored);
    expect(productFiles(item.id)).toHaveLength(1);
    await expectLive(api, stored);
  });

test('E2E-15-36 competing replacements preserve one new image in the original position',
  { tag: recoveryTags }, async ({ api, actors }) => {
    const [admin, moderator] = await Promise.all([actors('admin'), actors('moderator')]);
    const item = await product(admin);
    const kept = await added(api, admin, item.id);
    const original = await added(api, admin, item.id);
    const keptBytes = readFileSync(imagePath(item.id, kept));
    const beforeProduct = await getProduct(admin, item.id);
    const candidates = [
      { bytes: validPng(), name: 'front.png', mimeType: 'image/png' },
      { bytes: validJpeg(), name: 'rear.jpg', mimeType: 'image/jpeg' },
    ];
    // Capture each candidate's deterministic sanitized output on this server runtime, independently of the race.
    const controls: { image: ImageView; bytes: Buffer }[] = [];
    for (const candidate of candidates) {
      const controlProduct = await product(admin);
      const image = await expectJson<ImageView>(await uploadImage(api, admin, controlProduct.id,
        candidate.bytes, { name: candidate.name, mimeType: candidate.mimeType }), 201);
      expectImage(image);
      const response = await api.get(publicImage(image.url));
      expect(response.status()).toBe(200);
      const bytes = await response.body();
      expect(bytes).toEqual(readFileSync(imagePath(controlProduct.id, image)));
      controls.push({ image, bytes });
    }
    expect(controls[0].bytes.equals(controls[1].bytes)).toBe(false);
    const ids = [randomUUID(), randomUUID()];
    const responses = await race([item.id], candidates.map((candidate, index) =>
      () => uploadImage(api, index === 0 ? admin : moderator, item.id, candidate.bytes,
        { id: ids[index], replaces: original.id, name: candidate.name, mimeType: candidate.mimeType })));
    expect(responses.map((response) => response.status()).sort()).toEqual([201, 404]);
    const winner = responses.findIndex((response) => response.status() === 201);
    await expectImageError(responses[1 - winner], 404, 'NOT_FOUND');
    const stored = await expectJson<ImageView>(responses[winner], 201);
    expectImage(stored);
    const control = controls[winner];
    expect(stored).toMatchObject({ id: ids[winner], position: original.position,
      contentType: control.image.contentType, width: control.image.width, height: control.image.height,
      byteSize: control.bytes.length });
    const images = (await listImages(admin, item.id)).images;
    expect(images).toEqual([kept, stored]);
    expect(productFiles(item.id)).toEqual(images.map((image) =>
      `products/${item.id}/${path.basename(imagePath(item.id, image))}`).sort());
    expect(existsSync(imagePath(item.id, original))).toBe(false);
    expect(readFileSync(imagePath(item.id, kept))).toEqual(keptBytes);
    expect(readFileSync(imagePath(item.id, stored))).toEqual(control.bytes);
    await expectImageError(await api.get(publicImage(original.url)), 404, 'NOT_FOUND');
    expect((await optimizedImage(api, publicImage(original.url))).status()).toBe(404);
    const publicWinner = await api.get(publicImage(stored.url));
    expect(publicWinner.status()).toBe(200);
    expect(publicWinner.headers()['content-type']).toBe(control.image.contentType);
    expect(await publicWinner.body()).toEqual(control.bytes);
    expect(await (await api.get(publicImage(kept.url))).body()).toEqual(keptBytes);
    expect(await getProduct(admin, item.id)).toEqual(beforeProduct);
  });

test('E2E-15-37 local public reads never fall back from the test namespace to a production path',
  { tag: [...recoveryTags, '@security'] }, async ({ api, actors }) => {
    const admin = await actors('admin');
    const item = await product(admin);
    const image = await added(api, admin, item.id);
    const namespace = storageDirectory();
    const root = path.dirname(namespace);
    const productionName = `prod-${randomBytes(6).toString('hex')}`;
    const productionDirectory = path.join(root, productionName);
    if (!/^prod-[0-9a-f]{12}$/.test(productionName) || path.dirname(productionDirectory) !== root) {
      throw new Error('Namespace probe must own a fresh direct child of the checked storage root');
    }
    const file = imagePath(item.id, image);
    const hidden = `${file}.hidden-${randomUUID()}`;
    const original = readFileSync(file);
    const before = storageFiles();
    const relative = path.relative(namespace, file).split(path.sep).join('/');
    const hiddenRelative = path.relative(namespace, hidden).split(path.sep).join('/');
    let createdProductionDirectory = false;
    let moved = false;
    try {
      // Non-recursive creation refuses an existing namespace: cleanup can never target a pre-existing directory.
      mkdirSync(productionDirectory);
      createdProductionDirectory = true;
      const plantedDirectory = path.join(productionDirectory, 'products', item.id);
      mkdirSync(plantedDirectory, { recursive: true });
      const planted = pngFixture(32, 24, 57);
      expect(planted.equals(original)).toBe(false);
      writeFileSync(path.join(plantedDirectory, `${image.id}.png`), planted, { flag: 'wx' });
      renameSync(file, hidden);
      moved = true;
      // The row exists and its exact key exists in prod-*; the configured test namespace alone is authoritative.
      await expectImageError(await api.get(publicImage(image.url)), 404, 'NOT_FOUND');
      expect((await optimizedImage(api, publicImage(image.url))).status()).toBe(404);
      expect((await listImages(admin, item.id)).images).toEqual([image]);
      expect(storageFiles()).toEqual(before.map((name) => name === relative ? hiddenRelative : name).sort());
      expect(readFileSync(path.join(plantedDirectory, `${image.id}.png`))).toEqual(planted);
    } finally {
      try { if (moved) renameSync(hidden, file); }
      finally { if (createdProductionDirectory) rmSync(productionDirectory, { recursive: true, force: true }); }
    }
    expect(storageFiles()).toEqual(before);
    expect(existsSync(productionDirectory)).toBe(false);
    await expectLive(api, image);
    expect(await (await api.get(publicImage(image.url))).body()).toEqual(original);
  });


for (const difference of ['bytes', 'altText'] as const) {
  test(`E2E-15-38 concurrent same-id uploads with different ${difference} reject the losing intent at capacity`,
    { tag: recoveryTags }, async ({ api, actors }) => {
      const [admin, moderator] = await Promise.all([actors('admin'), actors('moderator')]);
      const item = await product(admin);
      for (let index = 0; index < 7; index += 1) await added(api, admin, item.id);
      const beforeProduct = await getProduct(admin, item.id);
      const beforeImages = (await listImages(admin, item.id)).images;
      const existingBytes = beforeImages.map((image) => readFileSync(imagePath(item.id, image)));
      const id = randomUUID();
      const payloads = [validPng(), difference === 'bytes' ? pngFixture(32, 24, 38) : validPng()];
      // Capture this runtime's deterministic re-encoding rather than compare stored bytes to source PNG bytes.
      const controls: Buffer[] = [];
      for (const payload of payloads) {
        const controlProduct = await product(admin);
        const control = await expectJson<ImageView>(await uploadImage(api, admin, controlProduct.id, payload), 201);
        expectImage(control);
        const response = await api.get(publicImage(control.url));
        expect(response.status()).toBe(200);
        const bytes = await response.body();
        expect(bytes).toEqual(readFileSync(imagePath(controlProduct.id, control)));
        controls.push(bytes);
      }
      expect(controls[0].equals(controls[1])).toBe(difference !== 'bytes');
      const descriptions = ['Synthetic front', difference === 'altText' ? 'Synthetic rear' : 'Synthetic front'];
      const responses = await race([item.id], [
        () => uploadImage(api, admin, item.id, payloads[0], { id, altText: descriptions[0] }),
        () => uploadImage(api, moderator, item.id, payloads[1], { id, altText: descriptions[1] }),
      ]);
      expect(responses.map((response) => response.status()).sort()).toEqual([201, 409]);
      const winner = responses.findIndex((response) => response.status() === 201);
      await expectImageError(responses[1 - winner], 409, 'ID_CONFLICT');
      const stored = await expectJson<ImageView>(responses[winner], 201);
      expectImage(stored);
      expect(stored).toMatchObject({ id, position: 7, altText: descriptions[winner] });
      const images = (await listImages(admin, item.id)).images;
      expect(images).toHaveLength(8);
      expect(images).toEqual([...beforeImages, stored]);
      const files = images.map((image) => `products/${item.id}/${path.basename(imagePath(item.id, image))}`).sort();
      const assertWinnerAndObjects = async () => {
        expect(productFiles(item.id)).toEqual(files);
        for (const [index, image] of beforeImages.entries()) {
          expect(readFileSync(imagePath(item.id, image)), 'existing object bytes remain unchanged').toEqual(existingBytes[index]);
        }
        expect(readFileSync(imagePath(item.id, stored)), 'the winner owns its exact re-encoded bytes').toEqual(controls[winner]);
        const response = await api.get(publicImage(stored.url));
        expect(response.status()).toBe(200);
        expect(await response.body(), 'public bytes belong to the winning intent').toEqual(controls[winner]);
      };
      await assertWinnerAndObjects();
      expect(await expectJson<ImageView>(await uploadImage(api, admin, item.id, payloads[winner],
        { id, altText: descriptions[winner] }), 200)).toEqual(stored);
      await assertWinnerAndObjects();
      await expectImageError(await uploadImage(api, admin, item.id, payloads[1 - winner],
        { id, altText: descriptions[1 - winner] }), 409, 'ID_CONFLICT');
      expect((await listImages(admin, item.id)).images).toEqual(images);
      expect(await getProduct(admin, item.id)).toEqual(beforeProduct);
      await assertWinnerAndObjects();
    });
}

test('E2E-15-39 a lost replacement response replays despite its retired target and preserves the replacement slot',
  { tag: recoveryTags }, async ({ api, actors, playwright }) => {
    const admin = await actors('admin');
    const item = await product(admin);
    const kept = await added(api, admin, item.id);
    const original = await added(api, admin, item.id);
    const beforeProduct = await getProduct(admin, item.id);
    const id = randomUUID();
    const bytes = pngFixture(32, 24, 39);
    const headers = await admin.authorization();
    const disconnected = await playwright.request.newContext({ baseURL: apiUrl });
    try {
      await withProductLock([item.id], async (pid) => {
        const lost = disconnected.post(`/api/staff/products/${item.id}/images`, {
          headers,
          multipart: { id, replaces: original.id, altText: 'Lost synthetic replacement',
            file: { name: 'replacement.png', mimeType: 'image/png', buffer: bytes } },
        });
        const outcome = lost.then(() => 'answered', () => 'connection lost');
        await blockedRequests(pid, 1);
        // Disconnect only after server receipt, before the existing 3-second JDBC timeout.
        await disconnected.dispose({ reason: 'Synthetic lost HTTP response' });
        expect(await outcome).toBe('connection lost');
      });
    } finally {
      await disconnected.dispose();
    }
    await expect.poll(async () => (await listImages(admin, item.id)).images.map((image) => image.id),
      { message: 'the replacement committed despite losing its HTTP response', timeout: 10_000 })
      .toEqual([kept.id, id]);
    const images = (await listImages(admin, item.id)).images;
    const stored = images[1];
    expect(images[0]).toEqual(kept);
    expect(stored).toMatchObject({ id, position: original.position, altText: 'Lost synthetic replacement' });
    // Replay is checked before looking up replaces, whose row has already been retired by the first request.
    expect(await expectJson<ImageView>(await uploadImage(api, admin, item.id, bytes,
      { id, replaces: original.id, altText: 'Lost synthetic replacement' }), 200)).toEqual(stored);
    expect((await listImages(admin, item.id)).images).toEqual(images);
    expect(productFiles(item.id)).toHaveLength(2);
    expect(existsSync(imagePath(item.id, original))).toBe(false);
    await expectImageError(await api.get(publicImage(original.url)), 404, 'NOT_FOUND');
    expect((await optimizedImage(api, publicImage(original.url))).status()).toBe(404);
    expect(await getProduct(admin, item.id)).toEqual(beforeProduct);
    for (const image of images) await expectLive(api, image);
  });

test('E2E-15-40 a replacement storage outage preserves the original and the same intent retries once',
  { tag: recoveryTags }, async ({ api, actors }) => {
    const admin = await actors('admin');
    const item = await product(admin);
    const original = await added(api, admin, item.id, { altText: 'Original synthetic view' });
    const before = await listImages(admin, item.id);
    const beforeProduct = await getProduct(admin, item.id);
    const originalPath = imagePath(item.id, original);
    const originalBytes = readFileSync(originalPath);
    const id = randomUUID();
    const directory = path.dirname(imagePath(item.id, { id, contentType: 'image/png' }));
    const hidden = `${directory}.hidden-${randomUUID()}`;
    expect(existsSync(hidden)).toBe(false);
    let moved = false;
    let blocked = false;
    try {
      renameSync(directory, hidden);
      moved = true;
      writeFileSync(directory, 'synthetic replacement storage blocker', { flag: 'wx' });
      blocked = true;
      await expectImageError(await uploadImage(api, admin, item.id, validPng(),
        { id, replaces: original.id, altText: 'Replacement synthetic view' }), 503, 'STORAGE_UNAVAILABLE');
      expect(await listImages(admin, item.id)).toEqual(before);
      expect(readFileSync(path.join(hidden, path.basename(originalPath)))).toEqual(originalBytes);
      await expectImageError(await api.get(`${apiUrl}/api/public/product-images/${id}.png`), 404, 'NOT_FOUND');
    } finally {
      try { if (blocked) unlinkSync(directory); }
      finally { if (moved) renameSync(hidden, directory); }
    }
    expect(await listImages(admin, item.id)).toEqual(before);
    expect(await (await api.get(publicImage(original.url))).body()).toEqual(originalBytes);
    expect(productFiles(item.id)).toHaveLength(1);
    expect(await getProduct(admin, item.id)).toEqual(beforeProduct);
    const replacement = await added(api, admin, item.id,
      { id, replaces: original.id, altText: 'Replacement synthetic view' });
    expect(replacement).toMatchObject({ id, position: original.position });
    expect(await expectJson<ImageView>(await uploadImage(api, admin, item.id, validPng(),
      { id, replaces: original.id, altText: 'Replacement synthetic view' }), 200)).toEqual(replacement);
    expect((await listImages(admin, item.id)).images).toEqual([replacement]);
    expect(productFiles(item.id)).toHaveLength(1);
    expect(existsSync(originalPath)).toBe(false);
    await expectImageError(await api.get(publicImage(original.url)), 404, 'NOT_FOUND');
    expect(await getProduct(admin, item.id)).toEqual(beforeProduct);
    await expectLive(api, replacement);
  });


test('E2E-15-41 a create-only replacement collision preserves an orphan and its original live image',
  { tag: recoveryTags }, async ({ api, actors }) => {
    const admin = await actors('admin');
    const item = await product(admin);
    const kept = await added(api, admin, item.id);
    const original = await added(api, admin, item.id);
    const before = await listImages(admin, item.id);
    const originalBytes = readFileSync(imagePath(item.id, original));
    const keptBytes = readFileSync(imagePath(item.id, kept));
    const id = randomUUID();
    const orphanPath = imagePath(item.id, { id, contentType: 'image/png' });
    const orphanBytes = Buffer.from('Synthetic conflicting orphan bytes');
    let planted = false;
    try {
      writeFileSync(orphanPath, orphanBytes, { flag: 'wx' });
      planted = true;
      await expectImageError(await uploadImage(api, admin, item.id, validPng(),
        { id, replaces: original.id }), 409, 'ID_CONFLICT');
      expect(await listImages(admin, item.id)).toEqual(before);
      expect(readFileSync(orphanPath)).toEqual(orphanBytes);
      expect(readFileSync(imagePath(item.id, original))).toEqual(originalBytes);
      expect(readFileSync(imagePath(item.id, kept))).toEqual(keptBytes);
      expect(productFiles(item.id)).toHaveLength(3);
      await expectImageError(await api.get(`${apiUrl}/api/public/product-images/${id}.png`), 404, 'NOT_FOUND');
      await expectLive(api, original);
      await expectLive(api, kept);
    } finally {
      if (planted) unlinkSync(orphanPath);
    }
    const replacement = await added(api, admin, item.id, { id, replaces: original.id });
    expect(replacement.position).toBe(original.position);
    expect((await listImages(admin, item.id)).images).toEqual([kept, replacement]);
    expect(productFiles(item.id)).toHaveLength(2);
    expect(readFileSync(imagePath(item.id, kept))).toEqual(keptBytes);
    await expectImageError(await api.get(publicImage(original.url)), 404, 'NOT_FOUND');
    await expectLive(api, replacement);
  });

for (const format of ['png', 'jpg'] as const) {
  for (const intent of ['append', 'replace'] as const) {
    test(`E2E-15-42 ${format} ${intent} adopts identical sanitized orphan bytes and replays once`,
      { tag: recoveryTags }, async ({ api, actors }) => {
        const admin = await actors('admin');
        const sourceBytes = format === 'png' ? validPng() : validJpeg();
        const options = { name: `front.${format}`, mimeType: format === 'png' ? 'image/png' : 'image/jpeg',
          altText: 'Recovered synthetic view' };
        const controlProduct = await product(admin);
        const control = await expectJson<ImageView>(await uploadImage(api, admin, controlProduct.id,
          sourceBytes, options), 201);
        expectImage(control);
        const controlResponse = await api.get(publicImage(control.url));
        expect(controlResponse.status()).toBe(200);
        const sanitizedBytes = await controlResponse.body();
        expect(sanitizedBytes).toEqual(readFileSync(imagePath(controlProduct.id, control)));
        const item = await product(admin);
        const original = intent === 'replace' ? await added(api, admin, item.id) : undefined;
        const before = await listImages(admin, item.id);
        const beforeProduct = await getProduct(admin, item.id);
        const id = randomUUID();
        const orphanPath = imagePath(item.id, { id, contentType: control.contentType });
        const originalBytes = original ? readFileSync(imagePath(item.id, original)) : undefined;
        const expectedKey = `products/${item.id}/${path.basename(orphanPath)}`;
        let planted = false;
        let adopted = false;
        try {
          mkdirSync(path.dirname(orphanPath), { recursive: true });
          writeFileSync(orphanPath, sanitizedBytes, { flag: 'wx' });
          planted = true;
          expect(await listImages(admin, item.id)).toEqual(before);
          expect(before.images.some((image) => image.id === id)).toBe(false);
          expect(productFiles(item.id)).toEqual([
            ...before.images.map((image) => `products/${item.id}/${path.basename(imagePath(item.id, image))}`),
            expectedKey,
          ].sort());
          const publicUrl = `${apiUrl}/api/public/product-images/${id}.${format}`;
          await expectImageError(await api.get(publicUrl), 404, 'NOT_FOUND');
          expect((await optimizedImage(api, publicUrl)).status()).toBe(404);
          if (original) expect(readFileSync(imagePath(item.id, original))).toEqual(originalBytes);
          // Model the storage/row gap directly; this does not claim to restart or crash the server.
          const response = await uploadImage(api, admin, item.id, sourceBytes,
            { ...options, id, replaces: original?.id });
          adopted = response.status() === 201;
          const image = await expectJson<ImageView>(response, 201);
          expectImage(image);
          expect(image).toMatchObject({ id, position: original?.position ?? 0, contentType: control.contentType,
            width: control.width, height: control.height, byteSize: sanitizedBytes.length, altText: options.altText });
          const assertAdopted = async () => {
            expect((await listImages(admin, item.id)).images).toEqual([image]);
            expect(productFiles(item.id)).toEqual([expectedKey]);
            expect(readFileSync(orphanPath)).toEqual(sanitizedBytes);
            const live = await api.get(publicImage(image.url));
            expect(live.status()).toBe(200);
            expect(live.headers()['content-type']).toBe(control.contentType);
            expect(await live.body()).toEqual(sanitizedBytes);
            expect(await getProduct(admin, item.id)).toEqual(beforeProduct);
            if (original) {
              expect(existsSync(imagePath(item.id, original))).toBe(false);
              await expectImageError(await api.get(publicImage(original.url)), 404, 'NOT_FOUND');
            }
          };
          await assertAdopted();
          expect(await expectJson<ImageView>(await uploadImage(api, admin, item.id, sourceBytes,
            { ...options, id, replaces: original?.id }), 200)).toEqual(image);
          await assertAdopted();
          expect(readFileSync(imagePath(controlProduct.id, control))).toEqual(sanitizedBytes);
        } finally {
          // Never delete adopted bytes; teardown owns live fixtures. Remove only this planted, unreferenced key.
          if (planted && !adopted && existsSync(orphanPath)
            && !(await listImages(admin, item.id)).images.some((image) => image.id === id)) unlinkSync(orphanPath);
        }
      });
  }
}

test('E2E-15-43 replay returns current position and compares the current edited description',
  { tag: recoveryTags }, async ({ api, actors }) => {
    const admin = await actors('admin');
    const item = await product(admin);
    const originalAlt = 'Initial synthetic description';
    const image = await added(api, admin, item.id, { altText: originalAlt });
    const kept = await added(api, admin, item.id);
    const beforeProduct = await getProduct(admin, item.id);
    const objects = [image, kept].map((source) => ({ source, bytes: readFileSync(imagePath(item.id, source)) }));
    const files = productFiles(item.id);
    const assertUnchanged = async (images: ImageView[]) => {
      expect((await listImages(admin, item.id)).images).toEqual(images);
      expect(productFiles(item.id)).toEqual(files);
      expect(await getProduct(admin, item.id)).toEqual(beforeProduct);
      for (const { source, bytes } of objects) {
        expect(readFileSync(imagePath(item.id, source))).toEqual(bytes);
        const response = await api.get(publicImage(source.url));
        expect(response.status()).toBe(200);
        expect(await response.body()).toEqual(bytes);
      }
    };
    expect((await reorderImages(admin, item.id, [kept.id, image.id], [image.id, kept.id])).status()).toBe(200);
    const reordered = (await listImages(admin, item.id)).images;
    const current = reordered[1];
    expect(current).toMatchObject({ id: image.id, position: 1, altText: originalAlt });
    expect(await expectJson<ImageView>(await uploadImage(api, admin, item.id, validPng(),
      { id: image.id, altText: originalAlt }), 200)).toEqual(current);
    await assertUnchanged(reordered);
    const currentAlt = 'Edited synthetic description';
    const edited = await expectJson<ImageView>(await updateAlt(admin, item.id, current, currentAlt), 200);
    expectImage(edited);
    expect(edited).toMatchObject({ id: image.id, position: 1, altText: currentAlt, version: current.version + 1 });
    const afterEdit = [reordered[0], edited];
    await assertUnchanged(afterEdit);
    await expectImageError(await uploadImage(api, admin, item.id, validPng(),
      { id: image.id, altText: originalAlt }), 409, 'ID_CONFLICT');
    await assertUnchanged(afterEdit);
    expect(await expectJson<ImageView>(await uploadImage(api, admin, item.id, validPng(),
      { id: image.id, altText: currentAlt }), 200)).toEqual(edited);
    await assertUnchanged(afterEdit);
  });

for (const operation of ['remove', 'replace'] as const) {
  test(`after-commit ${operation} deletion failure keeps the successful change and never serves the orphan`,
    { tag: recoveryTags }, async ({ api, actors }) => {
      const admin = await actors('admin');
      const item = await product(admin);
      const kept = await added(api, admin, item.id);
      const privateAlt = `private-delete-alt-${randomUUID()}`;
      const original = await added(api, admin, item.id, { altText: privateAlt });
      const beforeProduct = await getProduct(admin, item.id);
      const keptPath = imagePath(item.id, kept);
      const keptBytes = readFileSync(keptPath);
      const originalPath = imagePath(item.id, original);
      const originalBytes = readFileSync(originalPath);
      const hidden = `${originalPath}.orphan-${randomUUID()}`;
      expect(existsSync(hidden)).toBe(false);
      const blocker = path.join(originalPath, 'owned-delete-blocker');
      let moved = false;
      let directoryCreated = false;
      let blockerCreated = false;
      let replacement: ImageView | undefined;
      try {
        renameSync(originalPath, hidden);
        moved = true;
        // Deleting this nonempty owned directory fails on both native Windows and Linux.
        mkdirSync(originalPath);
        directoryCreated = true;
        writeFileSync(blocker, 'Synthetic after-commit deletion blocker', { flag: 'wx' });
        blockerCreated = true;
        const headers = await admin.authorization();
        const logStart = readFileSync(apiLogPath, 'utf8').length;
        const response = operation === 'remove'
          ? await api.delete(`/api/staff/products/${item.id}/images/${original.id}`, { headers })
          : await api.post(`/api/staff/products/${item.id}/images`, { headers, multipart: {
            id: randomUUID(), replaces: original.id, altText: privateAlt,
            file: { name: 'replacement.png', mimeType: 'image/png', buffer: validPng() },
          } });
        expectImageSuccess(response);
        if (operation === 'remove') {
          expect(response.status()).toBe(204);
          expect(await response.body()).toHaveLength(0);
          expect(response.headers()['cache-control']).toBe('no-store');
          expect(response.headers()['x-request-id']).toBeTruthy();
        } else {
          replacement = await expectJson<ImageView>(response, 201);
          expectImage(replacement);
        }
        // The callback runs synchronously before this successful response. Scope the ECS log to its request.
        const requestId = response.headers()['x-request-id'];
        const requestRecords = () => readFileSync(apiLogPath, 'utf8').slice(logStart).split(/\r?\n/)
          // A trailing partial JSON line can belong to the filter's finally block after the response arrived.
          .slice(0, -1).filter((line) => line.startsWith('{')).map((line) => JSON.parse(line) as {
            requestId?: string; log?: { level?: string }; message?: string; error?: unknown;
          }).filter((record) => record.requestId === requestId);
        // Wait only for the request-completion barrier, never for a desirable warning count.
        await expect.poll(() => requestRecords().some((record) =>
          record.message === `HTTP response status=${response.status()}`),
        { message: 'the faulting request completed its synchronous log writes', timeout: 5_000 }).toBe(true);
        const records = requestRecords();
        const warnings = records.filter((record) => record.log?.level === 'WARN');
        expect(warnings.length, 'one after-commit delete warning').toBe(1);
        const warning = warnings[0];
        expect(/(?:^|[ :])(?:[A-Za-z_$][\w$]*\.)*[A-Z][\w$]*(?:Exception|Error)[.)]?$/.test(warning.message ?? ''),
          'warning names the exception class without its raw message').toBe(true);
        expect(warning.error === undefined, 'no throwable, raw exception message or stack trace').toBe(true);
        const warningText = JSON.stringify(warning);
        expect([originalPath, originalPath.replaceAll('\\', '/'),
          `products/${item.id}/${original.id}.png`, original.id, item.id, 'owned-delete-blocker',
          privateAlt, headers.Authorization, headers.Authorization.slice('Bearer '.length)]
          .filter((secret) => warningText.includes(secret)).length,
        'warning contains no object identity, path, private alt text or bearer secret').toBe(0);
        expect(/directory(?: is)? not empty|access(?: is)? denied|caused by:|\bat [\w.$]+\([^)]*:\d+\)/i.test(warningText),
          'warning omits raw filesystem messages and stack frames').toBe(false);
        const images = (await listImages(admin, item.id)).images;
        expect(images).toEqual(replacement ? [kept, replacement] : [kept]);
        if (replacement) {
          expect(replacement.position).toBe(original.position);
          await expectLive(api, replacement);
        }
        expect(existsSync(blocker), 'the failed delete left its owned blocker intact').toBe(true);
        expect(readFileSync(hidden)).toEqual(originalBytes);
        expect(readFileSync(keptPath)).toEqual(keptBytes);
        expect(await getProduct(admin, item.id)).toEqual(beforeProduct);
        await expectLive(api, kept);
        await expectImageError(await api.get(publicImage(original.url)), 404, 'NOT_FOUND');
        expect((await optimizedImage(api, publicImage(original.url))).status()).toBe(404);
        await expectImageError(await uploadImage(api, admin, item.id, validPng(), { id: original.id }),
          409, 'ID_CONFLICT');
      } finally {
        try {
          if (blockerCreated && existsSync(blocker)) unlinkSync(blocker);
          if (directoryCreated && existsSync(originalPath)) rmdirSync(originalPath);
        } finally {
          if (moved) renameSync(hidden, originalPath);
        }
      }
      // Restore the unreferenced original at its key: namespace teardown, not a sweep, owns its final cleanup.
      expect(readFileSync(originalPath)).toEqual(originalBytes);
      expect(readFileSync(keptPath)).toEqual(keptBytes);
      expect((await listImages(admin, item.id)).images).toEqual(replacement ? [kept, replacement] : [kept]);
      await expectImageError(await api.get(publicImage(original.url)), 404, 'NOT_FOUND');
      expect((await optimizedImage(api, publicImage(original.url))).status()).toBe(404);
      expect(productFiles(item.id)).toHaveLength(replacement ? 3 : 2);
      await expectLive(api, kept);
      if (replacement) await expectLive(api, replacement);
    });
}
