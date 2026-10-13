import type { Locator, Page, Request, Route } from '@playwright/test';
import {
  activeProduct, copy, createCategory, createProduct, equipmentDraft, expect, getProduct, openProduct,
  productEditor, productList, tabTo, test, token, type ApiActor, type Product,
} from './catalogSupport';
import { listImages, publicImage, uploadImage, expectImageError, updateAlt, removeImage, reorderImages,
  type ImageView } from './productImageSupport';
import { largePng, maxImageBytes, validJpeg, validPng } from './imageFixtures';
import { accessTokenLifetimeMs, apiUrl, frontendUrl, removeRole } from './testApi';
import { verifiedAdmin, verifiedModerator } from './support';

/** Real browser/API journeys. Routes are intercepted only to delay requests or inject deliberate dependency failures. */
const text = {
  uploaded: 'Image uploaded.', uploading: 'Uploading image…', invalid: 'The file is not a valid JPG or PNG image within the size limits.',
  unavailable: 'Images cannot be saved right now. Try again shortly.', changed: 'The images changed in another session. The list has been refreshed.',
  alreadyRemoved: 'This image was already removed. The list has been refreshed.', denied: 'You don’t have permission to do that.',
  maximum: 'This product has the maximum of 8 images.',
};
const tags = (task: 'T5' | 'T6' | 'T7', extra: string[] = []) => ({ tag: ['@t15', `@t15-${task}`, ...extra] });
type FilePayload = { name: string; mimeType: string; buffer: Buffer };
const png = (name = 'front.png'): FilePayload => ({ name, mimeType: 'image/png', buffer: validPng() });
const imagesPath = (id: string) => `/api/staff/products/${id}/images`;
function card(page: Page): Locator {
  return page.locator('section.card').filter({ has: page.getByRole('heading', { name: 'Images', exact: true }) });
}
const thumbnails = (page: Page) => card(page).getByRole('button', { name: /^Image [1-8]:/ });
const dialog = (page: Page) => page.getByRole('dialog');
const message = (page: Page, value: string) => card(page).getByText(value, { exact: true })
  .or(card(page).getByRole('status').filter({ hasText: value }));
const uploadControl = (page: Page) => card(page).getByRole('button', { name: 'Upload image', exact: true });

async function product(actor: ApiActor): Promise<Product> {
  return createProduct(actor, equipmentDraft((await createCategory(actor)).id));
}
async function seed(api: Parameters<typeof uploadImage>[0], actor: ApiActor, productId: string,
                    options: { altText?: string } = {}): Promise<ImageView> {
  const response = await uploadImage(api, actor, productId, validPng(), options);
  expect(response.status()).toBe(201);
  return await response.json() as ImageView;
}
async function choose(page: Page, control: Locator, file: FilePayload = png(), keyboard = false): Promise<void> {
  const choosing = page.waitForEvent('filechooser');
  if (keyboard) { await tabTo(page, control); await page.keyboard.press('Enter'); }
  else await control.click();
  await (await choosing).setFiles(file);
}
async function upload(page: Page, file: FilePayload = png()): Promise<void> {
  const productId = new URL(page.url()).pathname.split('/').at(-1)!;
  // The shared session client retries one 401 after renewing an expired token. Await the command's final answer.
  const answered = page.waitForResponse((response) => isUpload(response.request(), productId) && response.status() !== 401);
  await choose(page, uploadControl(page), file);
  expect([200, 201]).toContain((await answered).status());
  await expect(message(page, text.uploaded)).toBeVisible();
}
async function expectIdle(page: Page, count: number): Promise<void> {
  await expect(thumbnails(page)).toHaveCount(count);
  await expect(card(page).getByText('Loading images…', { exact: true })).toHaveCount(0);
}
/** Responsive srcset density can alter natural dimensions; decode proves the rendered image is usable. */
async function expectDecodedImage(image: Locator): Promise<void> {
  await expect.poll(() => image.evaluate(async (element) => {
    const displayed = element as HTMLImageElement;
    try {
      await displayed.decode();
      return displayed.complete && displayed.naturalWidth > 0 && displayed.naturalHeight > 0;
    } catch { return false; }
  })).toBe(true);
}
function isUpload(request: Request, productId: string): boolean {
  return request.method() === 'POST' && new URL(request.url()).pathname === imagesPath(productId);
}
/** Capture the actual serialized multipart Request before Chromium omits file bytes from CDP. */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    type Upload = { url: string; contentType: string; body: Promise<string>; response: Promise<string> };
    const state = window as unknown as {
      __t15Uploads: Upload[]; __t15Dispatch: { method: string; dialogVisible: boolean }[];
      __t15DispatchProduct?: string;
    };
    state.__t15Uploads = []; state.__t15Dispatch = [];
    const originalFetch = window.fetch;
    window.fetch = function (input, init) {
      const url = input instanceof globalThis.Request ? input.url : String(input);
      const method = (init?.method ?? (input instanceof globalThis.Request ? input.method : 'GET')).toUpperCase();
      const pathname = new URL(url, location.href).pathname;
      const prefix = `/api/staff/products/${state.__t15DispatchProduct}`;
      if ((method === 'POST' && pathname === `${prefix}/images`)
        || (method === 'DELETE' && pathname.startsWith(`${prefix}/images/`))
        || (method === 'PUT' && pathname === `${prefix}/image-order`)) {
        state.__t15Dispatch.push({ method, dialogVisible: [...document.querySelectorAll('dialog,[role="dialog"]')]
          .some((element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden') });
      }
      if (method !== 'POST' || !/^\/api\/staff\/products\/[^/]+\/images$/.test(pathname)) {
        return originalFetch.call(this, input, init);
      }
      const request = new globalThis.Request(input, init);
      const body = request.clone().blob().then((blob) => new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      }));
      // Send exactly the Request whose bytes were captured; do not fulfill or alter a feature response.
      const response = originalFetch.call(this, request);
      const responseBody = response.then((answer) => answer.clone().text());
      // Abort journeys intentionally reject fetch; observing them must not create an unhandled rejection.
      void responseBody.catch(() => undefined);
      state.__t15Uploads.push({ url: request.url, contentType: request.headers.get('content-type') ?? '', body, response: responseBody });
      return response;
    };
  });
});

const observedBodies = new WeakMap<Request, Promise<Buffer>>();
async function observedUpload(request: Request, part: 'body' | 'response'): Promise<string> {
  return request.frame().page().evaluate(async ({ url, contentType, part }) => {
    const state = window as unknown as { __t15Uploads: {
      url: string; contentType: string; body: Promise<string>; response: Promise<string>;
    }[] };
    const upload = state.__t15Uploads.find((value) => value.url === url && value.contentType === contentType);
    if (!upload) throw new Error('No before-dispatch observation of this exact multipart boundary');
    return await upload[part];
  }, { url: request.url(), contentType: request.headers()['content-type'], part });
}
function requestBody(request: Request): Promise<Buffer> {
  let body = observedBodies.get(request);
  if (!body) { body = observedUpload(request, 'body').then((value) => Buffer.from(value, 'base64')); observedBodies.set(request, body); }
  return body;
}

