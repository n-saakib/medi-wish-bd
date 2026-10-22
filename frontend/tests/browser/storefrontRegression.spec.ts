import type { Browser, Page } from '@playwright/test';
import {
  activeProduct, createCategory, createProduct, expect, findCategory, medicineDraft, priceProduct, test, token,
  updateCategory, updateProduct, type ApiActor,
} from './catalogSupport';
import { assertAwayFromDhakaMidnight, discountApi, discountDraft, dhakaTomorrow, publicPrice } from './discountSupport';
import { validJpeg, validPng } from './imageFixtures';
import { uploadImage } from './productImageSupport';
import {
  aboutRows, apiLog, expectPublicJson, expectPublicNotFound, firstCategories, injection, malformedIds,
  normalizedText, openStorefront, pageTitle, productCount, publicApi, publicCatalog, seedCategory, serverHtml, storefront,
  storefrontCopy, taka, unknownId, watchForInjection,
} from './storefrontSupport';
import { frontendUrl } from './testApi';

/**
 * Ticket 17 T6 browser regression (plan T6 "Browser"): injected catalog text stays data, every unpurchasable case shares
 * one 404 page, no purchase surface, freshness after staff edits, public reads ignore credentials and leak no staff
 * field, and a scheduled Discount is shown nowhere. Real API jar and PostgreSQL; synthetic data only.
 */
const regression = ['@t17', '@t17-T6', '@t17-ui', '@regression'];
const t6 = { tag: regression };
const cross14 = { tag: [...regression, '@cross-14-17'] };
const cross16 = { tag: [...regression, '@cross-16-17'] };

/** Every unique catalog text this spec seeds, for the final API-log privacy check (E2E-17-16). */
const seededText: string[] = [];
function remember<T extends string>(text: T): T {
  seededText.push(text);
  return text;
}

type InjectedFixture = { categoryId: string; categoryName: string; productId: string; productName: string };

/** One category and one Medicine carrying the four `injection` strings (name, description, category name, image alt). */
async function seedInjected(admin: ApiActor, api: Parameters<typeof uploadImage>[0]): Promise<InjectedFixture> {
  const mark = token();
  const category = await createCategory(admin, remember(`${injection.categoryName} ${mark}`));
  const product = await activeProduct(admin, medicineDraft(category.id, {
    name: remember(`${injection.productName} ${mark}`), description: injection.description,
  }), '120.00');
  const uploaded = await uploadImage(api, admin, product.id, validPng(), { altText: injection.altText });
  expect(uploaded.status(), 'the injected-alt image upload').toBe(201);
  return { categoryId: category.id, categoryName: category.name, productId: product.id, productName: product.name };
}

/** The meta description P13 derives from the injected description: whitespace collapsed, shorter than 160. */
const injectedMetaDescription = normalizedText(injection.description);

/** No element, handler or script was created from catalog data (E7). Works with JavaScript on and off. */
async function expectNoInjectedMarkup(page: Page): Promise<void> {
  const main = page.getByRole('main');
  await expect(main.locator('script'), 'no script element inside main').toHaveCount(0);
  await expect(main.locator('svg[onload], img[src="x"], b, [onerror], [onload], [onmouseover]'),
    'no element made from injected markup').toHaveCount(0);
  const executable = await page.locator('script').evaluateAll((scripts) =>
    scripts.filter((script) => (script.textContent ?? '').trim() === 'window.__t17=1').length);
  expect(executable, 'the injected script text never became a script element').toBe(0);
}

