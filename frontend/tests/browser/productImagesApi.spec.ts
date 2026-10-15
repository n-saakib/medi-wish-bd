import { randomUUID } from 'node:crypto';
import { readFileSync, renameSync } from 'node:fs';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { APIRequestContext, APIResponse } from '@playwright/test';
import {
  ApiActor, createCategory, createProduct, equipmentDraft, expect, expectJson, getProduct, test,
} from './catalogSupport';
import { apiLogPath, apiUrl, checkedTarget, frontendUrl, grantRole, removeRole, rolledBackSql } from './testApi';
import {
  expectImage, expectImageError, expectImageSuccess, imagePath, imagesRoute, listImages, publicImage, removeImage, reorderImages,
  storageDirectory, storageFiles, updateAlt, uploadImage, type ImageList, type ImageView,
} from './productImageSupport';
import { invalidUploads, jpegWithExif, largePng, maxImageBytes, outputOversizedPng, pngFixture, pngWithMetadata, rgbaPng, validJpeg, validPng } from './imageFixtures';

const t5 = { tag: ['@t15', '@t15-T5'] };
const t6 = { tag: ['@t15', '@t15-T6', '@regression'] };

async function productFor(actor: ApiActor) {
  return createProduct(actor, equipmentDraft((await createCategory(actor)).id));
}
async function uploaded(api: APIRequestContext, actor: ApiActor, productId: string, seed = 15): Promise<ImageView> {
  const image = await expectJson<ImageView>(await uploadImage(api, actor, productId, pngFixture(32, 24, seed)), 201);
  expectImage(image);
  return image;
}
function rowCount(productId: string): number {
  const outcome = rolledBackSql(`SELECT count(*) FROM product_images WHERE product_id = '${productId}';`);
  expect(outcome.error).toBe('');
  return Number(outcome.output);
}
function productFiles(productId: string): string[] {
  return storageFiles().filter((file) => file.startsWith(`products/${productId}/`));
}
type Part = { name: string; value: string | Buffer; filename?: string; mimeType?: string };
/** Raw multipart lets cases exercise duplicate names and filename-less file parts, which object APIs cannot express. */
async function rawMultipart(api: APIRequestContext, actor: ApiActor, productId: string, parts: Part[]): Promise<APIResponse> {
  const boundary = `t15-${randomUUID()}`;
  const buffers: Buffer[] = [];
  for (const part of parts) {
    buffers.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"`
      + (part.filename !== undefined ? `; filename="${part.filename}"` : '') + '\r\n'
      + (part.mimeType ? `Content-Type: ${part.mimeType}\r\n` : '') + '\r\n'));
    buffers.push(Buffer.isBuffer(part.value) ? part.value : Buffer.from(part.value));
    buffers.push(Buffer.from('\r\n'));
  }
  buffers.push(Buffer.from(`--${boundary}--\r\n`));
  return api.post(imagesRoute(productId), {
    headers: { ...await actor.authorization(), 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    data: Buffer.concat(buffers),
  });
}

// Every fixed plan id stays attached to observable real-HTTP assertions, never skips or mocked feature responses.
test('E2E-15-01 migrated image rows own their Product and the database refuses a cross-product key', t5,
  async ({ api, actors }) => {
    const admin = await actors('admin');
    const first = await productFor(admin);
    const other = await productFor(admin);
    const image = await uploaded(api, admin, first.id);
    const stored = rolledBackSql(`SELECT object_key FROM product_images WHERE id = '${image.id}';`);
    expect(stored.error).toBe('');
    expect(stored.output).toBe(`products/${first.id}/${image.id}.png`);
    const move = rolledBackSql(`UPDATE product_images SET product_id = '${other.id}' WHERE id = '${image.id}';`);
    expect(move.error).toContain('ck_product_images_key_owner');
    expect((await listImages(admin, first.id)).images).toEqual([image]);
    expect((await listImages(admin, other.id)).images).toEqual([]);
  });

test('E2E-15-02 every staff image route checks current role and verified MFA before reading input', t5,
  async ({ api, actors }) => {
    const admin = await actors('admin');
    const product = await productFor(admin);
    const image = await uploaded(api, admin, product.id);
    const original = await listImages(admin, product.id);
    for (const kind of ['anonymous', 'customer', 'deliveryPerson', 'restrictedStaff'] as const) {
      const actor = kind === 'anonymous' ? undefined : await actors(kind);
      const headers = actor ? await actor.authorization() : {};
      const responses = [
        await api.get(imagesRoute(product.id), { headers }),
        await api.post(imagesRoute(product.id), { headers, multipart: {
          id: randomUUID(), file: { name: 'front.png', mimeType: 'image/png', buffer: validPng() },
        } }),
        await api.put(`${imagesRoute(product.id)}/${image.id}`, { headers, data: { altText: 'Denied', version: 0 } }),
        await api.put(`/api/staff/products/${product.id}/image-order`, { headers,
          data: { imageIds: [image.id], expectedImageIds: [image.id] } }),
        await api.delete(`${imagesRoute(product.id)}/${image.id}`, { headers }),
        // 2.7 MB > Tomcat's old swallow bound: the full bounded refusal remains readable.
        await api.post(imagesRoute(product.id), { headers, multipart: {
          id: randomUUID(), file: { name: 'large.png', mimeType: 'image/png', buffer: largePng() },
        } }),
        // An unknown Product and malformed body must not reveal existence to these actors.
        await api.put(`${imagesRoute(randomUUID())}/${image.id}`, { headers, data: '{' }),
      ];
      for (const response of responses) {
        await expectImageError(response, kind === 'anonymous' ? 401 : 403,
          kind === 'anonymous' ? 'AUTHENTICATION_REQUIRED' : kind === 'restrictedStaff' ? 'MFA_REQUIRED' : 'ACCESS_DENIED');
        if (kind === 'anonymous') expect(response.headers()['www-authenticate']).toBe('Bearer');
      }
      if (actor && kind === 'restrictedStaff') removeRole(actor.username, 'ADMIN');
    }
    for (const bearer of ['Bearer invalid.synthetic.token', 'Bearer']) {
      const response = await api.get(imagesRoute(product.id), { headers: { Authorization: bearer } });
      await expectImageError(response, 401, 'AUTHENTICATION_REQUIRED');
      expect(response.headers()['www-authenticate']).toBe('Bearer');
      const large = await api.post(imagesRoute(product.id), { headers: { Authorization: bearer }, multipart: {
        id: randomUUID(), file: { name: 'large.png', mimeType: 'image/png', buffer: largePng() },
      } });
      await expectImageError(large, 401, 'AUTHENTICATION_REQUIRED');
      expect(large.headers()['www-authenticate']).toBe('Bearer');
    }
    expect(await listImages(admin, product.id)).toEqual(original);
    expect(rowCount(product.id)).toBe(1);
    expect(productFiles(product.id)).toEqual([`products/${product.id}/${image.id}.png`]);
  });

