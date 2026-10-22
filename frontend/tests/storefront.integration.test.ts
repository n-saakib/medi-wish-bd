import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { createStorefrontClient } from '../src/lib/storefront';

const publicUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

it('ticket 17: the real storefront client projects categories and maps unknown reads to null', async () => {
  const baseUrl = process.env.MEDI_WISH_API_URL;
  if (!baseUrl) throw new Error('Set MEDI_WISH_API_URL to the running test backend before integration tests.');
  const catalog = createStorefrontClient({ baseUrl });

  const categories = await catalog.categories();
  if (categories === null) throw new Error('The public category list unexpectedly returned not-found.');
  for (const category of categories) {
    expect(Object.keys(category).sort()).toEqual(['id', 'name']);
    expect(category.id).toMatch(publicUuid);
    expect(category.name.length).toBeGreaterThan(0);
    expect(category.name.length).toBeLessThanOrEqual(80);
  }

  await expect(catalog.product(randomUUID())).resolves.toBeNull();
  await expect(catalog.product('not-a-uuid')).resolves.toBeNull();
  await expect(catalog.categoryPage(randomUUID(), 0)).resolves.toBeNull();
});