/** Runs `check` on `path` in a fresh context with JavaScript disabled (what a crawler gets). */
async function withoutJavaScript(browser: Browser, path: string, check: (page: Page) => Promise<void>): Promise<void> {
  const context = await browser.newContext({ baseURL: frontendUrl, javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await openStorefront(page, path);
    await check(page);
  } finally {
    await context.close();
  }
}

/** Raw markup the injected strings would produce if they were ever written as HTML instead of escaped text. */
const rawInjectedMarkup = ['<script>window.__t17', '<img src=x', '<svg onload', '<b onmouseover', '<b>bold</b>'];

/** Opens each path, asserts 404, and captures the visible page and metadata that can distinguish the error. */
async function notFoundViews(page: Page, paths: string[]): Promise<string[]> {
  const view = storefront(page);
  const views: string[] = [];
  for (const path of paths) {
    await openStorefront(page, path, 404);
    await expect(view.notFoundTitle, `not-found page for ${path}`).toBeVisible();
    await expect(view.goHome).toBeVisible();
    // Only the page's own content: the header's session-dependent links load after the first paint.
    views.push(JSON.stringify({
      content: normalizedText(await view.main.innerText()),
      title: await page.title(),
      description: await page.locator('meta[name="description"]').getAttribute('content'),
    }));
  }
  return views;
}

/** Ticket 17 has no cart action, including an icon-only link with no visible text. */
async function expectNoPurchaseLinks(page: Page): Promise<void> {
  const main = storefront(page).main;
  await expect(main.getByRole('link', { name: /add to cart|buy now|checkout|purchase/i })).toHaveCount(0);
  await expect(main.locator('a[href*="/cart"], a[href*="/checkout"]')).toHaveCount(0);
}

test('E2E-17-12 injected catalog text renders literally and never executes with JavaScript on', t6,
  async ({ page, actors, api }) => {
    const admin = await actors('admin');
    const fixture = await seedInjected(admin, api);
    const view = storefront(page);
    const watch = watchForInjection(page);

    await openStorefront(page, `/categories/${fixture.categoryId}`);
    await page.waitForLoadState('load');
    await expect(view.heading).toContainText(fixture.categoryName);
    await expect(view.cardLink(fixture.productName)).toBeVisible();
    await expect(view.card(fixture.productName).locator('img')).toHaveAttribute('alt', injection.altText);
    await expect(page).toHaveTitle(pageTitle(fixture.categoryName));
    await expect(page.locator('meta[name="description"]'))
      .toHaveAttribute('content', `${fixture.categoryName} at Medi Wish: ${productCount(1)}.`);
    await expectNoInjectedMarkup(page);
    await watch.assertInert();

    await view.cardLink(fixture.productName).click();
    await expect(page).toHaveURL(`${frontendUrl}/products/${fixture.productId}`);
    await page.waitForLoadState('load');
    await expect(view.heading).toHaveText(fixture.productName);
    await expect(view.breadcrumb.getByRole('link', { name: fixture.categoryName, exact: true })).toBeVisible();
    await expect(view.main.locator('.gallery-main img')).toHaveAttribute('alt', injection.altText);
    await expect(view.about).toContainText('<img src=x onerror="window.__t17=2">');
    await expect(view.about).toContainText('Second line <b>bold</b>');
    await expect(page).toHaveTitle(pageTitle(fixture.productName));
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', injectedMetaDescription);
    await view.main.locator('.gallery-main img').hover();
    await expectNoInjectedMarkup(page);
    await watch.assertInert();
  });

test('E2E-17-12 injected catalog text is escaped in the server HTML with JavaScript off', t6,
  async ({ browser, actors, api }) => {
    const admin = await actors('admin');
    const fixture = await seedInjected(admin, api);

    const listing = await serverHtml(browser, `/categories/${fixture.categoryId}`);
    expect(listing.status).toBe(200);
    expect(listing.title).toBe(pageTitle(fixture.categoryName));
    expect(listing.metaDescription).toBe(`${fixture.categoryName} at Medi Wish: ${productCount(1)}.`);
    expect(listing.h1).toHaveLength(1);
    expect(listing.h1[0]).toContain(fixture.categoryName);
    expect(listing.cardNames).toContain(fixture.productName);
    for (const markup of rawInjectedMarkup) expect(listing.html, `raw ${markup} in category HTML`).not.toContain(markup);

    const details = await serverHtml(browser, `/products/${fixture.productId}`);
    expect(details.status).toBe(200);
    expect(details.title).toBe(pageTitle(fixture.productName));
    expect(details.metaDescription).toBe(injectedMetaDescription);
    expect(details.h1).toEqual([fixture.productName]);
    expect(details.mainText).toContain('<img src=x onerror="window.__t17=2">');
    expect(details.mainText).toContain('Second line <b>bold</b>');
    for (const markup of rawInjectedMarkup) expect(details.html, `raw ${markup} in details HTML`).not.toContain(markup);

    await withoutJavaScript(browser, `/categories/${fixture.categoryId}`, async (page) => {
      await expect(storefront(page).card(fixture.productName).locator('img')).toHaveAttribute('alt', injection.altText);
      await expectNoInjectedMarkup(page);
    });
    await withoutJavaScript(browser, `/products/${fixture.productId}`, async (page) => {
      const view = storefront(page);
      await expect(view.breadcrumb.getByRole('link', { name: fixture.categoryName, exact: true })).toHaveCount(1);
      await expect(view.main.locator('.gallery-main img')).toHaveAttribute('alt', injection.altText);
      await expectNoInjectedMarkup(page);
    });
  });

test('E2E-17-13 inactive, unpriced, unknown and malformed Product URLs share one indistinguishable 404 page', t6,
  async ({ page, actors }) => {
    const admin = await actors('admin');
    const mark = token();
    const { category, products: [listed] } = await seedCategory(admin, 1, { prefix: remember(`Gone ${mark}`) });
    remember(category.name);
    const inactive = await updateProduct(admin, await activeProduct(admin,
      medicineDraft(category.id, { name: remember(`Inactive ${mark}`) }), '90.00'), { active: false });
    const unpriced = await createProduct(admin, medicineDraft(category.id, { name: remember(`Unpriced ${mark}`) }));

    await openStorefront(page, `/products/${listed.id}`);
    await expect(storefront(page).heading).toHaveText(listed.name);
    const views = await notFoundViews(page, [
      `/products/${inactive.id}`,
      `/products/${unpriced.id}`,
      `/products/${unknownId()}`,
      ...Object.values(malformedIds(listed.id)).map((id) => `/products/${id}`),
    ]);
    expect(new Set(views).size, 'every unpurchasable Product URL shows the same page').toBe(1);
    expect(views[0]).not.toContain(listed.name);
  });

test('E2E-17-13 inactive or unknown categories and invalid page values share the Product 404 page', t6,
  async ({ page, actors }) => {
    const admin = await actors('admin');
    const mark = token();
    const { category } = await seedCategory(admin, 1, { name: remember(`Paged ${mark}`), prefix: remember(`Pg ${mark}`) });
    const hidden = await seedCategory(admin, 1, { name: remember(`Hidden ${mark}`), prefix: remember(`Hd ${mark}`) });
    await updateCategory(admin, (await findCategory(admin, hidden.category.id))!, { active: false });

    await openStorefront(page, `/categories/${category.id}`);
    const pagePath = (value: string) => `/categories/${category.id}?${value}`;
    const views = await notFoundViews(page, [
      `/products/${unknownId()}`,
      `/categories/${hidden.category.id}`,
      `/categories/${unknownId()}`,
      `/categories/${malformedIds(category.id).text}`,
      `/categories/${malformedIds(category.id).upper}`,
      pagePath('page=2'),
      pagePath('page=0'),
      pagePath('page=-1'),
      pagePath('page=abc'),
      pagePath('page=01'),
      pagePath('page=1.5'),
      pagePath('page='),
      pagePath('page=2&page=3'),
    ]);
    expect(new Set(views).size, 'category and page not-found cases match the Product not-found page').toBe(1);
  });

test('E2E-17-14 category and details pages offer no purchase controls or stock wording', t6,
  async ({ page, actors, api }) => {
    const admin = await actors('admin');
    const { category, products: [pictured, plain] } = await seedCategory(admin, 2,
      { prefix: remember(`Shelf ${token()}`) });
    remember(category.name);
    for (const file of [
      { bytes: validPng(), name: 'front.png', mimeType: 'image/png' },
      { bytes: validJpeg(), name: 'back.jpg', mimeType: 'image/jpeg' },
    ]) {
      const uploaded = await uploadImage(api, admin, pictured.id, file.bytes, { name: file.name, mimeType: file.mimeType });
      expect(uploaded.status(), 'gallery image upload').toBe(201);
    }
    const view = storefront(page);
    const forbiddenWords = /stock|availab|add to cart/i;

    await openStorefront(page, `/categories/${category.id}`);
    await expect(view.cards).toHaveCount(2);
    await expect(view.main.locator('button, input, select, textarea')).toHaveCount(0);
    await expectNoPurchaseLinks(page);
    expect(await view.main.innerText()).not.toMatch(forbiddenWords);

    await openStorefront(page, `/products/${pictured.id}`);
    await expect(view.thumbnails).toHaveCount(2);
    const buttons = await view.main.locator('button').evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('aria-label') ?? element.textContent?.trim() ?? ''));
    expect(buttons, 'the only buttons are the gallery thumbnails').toEqual(['Image 1', 'Image 2']);
    await expect(view.main.locator('input, select, textarea')).toHaveCount(0);
    await expectNoPurchaseLinks(page);
    expect(await view.main.innerText()).not.toMatch(forbiddenWords);

    await openStorefront(page, `/products/${plain.id}`);
    await expect(view.heading).toHaveText(plain.name);
    await expect(view.main.locator('button, input, select, textarea')).toHaveCount(0);
    await expectNoPurchaseLinks(page);
    expect(await view.main.innerText()).not.toMatch(forbiddenWords);
  });