function recordUploads(page: Page, productId: string): Request[] {
  const requests: Request[] = [];
  page.on('request', (request) => {
    if (!isUpload(request, productId)) return;
    requests.push(request);
    // Cache while this document is live, so reloads cannot erase an earlier command's bytes.
    void requestBody(request).catch(() => undefined);
  });
  return requests;
}
/** Count command attempts while allowing only the shared client's one proven 401 retry per attempt. */
async function commandAttempts(requests: Request[]): Promise<Request[]> {
  const commands: Request[] = [];
  let unauthorized: Request | undefined;
  for (const request of requests) {
    if ((await request.response())?.status() === 401) {
      expect(unauthorized, 'at most one silent renewal per command attempt').toBeUndefined();
      unauthorized = request;
      continue;
    }
    if (unauthorized) {
      expect(request.method()).toBe(unauthorized.method());
      expect(request.url()).toBe(unauthorized.url());
      if ((unauthorized.headers()['content-type'] ?? '').startsWith('multipart/form-data')) {
        expect(await multipartFile(request)).toEqual(await multipartFile(unauthorized));
        expect(await multipartFields(request)).toEqual(await multipartFields(unauthorized));
      } else {
        expect(request.headers()['content-type']).toBe(unauthorized.headers()['content-type']);
        expect(request.postDataJSON()).toEqual(unauthorized.postDataJSON());
      }
      unauthorized = undefined;
    }
    commands.push(request);
  }
  expect(unauthorized, 'every 401 must be followed by its command retry').toBeUndefined();
  return commands;
}
/** Read a plain multipart field without assuming the random boundary the browser chose. */
async function field(request: Request, name: string): Promise<string | null> {
  const body = (await requestBody(request)).toString('latin1');
  return new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r\\n]*)`).exec(body)?.[1] ?? null;
}
/** Extract only the file part; compare bytes independently of the browser's regenerated multipart boundary. */
async function multipartFile(request: Request): Promise<FilePayload> {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(request.headers()['content-type'] ?? '');
  expect(boundary, 'upload has a multipart boundary').not.toBeNull();
  const body = await requestBody(request);
  expect(body, 'upload body is observable').not.toBeNull();
  const header = /Content-Disposition: form-data; name="file"; filename="([^"]*)"\r\nContent-Type: ([^\r\n]+)\r\n\r\n/.exec(body!.toString('latin1'));
  expect(header, 'upload contains its file part with a filename and MIME type').not.toBeNull();
  const start = header!.index + header![0].length;
  const end = body!.indexOf(Buffer.from(`\r\n--${boundary![1] ?? boundary![2]}`), start);
  expect(end).toBeGreaterThanOrEqual(start);
  return { name: header![1], mimeType: header![2], buffer: body!.subarray(start, end) };
}
/** Preserve every ordinary multipart field, including duplicate fields, independently of the boundary. */
async function multipartFields(request: Request): Promise<string[][]> {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(request.headers()['content-type'] ?? '');
  expect(boundary, 'command has a multipart boundary').not.toBeNull();
  const body = await requestBody(request);
  expect(body, 'command body is observable').not.toBeNull();
  return body!.toString('latin1').split(`--${boundary![1] ?? boundary![2]}`).flatMap((part) => {
    const match = /Content-Disposition: form-data; name="([^"]+)"\r\n\r\n([\s\S]*)\r\n$/.exec(part);
    return match ? [[match[1], match[2]]] : [];
  }).sort(([left], [right]) => left.localeCompare(right));
}
async function dependencyFailure(route: Route): Promise<void> {
  await route.fulfill({ status: 503, headers: {
    'Content-Type': 'application/json', 'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': frontendUrl, 'Access-Control-Allow-Credentials': 'true', 'X-Request-ID': 't15-fault',
  }, body: JSON.stringify({ code: 'STORAGE_UNAVAILABLE', message: text.unavailable, requestId: 't15-fault' }) });
}
async function expectTargets(scope: Locator): Promise<void> {
  for (const field of await scope.locator('input:not([type="file"]),textarea,select').all()) {
    if (await field.isVisible()) await expect(field).toHaveAccessibleName(/\S/);
  }
  for (const target of await scope.locator('button,input:not([type="file"]),textarea,select').all()) {
    if (!await target.isVisible()) continue;
    const box = await target.boundingBox();
    expect(box, 'visible interactive target has a measurable box').not.toBeNull();
    expect(box!.width, 'minimum target width').toBeGreaterThanOrEqual(44);
    expect(box!.height, 'minimum target height').toBeGreaterThanOrEqual(44);
  }
}

// Fixed IDs and exactly one sub-ticket tag follow the plan §5.2 matrix.
test('E2E-15-14 a Moderator uploads through the page, reloads the persisted thumbnail, and a Customer is refused',
  tags('T7', ['@smoke']), async ({ page, actors, api }) => {
    test.setTimeout(30_000);
    await verifiedModerator(page);
    const moderator = await actors('moderator');
    const saved = await product(moderator);
    await openProduct(page, saved);
    await upload(page);
    await expectIdle(page, 1);
    const [image] = (await listImages(moderator, saved.id)).images;
    expect(image).toBeDefined();
    await page.reload();
    await expectIdle(page, 1);
    const displayed = thumbnails(page).first().getByRole('img');
    await expect(displayed).toHaveAttribute('alt', `${saved.name}, image 1`);
    await expect(displayed).toHaveAttribute('width', String(image.width));
    await expect(displayed).toHaveAttribute('height', String(image.height));
    await expectDecodedImage(displayed);
    expect(new URL(await displayed.getAttribute('src') as string, frontendUrl).pathname).toBe('/_next/image');
    await expectImageError(await uploadImage(api, await actors('customer'), saved.id, validPng()), 403, 'ACCESS_DENIED');
    expect((await listImages(moderator, saved.id)).images.map(({ id }) => id)).toEqual([image.id]);
  });

test('UI upload: a real JPEG persists and decodes through the image optimizer after reload',
  tags('T5'), async ({ page, actors }) => {
    await verifiedModerator(page);
    const actor = await actors('moderator');
    const saved = await product(actor);
    await openProduct(page, saved);
    await upload(page, { name: 'front.jpeg', mimeType: 'image/jpeg', buffer: validJpeg() });
    const persisted = (await listImages(actor, saved.id)).images;
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({ contentType: 'image/jpeg', width: 8, height: 6 });
    expect(persisted[0].url).toMatch(/\.jpg$/);
    await page.reload();
    await expectIdle(page, 1);
    const displayed = thumbnails(page).first().getByRole('img');
    await expect(displayed).toHaveAttribute('alt', `${saved.name}, image 1`);
    const optimized = new URL(await displayed.getAttribute('src') as string, frontendUrl);
    expect(optimized.pathname).toBe('/_next/image');
    expect(optimized.searchParams.get('url')).toBe(publicImage(persisted[0].url));
    await expect(displayed).toHaveAttribute('width', String(persisted[0].width));
    await expect(displayed).toHaveAttribute('height', String(persisted[0].height));
    await expectDecodedImage(displayed);
  });

test('UI upload: a PNG at exactly 3 MiB passes client precheck, persists, and decodes after reload',
  tags('T5'), async ({ page, actors }) => {
    await verifiedModerator(page);
    const actor = await actors('moderator');
    const saved = await product(actor);
    await openProduct(page, saved);
    // The API boundary fixture uses a complete PNG followed by padding discarded by re-encoding.
    const bytes = Buffer.alloc(maxImageBytes);
    validPng().copy(bytes);
    expect(bytes.length).toBe(3_145_728);
    await upload(page, { name: 'boundary.png', mimeType: 'image/png', buffer: bytes });
    const persisted = (await listImages(actor, saved.id)).images;
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({ contentType: 'image/png', width: 32, height: 24 });
    expect(persisted[0].byteSize).toBeLessThan(maxImageBytes);
    await page.reload();
    await expectIdle(page, 1);
    expect((await listImages(actor, saved.id)).images).toEqual(persisted);
    const displayed = thumbnails(page).first().getByRole('img');
    await expect(displayed).toHaveAttribute('alt', `${saved.name}, image 1`);
    const optimized = new URL(await displayed.getAttribute('src') as string, frontendUrl);
    expect(optimized.pathname).toBe('/_next/image');
    expect(optimized.searchParams.get('url')).toBe(publicImage(persisted[0].url));
    await expect(displayed).toHaveAttribute('width', String(persisted[0].width));
    await expect(displayed).toHaveAttribute('height', String(persisted[0].height));
    await expectDecodedImage(displayed);
  });

test('UI upload: an empty PNG reaches server validation and cannot leave an image or retry command',
  tags('T5'), async ({ page, actors }) => {
    await verifiedModerator(page);
    const actor = await actors('moderator');
    const saved = await product(actor);
    await openProduct(page, saved);
    const answered = page.waitForResponse((response) => isUpload(response.request(), saved.id) && response.status() !== 401);
    await choose(page, uploadControl(page), { name: 'empty.png', mimeType: 'image/png', buffer: Buffer.alloc(0) });
    expect((await answered).status()).toBe(400);
    expect(JSON.parse(await observedUpload((await answered).request(), 'response'))).toMatchObject({ code: 'IMAGE_INVALID' });
    await expect(message(page, text.invalid)).toBeFocused();
    await expect(card(page).getByRole('button', { name: 'Try again' })).toHaveCount(0);
    expect((await listImages(actor, saved.id)).images).toEqual([]);
    await page.reload();
    await expectIdle(page, 0);
  });

test('E2E-15-15 a text file renamed fake.png reaches server validation, focuses the refusal, and adds nothing',
  tags('T5'), async ({ page, actors }) => {
    await verifiedModerator(page);
    const actor = await actors('moderator');
    const saved = await product(actor);
    await openProduct(page, saved);
    const requests = recordUploads(page, saved.id);
    await choose(page, uploadControl(page), { name: 'fake.png', mimeType: 'image/png', buffer: Buffer.from('Synthetic text, not a picture') });
    await expect(message(page, text.invalid)).toBeFocused();
    expect(await commandAttempts(requests)).toHaveLength(1);
    await expect(card(page).getByRole('button', { name: 'Try again' })).toHaveCount(0);
    expect((await listImages(actor, saved.id)).images).toEqual([]);
    await page.reload();
    await expectIdle(page, 0);
    await expect(uploadControl(page)).toBeVisible();
  });

test('UI replacement: server IMAGE_INVALID closes the modal, focuses the refusal, and preserves every original image',
  tags('T5'), async ({ page, actors, api }) => {
    await verifiedModerator(page);
    const actor = await actors('moderator');
    const saved = await product(actor);
    const original = [await seed(api, actor, saved.id), await seed(api, actor, saved.id)];
    const originalBytes = await Promise.all(original.map(async (image) => (await api.get(publicImage(image.url))).body()));
    await openProduct(page, saved);
    await expectIdle(page, 2);
    const requests = recordUploads(page, saved.id);
    await thumbnails(page).first().click();
    const file = { name: 'fake.png', mimeType: 'image/png', buffer: Buffer.from('Synthetic text, not a picture') };
    const answered = page.waitForResponse((response) => isUpload(response.request(), saved.id) && response.status() !== 401);
    await choose(page, dialog(page).getByRole('button', { name: 'Replace image' }), file);
    const refusal = await answered;
    expect(refusal.status()).toBe(400);
    expect(JSON.parse(await observedUpload(refusal.request(), 'response'))).toMatchObject({ code: 'IMAGE_INVALID' });
    await expect(dialog(page)).not.toBeVisible();
    await expect(message(page, text.invalid)).toBeFocused();
    await expect(card(page).getByRole('button', { name: 'Try again' })).toHaveCount(0);
    expect(await commandAttempts(requests)).toHaveLength(1);
    for (const request of requests) {
      expect(await multipartFile(request)).toEqual(file);
      expect(await field(request, 'replaces')).toBe(original[0].id);
    }
    expect((await listImages(actor, saved.id)).images).toEqual(original);
    const expectOriginalThumbnails = async () => {
      await expectIdle(page, original.length);
      for (const [index, image] of original.entries()) {
        const thumbnail = thumbnails(page).nth(index);
        await expect(thumbnail).toHaveAccessibleName(`Image ${index + 1}: ${saved.name}, image ${index + 1}`);
        const source = new URL(await thumbnail.getByRole('img').getAttribute('src') as string, frontendUrl);
        expect(source.pathname).toBe('/_next/image');
        expect(source.searchParams.get('url')).toBe(publicImage(image.url));
      }
    };
    // A reload must not repair an incorrectly cleared or repointed card after refusal.
    await expectOriginalThumbnails();
    await page.reload();
    await expectOriginalThumbnails();
    expect((await listImages(actor, saved.id)).images).toEqual(original);
    for (let index = 0; index < original.length; index += 1) {
      const bytes = await api.get(publicImage(original[index].url));
      expect(bytes.status()).toBe(200);
      expect(await bytes.body()).toEqual(originalBytes[index]);
    }
  });

test('E2E-15-16 size, MIME and extension prechecks refuse files without sending an upload',
  tags('T5'), async ({ page, actors }) => {
    await verifiedModerator(page);
    const actor = await actors('moderator');
    const saved = await product(actor);
    await openProduct(page, saved);
    await expectIdle(page, 0);
    const requests = recordUploads(page, saved.id);
    for (const file of [
      { name: 'large.png', mimeType: 'image/png', buffer: Buffer.alloc(3_145_729) },
      { name: 'photo.webp', mimeType: 'image/webp', buffer: Buffer.from('RIFF synthetic WEBP') },
      { name: 'wrong.png', mimeType: 'image/jpeg', buffer: validPng() },
      { name: 'photo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') },
    ]) {
      await choose(page, uploadControl(page), file);
      await expect(card(page).getByRole('status')).toBeVisible();
      await expect(card(page).getByRole('status')).toBeFocused();
      await expect(card(page).getByRole('status')).toHaveText(file.buffer.length > 3_145_728 ? /3 MB/ : /JPG or PNG/);
      expect(requests).toHaveLength(0);
      await expect(card(page).getByRole('button', { name: 'Try again' })).toHaveCount(0);
    }
    expect((await listImages(actor, saved.id)).images).toEqual([]);
    // Resetting the input lets the same path be chosen again after a refusal.
    await upload(page, png('large.png'));
    expect(await commandAttempts(requests)).toHaveLength(1);
  });

for (const precheck of ['size', 'type', 'extension'] as const) {
  test(`UI replacement: ${precheck} precheck preserves the original and permits the same filename after correction`,
    tags('T5'), async ({ page, actors, api }) => {
      await verifiedModerator(page);
      const actor = await actors('moderator');
      const saved = await product(actor);
      const original = await seed(api, actor, saved.id);
      const originalBytes = await (await api.get(publicImage(original.url))).body();
      await openProduct(page, saved);
      await expectIdle(page, 1);
      const requests = recordUploads(page, saved.id);
      const corrected = precheck === 'extension'
        ? { name: 'corrected.jpg', mimeType: 'image/jpeg', buffer: validJpeg() } : png('corrected.png');
      const invalid = precheck === 'size' ? { ...corrected, buffer: Buffer.alloc(3_145_729) }
        : { ...corrected, mimeType: precheck === 'type' ? 'image/webp' : 'image/png' };
      await thumbnails(page).first().click();
      await choose(page, dialog(page).getByRole('button', { name: 'Replace image' }), invalid);
      await expect(card(page).getByRole('status')).toHaveText(precheck === 'size' ? /3 MB/ : /JPG or PNG/);
      expect(requests).toHaveLength(0);
      await expect(card(page).getByRole('button', { name: 'Try again' })).toHaveCount(0);
      const fileInputs = card(page).locator('input[type="file"]');
      await expect(fileInputs.first()).toHaveValue('');
      expect(await fileInputs.evaluateAll((inputs) =>
        inputs.every((input) => (input as HTMLInputElement).value === ''))).toBe(true);
      expect((await listImages(actor, saved.id)).images).toEqual([original]);
      const publicOriginal = await api.get(publicImage(original.url));
      expect(publicOriginal.status()).toBe(200);
      expect(await publicOriginal.body()).toEqual(originalBytes);
      // The accepted precheck contract does not prescribe whether the dialog stays open on refusal.
      if (await dialog(page).isVisible()) await dialog(page).getByRole('button', { name: 'Close', exact: true }).last().click();
      await thumbnails(page).first().click();
      await choose(page, dialog(page).getByRole('button', { name: 'Replace image' }), corrected);
      await expect(message(page, 'Image replaced.')).toBeVisible();
      expect(await commandAttempts(requests)).toHaveLength(1);
      for (const request of requests) {
        expect(await multipartFile(request)).toEqual(corrected);
        expect(await field(request, 'replaces')).toBe(original.id);
      }
      const persisted = (await listImages(actor, saved.id)).images;
      expect(persisted).toHaveLength(1);
      expect(persisted[0].id).not.toBe(original.id);
      expect((await api.get(publicImage(original.url))).status()).toBe(404);
    });
}

test('E2E-15-17 image commands leave catalog version/history unchanged and catalog edit, pricing and deactivation still work',
  tags('T5', ['@cross-14-15']), async ({ page, actors, api }) => {
    await verifiedAdmin(page);
    const admin = await actors('admin');
    const saved = await activeProduct(admin, equipmentDraft((await createCategory(admin)).id), '40.00', '50.00');
    await openProduct(page, saved);
    await upload(page);
    await upload(page, png('back.png'));
    await thumbnails(page).nth(1).click();
    await dialog(page).getByLabel('Description (alt text)').fill('Synthetic rear panel');
    await dialog(page).getByRole('button', { name: 'Save description' }).click();
    await expect(message(page, 'Description saved.')).toBeVisible();
    await thumbnails(page).nth(1).click();
    await dialog(page).getByRole('button', { name: 'Make main image' }).click();
    await expect(card(page).getByRole('status').filter({ hasText: /main image/i })).toBeVisible();
    // Removal has the same independent catalog boundary as upload, alt edit and reordering.
    await upload(page, png('temporary.png'));
    await thumbnails(page).nth(2).click();
    await dialog(page).getByRole('button', { name: 'Remove image' }).click();
    await dialog(page).getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(message(page, 'Image removed.')).toBeVisible();
    await expectIdle(page, 2);
    const unchanged = await getProduct(admin, saved.id);
    expect(unchanged.version).toBe(saved.version);
    expect(unchanged.history).toEqual(saved.history);
    expect(unchanged.updatedAt).toBe(saved.updatedAt);
    const editor = productEditor(page);
    const brandName = `Image brand ${token()}`;
    const name = `Renamed image Product ${token()}`;
    await editor.brandName.fill(brandName);
    await editor.name.fill(name);
    await editor.save.click();
    await expect(editor.status(copy.productSaved)).toBeVisible();
    await editor.sellingPrice.fill('45.00');
    await editor.savePricing.click();
    await expect(editor.status(copy.pricingSaved)).toBeVisible();
    await editor.active.uncheck();
    await editor.save.click();
    await expect(editor.status(copy.productSaved)).toBeVisible();
    const changed = await getProduct(admin, saved.id);
    expect(changed).toMatchObject({ name, brandName, sellingPrice: '45.00', active: false, version: saved.version + 3 });
    expect(changed.history).toHaveLength(saved.history.length + 3);
    await expect(thumbnails(page).nth(1).getByRole('img')).toHaveAttribute('alt', `${name}, image 2`);
    expect((await listImages(admin, saved.id)).images[1].altText).toBeNull();
    for (const image of (await listImages(admin, saved.id)).images) {
      expect((await api.get(publicImage(image.url))).status()).toBe(200);
    }
    await page.reload();
    await expectIdle(page, 2);
  });

test('E2E-15-18 descriptions persist, appear on images, and blank descriptions use the numbered product-name fallback',
  tags('T5'), async ({ page, actors }) => {
    await verifiedModerator(page);
    const actor = await actors('moderator');
    const saved = await product(actor);
    await openProduct(page, saved);
    await upload(page);
    await upload(page, png('second.png'));
    await thumbnails(page).nth(1).click();
    const description = 'Synthetic strip, front';
    await dialog(page).getByLabel('Description (alt text)').fill(`  ${description}  `);
    await dialog(page).getByRole('button', { name: 'Save description' }).click();
    await expect(dialog(page)).not.toBeVisible();
    await expect(message(page, 'Description saved.')).toBeVisible();
    await expect(thumbnails(page).nth(1)).toBeFocused();
    expect((await listImages(actor, saved.id)).images[1].altText).toBe(description);
    await expect(thumbnails(page).nth(1)).toHaveAccessibleName(`Image 2: ${description}`);
    await expect(thumbnails(page).nth(1).getByRole('img')).toHaveAttribute('alt', description);
    await page.reload();
    await expect(thumbnails(page).nth(1).getByRole('img')).toHaveAttribute('alt', description);
    await thumbnails(page).nth(1).click();
    await expect(dialog(page).getByLabel('Description (alt text)')).toHaveValue(description);
    await expect(dialog(page).getByText('Leave empty to use the product name.', { exact: true })).toBeVisible();
    await dialog(page).getByLabel('Description (alt text)').fill('   ');
    await dialog(page).getByRole('button', { name: 'Save description' }).click();
    await expect(message(page, 'Description saved.')).toBeVisible();
    await expect(thumbnails(page).nth(1)).toHaveAccessibleName(`Image 2: ${saved.name}, image 2`);
    await expect(thumbnails(page).nth(1).getByRole('img')).toHaveAttribute('alt', `${saved.name}, image 2`);
    await page.reload();
    await expect(thumbnails(page).nth(1).getByRole('img')).toHaveAttribute('alt', `${saved.name}, image 2`);
    expect((await listImages(actor, saved.id)).images[1].altText).toBeNull();
  });

test('E2E-15-19 main, replacement and confirmed removal close the modal and persist the resulting order and identities',
  tags('T5'), async ({ page, actors, api }) => {
    await verifiedModerator(page);
    const actor = await actors('moderator');
    const saved = await product(actor);
    await openProduct(page, saved);
    await upload(page);
    await upload(page, png('second.png'));
    const original = (await listImages(actor, saved.id)).images;
    const expectThumbnailOrder = async (expected: ImageView[]) => {
      await expectIdle(page, expected.length);
      for (const [index, image] of expected.entries()) {
        const thumbnail = thumbnails(page).nth(index);
        await expect(thumbnail).toHaveCSS('border-width', index === 0 ? '2px' : '0px');
        if (index === 0) {
          await expect(thumbnail).toHaveCSS('border-style', 'solid');
          await expect(thumbnail).toHaveCSS('border-color', 'rgb(23, 107, 86)');
        }
        const displayed = thumbnail.getByRole('img');
        await expect(displayed).toHaveAttribute('src', /\/_next\/image\?/);
        const optimized = new URL(await displayed.getAttribute('src') as string, frontendUrl);
        expect(optimized.origin).toBe(frontendUrl);
        expect(optimized.pathname).toBe('/_next/image');
        expect(optimized.searchParams.get('url')).toBe(publicImage(image.url));
      }
    };
    await expectThumbnailOrder(original);
    const dispatched: string[] = [];
    const observeDispatch = (productId: string) => {
      const state = window as unknown as {
        __t15DispatchProduct: string; __t15Dispatch: { method: string; dialogVisible: boolean }[];
      };
      state.__t15DispatchProduct = productId; state.__t15Dispatch = [];
    };
    await page.addInitScript(observeDispatch, saved.id);
    await page.evaluate(observeDispatch, saved.id);
    const expectClosedAtDispatch = async (method: string) => {
      const observations = await page.evaluate(() => {
        const state = window as unknown as { __t15Dispatch: { method: string; dialogVisible: boolean }[] };
        return state.__t15Dispatch.splice(0);
      });
      expect(observations.length, 'command was synchronously observed in browser transport').toBeGreaterThan(0);
      for (const observation of observations) {
        expect(observation.method).toBe(method);
        expect(observation.dialogVisible, 'dialog is closed before fetch/XHR dispatch').toBe(false);
        dispatched.push(observation.method);
      }
    };
    await thumbnails(page).first().click();
    await expect(dialog(page).getByRole('button', { name: 'Make main image' })).toHaveCount(0);
    await dialog(page).getByRole('button', { name: 'Close', exact: true }).last().click();
    await thumbnails(page).nth(1).click();
    await dialog(page).getByRole('button', { name: 'Make main image' }).click();
    await expect(dialog(page)).not.toBeVisible();
    await expect(card(page).getByRole('status').filter({ hasText: /main image/i })).toBeVisible();
    await expect(thumbnails(page).first()).toBeFocused();
    expect((await listImages(actor, saved.id)).images.map(({ id }) => id)).toEqual([original[1].id, original[0].id]);
    await expectThumbnailOrder([original[1], original[0]]);
    await expectClosedAtDispatch('PUT');
    await page.reload();
    await expectThumbnailOrder([original[1], original[0]]);
    await thumbnails(page).first().click();
    await choose(page, dialog(page).getByRole('button', { name: 'Replace image' }),
      { name: 'replacement.jpg', mimeType: 'image/jpeg', buffer: validJpeg() });
    await expect(dialog(page)).not.toBeVisible();
    await expect(message(page, 'Image replaced.')).toBeVisible();
    await expect(thumbnails(page).first()).toBeFocused();
    const replaced = (await listImages(actor, saved.id)).images;
    expect(replaced[0].id).not.toBe(original[1].id);
    expect(replaced[0].url).not.toBe(original[1].url);
    expect(replaced[1].id).toBe(original[0].id);
    expect(replaced[0]).toMatchObject({ contentType: 'image/jpeg', width: 8, height: 6 });
    await expectThumbnailOrder(replaced);
    const displayedReplacement = thumbnails(page).first().getByRole('img');
    await expect(displayedReplacement).toHaveAttribute('width', '8');
    await expect(displayedReplacement).toHaveAttribute('height', '6');
    await expectDecodedImage(displayedReplacement);
    expect((await api.get(publicImage(original[1].url))).status()).toBe(404);
    await expectClosedAtDispatch('POST');
    await page.reload();
    await expectThumbnailOrder(replaced);
    await thumbnails(page).first().click();
    await dialog(page).getByRole('button', { name: 'Remove image' }).click();
    await expect(dialog(page).getByText('Remove this image? Customers will no longer see it.', { exact: true })).toBeVisible();
    await dialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
    expect((await listImages(actor, saved.id)).images).toHaveLength(2);
    await dialog(page).getByRole('button', { name: 'Remove image' }).click();
    await dialog(page).getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(dialog(page)).not.toBeVisible();
    await expect(message(page, 'Image removed.')).toBeVisible();
    await expect(thumbnails(page).first()).toBeFocused();
    expect((await api.get(publicImage(replaced[0].url))).status()).toBe(404);
    await expectClosedAtDispatch('DELETE');
    await page.reload();
    expect((await listImages(actor, saved.id)).images.map(({ id, position }) => ({ id, position })))
      .toEqual([{ id: original[0].id, position: 0 }]);
    await expectThumbnailOrder([original[0]]);
    await thumbnails(page).first().click();
    await dialog(page).getByRole('button', { name: 'Remove image' }).click();
    await dialog(page).getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(uploadControl(page)).toBeFocused();
    await expectClosedAtDispatch('DELETE');
    expect(new Set(dispatched)).toEqual(new Set(['PUT', 'POST', 'DELETE']));
    expect(dispatched.filter((method) => method === 'DELETE').length).toBeGreaterThanOrEqual(2);
    await page.reload();
    await expectIdle(page, 0);
  });

test('UI removal: removing the middle image focuses the next surviving identity and persists compacted order',
  tags('T5'), async ({ page, actors, api }) => {
    await verifiedModerator(page);
    const actor = await actors('moderator');
    const saved = await product(actor);
    const original = [await seed(api, actor, saved.id, { altText: 'First survivor' }),
      await seed(api, actor, saved.id, { altText: 'Middle removal' }),
      await seed(api, actor, saved.id, { altText: 'Next survivor' })];
    await openProduct(page, saved);
    await expectIdle(page, 3);
    await thumbnails(page).nth(1).click();
    await dialog(page).getByRole('button', { name: 'Remove image' }).click();
    await dialog(page).getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(message(page, 'Image removed.')).toBeVisible();
    await expect(thumbnails(page).nth(1)).toBeFocused();
    await expect(thumbnails(page).nth(1)).toHaveAccessibleName('Image 2: Next survivor');
    const expected = [{ id: original[0].id, position: 0 }, { id: original[2].id, position: 1 }];
    expect((await listImages(actor, saved.id)).images.map(({ id, position }) => ({ id, position }))).toEqual(expected);
    expect((await api.get(publicImage(original[1].url))).status()).toBe(404);
    await page.reload();
    await expectIdle(page, 2);
    for (const [index, image] of [original[0], original[2]].entries()) {
      const optimized = new URL(await thumbnails(page).nth(index).getByRole('img').getAttribute('src') as string, frontendUrl);
      expect(optimized.pathname).toBe('/_next/image');
      expect(optimized.searchParams.get('url')).toBe(publicImage(image.url));
    }
    expect((await listImages(actor, saved.id)).images.map(({ id, position }) => ({ id, position }))).toEqual(expected);
  });

test('E2E-15-20 keyboard upload, modal focus trap, description, escape, replacement and removal maintain focus and target sizes',
  tags('T7'), async ({ page, actors }) => {
    await verifiedModerator(page);
    const saved = await product(await actors('moderator'));
    await openProduct(page, saved);
    await tabTo(page, uploadControl(page));
    const focusRing = await uploadControl(page).evaluate((element) => {
      const style = getComputedStyle(element);
      return { color: style.outlineColor, width: parseFloat(style.outlineWidth), style: style.outlineStyle };
    });
    expect(focusRing.color).toBe('rgb(227, 155, 46)');
    expect(focusRing.width).toBeGreaterThanOrEqual(2);
    expect(focusRing.style).toBe('solid');
    await choose(page, uploadControl(page), png(), true);
    await expect(message(page, text.uploaded)).toBeVisible();
    await expect(thumbnails(page).first()).toBeFocused();
    await expectTargets(card(page));
    await page.keyboard.press('Enter');
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page)).toHaveAccessibleName('Image 1');
    expect(await dialog(page).evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await expectTargets(dialog(page));
    // Native modal tabbing can visit browser chrome, but never the inert editor.
    const modalFocus = () => dialog(page).evaluate((element) => {
      const controls = [...element.querySelectorAll<HTMLElement>('button,input:not([type="file"]),textarea,select')]
        .filter((control) => control.checkVisibility({ visibilityProperty: true }) && control.tabIndex >= 0
          && !(control as HTMLButtonElement).disabled);
      return { count: controls.length, index: controls.indexOf(document.activeElement as HTMLElement),
        inside: element.contains(document.activeElement),
        browserChrome: document.activeElement === document.body && !document.hasFocus() };
    });
    const controlCount = (await modalFocus()).count;
    expect(controlCount).toBeGreaterThan(0);
    for (const key of ['Tab', 'Shift+Tab']) {
      const visited = new Set<number>();
      let leftDocument = false;
      for (let index = 0; index < controlCount + 2; index += 1) {
        await page.keyboard.press(key);
        const focus = await modalFocus();
        expect(focus.inside || focus.browserChrome, 'focus cannot reach the background editor').toBe(true);
        if (leftDocument) expect(focus.inside, 'tabbing from browser chrome returns to the modal').toBe(true);
        if (focus.index >= 0) visited.add(focus.index);
        leftDocument = focus.browserChrome;
      }
      if (leftDocument) {
        await page.keyboard.press(key);
        expect((await modalFocus()).inside, 'tabbing from browser chrome returns to the modal').toBe(true);
      }
      expect(visited.size, `${key} reaches every visible enabled modal control`).toBe(controlCount);
    }
    await tabTo(page, dialog(page).getByLabel('Description (alt text)'));
    await page.keyboard.type('Keyboard synthetic image');
    await tabTo(page, dialog(page).getByRole('button', { name: 'Save description' }));
    await page.keyboard.press('Enter');
    await expect(thumbnails(page).first()).toBeFocused();
    await expect(message(page, 'Description saved.')).toBeVisible();
    await choose(page, uploadControl(page), png('keyboard-second.png'), true);
    await expect(message(page, text.uploaded)).toBeVisible();
    await expect(thumbnails(page).nth(1)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dialog(page)).toHaveAccessibleName('Image 2');
    await tabTo(page, dialog(page).getByRole('button', { name: 'Make main image' }));
    await page.keyboard.press('Enter');
    await expect(dialog(page)).not.toBeVisible();
    await expect(thumbnails(page).first()).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dialog(page)).toHaveAccessibleName('Image 1');
    await tabTo(page, dialog(page).getByRole('button', { name: 'Remove image' }));
    await page.keyboard.press('Enter');
    await expect(dialog(page)).toHaveAccessibleName('Image 1');
    await tabTo(page, dialog(page).getByRole('button', { name: 'Cancel', exact: true }));
    await page.keyboard.press('Enter');
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page)).toHaveAccessibleName('Image 1');
    await expect(dialog(page).getByRole('button', { name: 'Remove image' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(thumbnails(page).first()).toBeFocused();
    await page.keyboard.press('Enter');
    await choose(page, dialog(page).getByRole('button', { name: 'Replace image' }), png('keyboard.png'), true);
    await expect(message(page, 'Image replaced.')).toBeVisible();
    await expect(thumbnails(page).first()).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dialog(page)).toHaveAccessibleName('Image 1');
    await tabTo(page, dialog(page).getByRole('button', { name: 'Remove image' }));
    await page.keyboard.press('Enter');
    await expect(dialog(page)).toHaveAccessibleName('Image 1');
    await expectTargets(dialog(page));
    await tabTo(page, dialog(page).getByRole('button', { name: 'Remove', exact: true }));
    await page.keyboard.press('Enter');
    await expect(message(page, 'Image removed.')).toBeVisible();
    await expect(thumbnails(page).first()).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dialog(page)).toHaveAccessibleName('Image 1');
    await tabTo(page, dialog(page).getByRole('button', { name: 'Remove image' }));
    await page.keyboard.press('Enter');
    await expect(dialog(page)).toHaveAccessibleName('Image 1');
    await tabTo(page, dialog(page).getByRole('button', { name: 'Remove', exact: true }));
    await page.keyboard.press('Enter');
    await expect(uploadControl(page)).toBeFocused();
    // Status announcements must be polite and the placeholder has a meaningful accessible name.
    const status = card(page).getByRole('status');
    await expect(status).toContainText('Image removed.');
    expect([null, 'polite'], 'role=status is implicitly polite; explicit off/assertive is invalid')
      .toContain(await status.getAttribute('aria-live'));
  });

for (const width of [375, 1280]) {
  test(`E2E-15-21 at ${width}px the grid and modal stay inside the viewport with ${width === 375 ? 2 : 4} columns`,
    tags('T7'), async ({ page, actors, api }) => {
      await page.setViewportSize({ width, height: 900 });
      await verifiedModerator(page);
      const actor = await actors('moderator');
      const saved = await product(actor);
      for (let index = 0; index < 4; index += 1) await seed(api, actor, saved.id);
      await openProduct(page, saved);
      await expectIdle(page, 4);
      const expectNoScroll = async () => expect(await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
      await expectNoScroll();
      const columns = await thumbnails(page).first().evaluate((element) =>
        getComputedStyle(element.parentElement!).gridTemplateColumns.split(/\s+/).length);
      expect(columns).toBe(width === 375 ? 2 : 4);
      await thumbnails(page).first().click();
      await expect(dialog(page)).toBeVisible();
      const box = await dialog(page).boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      await expectNoScroll();
      await expectTargets(dialog(page));
    });
}

test('E2E-15-22 an optimizer failure renders a labelled placeholder instead of a broken image',
  tags('T5'), async ({ page, actors, api }) => {
    await verifiedModerator(page);
    const actor = await actors('moderator');
    const saved = await product(actor);
    const original = await seed(api, actor, saved.id, { altText: 'Synthetic front panel' });
    await page.route('**/_next/image**', (route) => route.abort('failed'));
    await openProduct(page, saved);
    const placeholder = thumbnails(page).first().getByRole('img', { name: 'Synthetic front panel', exact: true });
    await expect(placeholder).toBeVisible();
    await expect(placeholder).toHaveClass(/image-placeholder/);
    expect(await placeholder.evaluate((element) => element.tagName)).toBe('SPAN');
    await thumbnails(page).first().click();
    await expect(dialog(page).getByRole('img', { name: 'Synthetic front panel', exact: true })).toHaveClass(/image-placeholder/);
    expect((await listImages(actor, saved.id)).images).toHaveLength(1);
    await page.unroute('**/_next/image**');
    await choose(page, dialog(page).getByRole('button', { name: 'Replace image' }),
      { name: 'recovered.jpg', mimeType: 'image/jpeg', buffer: validJpeg() });
    await expect(message(page, 'Image replaced.')).toBeVisible();
    const [replacement] = (await listImages(actor, saved.id)).images;
    expect(replacement.id).not.toBe(original.id);
    const recovered = thumbnails(page).first().getByRole('img');
    await expect(recovered).not.toHaveClass(/image-placeholder/);
    const optimized = new URL(await recovered.getAttribute('src') as string, frontendUrl);
    expect(optimized.pathname).toBe('/_next/image');
    expect(optimized.searchParams.get('url')).toBe(publicImage(replacement.url));
    await expect(recovered).toHaveAttribute('width', '8');
    await expect(recovered).toHaveAttribute('height', '6');
    await expectDecodedImage(recovered);
  });

test('E2E-15-23 a Moderator demoted mid-session sees the access error on the next upload and changes nothing',
  tags('T6', ['@cross-08-15']), async ({ page, actors, api }) => {
    const user = await verifiedModerator(page);
    const actor = await actors('moderator');
    const saved = await product(actor);
    const existing = await seed(api, actor, saved.id);
    await openProduct(page, saved);
    await expectIdle(page, 1);
    removeRole(user.username, 'MODERATOR');
    const response = page.waitForResponse((answer) => isUpload(answer.request(), saved.id) && answer.status() !== 401);
    await choose(page, uploadControl(page));
    expect((await response).status()).toBe(403);
    await expect(message(page, text.denied)).toBeFocused();
    await expect(card(page).getByRole('button', { name: 'Try again' })).toHaveCount(0);
    expect((await listImages(actor, saved.id)).images.map(({ id }) => id)).toEqual([existing.id]);
  });

test('E2E-15-24 a pending upload is guarded, storage retry reuses its id, and an expired token refreshes one 2.5MB upload',
  tags('T6'), async ({ page, actors, api }) => {
    await verifiedModerator(page);
    const actor = await actors('moderator');
    const saved = await product(actor);
    await seed(api, actor, saved.id);
    await openProduct(page, saved);
    await expectIdle(page, 1);
    const requests = recordUploads(page, saved.id);
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    let intercepted!: () => void;
    const arrived = new Promise<void>((resolve) => { intercepted = resolve; });
    await page.route(`${apiUrl}${imagesPath(saved.id)}`, async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      intercepted(); await blocked; await dependencyFailure(route);
    });
    try {
      await choose(page, uploadControl(page));
      await arrived;
      await expect(message(page, text.uploading)).toBeVisible();
      await expect(uploadControl(page)).toBeDisabled();
      await expect(thumbnails(page).first()).toBeDisabled();
      // A second physical activation of a disabled upload control must send nothing.
      await uploadControl(page).dispatchEvent('click');
      expect(requests).toHaveLength(1);
    } finally { release(); }
    await expect(message(page, text.unavailable)).toBeFocused();
    await expectIdle(page, 1);
    await page.unroute(`${apiUrl}${imagesPath(saved.id)}`);
    await card(page).getByRole('button', { name: 'Try again' }).click();
    await expect(message(page, text.uploaded)).toBeVisible();
    const retried = await commandAttempts(requests);
    expect(retried).toHaveLength(2);
    expect(await field(retried[0], 'id')).toMatch(/^[0-9a-f-]{36}$/);
    expect(await field(retried[1], 'id')).toBe(await field(retried[0], 'id'));
    expect((await listImages(actor, saved.id)).images).toHaveLength(2);
    await expect(card(page).getByRole('button', { name: 'Try again' })).toHaveCount(0);

    // Establish the page session's exact last token issuance, then let it expire without another API interaction.
    const refresh = page.waitForResponse((answer) => new URL(answer.url()).pathname === '/api/auth/refresh' && answer.status() === 200);
    await page.reload();
    await refresh;
    await expectIdle(page, 2);
    await page.waitForTimeout(accessTokenLifetimeMs + 250);
    const refreshes: number[] = [];
    page.on('response', (answer) => {
      if (new URL(answer.url()).pathname === '/api/auth/refresh') refreshes.push(answer.status());
    });
    const largeRequestsStart = requests.length;
    const file = largePng();
    expect(file.length).toBeGreaterThan(2 * 1024 * 1024);
    expect(file.length).toBeLessThanOrEqual(3_145_728);
    await upload(page, { name: 'large-valid.png', mimeType: 'image/png', buffer: file });
    expect(refreshes).toEqual([200]);
    const largeRequests = requests.slice(largeRequestsStart);
    expect(largeRequests).toHaveLength(2); // 401 from the old token, then the same command after silent refresh.
    expect((await largeRequests[0].response())?.status()).toBe(401);
    expect((await largeRequests[1].response())?.status()).toBe(201);
    expect(await field(largeRequests[0], 'id')).toBe(await field(largeRequests[1], 'id'));
    for (const request of largeRequests) {
      expect(await multipartFile(request)).toEqual({ name: 'large-valid.png', mimeType: 'image/png', buffer: file });
      expect(await field(request, 'altText')).toBeNull();
      expect(await field(request, 'replaces')).toBeNull();
    }
    expect((await listImages(actor, saved.id)).images).toHaveLength(3);
    await page.reload();
    await expectIdle(page, 3);
  });

for (const operation of ['make-main', 'remove'] as const) {
  test(`UI busy guard: pending ${operation} disables every image control and double activation sends one command`,
    tags('T6'), async ({ page, actors, api }) => {
      await verifiedModerator(page);
      const actor = await actors('moderator');
      const saved = await product(actor);
      const original = [await seed(api, actor, saved.id), await seed(api, actor, saved.id), await seed(api, actor, saved.id)];
      await openProduct(page, saved);
      await expectIdle(page, 3);
      const method = operation === 'make-main' ? 'PUT' : 'DELETE';
      const path = operation === 'make-main' ? `/api/staff/products/${saved.id}/image-order`
        : `${imagesPath(saved.id)}/${original[1].id}`;
      const requests: Request[] = [];
      const pending = new Set<Request>();
      page.on('request', (request) => {
        const pathname = new URL(request.url()).pathname;
        if (['POST', 'PUT', 'DELETE'].includes(request.method()) &&
          (pathname.startsWith(imagesPath(saved.id)) || pathname === `/api/staff/products/${saved.id}/image-order`)) {
          requests.push(request); pending.add(request);
        }
      });
      page.on('requestfinished', (request) => pending.delete(request));
      page.on('requestfailed', (request) => pending.delete(request));
      let release!: () => void;
      const blocked = new Promise<void>((resolve) => { release = resolve; });
      let received!: () => void;
      const arrived = new Promise<void>((resolve) => { received = resolve; });
      await page.route(`${apiUrl}${path}`, async (route) => {
        if (route.request().method() !== method) return route.continue();
        received(); await blocked; await route.continue();
      });
      await thumbnails(page).nth(1).click();
      if (operation === 'remove') await dialog(page).getByRole('button', { name: 'Remove image' }).click();
      const command = dialog(page).getByRole('button', { name: operation === 'make-main' ? 'Make main image' : 'Remove', exact: true });
      try {
        // Dispatch both activations in one browser task, before a render can mask a missing synchronous guard.
        await command.evaluate((element) => {
          element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        await arrived;
        await expect(dialog(page)).not.toBeVisible();
        for (const button of await card(page).getByRole('button').all()) {
          await expect(button).toBeDisabled();
          await button.dispatchEvent('click');
        }
        await expect(dialog(page)).not.toBeVisible();
        expect((await listImages(actor, saved.id)).images).toEqual(original);
      } finally { release(); }
      await expect(card(page).getByRole('status')).toHaveText(operation === 'make-main' ? /main image/i : 'Image removed.');
      await expect.poll(() => pending.size, 'all attempted image commands settle').toBe(0);
      const attempts = await commandAttempts(requests);
      expect(attempts).toHaveLength(1);
      expect(attempts[0].method()).toBe(method);
      expect(new URL(attempts[0].url()).pathname).toBe(path);
      expect((await attempts[0].response())?.status()).toBe(operation === 'make-main' ? 200 : 204);
      if (operation === 'make-main') expect(attempts[0].postDataJSON()).toEqual({
        imageIds: [original[1].id, original[0].id, original[2].id], expectedImageIds: original.map(({ id }) => id),
      });
      const expected = operation === 'make-main' ? [original[1].id, original[0].id, original[2].id]
        : [original[0].id, original[2].id];
      expect((await listImages(actor, saved.id)).images.map(({ id }) => id)).toEqual(expected);
      await expect(uploadControl(page)).toBeEnabled();
      for (const thumbnail of await thumbnails(page).all()) await expect(thumbnail).toBeEnabled();
      await page.reload();
      await expectIdle(page, expected.length);
      const persisted = (await listImages(actor, saved.id)).images;
      expect(persisted.map(({ id }) => id)).toEqual(expected);
      for (let index = 0; index < persisted.length; index += 1) {
        const source = new URL(await thumbnails(page).nth(index).getByRole('img').getAttribute('src') as string, frontendUrl);
        expect(source.pathname).toBe('/_next/image');
        expect(source.searchParams.get('url')).toBe(publicImage(persisted[index].url));
      }
    });
}

for (const operation of ['make-main', 'remove'] as const) {
  test(`UI recovery: a failed ${operation} closes the dialog, preserves the card, and permits a later real command`,
    tags('T6'), async ({ page, actors, api }) => {
      await verifiedModerator(page);
      const actor = await actors('moderator');
      const saved = await product(actor);
      const original = [await seed(api, actor, saved.id), await seed(api, actor, saved.id), await seed(api, actor, saved.id)];
      const originalBytes = await Promise.all(original.map(async (image) => {
        const response = await api.get(publicImage(image.url));
        expect(response.status()).toBe(200);
        return response.body();
      }));
      await openProduct(page, saved);
      await expectIdle(page, original.length);
      const method = operation === 'make-main' ? 'PUT' : 'DELETE';
      const path = operation === 'make-main' ? `/api/staff/products/${saved.id}/image-order`
        : `${imagesPath(saved.id)}/${original[1].id}`;
      const requests: Request[] = [];
      const pending = new Set<Request>();
      page.on('request', (request) => {
        const pathname = new URL(request.url()).pathname;
        if (['POST', 'PUT', 'DELETE'].includes(request.method()) &&
          (pathname.startsWith(imagesPath(saved.id)) || pathname === `/api/staff/products/${saved.id}/image-order`)) {
          requests.push(request); pending.add(request);
        }
      });
      page.on('requestfinished', (request) => pending.delete(request));
      page.on('requestfailed', (request) => pending.delete(request));
      const activate = async () => {
        await thumbnails(page).nth(1).click();
        if (operation === 'remove') await dialog(page).getByRole('button', { name: 'Remove image' }).click();
        await dialog(page).getByRole('button', {
          name: operation === 'make-main' ? 'Make main image' : 'Remove', exact: true,
        }).click();
      };
      // Refuse only this command before forwarding any bytes to the real backend.
      await page.route(`${apiUrl}${path}`, (route) => route.request().method() === method
        ? route.abort('failed') : route.continue());
      await activate();
      await expect(dialog(page)).not.toBeVisible();
      await expect(message(page, 'The request could not be completed.')).toBeFocused();
      await expect(card(page).getByRole('button', { name: 'Try again' })).toHaveCount(0);
      await expect.poll(() => pending.size, 'failed command transports settle').toBe(0);
      const failed = await commandAttempts(requests);
      expect(failed).toHaveLength(1);
      expect(failed[0].method()).toBe(method);
      expect(new URL(failed[0].url()).pathname).toBe(path);
      expect(failed[0].failure()).not.toBeNull();
      expect(await failed[0].response()).toBeNull();
      expect((await listImages(actor, saved.id)).images).toEqual(original);
      // Inspect the current document before any reload can repair optimistic removal/reordering.
      await expectIdle(page, original.length);
      for (const [index, image] of original.entries()) {
        const thumbnail = thumbnails(page).nth(index);
        await expect(thumbnail).toHaveAccessibleName(`Image ${index + 1}: ${saved.name}, image ${index + 1}`);
        const source = new URL(await thumbnail.getByRole('img').getAttribute('src') as string, frontendUrl);
        expect(source.pathname).toBe('/_next/image');
        expect(source.searchParams.get('url')).toBe(publicImage(image.url));
        const response = await api.get(publicImage(image.url));
        expect(response.status()).toBe(200);
        expect(await response.body()).toEqual(originalBytes[index]);
      }
      for (const button of await card(page).getByRole('button').all()) await expect(button).toBeEnabled();
      await page.unroute(`${apiUrl}${path}`);
      const answered = page.waitForResponse((response) => response.request().method() === method &&
        new URL(response.url()).pathname === path && response.status() !== 401);
      await activate();
      expect((await answered).status()).toBe(operation === 'make-main' ? 200 : 204);
      await expect(dialog(page)).not.toBeVisible();
      await expect(card(page).getByRole('status')).toHaveText(operation === 'make-main' ? /main image/i : 'Image removed.');
      await expect.poll(() => pending.size, 'later real command transports settle').toBe(0);
      const attempts = await commandAttempts(requests);
      expect(attempts).toHaveLength(2);
      for (const attempt of attempts) {
        expect(attempt.method()).toBe(method);
        expect(new URL(attempt.url()).pathname).toBe(path);
        if (operation === 'make-main') expect(attempt.postDataJSON()).toEqual({
          imageIds: [original[1].id, original[0].id, original[2].id], expectedImageIds: original.map(({ id }) => id),
        });
      }
      const expected = operation === 'make-main' ? [original[1].id, original[0].id, original[2].id]
        : [original[0].id, original[2].id];
      expect((await listImages(actor, saved.id)).images.map(({ id }) => id)).toEqual(expected);
      await expectIdle(page, expected.length);
      await expect(uploadControl(page)).toBeEnabled();
    });
}

test('UI states: loading is quiet, a failed list can be retried, and an empty card has only the upload slot',
  tags('T5'), async ({ page, actors }) => {
    await verifiedModerator(page);
    const saved = await product(await actors('moderator'));
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    await page.route(`${apiUrl}${imagesPath(saved.id)}`, async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      await blocked;
      await route.abort('failed');
    });
    try {
      await openProduct(page, saved);
      await expect(card(page).getByText('Loading images…', { exact: true })).toBeVisible();
      await expect(card(page).getByRole('status')).toHaveCount(0);
      await expect(card(page).getByRole('alert')).toHaveCount(0);
      await expect(thumbnails(page)).toHaveCount(0);
    } finally { release(); }
    await expect(card(page).getByRole('alert')).toBeVisible();
    await expect(card(page).getByRole('button', { name: 'Try again' })).toBeVisible();
    await page.unroute(`${apiUrl}${imagesPath(saved.id)}`);
    await card(page).getByRole('button', { name: 'Try again' }).click();
    await expectIdle(page, 0);
    await expect(uploadControl(page)).toBeVisible();
    await expect(card(page).getByText('JPG or PNG · up to 3 MB', { exact: true })).toBeVisible();
    await expect(card(page).getByText('The first image is the main image.', { exact: true })).toBeVisible();
    await expect(card(page).getByRole('status')).toHaveCount(0);
    await expect(card(page).getByRole('alert')).toHaveCount(0);
    await expect(card(page).getByRole('button')).toHaveCount(1);
    await page.goto('/staff/products/new');
    await expect(page.getByRole('heading', { level: 1, name: 'New product' })).toBeVisible();
    await expect(card(page)).toHaveCount(0);
  });

test('UI states: the eighth image replaces the upload slot, replacement remains available and removing permits a fresh append',
  tags('T5'), async ({ page, actors, api }) => {
    await verifiedModerator(page);
    const actor = await actors('moderator');
    const saved = await product(actor);
    const survivors: ImageView[] = [];
    for (let index = 0; index < 7; index += 1) survivors.push(await seed(api, actor, saved.id));
    await openProduct(page, saved);
    await upload(page);
    await expectIdle(page, 8);
    const eighth = (await listImages(actor, saved.id)).images[7];
    await expect(uploadControl(page)).toHaveCount(0);
    await expect(message(page, text.maximum)).toBeVisible();
    await thumbnails(page).nth(7).click();
    await choose(page, dialog(page).getByRole('button', { name: 'Replace image' }), png('at-limit.png'));
    await expect(message(page, 'Image replaced.')).toBeVisible();
    const replaced = (await listImages(actor, saved.id)).images;
    expect(replaced.slice(0, 7)).toEqual(survivors);
    expect(replaced).toHaveLength(8);
    expect(replaced[7].id).not.toBe(eighth.id);
    await thumbnails(page).nth(7).click();
    await dialog(page).getByRole('button', { name: 'Remove image' }).click();
    await dialog(page).getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(message(page, 'Image removed.')).toBeVisible();
    await expect(uploadControl(page)).toBeEnabled();
    expect((await listImages(actor, saved.id)).images).toEqual(survivors);
    await expect(message(page, text.maximum)).toHaveCount(0);
    const requests = recordUploads(page, saved.id);
    const file = png('fresh-after-removal.png');
    await upload(page, file);
    expect(await commandAttempts(requests)).toHaveLength(1);
    const appendedId = await field(requests[0], 'id');
    expect(appendedId).toBeTruthy();
    expect([eighth.id, replaced[7].id, ...survivors.map(({ id }) => id)]).not.toContain(appendedId);
    for (const request of requests) {
      expect(await multipartFile(request)).toEqual(file);
      expect(await field(request, 'id')).toBe(appendedId);
      expect(await field(request, 'replaces')).toBeNull();
    }
    const appended = (await listImages(actor, saved.id)).images;
    expect(appended.slice(0, 7)).toEqual(survivors);
    expect(appended.map(({ id }) => id)).toEqual([...survivors.map(({ id }) => id), appendedId]);
    await expect(uploadControl(page)).toHaveCount(0);
    await expect(message(page, text.maximum)).toBeVisible();
    await page.reload();
    await expectIdle(page, 8);
    expect((await listImages(actor, saved.id)).images).toEqual(appended);
    for (let index = 0; index < appended.length; index += 1) {
      const source = new URL(await thumbnails(page).nth(index).getByRole('img').getAttribute('src') as string, frontendUrl);
      expect(source.pathname).toBe('/_next/image');
      expect(source.searchParams.get('url')).toBe(publicImage(appended[index].url));
    }
  });

for (const operation of ['upload', 'replace'] as const) {
  for (const failure of ['network-before-save', 'lost-response-after-save', 'storage-unavailable'] as const) {
    test(`UI recovery: ${operation} ${failure} retries the same command and persists exactly one identity`,
      tags('T6'), async ({ page, actors, api }) => {
        await verifiedModerator(page);
        const actor = await actors('moderator');
        const saved = await product(actor);
        const original = await seed(api, actor, saved.id);
        await openProduct(page, saved);
        await expectIdle(page, 1);
        const requests = recordUploads(page, saved.id);
        await page.route(`${apiUrl}${imagesPath(saved.id)}`, async (route) => {
          if (route.request().method() !== 'POST') return route.continue();
          if (failure === 'storage-unavailable') return dependencyFailure(route);
          if (failure === 'lost-response-after-save') {
            const committed = await route.fetch();
            // Preserve genuine authentication renewal before deliberately losing a committed answer.
            if (committed.status() === 401) return route.fulfill({ response: committed });
            expect(committed.status()).toBe(201);
          }
          await route.abort('failed');
        });
        const file = png();
        if (operation === 'replace') {
          await thumbnails(page).first().click();
          await choose(page, dialog(page).getByRole('button', { name: 'Replace image' }), file);
        } else await choose(page, uploadControl(page), file);
        await expect(dialog(page)).not.toBeVisible();
        await expect(card(page).getByRole('button', { name: 'Try again' })).toBeVisible();
        await expect(card(page).getByRole('status')).toBeFocused();
        expect(await commandAttempts(requests)).toHaveLength(1);
        await page.unroute(`${apiUrl}${imagesPath(saved.id)}`);
        const retriedResponse = page.waitForResponse((answer) => isUpload(answer.request(), saved.id) && answer.status() !== 401);
        await card(page).getByRole('button', { name: 'Try again' }).click();
        expect((await retriedResponse).status()).toBe(failure === 'lost-response-after-save' ? 200 : 201);
        await expect(message(page, operation === 'replace' ? 'Image replaced.' : text.uploaded)).toBeVisible();
        const attempts = await commandAttempts(requests);
        expect(attempts).toHaveLength(2);
        expect(await field(attempts[1], 'id')).toBe(await field(attempts[0], 'id'));
        for (const request of requests) {
          expect(await multipartFile(request)).toEqual(file);
          expect(await field(request, 'id')).toBe(await field(requests[0], 'id'));
          expect(await field(request, 'replaces')).toBe(operation === 'replace' ? original.id : null);
          expect(await field(request, 'altText')).toBeNull();
          expect(await multipartFields(request)).toEqual(await multipartFields(requests[0]));
        }
        const persisted = (await listImages(actor, saved.id)).images;
        expect(persisted).toHaveLength(operation === 'replace' ? 1 : 2);
        const commandId = await field(requests[0], 'id');
        expect(persisted.filter(({ id }) => id === commandId)).toHaveLength(1);
        if (operation === 'replace') {
          expect(persisted[0].id).not.toBe(original.id);
          expect((await api.get(publicImage(original.url))).status()).toBe(404);
        }
        await page.reload();
        await expectIdle(page, persisted.length);
      });
  }
}

test('UI recovery: a new file choice discards a failed upload, and choosing the same path twice creates distinct ids',
  tags('T6'), async ({ page, actors }) => {
    await verifiedModerator(page);
    const actor = await actors('moderator');
    const saved = await product(actor);
    await openProduct(page, saved);
    const requests = recordUploads(page, saved.id);
    await page.route(`${apiUrl}${imagesPath(saved.id)}`, (route) => route.request().method() === 'POST'
      ? route.abort('failed') : route.continue());
    await choose(page, uploadControl(page));
    await expect(card(page).getByRole('button', { name: 'Try again' })).toBeVisible();
    await page.unroute(`${apiUrl}${imagesPath(saved.id)}`);
    await upload(page, png('front.png'));
    await expect(card(page).getByRole('button', { name: 'Try again' })).toHaveCount(0);
    await upload(page, png('front.png'));
    const attempts = await commandAttempts(requests);
    expect(attempts).toHaveLength(3);
    expect(new Set(await Promise.all(attempts.map((request) => field(request, 'id')))).size).toBe(3);
    for (const input of await page.locator('input[type="file"]').all()) await expect(input).toHaveValue('');
    expect((await listImages(actor, saved.id)).images).toHaveLength(2);
  });

for (const operation of ['upload', 'replace'] as const) {
  for (const precheck of ['size', 'type-extension-mismatch'] as const) {
    test(`UI recovery: ${operation} discards its retained failed command even when the next choice fails ${precheck} precheck`,
      tags('T6'), async ({ page, actors, api }) => {
        await verifiedModerator(page);
        const actor = await actors('moderator');
        const saved = await product(actor);
        const original = await seed(api, actor, saved.id);
        const catalogBefore = await getProduct(actor, saved.id);
        const originalBytes = await (await api.get(publicImage(original.url))).body();
        await openProduct(page, saved);
        await expectIdle(page, 1);
        const requests = recordUploads(page, saved.id);
        const path = `${apiUrl}${imagesPath(saved.id)}`;
        const chooseCommand = async (file: FilePayload) => {
          if (operation === 'replace') {
            await thumbnails(page).first().click();
            await choose(page, dialog(page).getByRole('button', { name: 'Replace image' }), file);
          } else await choose(page, uploadControl(page), file);
        };
        await page.route(path, (route) => route.request().method() === 'POST' ? route.abort('failed') : route.continue());
        await chooseCommand(png('failed.png'));
        await expect(dialog(page)).not.toBeVisible();
        await expect(card(page).getByRole('button', { name: 'Try again' })).toBeVisible();
        expect(await commandAttempts(requests)).toHaveLength(1);
        const failedId = await field(requests[0], 'id');
        expect(failedId).toBeTruthy();
        await page.unroute(path);
        const corrected = png('fresh.png');
        const invalid = precheck === 'size' ? { ...corrected, buffer: Buffer.alloc(3_145_729) }
          : { ...corrected, mimeType: 'image/jpeg' };
        await chooseCommand(invalid);
        await expect(card(page).getByRole('status')).toHaveText(precheck === 'size' ? /3 MB/ : /JPG or PNG/);
        await expect(card(page).getByRole('button', { name: 'Try again' })).toHaveCount(0);
        expect(requests).toHaveLength(1);
        for (const input of await page.locator('input[type="file"]').all()) await expect(input).toHaveValue('');
        expect((await listImages(actor, saved.id)).images).toEqual([original]);
        expect(await getProduct(actor, saved.id)).toEqual(catalogBefore);
        const publicOriginal = await api.get(publicImage(original.url));
        expect(publicOriginal.status()).toBe(200);
        expect(await publicOriginal.body()).toEqual(originalBytes);
        // Precheck rejection may keep or close the dialog; neither outcome may retain the failed command.
        if (await dialog(page).isVisible()) await dialog(page).getByRole('button', { name: 'Close', exact: true }).last().click();
        const answered = page.waitForResponse((response) => isUpload(response.request(), saved.id) && response.status() !== 401);
        await chooseCommand(corrected);
        expect((await answered).status()).toBe(201);
        await expect(message(page, operation === 'replace' ? 'Image replaced.' : text.uploaded)).toBeVisible();
        await expectIdle(page, operation === 'replace' ? 1 : 2);
        const attempts = await commandAttempts(requests);
        expect(attempts).toHaveLength(2);
        const freshId = await field(attempts[1], 'id');
        expect(freshId).toBeTruthy();
        expect(freshId).not.toBe(failedId);
        for (const request of requests.slice(1)) {
          expect(await multipartFile(request)).toEqual(corrected);
          expect(await field(request, 'id')).toBe(freshId);
          expect(await field(request, 'replaces')).toBe(operation === 'replace' ? original.id : null);
        }
        await expect(card(page).getByRole('button', { name: 'Try again' })).toHaveCount(0);
        const persisted = (await listImages(actor, saved.id)).images;
        expect(persisted.map(({ id }) => id)).toEqual(operation === 'replace' ? [freshId] : [original.id, freshId]);
        expect(await getProduct(actor, saved.id)).toEqual(catalogBefore);
      });
  }
}

test('UI recovery: stale description and main-image intent refresh the list instead of overwriting another session',
  tags('T6'), async ({ page, actors, api }) => {
    await verifiedModerator(page);
    const actor = await actors('moderator');
    const saved = await product(actor);
    const first = await seed(api, actor, saved.id);
    const second = await seed(api, actor, saved.id);
    const third = await seed(api, actor, saved.id);
    await openProduct(page, saved);
    await expectIdle(page, 3);
    const documentId = await page.evaluate(() => {
      const state = window as unknown as { __t15DocumentId: string };
      state.__t15DocumentId = crypto.randomUUID();
      return state.__t15DocumentId;
    });
    await thumbnails(page).first().click();
    await dialog(page).getByLabel('Description (alt text)').fill('Stale client description');
    expect((await updateAlt(actor, saved.id, first, 'Other session description')).status()).toBe(200);
    const staleAlt = page.waitForResponse((answer) => answer.request().method() === 'PUT' && answer.status() !== 401
      && new URL(answer.url()).pathname === `${imagesPath(saved.id)}/${first.id}`);
    await dialog(page).getByRole('button', { name: 'Save description' }).click();
    expect((await staleAlt).status()).toBe(409);
    await expect(dialog(page)).not.toBeVisible();
    await expect(message(page, text.changed)).toBeVisible();
    expect((await listImages(actor, saved.id)).images[0].altText).toBe('Other session description');
    await expect(thumbnails(page).first()).toHaveAccessibleName('Image 1: Other session description');
    await thumbnails(page).nth(1).click();
    expect((await reorderImages(actor, saved.id, [third.id, second.id, first.id], [first.id, second.id, third.id])).status()).toBe(200);
    const staleOrder = page.waitForResponse((answer) => answer.request().method() === 'PUT' && answer.status() !== 401
      && new URL(answer.url()).pathname === `/api/staff/products/${saved.id}/image-order`);
    await dialog(page).getByRole('button', { name: 'Make main image' }).click();
    expect((await staleOrder).status()).toBe(409);
    await expect(message(page, text.changed)).toBeVisible();
    await expect(dialog(page)).not.toBeVisible();
    expect((await listImages(actor, saved.id)).images.map(({ id }) => id)).toEqual([third.id, second.id, first.id]);
    const expected = [third, second, { ...first, altText: 'Other session description' }];
    const expectRefreshedImages = async () => {
      await expectIdle(page, 3);
      for (const [index, image] of expected.entries()) {
        await expect(thumbnails(page).nth(index)).toHaveAccessibleName(
          `Image ${index + 1}: ${image.altText ?? `${saved.name}, image ${index + 1}`}`);
        const displayed = thumbnails(page).nth(index).getByRole('img');
        await expect(displayed).toHaveAttribute('src', /\/_next\/image\?/);
        const optimized = new URL(await displayed.getAttribute('src') as string, frontendUrl);
        expect(optimized.origin).toBe(frontendUrl);
        expect(optimized.pathname).toBe('/_next/image');
        expect(optimized.searchParams.get('url')).toBe(publicImage(image.url));
      }
    };
    await expectRefreshedImages();
    expect(await page.evaluate(() => (window as unknown as { __t15DocumentId?: string }).__t15DocumentId)).toBe(documentId);
    await page.reload();
    await expectRefreshedImages();
  });

test('UI recovery: already removed confirmation refreshes honestly and a rejected description stays typed in the dialog',
  tags('T6'), async ({ page, actors, api }) => {
    await verifiedModerator(page);
    const actor = await actors('moderator');
    const saved = await product(actor);
    const first = await seed(api, actor, saved.id);
    await openProduct(page, saved);
    await thumbnails(page).first().click();
    const typed = 'Keep this synthetic description';
    await dialog(page).getByLabel('Description (alt text)').fill(typed);
    await page.route(`${apiUrl}${imagesPath(saved.id)}/${first.id}`, (route) => route.request().method() === 'PUT'
      ? dependencyFailure(route) : route.continue());
    await dialog(page).getByRole('button', { name: 'Save description' }).click();
    await expect(dialog(page).getByText(text.unavailable, { exact: true })).toBeFocused();
    await expect(dialog(page).getByLabel('Description (alt text)')).toHaveValue(typed);
    await expect(dialog(page).getByRole('button', { name: 'Save description' })).toBeEnabled();
    await page.unroute(`${apiUrl}${imagesPath(saved.id)}/${first.id}`);
    await dialog(page).getByRole('button', { name: 'Remove image' }).click();
    expect((await removeImage(actor, saved.id, first.id)).status()).toBe(204);
    await dialog(page).getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(dialog(page)).not.toBeVisible();
    await expect(message(page, text.alreadyRemoved)).toBeVisible();
    await expectIdle(page, 0);
    expect((await listImages(actor, saved.id)).images).toEqual([]);
  });

test('UI recovery: a concurrently reached image limit refreshes the card and discards retry',
  tags('T6'), async ({ page, actors, api }) => {
    await verifiedModerator(page);
    const actor = await actors('moderator');
    const saved = await product(actor);
    for (let index = 0; index < 7; index += 1) await seed(api, actor, saved.id);
    await openProduct(page, saved);
    await expectIdle(page, 7);
    await seed(api, actor, saved.id);
    const response = page.waitForResponse((answer) => isUpload(answer.request(), saved.id) && answer.status() !== 401);
    await choose(page, uploadControl(page));
    const rejected = await response;
    expect(rejected.status()).toBe(409);
    expect(await rejected.json()).toMatchObject({ code: 'IMAGE_LIMIT_REACHED', message: 'This Product already has the maximum number of images.' });
    await expectIdle(page, 8);
    await expect(message(page, 'This Product already has the maximum number of images.')).toBeVisible();
    await expect(message(page, text.maximum)).toBeVisible();
    await expect(uploadControl(page)).toHaveCount(0);
    await expect(card(page).getByRole('button', { name: 'Try again' })).toHaveCount(0);
    expect((await listImages(actor, saved.id)).images).toHaveLength(8);
  });

test('UI recovery: a terminal id conflict drops retry and the next file choice uses a fresh id',
  tags('T6'), async ({ page, actors }) => {
    await verifiedModerator(page);
    const actor = await actors('moderator');
    const saved = await product(actor);
    await openProduct(page, saved);
    const requests = recordUploads(page, saved.id);
    await page.route(`${apiUrl}${imagesPath(saved.id)}`, async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await route.fulfill({ status: 409, headers: {
        'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Request-ID': 't15-conflict',
        'Access-Control-Allow-Origin': frontendUrl, 'Access-Control-Allow-Credentials': 'true',
      }, body: JSON.stringify({ code: 'ID_CONFLICT', message: 'This id is already used by a different record.', requestId: 't15-conflict' }) });
    });
    await choose(page, uploadControl(page));
    await expect(card(page).getByRole('status')).toBeFocused();
    await expect(card(page).getByRole('button', { name: 'Try again' })).toHaveCount(0);
    await page.unroute(`${apiUrl}${imagesPath(saved.id)}`);
    await upload(page);
    const attempts = await commandAttempts(requests);
    expect(attempts).toHaveLength(2);
    expect(await field(attempts[1], 'id')).not.toBe(await field(attempts[0], 'id'));
    expect((await listImages(actor, saved.id)).images).toHaveLength(1);
  });

test('UI security: printable alt text containing markup stays text after reload and in the image dialog',
  tags('T6'), async ({ page, actors, api }) => {
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).__t15AltExecuted = false;
    });
    await verifiedModerator(page);
    const actor = await actors('moderator');
    const saved = await product(actor);
    const description = '<img src=x onerror=window.__t15AltExecuted=true>';
    await seed(api, actor, saved.id, { altText: description });
    await openProduct(page, saved);
    await expectIdle(page, 1);
    const expectLiteralDescription = async () => {
      await expect(thumbnails(page).first()).toHaveAccessibleName(`Image 1: ${description}`);
      await expect(thumbnails(page).first().getByRole('img')).toHaveAttribute('alt', description);
      await expect(page.locator('[onerror]')).toHaveCount(0);
      expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__t15AltExecuted)).toBe(false);
      await thumbnails(page).first().click();
      await expect(dialog(page).getByLabel('Description (alt text)')).toHaveValue(description);
      await expect(dialog(page).getByRole('img')).toHaveAttribute('alt', description);
      await expect(page.locator('[onerror]')).toHaveCount(0);
      expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__t15AltExecuted)).toBe(false);
    };
    await expectLiteralDescription();
    await page.reload();
    await expectIdle(page, 1);
    await expectLiteralDescription();
    expect((await listImages(actor, saved.id)).images[0].altText).toBe(description);
  });


test('UI recovery: leaving a Product discards a retained failed upload and returning cannot replay it',
  tags('T6'), async ({ page, actors }) => {
    await verifiedModerator(page);
    const actor = await actors('moderator');
    const saved = await product(actor);
    await openProduct(page, saved);
    await expectIdle(page, 0);
    const documentId = await page.evaluate(() => {
      const state = window as unknown as { __t15DocumentId: string };
      state.__t15DocumentId = crypto.randomUUID();
      return state.__t15DocumentId;
    });
    const requests = recordUploads(page, saved.id);
    await page.route(`${apiUrl}${imagesPath(saved.id)}`, (route) => route.request().method() === 'POST'
      ? route.abort('failed') : route.continue());
    await choose(page, uploadControl(page));
    await expect(card(page).getByRole('button', { name: 'Try again' })).toBeVisible();
    expect(requests).toHaveLength(1);
    const failedId = await field(requests[0], 'id');
    await page.unroute(`${apiUrl}${imagesPath(saved.id)}`);
    // Use application links in both directions so document teardown cannot clear the retained command for us.
    await page.getByRole('link', { name: 'Products', exact: true }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: 'Products', exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __t15DocumentId?: string }).__t15DocumentId)).toBe(documentId);
    await productList(page).search.fill(saved.name);
    await productList(page).apply.click();
    await page.getByRole('link', { name: `Edit ${saved.name}`, exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: saved.name, exact: true })).toBeVisible();
    await expectIdle(page, 0);
    expect(await page.evaluate(() => (window as unknown as { __t15DocumentId?: string }).__t15DocumentId)).toBe(documentId);
    await expect(card(page).getByRole('button', { name: 'Try again' })).toHaveCount(0);
    await expect(card(page).getByRole('status')).toHaveCount(0);
    expect(requests).toHaveLength(1);
    expect((await listImages(actor, saved.id)).images).toEqual([]);
    await upload(page);
    const attempts = await commandAttempts(requests);
    expect(attempts).toHaveLength(2);
    const nextIds = await Promise.all(attempts.slice(1).map((request) => field(request, 'id')));
    expect(new Set(nextIds).size).toBe(1);
    expect(nextIds[0]).not.toBe(failedId);
    expect((await listImages(actor, saved.id)).images.map(({ id }) => id)).toEqual([nextIds[0]]);
  });

test('UI recovery: a pending description disables the modal, and a lost network request retains the typed text for save',
  tags('T6'), async ({ page, actors, api }) => {
    await verifiedModerator(page);
    const actor = await actors('moderator');
    const saved = await product(actor);
    const first = await seed(api, actor, saved.id);
    await openProduct(page, saved);
    await thumbnails(page).first().click();
    const typed = 'Keep this description after a network refusal';
    const input = dialog(page).getByLabel('Description (alt text)');
    await input.fill(typed);
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    let received!: () => void;
    const arrived = new Promise<void>((resolve) => { received = resolve; });
    let requests = 0;
    const commandRequests: Request[] = [];
    const pending = new Set<Request>();
    const path = `${apiUrl}${imagesPath(saved.id)}/${first.id}`;
    page.on('request', (request) => {
      if (request.method() === 'PUT' && request.url() === path) { commandRequests.push(request); pending.add(request); }
    });
    page.on('requestfinished', (request) => pending.delete(request));
    page.on('requestfailed', (request) => pending.delete(request));
    await page.route(path, async (route) => {
      if (route.request().method() !== 'PUT') return route.continue();
      requests += 1;
      received();
      await blocked;
      await route.abort('failed');
    });
    try {
      await dialog(page).getByRole('button', { name: 'Save description' }).click();
      await arrived;
      await expect(dialog(page)).toBeVisible();
      await expect(input).toBeDisabled();
      for (const button of await dialog(page).getByRole('button').all()) await expect(button).toBeDisabled();
      await dialog(page).getByRole('button', { name: 'Save description' }).dispatchEvent('click');
      expect((await listImages(actor, saved.id)).images[0]).toEqual(first);
    } finally { release(); }
    await expect(dialog(page).getByText('The request could not be completed.', { exact: true })).toBeFocused();
    await expect.poll(() => pending.size, 'description transports settle after the refusal').toBe(0);
    expect(requests).toBe(1);
    expect(await commandAttempts(commandRequests)).toHaveLength(1);
    await expect(input).toBeEnabled();
    await expect(input).toHaveValue(typed);
    await expect(dialog(page).getByRole('button', { name: 'Save description' })).toBeEnabled();
    await page.unroute(path);
    await dialog(page).getByRole('button', { name: 'Save description' }).click();
    await expect(dialog(page)).not.toBeVisible();
    await expect(message(page, 'Description saved.')).toBeVisible();
    await expect.poll(() => pending.size, 'description transports settle after the final save').toBe(0);
    expect(await commandAttempts(commandRequests)).toHaveLength(2);
    await expect(thumbnails(page).first()).toBeFocused();
    expect((await listImages(actor, saved.id)).images[0]).toMatchObject({ altText: typed, version: first.version + 1 });
  });

test('UI recovery: an image removed elsewhere refreshes a stale description and cannot be made main',
  tags('T6'), async ({ page, actors, api }) => {
    await verifiedModerator(page);
    const actor = await actors('moderator');
    const saved = await product(actor);
    const first = await seed(api, actor, saved.id);
    const second = await seed(api, actor, saved.id);
    await openProduct(page, saved);
    await expectIdle(page, 2);
    await thumbnails(page).first().click();
    await dialog(page).getByLabel('Description (alt text)').fill('Description for a removed image');
    expect((await removeImage(actor, saved.id, first.id)).status()).toBe(204);
    const refused = page.waitForResponse((answer) => answer.request().method() === 'PUT'
      && answer.status() !== 401 && new URL(answer.url()).pathname === `${imagesPath(saved.id)}/${first.id}`);
    await dialog(page).getByRole('button', { name: 'Save description' }).click();
    expect((await refused).status()).toBe(404);
    await expect(dialog(page)).not.toBeVisible();
    await expectIdle(page, 1);
    await expect(card(page).getByRole('status')).toBeFocused();
    await expect(card(page).getByRole('button', { name: 'Try again' })).toHaveCount(0);
    expect((await listImages(actor, saved.id)).images.map(({ id }) => id)).toEqual([second.id]);
    const third = await seed(api, actor, saved.id);
    await page.reload();
    await expectIdle(page, 2);
    await thumbnails(page).nth(1).click();
    expect((await removeImage(actor, saved.id, third.id)).status()).toBe(204);
    const stale = page.waitForResponse((answer) => answer.request().method() === 'PUT'
      && answer.status() !== 401 && new URL(answer.url()).pathname === `/api/staff/products/${saved.id}/image-order`);
    await dialog(page).getByRole('button', { name: 'Make main image' }).click();
    expect((await stale).status()).toBe(409);
    await expect(dialog(page)).not.toBeVisible();
    await expect(message(page, text.changed)).toBeFocused();
    await expectIdle(page, 1);
    expect((await listImages(actor, saved.id)).images.map(({ id }) => id)).toEqual([second.id]);
  });


test('UI recovery: a committed upload with a failed list refresh retries only the read and retains one identity',
  tags('T6'), async ({ page, actors }) => {
    await verifiedModerator(page);
    const actor = await actors('moderator');
    const saved = await product(actor);
    await openProduct(page, saved);
    await expectIdle(page, 0);
    const uploads = recordUploads(page, saved.id);
    let committed = false;
    const reads: Request[] = [];
    const path = `${apiUrl}${imagesPath(saved.id)}`;
    await page.route(path, async (route) => {
      if (route.request().method() === 'POST') {
        const answer = await route.fetch();
        if (answer.status() === 401) return route.fulfill({ response: answer });
        expect(answer.status()).toBe(201);
        committed = true;
        return route.fulfill({ response: answer });
      }
      if (route.request().method() === 'GET' && committed) { reads.push(route.request()); return route.abort('failed'); }
      return route.continue();
    });
    await choose(page, uploadControl(page));
    await expect(card(page).getByRole('alert')).toContainText('Images could not be loaded.');
    await expect(card(page).getByRole('status')).toHaveCount(0);
    expect(committed).toBe(true);
    expect(reads).toHaveLength(1);
    const persisted = (await listImages(actor, saved.id)).images;
    expect(persisted).toHaveLength(1);
    const [created] = persisted;
    expect(created.id).toBe(await field(uploads[0], 'id'));
    expect(await commandAttempts(uploads)).toHaveLength(1);
    await page.unroute(path);
    const refreshed = page.waitForResponse((answer) => answer.request().method() === 'GET'
      && new URL(answer.url()).pathname === imagesPath(saved.id) && answer.status() === 200);
    await card(page).getByRole('button', { name: 'Try again' }).click();
    await refreshed;
    await expectIdle(page, 1);
    await expect(card(page).getByRole('alert')).toHaveCount(0);
    await expect(uploadControl(page)).toBeEnabled();
    expect(await commandAttempts(uploads)).toHaveLength(1);
    expect((await listImages(actor, saved.id)).images.map(({ id }) => id)).toEqual([created.id]);
    const displayed = thumbnails(page).first().getByRole('img');
    const optimized = new URL(await displayed.getAttribute('src') as string, frontendUrl);
    expect(optimized.pathname).toBe('/_next/image');
    expect(optimized.searchParams.get('url')).toBe(publicImage(created.url));
  });

test('UI recovery: the upload busy guard remains active through its held post-commit list refresh',
  tags('T6'), async ({ page, actors, api }) => {
    await verifiedModerator(page);
    const actor = await actors('moderator');
    const saved = await product(actor);
    await seed(api, actor, saved.id);
    await openProduct(page, saved);
    await expectIdle(page, 1);
    const uploads = recordUploads(page, saved.id);
    let postStarted = false;
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    let received!: () => void;
    const arrived = new Promise<void>((resolve) => { received = resolve; });
    const path = `${apiUrl}${imagesPath(saved.id)}`;
    await page.route(path, async (route) => {
      if (route.request().method() === 'POST') { postStarted = true; return route.continue(); }
      if (route.request().method() !== 'GET' || !postStarted) return route.continue();
      const answer = await route.fetch();
      if (answer.status() === 401) return route.fulfill({ response: answer });
      expect(answer.status()).toBe(200);
      received();
      await blocked;
      return route.fulfill({ response: answer });
    });
    try {
      await choose(page, uploadControl(page));
      await arrived;
      expect((await listImages(actor, saved.id)).images).toHaveLength(2);
      await expect(card(page).locator('button:enabled')).toHaveCount(0);
      for (const button of await card(page).getByRole('button').all()) {
        await expect(button).toBeDisabled();
        await button.dispatchEvent('click');
      }
    } finally { release(); }
    await expectIdle(page, 2);
    await expect(message(page, text.uploaded)).toBeVisible();
    await expect(uploadControl(page)).toBeEnabled();
    expect(await commandAttempts(uploads)).toHaveLength(1);
    await page.unroute(path);
  });

test('UI recovery: a late Product A image list cannot overwrite Product B after application-link navigation',
  tags('T6'), async ({ page, actors, api }) => {
    await verifiedModerator(page);
    const actor = await actors('moderator');
    const first = await product(actor);
    const second = await product(actor);
    await seed(api, actor, first.id, { altText: 'Product A image' });
    const secondImages = [await seed(api, actor, second.id, { altText: 'Product B main' }),
      await seed(api, actor, second.id, { altText: 'Product B rear' })];
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    let received!: () => void;
    const arrived = new Promise<void>((resolve) => { received = resolve; });
    let settled!: () => void;
    const finished = new Promise<void>((resolve) => { settled = resolve; });
    let lateRequest: Request | undefined;
    let documentId: string | undefined;
    const path = `${apiUrl}${imagesPath(first.id)}`;
    await page.route(path, async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const answer = await route.fetch();
      if (answer.status() === 401) return route.fulfill({ response: answer });
      expect(answer.status()).toBe(200);
      lateRequest = route.request();
      received();
      await blocked;
      try { await route.fulfill({ response: answer }); }
      catch (error) {
        // Aborting A on unmount is an equally valid implementation of ignoring its late response.
        if (!route.request().failure()) throw error;
      } finally { settled(); }
    });
    const expectSecondImages = async () => {
      expect(await page.evaluate(() => (window as unknown as { __t15DocumentId?: string }).__t15DocumentId)).toBe(documentId);
      await expect(page.getByRole('heading', { level: 1, name: second.name, exact: true })).toBeVisible();
      await expectIdle(page, 2);
      for (const [index, image] of secondImages.entries()) {
        await expect(thumbnails(page).nth(index)).toHaveAccessibleName(`Image ${index + 1}: ${image.altText}`);
        const optimized = new URL(await thumbnails(page).nth(index).getByRole('img').getAttribute('src') as string, frontendUrl);
        expect(optimized.origin).toBe(frontendUrl);
        expect(optimized.pathname).toBe('/_next/image');
        expect(optimized.searchParams.get('url')).toBe(publicImage(image.url));
      }
    };
    try {
      await openProduct(page, first);
      await arrived;
      documentId = await page.evaluate(() => {
        const state = window as unknown as { __t15DocumentId: string };
        state.__t15DocumentId = crypto.randomUUID();
        return state.__t15DocumentId;
      });
      await page.getByRole('link', { name: 'Products', exact: true }).first().click();
      await expect(page.getByRole('heading', { level: 1, name: 'Products', exact: true })).toBeVisible();
      expect(await page.evaluate(() => (window as unknown as { __t15DocumentId?: string }).__t15DocumentId)).toBe(documentId);
      await productList(page).search.fill(second.name);
      await productList(page).apply.click();
      await page.getByRole('link', { name: `Edit ${second.name}`, exact: true }).click();
      await expectSecondImages();
    } finally { release(); }
    await finished;
    const delivered = await lateRequest!.response();
    if (delivered) await delivered.finished();
    // Give the completed read and any resulting React update their rendering turns before checking B.
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expectSecondImages();
    expect((await listImages(actor, second.id)).images).toEqual(secondImages);
    await page.unroute(path);
  });

test('UI recovery: a bounded INVALID_REQUEST description refusal keeps the draft and metadata for a later real save',
  tags('T6'), async ({ page, actors, api }) => {
    await verifiedModerator(page);
    const actor = await actors('moderator');
    const saved = await product(actor);
    const first = await seed(api, actor, saved.id);
    await openProduct(page, saved);
    await thumbnails(page).first().click();
    const typed = 'Keep this description after a bounded validation refusal';
    const input = dialog(page).getByLabel('Description (alt text)');
    await input.fill(typed);
    const path = `${apiUrl}${imagesPath(saved.id)}/${first.id}`;
    await page.route(path, (route) => route.request().method() !== 'PUT' ? route.continue()
      : route.fulfill({ status: 400, headers: {
        'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Request-ID': 't15-invalid-alt',
        'Access-Control-Allow-Origin': frontendUrl, 'Access-Control-Allow-Credentials': 'true',
      }, body: JSON.stringify({ code: 'INVALID_REQUEST', message: 'The request is invalid.', requestId: 't15-invalid-alt' }) }));
    await dialog(page).getByRole('button', { name: 'Save description' }).click();
    await expect(dialog(page).getByText('Check your details and try again.', { exact: true })).toBeFocused();
    await expect(input).toHaveValue(typed);
    await expect(input).toBeEnabled();
    await expect(dialog(page).getByRole('button', { name: 'Save description' })).toBeEnabled();
    expect((await listImages(actor, saved.id)).images).toEqual([first]);
    await page.unroute(path);
    const savedResponse = page.waitForResponse((answer) => answer.request().method() === 'PUT'
      && answer.url() === path && answer.status() !== 401);
    await dialog(page).getByRole('button', { name: 'Save description' }).click();
    expect((await savedResponse).status()).toBe(200);
    await expect(dialog(page)).not.toBeVisible();
    await expect(message(page, 'Description saved.')).toBeVisible();
    await expect(thumbnails(page).first()).toBeFocused();
    expect((await listImages(actor, saved.id)).images[0]).toMatchObject({
      id: first.id, url: first.url, contentType: first.contentType, width: first.width, height: first.height,
      altText: typed, version: first.version + 1,
    });
  });