test('E2E-15-03 Admin and Moderator upload PNG/JPEG, replay without duplication and reject conflicting identity', t5,
  async ({ api, actors }) => {
    for (const kind of ['admin', 'moderator'] as const) {
      const actor = await actors(kind);
      const product = await productFor(actor);
      const before = await getProduct(actor, product.id);
      expect((await listImages(actor, product.id)).images).toEqual([]);
      const id = randomUUID();
      const response = await uploadImage(api, actor, product.id, validPng(), { id, altText: '  Synthetic front  ' });
      const image = await expectJson<ImageView>(response, 201);
      expectImage(image);
      expect(response.headers()['x-request-id']).toBeTruthy();
      expect(image).toMatchObject({ id, width: 32, height: 24, position: 0, version: 0, altText: 'Synthetic front' });
      expect(await expectJson<ImageView>(await uploadImage(api, actor, product.id, validPng(),
        { id, altText: 'Synthetic front', name: 'renamed.png' }), 200)).toEqual(image);
      for (const options of [{ id, altText: 'Different' }, { id, altText: 'Synthetic front' }]) {
        const bytes = options.altText === 'Different' ? validPng() : pngFixture(32, 24, 16);
        await expectImageError(await uploadImage(api, actor, product.id, bytes, options), 409, 'ID_CONFLICT');
      }
      const another = await productFor(actor);
      await expectImageError(await uploadImage(api, actor, another.id, validPng(), { id, altText: 'Synthetic front' }),
        409, 'ID_CONFLICT');
      const jpeg = await expectJson<ImageView>(await uploadImage(api, actor, product.id, validJpeg(),
        { name: 'rear.jpeg', mimeType: 'image/jpeg', altText: '   ' }), 201);
      expectImage(jpeg);
      expect(jpeg).toMatchObject({ contentType: 'image/jpeg', width: 8, height: 6, position: 1, altText: null });
      expect((await listImages(actor, product.id)).images).toEqual([image, jpeg]);
      expect(rowCount(product.id)).toBe(2);
      expect(await getProduct(actor, product.id)).toEqual(before);
      // Accepted boundary: 4096 px and 160 characters are valid, not off-by-one refusals.
      const edge = await expectJson<ImageView>(await uploadImage(api, actor, another.id, pngFixture(4096, 1),
        { altText: 'x'.repeat(160) }), 201);
      expect(edge.width).toBe(4096);
      expect(edge.altText).toHaveLength(160);
      const tall = await expectJson<ImageView>(await uploadImage(api, actor, another.id, pngFixture(1, 4096)), 201);
      expectImage(tall);
      expect(tall).toMatchObject({ width: 1, height: 4096 });
    }
  });

test('E2E-15-04 invalid bytes, multipart structure and strict JSON fail with exact codes and leave no object or row', t5,
  async ({ api, actors }) => {
    test.setTimeout(90_000);
    const admin = await actors('admin');
    const product = await productFor(admin);
    const initialFiles = storageFiles();
    async function refused(response: APIResponse, status: number, code: 'IMAGE_INVALID' | 'INVALID_REQUEST') {
      await expectImageError(response, status, code);
      expect(rowCount(product.id)).toBe(0);
      expect(storageFiles()).toEqual(initialFiles);
      expect((await listImages(admin, product.id)).images).toEqual([]);
    }
    for (const fixture of invalidUploads()) {
      await test.step(fixture.label, async () => refused(await uploadImage(api, admin, product.id, fixture.bytes,
        { name: fixture.name, mimeType: fixture.mimeType }), 400, 'IMAGE_INVALID'));
    }
    for (const altText of ['x'.repeat(161), 'line\nbreak', 'tab\there', 'control\u0085character',
      '\tSynthetic\t', '\u0000Synthetic\u0000']) {
      await refused(await uploadImage(api, admin, product.id, validPng(), { altText }), 400, 'INVALID_REQUEST');
    }
    const file: Part = { name: 'file', filename: 'front.png', mimeType: 'image/png', value: validPng() };
    const id: Part = { name: 'id', value: randomUUID() };
    const malformed: Part[][] = [
      [file], [id], [{ name: 'id', value: 'not-a-uuid' }, file],
      [id, file, file], [id, id, file],
      [id, { name: 'file', value: Buffer.alloc(100_000), mimeType: 'image/png' }],
      [{ ...id, filename: 'id.txt', mimeType: 'text/plain' }, file],
      [id, file, { name: 'altText', value: 'Synthetic', filename: 'alt.txt', mimeType: 'text/plain' }],
      [id, file, { name: 'replaces', value: randomUUID(), filename: 'id.txt', mimeType: 'text/plain' }],
      [id, file, { name: 'replaces', value: 'bad-id' }],
      [id, file, { name: 'position', value: '0' }],
      [id, file, { name: 'altText', value: 'First' }, { name: 'altText', value: 'Second' }],
      [id, file, { name: 'replaces', value: randomUUID() }, { name: 'replaces', value: randomUUID() }],
    ];
    for (const parts of malformed) await refused(await rawMultipart(api, admin, product.id, parts), 400, 'INVALID_REQUEST');
    await refused(await rawMultipart(api, admin, product.id, [id,
      { name: 'file', value: Buffer.alloc(2_500_000), mimeType: 'image/png' }]), 400, 'IMAGE_INVALID');
    await refused(await rawMultipart(api, admin, product.id, [id, { ...file, mimeType: undefined }]), 400, 'IMAGE_INVALID');
    await refused(await admin.post(imagesRoute(product.id), { id: randomUUID(), url: 'https://example.test/a.png' }),
      415, 'INVALID_REQUEST');
    await refused(await api.post(imagesRoute(product.id), { headers: await admin.authorization() }), 415, 'INVALID_REQUEST');
    await expectImageError(await admin.get(imagesRoute('bad-id')), 400, 'INVALID_REQUEST');
    await expectImageError(await admin.get(imagesRoute(randomUUID())), 404, 'NOT_FOUND');
    await expectImageError(await uploadImage(api, admin, randomUUID(), validPng()), 404, 'NOT_FOUND');

    const image = await uploaded(api, admin, product.id);
    const existing = await listImages(admin, product.id);
    const files = storageFiles();
    for (const body of [
      { altText: 'x', version: 0, objectKey: 'private' }, { altText: 'x' }, { version: 0 },
      { altText: 'x', version: -1 }, { altText: 'x', version: 0.5 }, { altText: 'x'.repeat(161), version: 0 },
      { altText: 'x\n', version: 0 }, { altText: '\tSynthetic\t', version: 0 },
      { altText: '\u0000Synthetic\u0000', version: 0 }, '{',
      [], null, 0, true, '"synthetic"',
      { altText: 123, version: 0 }, { altText: false, version: 0 },
      { altText: [], version: 0 }, { altText: {}, version: 0 },
      ...[null, '0', true, [], {}, 1e20].map((version) => ({ altText: 'Synthetic', version })),
    ]) {
      await expectImageError(await admin.put(`${imagesRoute(product.id)}/${image.id}`, body), 400, 'INVALID_REQUEST');
      expect(await listImages(admin, product.id)).toEqual(existing);
      expect(storageFiles()).toEqual(files);
    }
    for (const body of [
      { imageIds: [image.id] }, { imageIds: [image.id, image.id], expectedImageIds: [image.id, image.id] },
      { imageIds: [image.id], expectedImageIds: [randomUUID()] },
      { imageIds: ['bad'], expectedImageIds: ['bad'] },
      { imageIds: Array(9).fill(image.id), expectedImageIds: Array(9).fill(image.id) },
      { imageIds: [image.id], expectedImageIds: [image.id], position: 0 },
      [], null, 0, true, '"synthetic"',
      { expectedImageIds: [image.id] },
      ...[null, image.id, 1, true, {}].flatMap((value) => [
        { imageIds: value, expectedImageIds: [image.id] },
        { imageIds: [image.id], expectedImageIds: value },
      ]),
      ...[null, 1, true, [], {}].flatMap((value) => [
        { imageIds: [value], expectedImageIds: [image.id] },
        { imageIds: [image.id], expectedImageIds: [value] },
      ]),
      { imageIds: [image.id, image.id], expectedImageIds: [image.id] },
      { imageIds: [image.id], expectedImageIds: [image.id, image.id] },
      { imageIds: [image.id], expectedImageIds: [] },
      { imageIds: [], expectedImageIds: [image.id] },
    ]) {
      await expectImageError(await admin.put(`/api/staff/products/${product.id}/image-order`, body), 400, 'INVALID_REQUEST');
      expect(await listImages(admin, product.id)).toEqual(existing);
      expect(storageFiles()).toEqual(files);
    }
    for (const response of [
      await uploadImage(api, admin, 'bad-id', validPng()),
      await admin.put(`${imagesRoute('bad-id')}/${image.id}`, { altText: 'Synthetic', version: 0 }),
      await admin.put(`${imagesRoute(product.id)}/bad-id`, { altText: 'Synthetic', version: 0 }),
      await reorderImages(admin, 'bad-id', [image.id]),
      await removeImage(admin, 'bad-id', image.id),
      await removeImage(admin, product.id, 'bad-id'),
    ]) await expectImageError(response, 400, 'INVALID_REQUEST');
    for (const response of [
      await updateAlt(admin, product.id, { ...image, id: randomUUID() }, 'Synthetic'),
      await removeImage(admin, product.id, randomUUID()),
      await reorderImages(admin, randomUUID(), []),
    ]) await expectImageError(response, 404, 'NOT_FOUND');
    expect(await listImages(admin, product.id)).toEqual(existing);
    expect(storageFiles()).toEqual(files);
  });