test('E2E-17-15 rename, Sale Unit and price changes show on the next load and deactivation becomes 404', cross14,
  async ({ page, actors }) => {
    const admin = await actors('admin');
    const mark = token();
    const category = await createCategory(admin, remember(`Fresh ${mark}`));
    let product = await activeProduct(admin, medicineDraft(category.id,
      { name: remember(`Fresh ${mark} first`), saleUnit: 'Strip of 10 tablets' }), '120.00');
    await activeProduct(admin, medicineDraft(category.id, { name: remember(`Fresh ${mark} second`) }), '80.00');
    const view = storefront(page);
    const reload = async (status = 200) => expect((await page.reload())?.status(), 'reloaded status').toBe(status);

    await openStorefront(page, `/products/${product.id}`);
    await expect(view.heading).toHaveText(product.name);
    await expect(view.price.first()).toHaveText(taka('120.00'));

    product = await updateProduct(admin, product, { name: remember(`Renamed ${mark}`) });
    await reload();
    await expect(view.heading).toHaveText(`Renamed ${mark}`);

    product = await updateProduct(admin, product, { saleUnit: 'Box of 30 tablets' });
    await reload();
    await expect.poll(() => aboutRows(view.about)).toContainEqual(['Sale unit', 'Box of 30 tablets']);

    product = await priceProduct(admin, product, '135.00');
    await reload();
    await expect(view.price.first()).toHaveText(taka('135.00'));

    await updateProduct(admin, product, { active: false });
    await reload(404);
    await expect(view.notFoundTitle).toBeVisible();

    await openStorefront(page, `/categories/${category.id}`);
    await expect(view.cards).toHaveCount(1);
    await expect(view.cardLink(`Renamed ${mark}`)).toHaveCount(0);
  });

