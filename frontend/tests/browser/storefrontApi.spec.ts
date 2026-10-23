import type { APIRequestContext } from '@playwright/test';
import {
  ApiActor, createCategory, createProduct, expect, medicineDraft, priceProduct, test, token, updateCategory, updateProduct,
} from './catalogSupport';
import { assertAwayFromDhakaMidnight, dhakaTomorrow, discountApi, discountDraft, publicPrice } from './discountSupport';
import { uploadImage, type ImageView, type UploadOptions } from './productImageSupport';
import { validJpeg, validPng } from './imageFixtures';
import {
  expectPublicJson, expectPublicNotFound, malformedIds, publicApi, publicCatalog, seedCategory, seedEquipment,
  storefrontPageSize, unknownId, withoutProductId, type PublicCategoryList, type PublicImage, type StorefrontFixture,
} from './storefrontSupport';
import { apiUrl } from './testApi';

/**
 * Ticket 17 T5 contract specs (E2E-17-01…04): the three anonymous catalog reads of plan §4.0.1 through the real jar and
 * PostgreSQL. Test-first: they fail until T2/T4 land.
 */
const t5 = (cross: string[] = []) => ({ tag: ['@t17', '@t17-T5', '@t17-api', ...cross] });

/** The public image of a staff image view (plan §4.0.1: `{url, altText, width, height}`). */
function publicImageOf(view: ImageView): PublicImage {
  return { url: view.url, altText: view.altText, width: view.width, height: view.height };
}

async function uploaded(api: APIRequestContext, admin: ApiActor, productId: string, bytes: Buffer,
                        options: UploadOptions = {}): Promise<ImageView> {
  const response = await uploadImage(api, admin, productId, bytes, options);
  expect(response.status()).toBe(201);
  return await response.json() as ImageView;
}

/** Malformed ids the API rejects; the upper-case form is a valid UUID the API still accepts (P16). */
function apiMalformedIds(validId: string): string[] {
  return Object.entries(malformedIds(validId)).filter(([form]) => form !== 'upper').map(([, id]) => id);
}

test('E2E-17-01 listable categories hold only active categories with an active priced Product', t5(),
  async ({ actors, api }) => {
    const admin = await actors('admin');
    const listed = await seedCategory(admin, 1, { name: `Listed ${token()}` });
    const empty = await createCategory(admin, `Empty ${token()}`);
    const inactive = await seedCategory(admin, 1, { name: `Hidden ${token()}` });
    await updateCategory(admin, inactive.category, { active: false });
    const onlyInactive = await seedCategory(admin, 1, { name: `Retired ${token()}` });
    await updateProduct(admin, onlyInactive.products[0], { active: false });

    const categories = await publicCatalog(api).categories();
    expect(categories.filter((category) => category.id === listed.category.id))
      .toEqual([{ id: listed.category.id, name: listed.category.name }]);
    const ids = categories.map((category) => category.id);
    for (const absent of [empty.id, inactive.category.id, onlyInactive.category.id]) expect(ids).not.toContain(absent);
  });

test('E2E-17-01 listable categories are the same for anonymous, Admin and invalid bearer callers', t5(),
  async ({ actors, api }) => {
    const admin = await actors('admin');
    await seedCategory(admin, 1);
    const raw = publicApi(api);
    const anonymous = await expectPublicJson<PublicCategoryList>(await raw.categories());
    const asAdmin = await expectPublicJson<PublicCategoryList>(await raw.categories(await admin.authorization()));
    const invalidBearer = await expectPublicJson<PublicCategoryList>(await raw.categories({ Authorization: 'Bearer invalid' }));
    expect(anonymous.categories.length).toBeGreaterThan(0);
    expect(asAdmin).toEqual(anonymous);
    expect(invalidBearer).toEqual(anonymous);
  });