test('multipart and JSON alt text retain Java trim semantics and count UTF-16 units', t5,
  async ({ api, actors }) => {
    const admin = await actors('admin');
    const product = await productFor(admin);
    const beforeProduct = await getProduct(admin, product.id);
    // ProductRules.text trims U+0000–U+0020 after rejecting raw ISO controls;
    // NBSP and BOM remain ordinary content, and Java String.length counts UTF-16 units.
    const accepted = [
      { raw: '  \u00a0Synthetic\u00a0  ', normalized: '\u00a0Synthetic\u00a0' },
      { raw: '  \ufeffSynthetic\ufeff  ', normalized: '\ufeffSynthetic\ufeff' },
      { raw: '😀'.repeat(80), normalized: '😀'.repeat(80) },
    ];
    const images: ImageView[] = [];
    for (const { raw, normalized } of accepted) {
      const image = await expectJson<ImageView>(await uploadImage(api, admin, product.id, validPng(),
        { altText: raw }), 201);
      expectImage(image);
      expect(image.altText).toBe(normalized);
      images.push(image);
    }
    let current = images[0];
    for (const { raw, normalized } of accepted) {
      const edited = await expectJson<ImageView>(await updateAlt(admin, product.id, current, raw), 200);
      expectImage(edited);
      expect(edited).toMatchObject({ id: current.id, altText: normalized, version: current.version + 1 });
      current = edited;
    }
    const beforeImages = await listImages(admin, product.id);
    const beforeFiles = productFiles(product.id);
    for (const altText of ['\u00a0' + 'x'.repeat(159) + '\u00a0',
      '\ufeff' + 'x'.repeat(159) + '\ufeff', '😀'.repeat(80) + 'x']) {
      await expectImageError(await uploadImage(api, admin, product.id, validPng(), { altText }), 400, 'INVALID_REQUEST');
      await expectImageError(await updateAlt(admin, product.id, current, altText), 400, 'INVALID_REQUEST');
      expect(await listImages(admin, product.id)).toEqual(beforeImages);
      expect(productFiles(product.id)).toEqual(beforeFiles);
    }
    expect(await getProduct(admin, product.id)).toEqual(beforeProduct);
  });

test('invalid replacement bytes, alt text and multipart leave both existing images and their identities intact', t5,
  async ({ api, actors }) => {
    test.setTimeout(120_000);
    const admin = await actors('admin');
    const product = await productFor(admin);
    const original = await uploaded(api, admin, product.id);
    const kept = await uploaded(api, admin, product.id, 16);
    const before = await listImages(admin, product.id);
    const beforeProduct = await getProduct(admin, product.id);
    const files = productFiles(product.id);
    const bytes = await Promise.all([original, kept].map(async (image) => {
      const response = await api.get(publicImage(image.url));
      expect(response.status()).toBe(200);
      return response.body();
    }));
    async function refused(response: APIResponse, code: 'IMAGE_INVALID' | 'INVALID_REQUEST', candidate: string) {
      await expectImageError(response, 400, code);
      expect(await listImages(admin, product.id)).toEqual(before);
      expect(rowCount(product.id)).toBe(2);
      expect(productFiles(product.id)).toEqual(files);
      expect(await getProduct(admin, product.id)).toEqual(beforeProduct);
      const retired = rolledBackSql(`SELECT count(*) FROM retired_product_image_ids WHERE id IN ('${original.id}', '${kept.id}', '${candidate}');`);
      expect(retired.error).toBe('');
      expect(Number(retired.output)).toBe(0);
      for (const [index, image] of [original, kept].entries()) {
        expect(readFileSync(imagePath(product.id, image))).toEqual(bytes[index]);
        const publicResponse = await api.get(publicImage(image.url));
        expect(publicResponse.status()).toBe(200);
        expect(await publicResponse.body()).toEqual(bytes[index]);
      }
    }
    for (const fixture of invalidUploads()) {
      const id = randomUUID();
      await test.step(`replacement: ${fixture.label}`, async () => refused(
        await uploadImage(api, admin, product.id, fixture.bytes,
          { id, replaces: original.id, name: fixture.name, mimeType: fixture.mimeType }), 'IMAGE_INVALID', id));
    }
    for (const altText of ['x'.repeat(161), 'line\nbreak', 'control\u0085character']) {
      const id = randomUUID();
      await refused(await uploadImage(api, admin, product.id, validPng(),
        { id, replaces: original.id, altText }), 'INVALID_REQUEST', id);
    }
    for (const extra of [
      [{ name: 'altText', value: 'First' }, { name: 'altText', value: 'Second' }],
      [{ name: 'replaces', value: kept.id }],
      [{ name: 'position', value: '0' }],
      [{ name: 'url', value: 'https://synthetic.example.test/private.png' }],
    ] satisfies Part[][]) {
      const id = randomUUID();
      await refused(await rawMultipart(api, admin, product.id, [
        { name: 'id', value: id }, { name: 'replaces', value: original.id },
        { name: 'file', filename: 'replacement.png', mimeType: 'image/png', value: validPng() }, ...extra,
      ]), 'INVALID_REQUEST', id);
    }
  });

