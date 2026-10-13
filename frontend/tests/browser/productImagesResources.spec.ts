import type { Page } from '@playwright/test';
import {
  createCategory, createProduct, equipmentDraft, expect, expectJson, test,
} from './catalogSupport';
import { maxImageBytes, pngFixture } from './imageFixtures';
import {
  expectImage, imagesRoute, listImages, optimizedImage, uploadImage, type ImageView,
} from './productImageSupport';

async function decodedDimensions(page: Page, bytes: Buffer) {
  return page.evaluate(async (values) => {
    const image = await createImageBitmap(new Blob([Uint8Array.from(values)], { type: 'image/webp' }));
    try { return { width: image.width, height: image.height }; }
    finally { image.close(); }
  }, [...bytes]);
}

function expectedDimensions(width: number) {
  // Pinned Sharp rounds 1020 * (640 / 1024) to 638; withoutEnlargement preserves the source at 3840.
  return width === 640 ? { width: 640, height: 638 } : { width: 1024, height: 1020 };
}

test('T7 near-limit image uploads and uncached optimizer resource measurements',
  { tag: ['@t15', '@t15-T7', '@resources'] }, async ({ api, actors, page }) => {
    test.setTimeout(180_000);
    const admin = await actors('admin');
    const product = await createProduct(admin, equipmentDraft((await createCategory(admin)).id));
    const images: ImageView[] = [];
    const uploads: { imageIndex: number; inputBytes: number; storedBytes: number; elapsedMs: number }[] = [];
    for (let imageIndex = 0; imageIndex < 8; imageIndex += 1) {
      const bytes = pngFixture(1024, 1020, 15 + imageIndex);
      expect(bytes.length).toBeGreaterThan(maxImageBytes * 0.99);
      expect(bytes.length).toBeLessThanOrEqual(maxImageBytes);
      const start = performance.now();
      const response = await uploadImage(api, admin, product.id, bytes);
      const image = await expectJson<ImageView>(response, 201);
      const elapsedMs = performance.now() - start;
      expectImage(image);
      expect(image).toMatchObject({ width: 1024, height: 1020, position: imageIndex });
      images.push(image);
      uploads.push({ imageIndex, inputBytes: bytes.length, storedBytes: image.byteSize, elapsedMs });
    }
    expect((await listImages(admin, product.id)).images).toEqual(images);
    const listResponse = await admin.get(imagesRoute(product.id));
    expect(listResponse.status()).toBe(200);
    const listBytes = (await listResponse.body()).length;
    expect(listBytes).toBeLessThanOrEqual(16 * 1024);

    const sequential: { width: number; sample: number; optimizedBytes: number; optimizedWidth: number; optimizedHeight: number; elapsedMs: number; cache: string }[] = [];
    for (const width of [640, 3840]) {
      for (let sample = 0; sample < 2; sample += 1) {
        const start = performance.now();
        const response = await optimizedImage(api, images[0].url, width);
        const bytes = await response.body();
        const elapsedMs = performance.now() - start;
        const cache = response.headers()['x-nextjs-cache'];
        expect(response.status()).toBe(200);
        expect(response.headers()['content-type']).toBe('image/webp');
        expect(cache).toBe('MISS');
        expect(response.headers()['cache-control']).toBe('public, max-age=60, must-revalidate');
        expect(bytes.length).toBeGreaterThan(0);
        const dimensions = await decodedDimensions(page, bytes);
        expect(dimensions).toEqual(expectedDimensions(width));
        sequential.push({ width, sample, optimizedBytes: bytes.length, elapsedMs, cache,
          optimizedWidth: dimensions.width, optimizedHeight: dimensions.height });
        if (width === 640) expect(bytes.length).toBeLessThan(images[0].byteSize);
      }
    }

    const burstStartedAtUtcMs = Date.now();
    const burstStart = performance.now();
    const attempts = images.flatMap((image, imageIndex) => [640, 3840].map((width) => ({
      imageIndex, width, url: image.url, elapsedMs: 0,
    })));
    const outcomes = await Promise.allSettled(attempts.map(async (attempt) => {
      const start = performance.now();
      try {
        const response = await optimizedImage(api, attempt.url, attempt.width);
        const bytes = await response.body();
        return {
          imageIndex: attempt.imageIndex, width: attempt.width, status: response.status(),
          contentType: response.headers()['content-type'], optimizedBytes: bytes.length,
          cache: response.headers()['x-nextjs-cache'], cacheControl: response.headers()['cache-control'],
          bytes, networkFailure: false,
        };
      } finally {
        attempt.elapsedMs = performance.now() - start;
      }
    }));
    const burstElapsedMs = performance.now() - burstStart;
    const burstCompletedAtUtcMs = Date.now();
    // All HTTP attempts settle first; decode failures retain the response measurements and no exception text.
    const burst = await Promise.all(outcomes.map(async (outcome, index) => {
      let dimensions: { width: number; height: number } | null = null;
      let decodeFailure = false;
      const { bytes, ...sample } = outcome.status === 'fulfilled' ? outcome.value : {
        imageIndex: attempts[index].imageIndex, width: attempts[index].width,
        status: null, contentType: null, optimizedBytes: 0, cache: null, cacheControl: null, bytes: undefined, networkFailure: true,
      };
      if (bytes !== undefined && sample.status === 200) {
        try { dimensions = await decodedDimensions(page, bytes); }
        catch { decodeFailure = true; }
      }
      return { ...sample, elapsedMs: attempts[index].elapsedMs, decodeFailure,
        optimizedWidth: dimensions?.width ?? null, optimizedHeight: dimensions?.height ?? null };
    }));
    const measurements = {
      uploads, listBytes, sequential, burst, burstElapsedMs, burstStartedAtUtcMs, burstCompletedAtUtcMs,
      fiveHundredResponses: burst.filter((sample) => sample.status !== null && sample.status >= 500).length,
      networkFailures: burst.filter((sample) => sample.networkFailure).length,
      decodeFailures: burst.filter((sample) => sample.decodeFailure).length,
      peakWorkingSetBytes: null,
      memoryMeasurement: 'Pending native Windows sampling of the built frontend process during the burst.',
    };
    await test.info().attach('ticket-15-resources.json', {
      body: JSON.stringify(measurements, null, 2), contentType: 'application/json',
    });
    test.info().annotations.push({
      type: 't15-resources', description: JSON.stringify(measurements),
    }, {
      type: 'outstanding-check', description: measurements.memoryMeasurement,
    });
    expect(burst).toHaveLength(16);
    expect(measurements.networkFailures).toBe(0);
    expect(measurements.fiveHundredResponses).toBe(0);
    expect(measurements.decodeFailures).toBe(0);
    for (const sample of burst) {
      expect(sample.status).toBe(200);
      expect(sample.contentType).toBe('image/webp');
      expect(sample.cache).toBe('MISS');
      expect(sample.cacheControl).toBe('public, max-age=60, must-revalidate');
      expect({ width: sample.optimizedWidth, height: sample.optimizedHeight }).toEqual(expectedDimensions(sample.width));
      expect(sample.optimizedBytes).toBeGreaterThan(0);
    }
  });