test('E2E-17-15 a deactivated category leaves the header bar on the next load', cross14,
  async ({ page, actors, api }) => {
    const admin = await actors('admin');
    const mark = token();
    // Digits sort before letters, so this category lands among the first 8 listable categories the bar shows.
    const category = await createCategory(admin, remember(`000 Bar ${mark}`));
    await activeProduct(admin, medicineDraft(category.id, { name: remember(`Bar ${mark} item`) }), '75.00');
    const view = storefront(page);
    const catalog = publicCatalog(api);

    const before = firstCategories(await catalog.categories());
    expect(before.map((item) => item.id), 'the seeded category is among the first 8 listable categories')
      .toContain(category.id);
    await openStorefront(page, '/');
    await expect(view.categoryNavLinks).toHaveText([...before.map((item) => item.name), storefrontCopy.allCategories]);

    await updateCategory(admin, (await findCategory(admin, category.id))!, { active: false });
    const after = firstCategories(await catalog.categories());
    expect(after.map((item) => item.id)).not.toContain(category.id);
    expect((await page.reload())?.status()).toBe(200);
    await expect(view.categoryNav.getByRole('link', { name: category.name, exact: true })).toHaveCount(0);
    await expect(view.categoryNavLinks).toHaveText([...after.map((item) => item.name), storefrontCopy.allCategories]);
  });