test.describe('E2E-17-02 one category of 25 Products', () => {
  let http: APIRequestContext;
  let fixture: StorefrontFixture;

  // Seeded once per worker; a failed test restarts the worker, which seeds again, so the other tests still run.
  test.beforeAll(async ({ playwright }) => {
    http = await playwright.request.newContext({ baseURL: apiUrl });
    fixture = await seedCategory(await ApiActor.open(http, 'admin'), 25);
  });
  test.afterAll(async () => { await http?.dispose(); });

  test('E2E-17-02 category page lists 24 Products per page in public order', t5(), async ({ api }) => {
    const names = fixture.products.map((product) => product.name);
    expect([...names].sort(), 'the names sort differently by byte order, so the order check is meaningful')
      .not.toEqual(names);
    const page = await publicCatalog(api).categoryPage(fixture.category.id, 0);
    expect(page.category).toEqual({ id: fixture.category.id, name: fixture.category.name });
    expect(page.size).toBe(storefrontPageSize);
    expect(page.totalItems).toBe(25);
    expect(page.items.map((card) => card.id)).toEqual(fixture.products.slice(0, 24).map((product) => product.id));
    expect(page.items.map((card) => card.name)).toEqual(names.slice(0, 24));
    const first = fixture.products[0];
    expect(page.items[0]).toEqual({
      id: first.id, name: first.name, genericName: first.genericName, saleUnit: first.saleUnit, image: null,
      price: { sellingPrice: '120.00', mrp: null, price: '120.00', saving: '0.00', discount: null },
    });
  });

  test('E2E-17-02 the second API page holds the 25th Product and the page after it is not found', t5(),
    async ({ api }) => {
      const second = await publicCatalog(api).categoryPage(fixture.category.id, 1);
      expect(second.items.map((card) => card.id)).toEqual([fixture.products[24].id]);
      expect(second.totalItems).toBe(25);
      await expectPublicNotFound(await publicApi(api).categoryPage(fixture.category.id, 2));
    });

  test('E2E-17-02 invalid page values answer identical not-found bodies', t5(), async ({ api }) => {
    const raw = publicApi(api);
    const reference = await expectPublicNotFound(await raw.categoryPage(unknownId()));
    for (const value of ['-1', '01', '1.5', '1e2', 'abc', '', ' 1', '1,0', '2', '999999999', '1000000000']) {
      expect(await expectPublicNotFound(await raw.categoryPage(fixture.category.id, value)), `page=${value}`)
        .toEqual(reference);
    }
    expect(await expectPublicNotFound(await raw.categoryPath(
      `/api/categories/${fixture.category.id}/products?page=0&page=1`)), 'a repeated page parameter').toEqual(reference);
  });

  test('E2E-17-02 an explicit page 0 equals the bare route and an extra size parameter is ignored', t5(),
    async ({ api }) => {
      const raw = publicApi(api);
      const bare = await expectPublicJson(await raw.categoryPage(fixture.category.id));
      expect(await expectPublicJson(await raw.categoryPage(fixture.category.id, 0))).toEqual(bare);
      expect(await expectPublicJson(await raw.categoryPath(`/api/categories/${fixture.category.id}/products?size=50`)))
        .toEqual(bare);
    });
});

test('E2E-17-02 an empty active category answers page 0 with no items and page 1 not found', t5(),
  async ({ actors, api }) => {
    const admin = await actors('admin');
    const empty = await createCategory(admin, `Empty ${token()}`);
    const page = await publicCatalog(api).categoryPage(empty.id, 0);
    expect(page).toEqual({ category: { id: empty.id, name: empty.name }, items: [], page: 0, size: 24, totalItems: 0 });
    await expectPublicNotFound(await publicApi(api).categoryPage(empty.id, 1));
  });

test('E2E-17-02 an inactive, unknown or malformed category answers identical not-found bodies', t5(),
  async ({ actors, api }) => {
    const admin = await actors('admin');
    const inactive = await seedCategory(admin, 1);
    await updateCategory(admin, inactive.category, { active: false });
    const raw = publicApi(api);
    const reference = await expectPublicNotFound(await raw.categoryPage(unknownId()));
    expect(await expectPublicNotFound(await raw.categoryPage(inactive.category.id)), 'inactive').toEqual(reference);
    for (const id of apiMalformedIds(inactive.category.id)) {
      expect(await expectPublicNotFound(await raw.categoryPage(id)), `malformed ${id}`).toEqual(reference);
    }
  });

test('E2E-17-03 Product details expose exactly the public fields, images in order and the public price', t5(['@cross-15-17']),
  async ({ actors, api }) => {
    const admin = await actors('admin');
    const { category, products: [product] } = await seedCategory(admin, 1, {
      sellingPrice: '150.00', mrp: '160.00',
      overrides: { description: 'Line one\nLine two', requireValidation: true },
    });
    const front = await uploaded(api, admin, product.id, validPng(), { altText: 'Front of the box' });
    const side = await uploaded(api, admin, product.id, validJpeg(), { name: 'side.jpg', mimeType: 'image/jpeg' });

    const details = await publicCatalog(api).product(product.id);
    expect(details).toEqual({
      id: product.id, name: product.name, brandName: product.brandName, genericName: product.genericName,
      dosageForm: product.dosageForm, manufacturer: product.manufacturer, saleUnit: product.saleUnit,
      description: 'Line one\nLine two', requireValidation: true,
      category: { id: category.id, name: category.name },
      images: [publicImageOf(front), { ...publicImageOf(side), altText: null }],
      price: { sellingPrice: '150.00', mrp: '160.00', price: '150.00', saving: '0.00', discount: null },
    });
    expect(details.price).toEqual(withoutProductId(await publicPrice(api, product.id)));
    const [card] = (await publicCatalog(api).categoryPage(category.id, 0)).items;
    expect(card.image, 'the card shows the image at position 0').toEqual(publicImageOf(front));
    // The API accepts any UUID case, like the price route; only the pages insist on lower case (P16).
    expect(await expectPublicJson(await publicApi(api).product(product.id.toUpperCase()))).toEqual(details);
  });