test('E2E-15-05 URL and key parts are refused without connecting to their supplied server', t5,
  async ({ api, actors }) => {
    const admin = await actors('admin');
    const product = await productFor(admin);
    const initialFiles = storageFiles();
    let connections = 0;
    const listener = createServer((_request, response) => { response.end('Synthetic image source'); });
    listener.on('connection', () => { connections += 1; });
    listener.listen(0, '127.0.0.1');
    await once(listener, 'listening');
    const address = listener.address();
    if (!address || typeof address === 'string') throw new Error('No synthetic listener address');
    try {
      for (const extraParts of [
        { url: `http://127.0.0.1:${address.port}/private.png` },
        { key: `products/${randomUUID()}/${randomUUID()}.png` },
        { objectKey: '../private.png' },
      ] as Record<string, string>[]) {
        await expectImageError(await uploadImage(api, admin, product.id, validPng(), { extraParts }), 400, 'INVALID_REQUEST');
        expect(rowCount(product.id)).toBe(0);
        expect(storageFiles()).toEqual(initialFiles);
      }
      expect(connections).toBe(0);
    } finally {
      listener.closeAllConnections();
      await new Promise<void>((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
    }
  });

test('E2E-15-06 ninth image is refused; replay and replacement remain allowed at the eight-image limit', t5,
  async ({ api, actors }) => {
    const admin = await actors('admin');
    const product = await productFor(admin);
    const images: ImageView[] = [];
    for (let index = 0; index < 8; index += 1) images.push(await uploaded(api, admin, product.id, 15 + index));
    const before = await listImages(admin, product.id);
    const listed = await admin.get(imagesRoute(product.id));
    expect(listed.status()).toBe(200);
    const listBytes = (await listed.body()).length;
    expect(listBytes, 'eight-image response fits the client 16 KiB bound').toBeLessThanOrEqual(16 * 1024);
    test.info().annotations.push({ type: 't15-resources', description: JSON.stringify({ imageCount: 8, listBytes }) });
    const files = productFiles(product.id);
    await expectImageError(await uploadImage(api, admin, product.id, validPng()), 409, 'IMAGE_LIMIT_REACHED');
    expect(await listImages(admin, product.id)).toEqual(before);
    expect(productFiles(product.id)).toEqual(files);
    expect(await expectJson<ImageView>(await uploadImage(api, admin, product.id, validPng(), { id: images[0].id }), 200))
      .toEqual(images[0]);
    const replacement = await expectJson<ImageView>(await uploadImage(api, admin, product.id, pngFixture(32, 24, 99),
      { replaces: images[3].id }), 201);
    expect(replacement.position).toBe(3);
    expect(rowCount(product.id)).toBe(8);
    expect((await listImages(admin, product.id)).images.map((image) => image.id))
      .toEqual(images.map((image, index) => index === 3 ? replacement.id : image.id));
    expect(productFiles(product.id)).toHaveLength(8);
  });

test('E2E-15-07 alt edits and ordering persist; stale versions and old order reject without change', t5,
  async ({ api, actors }) => {
    const admin = await actors('admin');
    const product = await productFor(admin);
    const images = [await uploaded(api, admin, product.id), await uploaded(api, admin, product.id, 16),
      await uploaded(api, admin, product.id, 17)];
    const beforeProduct = await getProduct(admin, product.id);
    const files = productFiles(product.id);
    const bytes = readFileSync(imagePath(product.id, images[0]));
    const alt = await expectJson<ImageView>(await updateAlt(admin, product.id, images[0], '  Synthetic label  '), 200);
    expectImage(alt);
    expect(alt).toMatchObject({ altText: 'Synthetic label', version: images[0].version + 1 });
    await expectImageError(await updateAlt(admin, product.id, images[0], 'Lost update'), 409, 'STALE_UPDATE');
    const cleared = await expectJson<ImageView>(await updateAlt(admin, product.id, alt, null), 200);
    expectImage(cleared);
    expect(cleared).toEqual({ ...alt, altText: null, version: alt.version + 1 });
    const before = await listImages(admin, product.id);
    expect(before.images[0]).toEqual(cleared);
    await expectImageError(await updateAlt(admin, product.id, alt, 'Stale before clear'), 409, 'STALE_UPDATE');
    expect(await listImages(admin, product.id)).toEqual(before);
    expect(productFiles(product.id)).toEqual(files);
    expect(readFileSync(imagePath(product.id, cleared))).toEqual(bytes);
    const publicResponse = await api.get(publicImage(cleared.url));
    expect(publicResponse.status()).toBe(200);
    expect(await publicResponse.body()).toEqual(bytes);
    expect(await getProduct(admin, product.id)).toEqual(beforeProduct);
    const oldIds = before.images.map((image) => image.id);
    const newIds = [oldIds[2], oldIds[0], oldIds[1]];
    const reordered = await expectJson<ImageList>(await reorderImages(admin, product.id, newIds, oldIds), 200);
    expect(reordered.images.map((image) => image.id)).toEqual(newIds);
    expect(reordered.images.map((image) => image.position)).toEqual([0, 1, 2]);
    for (const image of reordered.images) {
      expectImage(image);
      const old = before.images.find((candidate) => candidate.id === image.id)!;
      expect(image).toMatchObject({ url: old.url, altText: old.altText, width: old.width, height: old.height,
        byteSize: old.byteSize, contentType: old.contentType, createdAt: old.createdAt });
    }
    await expectImageError(await reorderImages(admin, product.id, oldIds, oldIds), 409, 'STALE_UPDATE');
    expect(await listImages(admin, product.id)).toEqual(reordered);
    const unchanged = await expectJson<ImageList>(await reorderImages(admin, product.id, newIds, newIds), 200);
    expect(unchanged.images.map((image) => image.id)).toEqual(newIds);
  });

test('reorder requires the entire current list, including when the submitted lists are empty', t5,
  async ({ api, actors }) => {
    const admin = await actors('admin');
    const product = await productFor(admin);
    const beforeProduct = await getProduct(admin, product.id);
    expect(await expectJson<ImageList>(await reorderImages(admin, product.id, [], []), 200))
      .toEqual({ images: [], maxImages: 8 });
    expect(rowCount(product.id)).toBe(0);
    expect(productFiles(product.id)).toEqual([]);
    expect(await getProduct(admin, product.id)).toEqual(beforeProduct);

    const images = [await uploaded(api, admin, product.id), await uploaded(api, admin, product.id, 16)];
    const before = await listImages(admin, product.id);
    const files = productFiles(product.id);
    const bytes = images.map((image) => readFileSync(imagePath(product.id, image)));
    // Equal sets are valid JSON requests but stale when they omit any current image.
    for (const ids of [[], [images[0].id], [images[1].id]]) {
      await expectImageError(await reorderImages(admin, product.id, ids, ids), 409, 'STALE_UPDATE');
      expect(await listImages(admin, product.id)).toEqual(before);
      expect(rowCount(product.id)).toBe(2);
      expect(productFiles(product.id)).toEqual(files);
      expect(await getProduct(admin, product.id)).toEqual(beforeProduct);
      for (const [index, image] of images.entries()) {
        expect(readFileSync(imagePath(product.id, image))).toEqual(bytes[index]);
        const response = await api.get(publicImage(image.url));
        expect(response.status()).toBe(200);
        expect(await response.body()).toEqual(bytes[index]);
      }
    }
  });

test('E2E-15-08 public GET and HEAD expose stored bytes and exact bounded caching headers without credentials', t5,
  async ({ api, actors }) => {
    const admin = await actors('admin');
    const product = await productFor(admin);
    // A letter guarantees the uppercase UUID case differs, independent of random UUID digits.
    const pngId = `a${randomUUID().slice(1)}`;
    const images = [await expectJson<ImageView>(await uploadImage(api, admin, product.id, validPng(), { id: pngId }), 201),
      await expectJson<ImageView>(await uploadImage(api, admin, product.id, validJpeg(),
        { name: 'front.jpg', mimeType: 'image/jpeg' }), 201)];
    expect(images[0].id).toBe(pngId);
    for (const image of images) {
      expectImage(image);
      const stored = readFileSync(imagePath(product.id, image));
      const response = await api.get(publicImage(image.url));
      expect(response.status()).toBe(200);
      expect(await response.body()).toEqual(stored);
      expect(stored.length).toBe(image.byteSize);
      for (const answer of [response, await api.head(publicImage(image.url))]) {
        expect(answer.status()).toBe(200);
        const headers = answer.headers();
        expect(headers['content-type']).toBe(image.contentType);
        expect(headers['content-length']).toBe(String(image.byteSize));
        expect(headers['cache-control']).toBe('public, max-age=60');
        expect(answer.headersArray().filter((header) => header.name.toLowerCase() === 'cache-control')).toHaveLength(1);
        expect(headers['x-content-type-options']).toBe('nosniff');
        expect(headers['content-security-policy']).toBe("default-src 'none'; sandbox");
        expect(headers['content-disposition']).toBe('inline');
        expect(headers['x-request-id']).toBeTruthy();
        expect(headers['set-cookie']).toBeUndefined();
        expect(headers['location']).toBeUndefined();
      }
      expect(await (await api.head(publicImage(image.url))).body()).toHaveLength(0);
    }
    const invalidNames = [
      `${randomUUID()}.png`, `${images[0].id}.jpg`,
      `${images[0].id.toUpperCase()}.png`, `${images[0].id}.PNG`, `${images[0].id.toUpperCase()}.PNG`,
      'not-an-image.png', `${images[0].id}.svg`, `${images[0].id}.jpeg`,
    ];
    for (const name of invalidNames) {
      await expectImageError(await api.get(`/api/public/product-images/${name}`), 404, 'NOT_FOUND');
      const head = await api.head(`/api/public/product-images/${name}`);
      expect(head.status()).toBe(404);
      expect(head.headers()['cache-control']).toBe('no-store');
      expect(head.headers()['x-request-id']).toBeTruthy();
      expect(await head.body()).toHaveLength(0);
    }
    for (const method of ['POST', 'PUT', 'DELETE']) {
      await expectImageError(await api.fetch(publicImage(images[0].url), { method }), 403, 'ACCESS_DENIED');
    }
    // Bypass the earlier CSRF refusal with a real pair in this anonymous cookie jar:
    // An accidentally method-unrestricted public permitAll matcher must not reach MVC.
    const csrf = await api.get('/api/auth/csrf');
    expect(csrf.status()).toBe(200);
    const { csrfToken } = await csrf.json() as { csrfToken: string };
    expect(typeof csrfToken).toBe('string');
    expect(csrfToken).not.toBe('');
    // With no refresh session, 204 proves this pair passes CSRF before testing the method allowlist.
    const signedOutRefresh = await api.post('/api/auth/refresh', { headers: { 'X-XSRF-TOKEN': csrfToken } });
    expect(signedOutRefresh.status()).toBe(204);
    expect(await signedOutRefresh.body()).toHaveLength(0);
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const response = await api.fetch(publicImage(images[0].url), { method, headers: { 'X-XSRF-TOKEN': csrfToken } });
      await expectImageError(response, 403, 'ACCESS_DENIED');
    }
  });

test('E2E-15-10 replace retires identity, keeps position and deletes old bytes immediately; remove compacts order', t5,
  async ({ api, actors }) => {
    const admin = await actors('admin');
    const product = await productFor(admin);
    const images = [await uploaded(api, admin, product.id), await uploaded(api, admin, product.id, 16),
      await uploaded(api, admin, product.id, 17)];
    const replacement = await expectJson<ImageView>(await uploadImage(api, admin, product.id, validJpeg(), {
      replaces: images[1].id, name: 'replacement.jpeg', mimeType: 'image/jpeg', altText: 'Replacement',
    }), 201);
    expectImage(replacement);
    expect(replacement.id).not.toBe(images[1].id);
    expect(replacement.url).not.toBe(images[1].url);
    expect(replacement.position).toBe(1);
    await expectImageError(await api.get(publicImage(images[1].url)), 404, 'NOT_FOUND');
    expect(productFiles(product.id)).not.toContain(`products/${product.id}/${images[1].id}.png`);
    expect((await api.get(publicImage(replacement.url))).status()).toBe(200);
    await expectImageError(await uploadImage(api, admin, product.id, pngFixture(32, 24, 16), { id: images[1].id }),
      409, 'ID_CONFLICT');
    const removed = await removeImage(admin, product.id, images[0].id);
    expect(removed.status()).toBe(204);
    expect(await removed.body()).toHaveLength(0);
    expect(removed.headers()['cache-control']).toBe('no-store');
    expect(removed.headers()['x-request-id']).toBeTruthy();
    const remaining = await listImages(admin, product.id);
    expect(remaining.images.map((image) => [image.id, image.position]))
      .toEqual([[replacement.id, 0], [images[2].id, 1]]);
    await expectImageError(await api.get(publicImage(images[0].url)), 404, 'NOT_FOUND');
    await expectImageError(await removeImage(admin, product.id, images[0].id), 404, 'NOT_FOUND');
    await expectImageError(await uploadImage(api, admin, product.id, validPng(), { id: images[0].id }), 409, 'ID_CONFLICT');
    expect(productFiles(product.id)).toHaveLength(2);
    expect(rowCount(product.id)).toBe(2);
  });

test('E2E-15-11 all stored objects stay within this run namespace and names contain only owned UUID keys', t5,
  async ({ api, actors }) => {
    const admin = await actors('admin');
    const product = await productFor(admin);
    const image = await uploaded(api, admin, product.id);
    expect(storageDirectory().split(/[\\/]/).at(-1)).toMatch(/^test-browser-[0-9a-f]{12}$/);
    expect(storageFiles()).toContain(`products/${product.id}/${image.id}.png`);
    for (const file of storageFiles()) {
      expect(file).toMatch(/^products\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(png|jpg)$/);
      expect(file).not.toContain('front');
      expect(file).not.toContain('..');
    }
    expect(readFileSync(imagePath(product.id, image))).toHaveLength(image.byteSize);
  });

test('E2E-15-12 CORS permits frontend multipart upload and delete and refuses an unrelated origin', t5,
  async ({ api }) => {
    for (const [method, route] of [
      ['POST', imagesRoute(randomUUID())], ['DELETE', `${imagesRoute(randomUUID())}/${randomUUID()}`],
      ['PUT', `${imagesRoute(randomUUID())}/${randomUUID()}`], ['PUT', `/api/staff/products/${randomUUID()}/image-order`],
    ]) {
      const response = await api.fetch(route, { method: 'OPTIONS', headers: {
        Origin: frontendUrl, 'Access-Control-Request-Method': method,
        'Access-Control-Request-Headers': 'authorization,content-type',
      } });
      expect(response.status()).toBe(200);
      expect(response.headers()['access-control-allow-origin']).toBe(frontendUrl);
      expect(response.headers()['access-control-allow-methods'].split(/\s*,\s*/)).toContain(method);
      expect(response.headers()['access-control-allow-headers'].toLowerCase()).toContain('authorization');
      expect(response.headers()['access-control-allow-headers'].toLowerCase()).toContain('content-type');
      const refused = await api.fetch(route, { method: 'OPTIONS', headers: {
        Origin: 'https://untrusted.example.test', 'Access-Control-Request-Method': method,
        'Access-Control-Request-Headers': 'authorization,content-type',
      } });
      expect(refused.status()).toBe(403);
      expect(refused.headers()['access-control-allow-origin']).toBeUndefined();
    }
  });

test('E2E-15-13 cross-product replace, alt edit, remove and ordering cannot touch another Product image', t6,
  async ({ api, actors }) => {
    const moderator = await actors('moderator');
    const first = await productFor(moderator);
    const other = await productFor(moderator);
    const owned = await uploaded(api, moderator, first.id);
    const otherImage = await uploaded(api, moderator, other.id, 16);
    const beforeFirst = await listImages(moderator, first.id);
    const beforeOther = await listImages(moderator, other.id);
    const beforeFiles = storageFiles();
    const beforeBytes = await (await api.get(publicImage(owned.url))).body();
    await expectImageError(await uploadImage(api, moderator, other.id, validPng(), { replaces: owned.id }), 404, 'NOT_FOUND');
    await expectImageError(await updateAlt(moderator, other.id, owned, 'Tampered'), 404, 'NOT_FOUND');
    await expectImageError(await removeImage(moderator, other.id, owned.id), 404, 'NOT_FOUND');
    await expectImageError(await reorderImages(moderator, other.id, [owned.id], [owned.id]), 409, 'STALE_UPDATE');
    expect(await listImages(moderator, first.id)).toEqual(beforeFirst);
    expect(await listImages(moderator, other.id)).toEqual(beforeOther);
    expect(storageFiles()).toEqual(beforeFiles);
    expect(await (await api.get(publicImage(owned.url))).body()).toEqual(beforeBytes);
    expect((await api.get(publicImage(otherImage.url))).status()).toBe(200);
    expect(rowCount(first.id)).toBe(1);
    expect(rowCount(other.id)).toBe(1);
  });

test('a valid input whose sanitized PNG exceeds 3 MiB is refused without changing rows or objects', t5,
  async ({ api, actors }) => {
    const admin = await actors('admin');
    const product = await productFor(admin);
    const before = await getProduct(admin, product.id);
    const files = storageFiles();
    const bytes = outputOversizedPng();
    expect(bytes.length).toBeLessThanOrEqual(maxImageBytes);
    await expectImageError(await uploadImage(api, admin, product.id, bytes), 400, 'IMAGE_INVALID');
    expect(rowCount(product.id)).toBe(0);
    expect((await listImages(admin, product.id)).images).toEqual([]);
    expect(storageFiles()).toEqual(files);
    expect(await getProduct(admin, product.id)).toEqual(before);
  });

test('demoted verified Moderator bearer fails all staff image routes before its access token expires', t6,
  async ({ api, actors }) => {
    const admin = await actors('admin');
    const product = await productFor(admin);
    const image = await uploaded(api, admin, product.id);
    const before = await listImages(admin, product.id);
    const beforeProduct = await getProduct(admin, product.id);
    const files = storageFiles();
    const moderator = await actors('moderator');
    // Direct requests deliberately reuse the verified token's old role claim, with no refresh after demotion.
    const headers = await moderator.authorization();
    const claims = JSON.parse(Buffer.from(headers.Authorization.split('.')[1], 'base64url').toString()) as { exp: number };
    const expiresAt = claims.exp * 1000;
    expect(Number.isFinite(expiresAt)).toBe(true);
    expect(expiresAt).toBeGreaterThan(Date.now());
    expect((await api.get(imagesRoute(product.id), { headers })).status()).toBe(200);
    removeRole(moderator.username, 'MODERATOR');
    const responses = await Promise.all([
      api.get(imagesRoute(product.id), { headers }),
      api.post(imagesRoute(product.id), { headers, multipart: {
        id: randomUUID(), file: { name: 'front.png', mimeType: 'image/png', buffer: validPng() },
      } }),
      api.put(`${imagesRoute(product.id)}/${image.id}`, { headers, data: { altText: 'Denied', version: image.version } }),
      api.put(`/api/staff/products/${product.id}/image-order`, { headers,
        data: { imageIds: [image.id], expectedImageIds: [image.id] } }),
      api.delete(`${imagesRoute(product.id)}/${image.id}`, { headers }),
    ]);
    for (const response of responses) await expectImageError(response, 403, 'ACCESS_DENIED');
    expect(Date.now(), 'all calls complete before the captured token expires').toBeLessThan(expiresAt);
    expect(await listImages(admin, product.id)).toEqual(before);
    expect(rowCount(product.id)).toBe(1);
    expect(storageFiles()).toEqual(files);
    expect(await getProduct(admin, product.id)).toEqual(beforeProduct);
  });

test('accepted 3 MiB boundary and PNG/JPEG metadata stripping are enforced over real storage', t5,
  async ({ api, actors, page }) => {
    const admin = await actors('admin');
    const product = await productFor(admin);
    const padded = Buffer.alloc(maxImageBytes);
    validPng().copy(padded);
    const marker = `t15-metadata-${randomUUID()}`;
    Buffer.from(marker).copy(padded, maxImageBytes - marker.length);
    for (const fixture of [
      { bytes: padded, name: 'boundary.png', mimeType: 'image/png', width: 32, height: 24 },
      { bytes: pngWithMetadata(marker), name: 'metadata.png', mimeType: 'image/png', width: 32, height: 24 },
      { bytes: rgbaPng(), name: 'alpha.png', mimeType: 'image/png', width: 3, height: 2 },
      { bytes: jpegWithExif(marker), name: 'metadata.jpg', mimeType: 'image/jpeg', width: 8, height: 6 },
      { bytes: Buffer.concat([validJpeg(), Buffer.from(marker)]), name: 'trailing.jpg',
        mimeType: 'image/jpeg', width: 8, height: 6 },
    ]) {
      const image = await expectJson<ImageView>(await uploadImage(api, admin, product.id, fixture.bytes,
        { name: fixture.name, mimeType: fixture.mimeType }), 201);
      expectImage(image);
      expect(image).toMatchObject({ width: fixture.width, height: fixture.height, contentType: fixture.mimeType });
      const response = await api.get(publicImage(image.url));
      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).toBe(fixture.mimeType);
      const bytes = await response.body();
      expect(bytes).toEqual(readFileSync(imagePath(product.id, image)));
      if (fixture.mimeType === 'image/png') {
        // The browser decodes independent source fixtures and real public output; never use the server sanitizer as an oracle.
        const [source, sanitized] = await page.evaluate(async (encodedImages) => Promise.all(encodedImages.map(async (encoded) => {
          const encodedBytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
          const bitmap = await createImageBitmap(new Blob([encodedBytes], { type: 'image/png' }),
            { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
          try {
            const canvas = document.createElement('canvas');
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            const context = canvas.getContext('2d', { willReadFrequently: true });
            if (!context) throw new Error('Browser cannot decode synthetic PNG pixels');
            context.drawImage(bitmap, 0, 0);
            return { width: bitmap.width, height: bitmap.height,
              rgba: Array.from(context.getImageData(0, 0, bitmap.width, bitmap.height).data) };
          } finally {
            bitmap.close();
          }
        })), [fixture.bytes.toString('base64'), bytes.toString('base64')]);
        expect(source.width).toBe(fixture.width);
        expect(source.height).toBe(fixture.height);
        expect(source.rgba).toHaveLength(fixture.width * fixture.height * 4);
        expect(sanitized, 'PNG re-encoding preserves every decoded RGBA pixel').toEqual(source);
      } else {
        const [source, sanitized] = await page.evaluate(async (encodedImages) => Promise.all(encodedImages.map(async (encoded) => {
          const encodedBytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
          const bitmap = await createImageBitmap(new Blob([encodedBytes], { type: 'image/jpeg' }));
          try {
            const canvas = document.createElement('canvas');
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            const context = canvas.getContext('2d', { willReadFrequently: true });
            if (!context) throw new Error('Browser cannot decode synthetic JPEG pixels');
            context.drawImage(bitmap, 0, 0);
            return { width: bitmap.width, height: bitmap.height,
              rgba: Array.from(context.getImageData(0, 0, bitmap.width, bitmap.height).data) };
          } finally {
            bitmap.close();
          }
        })), [fixture.bytes.toString('base64'), bytes.toString('base64')]);
        for (const decoded of [source, sanitized]) {
          expect(decoded).toMatchObject({ width: fixture.width, height: fixture.height });
          expect(decoded.rgba).toHaveLength(fixture.width * fixture.height * 4);
          expect(decoded.rgba.filter((_, index) => index % 4 === 3)).toEqual(Array(fixture.width * fixture.height).fill(255));
        }
        const maxRgbDelta = sanitized.rgba.reduce((maximum, value, index) => index % 4 === 3 ? maximum
          : Math.max(maximum, Math.abs(value - source.rgba[index])), 0);
        // This flat fixture has delta 0 after JDK 25 quality-0.90 re-encoding in Chrome/Edge; allow small lossy rounding.
        expect(maxRgbDelta, 'JPEG re-encoding preserves the uploaded image content').toBeLessThanOrEqual(3);
      }
      expect(bytes.length).toBe(image.byteSize);
      expect(bytes.includes(Buffer.from(marker))).toBe(false);
      expect(bytes.includes(Buffer.from('Exif'))).toBe(false);
      if (fixture.name === 'boundary.png') expect(bytes.length).toBeLessThan(maxImageBytes);
    }
    expect(rowCount(product.id)).toBe(5);
  });

test('image metadata tables contain no binary or large-object image storage columns', t5, async ({ api, actors }) => {
  const admin = await actors('admin');
  const product = await productFor(admin);
  await uploaded(api, admin, product.id);
  const schema = checkedTarget('imageMetadataColumns');
  const metadata = rolledBackSql(`SELECT table_name FROM information_schema.tables WHERE table_schema = '${schema}'
    AND table_name IN ('product_images', 'retired_product_image_ids') ORDER BY table_name;`);
  expect(metadata.error).toBe('');
  expect(metadata.output.split(/\r?\n/)).toEqual(['product_images', 'retired_product_image_ids']);
  const binary = rolledBackSql(`SELECT table_name || '.' || column_name FROM information_schema.columns
    WHERE table_schema = '${schema}' AND table_name IN ('product_images', 'retired_product_image_ids')
    AND (udt_name IN ('bytea', 'oid') OR data_type = 'USER-DEFINED');`);
  expect(binary.error).toBe('');
  expect(binary.output).toBe('');
});

test('upload, replay and error logs omit filename, alt text and authorization secrets', t6,
  async ({ api, actors }) => {
    const admin = await actors('admin');
    const product = await productFor(admin);
    const filenameMarker = `file-${randomUUID().slice(0, 12)}`;
    const altMarker = `alt-${randomUUID().slice(0, 12)}`;
    const syntheticPhone = '01700000000';
    const filename = `${filenameMarker}-${syntheticPhone}-${randomUUID()}.png`;
    const altText = `${altMarker}-private-description-${randomUUID()}`;
    const id = randomUUID();
    const headers = await admin.authorization();
    const before = readFileSync(apiLogPath, 'utf8').length;
    const replies = [
      await api.post(imagesRoute(product.id), { headers, multipart: {
        id, file: { name: filename, mimeType: 'image/png', buffer: validPng() }, altText,
      } }),
      await api.post(imagesRoute(product.id), { headers, multipart: {
        id, file: { name: filename, mimeType: 'image/png', buffer: validPng() }, altText,
      } }),
      await api.post(imagesRoute(product.id), { headers, multipart: {
        id, file: { name: filename, mimeType: 'image/png', buffer: pngFixture(32, 24, 99) }, altText,
      } }),
    ];
    for (const [index, response] of replies.entries()) {
      if (index < 2) {
        expectImageSuccess(response);
        const image = await expectJson<ImageView>(response, index === 0 ? 201 : 200);
        expectImage(image);
        expect(image.altText).toBe(altText); // Explicit image projection only; no filename or credentials.
        const text = await response.text();
        expect([filename, filenameMarker, syntheticPhone, headers.Authorization.slice('Bearer '.length)]
          .filter((secret) => text.includes(secret)).length,
          'private values found in the response').toBe(0);
      } else {
        await expectImageError(response, 409, 'ID_CONFLICT');
        const text = await response.text();
        expect([filename, filenameMarker, syntheticPhone, altText, altMarker, headers.Authorization.slice('Bearer '.length)]
          .filter((secret) => text.includes(secret)).length,
          'private values found in the error').toBe(0);
      }
    }
    const expectedStatuses = replies.map((response, index) => ({
      requestId: response.headers()['x-request-id'], status: [201, 200, 409][index],
    }));
    expect(expectedStatuses.every(({ requestId }) => Boolean(requestId))).toBe(true);
    expect(new Set(expectedStatuses.map(({ requestId }) => requestId)).size).toBe(3);
    let completeTail = '';
    // The filter logs status in finally, potentially after the response arrives. Wait for
    // all three correlated completions, never for disappearance of a leaked private value.
    await expect.poll(() => {
      const tail = readFileSync(apiLogPath, 'utf8').slice(before);
      const newline = tail.lastIndexOf('\n');
      completeTail = tail.slice(0, newline + 1);
      const records = completeTail.split(/\r?\n/).filter((line) => line.startsWith('{'))
        .map((line) => JSON.parse(line) as { requestId?: string; message?: string });
      return expectedStatuses.every(({ requestId, status }) => records.some((record) =>
        record.requestId === requestId && record.message === `HTTP response status=${status}`));
    }, { message: 'upload, replay and conflict all have complete correlated status logs', timeout: 10_000 }).toBe(true);
    // Early unique markers also expose a bounded logger that truncates these private fields.
    expect([filename, filenameMarker, syntheticPhone, altText, altMarker,
      headers.Authorization, headers.Authorization.slice('Bearer '.length)]
      .filter((secret) => completeTail.includes(secret)).length, 'private values found in the backend log').toBe(0);
  });

test('restricted Moderator, cookie-only and genuinely revoked staff sessions fail all image routes', t6,
  async ({ api, actors, playwright }) => {
    const admin = await actors('admin');
    const product = await productFor(admin);
    const image = await uploaded(api, admin, product.id);
    const before = await listImages(admin, product.id);
    const files = productFiles(product.id);
    const restricted = await actors('restrictedStaff');
    grantRole(restricted.username, 'MODERATOR');
    async function calls(http: APIRequestContext, headers: Record<string, string>): Promise<APIResponse[]> {
      return Promise.all([
        http.get(imagesRoute(product.id), { headers }),
        http.post(imagesRoute(product.id), { headers, multipart: {
          id: randomUUID(), file: { name: 'large.png', mimeType: 'image/png', buffer: largePng() },
        } }),
        http.put(`${imagesRoute(product.id)}/${image.id}`, { headers, data: { altText: 'Denied', version: 0 } }),
        http.put(`/api/staff/products/${product.id}/image-order`, { headers,
          data: { imageIds: [image.id], expectedImageIds: [image.id] } }),
        http.delete(`${imagesRoute(product.id)}/${image.id}`, { headers }),
      ]);
    }
    for (const response of await calls(api, await restricted.authorization())) {
      await expectImageError(response, 403, 'MFA_REQUIRED');
    }
    const http = await playwright.request.newContext({ baseURL: apiUrl });
    try {
      const staff = await ApiActor.open(http, 'moderator');
      const token = await staff.authorization();
      const claims = JSON.parse(Buffer.from(token.Authorization.split('.')[1], 'base64url').toString()) as { exp: number };
      const expiresAt = claims.exp * 1000;
      expect(Number.isFinite(expiresAt)).toBe(true);
      expect(expiresAt).toBeGreaterThan(Date.now());
      const authorized = await http.get(imagesRoute(product.id), { headers: token });
      expect(await expectJson<ImageList>(authorized, 200)).toEqual(before);
      const csrf = await http.get('/api/auth/csrf');
      expect(csrf.status()).toBe(200);
      const { csrfToken } = await csrf.json() as { csrfToken: string };
      for (const response of await calls(http, { 'X-XSRF-TOKEN': csrfToken })) {
        await expectImageError(response, 401, 'AUTHENTICATION_REQUIRED');
        expect(response.headers()['www-authenticate']).toBe('Bearer');
      }
      const logout = await http.post('/api/auth/logout', { headers: { 'X-XSRF-TOKEN': csrfToken } });
      expect(logout.status()).toBe(204);
      for (const response of await calls(http, token)) {
        await expectImageError(response, 401, 'AUTHENTICATION_REQUIRED');
        expect(response.headers()['www-authenticate']).toBe('Bearer');
      }
      expect(Date.now(), 'every revoked-token refusal precedes the captured JWT expiry').toBeLessThan(expiresAt);
    } finally {
      await http.dispose();
    }
    expect(await listImages(admin, product.id)).toEqual(before);
    expect(productFiles(product.id)).toEqual(files);
  });

test('replay compares re-encoded content rather than source metadata or filename', t5,
  async ({ api, actors }) => {
    const admin = await actors('admin');
    const product = await productFor(admin);
    for (const fixture of [
      { original: validPng(), modified: pngWithMetadata(`synthetic-${randomUUID()}`),
        name: 'front.png', replayName: 'renamed.png', mimeType: 'image/png' },
      { original: validJpeg(), modified: jpegWithExif(`synthetic-${randomUUID()}`),
        name: 'front.jpg', replayName: 'renamed.jpeg', mimeType: 'image/jpeg' },
    ]) {
      expect(fixture.modified.equals(fixture.original)).toBe(false);
      const id = randomUUID();
      const options = { id, altText: 'Synthetic metadata-free image', name: fixture.name, mimeType: fixture.mimeType };
      const image = await expectJson<ImageView>(await uploadImage(api, admin, product.id, fixture.original, options), 201);
      expectImage(image);
      const before = await listImages(admin, product.id);
      const files = productFiles(product.id);
      const bytes = readFileSync(imagePath(product.id, image));
      expect(await expectJson<ImageView>(await uploadImage(api, admin, product.id, fixture.modified,
        { ...options, name: fixture.replayName }), 200)).toEqual(image);
      expect(await listImages(admin, product.id)).toEqual(before);
      expect(productFiles(product.id)).toEqual(files);
      expect(readFileSync(imagePath(product.id, image))).toEqual(bytes);
      expect(await (await api.get(publicImage(image.url))).body()).toEqual(bytes);
    }
    expect(rowCount(product.id)).toBe(2);
  });

test('replacement intent replays after its original image identity is retired', t5,
  async ({ api, actors }) => {
    const admin = await actors('admin');
    const product = await productFor(admin);
    const original = await uploaded(api, admin, product.id);
    const kept = await uploaded(api, admin, product.id, 16);
    const id = randomUUID();
    const options = { id, replaces: original.id, altText: 'Synthetic replacement' };
    const replacement = await expectJson<ImageView>(await uploadImage(api, admin, product.id,
      pngFixture(32, 24, 17), options), 201);
    expectImage(replacement);
    const before = await listImages(admin, product.id);
    const files = productFiles(product.id);
    expect(await expectJson<ImageView>(await uploadImage(api, admin, product.id,
      pngFixture(32, 24, 17), options), 200)).toEqual(replacement);
    expect(await listImages(admin, product.id)).toEqual(before);
    expect(before.images).toEqual([replacement, kept]);
    expect(productFiles(product.id)).toEqual(files);
    expect(rowCount(product.id)).toBe(2);
    await expectImageError(await api.get(publicImage(original.url)), 404, 'NOT_FOUND');
    expect((await api.get(publicImage(replacement.url))).status()).toBe(200);
  });

test('public HEAD of a missing stored object returns no body and never caches the failure', t5,
  async ({ api, actors }) => {
    const admin = await actors('admin');
    const product = await productFor(admin);
    const image = await uploaded(api, admin, product.id);
    const file = imagePath(product.id, image);
    const hidden = `${file}.hidden-${randomUUID()}`;
    const bytes = readFileSync(file);
    renameSync(file, hidden);
    try {
      const response = await api.head(publicImage(image.url));
      expect(response.status()).toBe(404);
      expect(response.headers()['cache-control']).toBe('no-store');
      expect(response.headers()['x-request-id']).toBeTruthy();
      expect(response.headers()['set-cookie']).toBeUndefined();
      expect(await response.body()).toHaveLength(0);
      expect((await listImages(admin, product.id)).images).toEqual([image]);
    } finally {
      renameSync(hidden, file);
    }
    const restored = await api.get(publicImage(image.url));
    expect(restored.status()).toBe(200);
    expect(await restored.body()).toEqual(bytes);
  });