test.describe('E2E-17-16 privacy', () => {
  test.describe.configure({ mode: 'serial' });

  test('E2E-17-16 a Bearer invalid header changes no public API response', t6, async ({ actors, api }) => {
    const admin = await actors('admin');
    const { category, products: [product] } = await seedCategory(admin, 1, { name: remember(`Private ${token()}`) });
    remember(product.name);
    const raw = publicApi(api);
    const bearer = { Authorization: 'Bearer invalid' };

    expect(await expectPublicJson(await raw.categories(bearer))).toEqual(await expectPublicJson(await raw.categories()));
    expect(await expectPublicJson(await raw.categoryPage(category.id, undefined, bearer)))
      .toEqual(await expectPublicJson(await raw.categoryPage(category.id)));
    expect(await expectPublicJson(await raw.product(product.id, bearer)))
      .toEqual(await expectPublicJson(await raw.product(product.id)));
    const unknown = unknownId();
    expect(await expectPublicNotFound(await raw.product(unknown, bearer)))
      .toEqual(await expectPublicNotFound(await raw.product(unknown)));
    expect(await expectPublicNotFound(await raw.categoryPage(unknown, undefined, bearer)))
      .toEqual(await expectPublicNotFound(await raw.categoryPage(unknown)));
  });

  test('E2E-17-16 server HTML of details and category pages holds no staff field', t6, async ({ browser, actors }) => {
    const admin = await actors('admin');
    const { category, products: [product] } = await seedCategory(admin, 1, { name: remember(`Fields ${token()}`) });
    remember(product.name);
    // JSON keys may appear plain or backslash-escaped inside the inline RSC payload. Every message namespace is
    // shipped to the client, so the translated label `"status": "Status"` is present; the staff field is matched
    // by its ProductStatus values instead.
    const staffKeys = [/\\?"version\\?"\s*:/, /updatedBy/, /\\?"status\\?"\s*:\s*\\?"(ACTIVE|INACTIVE|NEEDS_PRICE)\\?"/];
    for (const path of [`/products/${product.id}`, `/categories/${category.id}`]) {
      const html = await serverHtml(browser, path);
      expect(html.status).toBe(200);
      for (const key of staffKeys) expect(html.html, `${key} in ${path}`).not.toMatch(key);
    }
  });
});

test.describe('E2E-17-17 scheduled Discount', () => {
  test.beforeAll(() => assertAwayFromDhakaMidnight());

  test('E2E-17-17 a Discount that starts tomorrow is shown on no page', cross16, async ({ page, browser, actors, api }) => {
    const admin = await actors('admin');
    const mark = token();
    const { category, products: [first, second] } = await seedCategory(admin, 2,
      { name: remember(`Later ${mark}`), prefix: remember(`Soon ${mark}`) });
    await discountApi(admin).create(discountDraft('CATEGORY', category.id, { startsOn: dhakaTomorrow() }));
    await discountApi(admin).create(discountDraft('PRODUCT', second.id,
      { kind: 'FLAT', value: '15.00', startsOn: dhakaTomorrow() }));
    for (const product of [first, second]) expect((await publicPrice(api, product.id)).discount).toBeNull();
    const view = storefront(page);

    await openStorefront(page, `/categories/${category.id}`);
    await expect(view.cards).toHaveCount(2);
    await expect(view.badge).toHaveCount(0);
    await expect(view.wasPrice).toHaveCount(0);
    for (const product of [first, second]) {
      await expect(view.card(product.name).locator('.price')).toHaveText(taka('120.00'));
    }
    for (const product of [first, second]) {
      await openStorefront(page, `/products/${product.id}`);
      await expect(view.price.first()).toHaveText(taka('120.00'));
      await expect(view.badge).toHaveCount(0);
      await expect(view.wasPrice).toHaveCount(0);
    }
    for (const path of [`/categories/${category.id}`, `/products/${second.id}`]) {
      const html = await serverHtml(browser, path);
      expect(html.status).toBe(200);
      expect(html.html).not.toContain('badge-sale');
      expect(html.html).not.toContain('price-was');
      expect(html.mainText).not.toMatch(/OFF/);
    }
  });
});

test('E2E-17-16 the API log holds none of this spec\'s seeded catalog text', t6, async () => {
  expect(seededText.length, 'this worker seeded catalog text').toBeGreaterThan(0);
  const log = apiLog();
  for (const text of seededText) expect(log.includes(text), 'seeded catalog text in the API log').toBe(false);
});