test('E2E-17-03 equipment details and cards carry no generic name or dosage form', t5(), async ({ actors, api }) => {
  const admin = await actors('admin');
  const category = await createCategory(admin, `Devices ${token()}`);
  const equipment = await seedEquipment(admin, category.id);
  const details = await publicCatalog(api).product(equipment.id);
  expect(details).toMatchObject({
    genericName: null, dosageForm: null, brandName: equipment.brandName, manufacturer: equipment.manufacturer,
    saleUnit: equipment.saleUnit, description: null, requireValidation: false, images: [],
  });
  const [card] = (await publicCatalog(api).categoryPage(category.id, 0)).items;
  expect(card).toMatchObject({ id: equipment.id, genericName: null, image: null });
});

test('E2E-17-03 a Product of an inactive category stays readable with category null', t5(), async ({ actors, api }) => {
  const admin = await actors('admin');
  const { category, products: [product] } = await seedCategory(admin, 1);
  await updateCategory(admin, category, { active: false });
  const details = await publicCatalog(api).product(product.id);
  expect(details.category).toBeNull();
  expect(details.price).toEqual(withoutProductId(await publicPrice(api, product.id)));
});

test('E2E-17-03 inactive, unknown, malformed and unpriced Products answer identical not-found bodies', t5(),
  async ({ actors, api }) => {
    const admin = await actors('admin');
    const { category, products: [retired] } = await seedCategory(admin, 1);
    await updateProduct(admin, retired, { active: false });
    const draft = await createProduct(admin, medicineDraft(category.id));
    const pricedInactive = await priceProduct(admin, await createProduct(admin, medicineDraft(category.id)), '80.00');
    const raw = publicApi(api);
    const reference = await expectPublicNotFound(await raw.product(unknownId()));
    expect(await expectPublicNotFound(await api.get(`/api/products/${unknownId()}/price`)),
      'the same body as the price route').toEqual(reference);
    const cases: Record<string, string> = { inactive: retired.id, draft: draft.id, 'priced inactive': pricedInactive.id };
    apiMalformedIds(retired.id).forEach((id, index) => { cases[`malformed ${index}`] = id; });
    for (const [label, id] of Object.entries(cases)) {
      expect(await expectPublicNotFound(await raw.product(id)), label).toEqual(reference);
    }
  });

test.describe('E2E-17-04 Discounts in public reads', () => {
  test.beforeAll(() => assertAwayFromDhakaMidnight());

  test('E2E-17-04 a Category percentage and a Product flat Discount appear on cards and details', t5(['@cross-16-17']),
    async ({ actors, api }) => {
      const admin = await actors('admin');
      const discounted = await seedCategory(admin, 2, { sellingPrice: '150.00' });
      const flatShelf = await seedCategory(admin, 1, { sellingPrice: '150.00' });
      await discountApi(admin).create(discountDraft('CATEGORY', discounted.category.id, { kind: 'PERCENTAGE', value: '10' }));
      const [flatProduct] = flatShelf.products;
      await discountApi(admin).create(discountDraft('PRODUCT', flatProduct.id, { kind: 'FLAT', value: '15.00' }));

      const catalog = publicCatalog(api);
      const percentCards = (await catalog.categoryPage(discounted.category.id, 0)).items;
      const [flatCard] = (await catalog.categoryPage(flatShelf.category.id, 0)).items;
      expect(percentCards.map((card) => card.price)).toEqual(Array(2).fill({
        sellingPrice: '150.00', mrp: null, price: '135.00', saving: '15.00',
        discount: { targetType: 'CATEGORY', kind: 'PERCENTAGE', value: '10' },
      }));
      expect(flatCard.price).toEqual({
        sellingPrice: '150.00', mrp: null, price: '135.00', saving: '15.00',
        discount: { targetType: 'PRODUCT', kind: 'FLAT', value: '15.00' },
      });
      for (const card of [...percentCards, flatCard]) {
        const expected = withoutProductId(await publicPrice(api, card.id));
        expect(card.price, `card ${card.name}`).toEqual(expected);
        expect((await catalog.product(card.id)).price, `details ${card.name}`).toEqual(expected);
      }
    });

  test('E2E-17-04 a Discount that starts tomorrow is not applied', t5(['@cross-16-17']), async ({ actors, api }) => {
    const admin = await actors('admin');
    const { category, products: [product] } = await seedCategory(admin, 1, { sellingPrice: '150.00' });
    await discountApi(admin).create(discountDraft('PRODUCT', product.id, { value: '20', startsOn: dhakaTomorrow() }));
    await discountApi(admin).create(discountDraft('CATEGORY', category.id, { value: '30', startsOn: dhakaTomorrow() }));
    const undiscounted = { sellingPrice: '150.00', mrp: null, price: '150.00', saving: '0.00', discount: null };
    const [card] = (await publicCatalog(api).categoryPage(category.id, 0)).items;
    expect(card.price).toEqual(undiscounted);
    expect((await publicCatalog(api).product(product.id)).price).toEqual(undiscounted);
  });
});
