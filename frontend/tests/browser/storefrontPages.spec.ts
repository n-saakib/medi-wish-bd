import type { APIRequestContext, Browser, Locator, Page } from '@playwright/test';
import { ApiActor, createCategory, expect, test, token, updateCategory, updateProduct } from './catalogSupport';
import { assertAwayFromDhakaMidnight, discountApi, discountDraft, publicPrice } from './discountSupport';
import { publicImage, uploadImage, type ImageView, type UploadOptions } from './productImageSupport';
import { validJpeg, validPng } from './imageFixtures';
import {
  aboutRows, apiResponseCount, badgeText, canonical, copyPattern, firstCategories, malformedIds, navCategoryCount,
  normalizedMain, openStorefront, orderedNames, pageOf, pageTitle, productCount, publicCatalog, seedCategory, serverHtml,
  showsMrp, storefront, storefrontCopy, taka, unknownId, withoutProductId, type StorefrontFixture,
} from './storefrontSupport';
import { register, syntheticCustomer } from './support';
import { apiUrl, frontendUrl } from './testApi';

/**
 * Ticket 17 T5 page specs (E2E-17-05…11): server-rendered storefront HTML and guest journeys on the built Next server
 * against the real jar and PostgreSQL (plan §4.0.5). Test-first: they fail until T3/T4 land.
 */
const t5 = (cross: string[] = []) => ({ tag: ['@t17', '@t17-T5', '@t17-ui', ...cross] });

/** Runs `inspect` on `path` opened with JavaScript disabled, so everything it sees came from the server (AC3). */
async function withServerPage<T>(browser: Browser, path: string, inspect: (page: Page) => Promise<T>): Promise<T> {
  const context = await browser.newContext({ baseURL: frontendUrl, javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await openStorefront(page, path);
    return await inspect(page);
  } finally {
    await context.close();
  }
}

/** The absolute URL a link points to, so relative (`?page=2`) and root-relative hrefs compare alike. */
async function target(link: Locator): Promise<string> {
  const href = await link.getAttribute('href');
  expect(href, 'the link has an href').not.toBeNull();
  return new URL(href!, link.page().url()).href;
}

async function mainText(page: Page): Promise<string> {
  return normalizedMain(await storefront(page).main.innerText());
}

async function uploaded(api: APIRequestContext, admin: ApiActor, productId: string, bytes: Buffer,
                        options: UploadOptions = {}): Promise<ImageView> {
  const response = await uploadImage(api, admin, productId, bytes, options);
  expect(response.status()).toBe(201);
  return await response.json() as ImageView;
}

async function expectWebp(request: APIRequestContext, src: string): Promise<void> {
  const optimized = await request.get(src, { headers: { Accept: 'image/webp,*/*' } });
  expect(optimized.status(), 'the optimizer serves the public image').toBe(200);
  expect(optimized.headers()['content-type']).toBe('image/webp');
}

test.describe('a listed category of 25 discounted Products', () => {
  let http: APIRequestContext;
  let fixture: StorefrontFixture;
  const url = (suffix = '') => `/categories/${fixture.category.id}${suffix}`;

  // Seeded once per worker; a failed test restarts the worker, which seeds again, so the other tests still run.
  test.beforeAll(async ({ playwright }) => {
    assertAwayFromDhakaMidnight();
    http = await playwright.request.newContext({ baseURL: apiUrl });
    const admin = await ApiActor.open(http, 'admin');
    fixture = await seedCategory(admin, 25, {
      sellingPrice: '150.00', mrp: '160.00', overrides: { description: 'Line one\nLine two', requireValidation: true },
    });
    await discountApi(admin).create(discountDraft('CATEGORY', fixture.category.id, { kind: 'PERCENTAGE', value: '10' }));
  });
  test.afterAll(async () => { await http?.dispose(); });

  test('E2E-17-05 a category page arrives as server HTML with title, canonical, cards and prices', t5(),
    async ({ browser, api }) => {
      const { category } = fixture;
      const listed = await publicCatalog(api).categoryPage(category.id, 0);
      const html = await serverHtml(browser, url());
      expect(html.status).toBe(200);
      expect(html.title).toBe(pageTitle(category.name));
      expect(html.canonical).toBe(`http://127.0.0.1:3115/categories/${category.id}`);
      expect(html.canonical).toBe(canonical(url()));
      expect(html.metaDescription).toBe(`${category.name} at Medi Wish: ${productCount(25)}.`);
      expect(html.h1).toHaveLength(1);
      expect(html.h1[0]).toContain(category.name);
      expect(html.mainText).toContain(productCount(25));
      expect(html.cardNames).toEqual(listed.items.map((card) => card.name));
      expect(html.cardNames).toEqual(fixture.products.slice(0, 24).map((product) => product.name));

      await withServerPage(browser, url(), async (page) => {
        const view = storefront(page);
        await expect(view.cards).toHaveCount(24);
        await expect(view.cards.locator('.price')).toHaveText(listed.items.map((card) => taka(card.price.price)));
        await expect(view.cards.locator('s.price-was'))
          .toContainText(listed.items.map((card) => taka(card.price.sellingPrice)));
        await expect(view.cards.locator('.badge-sale')).toHaveText(listed.items.map((card) => badgeText(card.price.discount!)));
        const destinations = await Promise.all(listed.items.map((card) => target(view.cardLink(card.name))));
        expect(destinations).toEqual(listed.items.map((card) => `${frontendUrl}/products/${card.id}`));
        const [first] = listed.items;
        await expect(view.card(first.name)).toContainText(first.genericName!);
        await expect(view.card(first.name)).toContainText(first.saleUnit);
        await expect(view.pageStatus).toHaveText(pageOf(1, 2));
        await expect(view.previous).toHaveCount(0);
        expect(await target(view.next)).toBe(`${frontendUrl}${url('?page=2')}`);
      });
    });

  test('E2E-17-05 the second category page has its own canonical and holds the 25th card', t5(), async ({ browser }) => {
    const html = await serverHtml(browser, url('?page=2'));
    expect(html.status).toBe(200);
    expect(html.canonical).toBe(canonical(url('?page=2')));
    expect(html.canonical!.endsWith('?page=2')).toBe(true);
    expect(html.title).toBe(pageTitle(fixture.category.name));
    expect(html.cardNames).toEqual([fixture.products[24].name]);
    await withServerPage(browser, url('?page=2'), async (page) => {
      const view = storefront(page);
      expect(await target(view.cardLink(fixture.products[24].name)))
        .toBe(`${frontendUrl}/products/${fixture.products[24].id}`);
      await expect(view.pageStatus).toHaveText(pageOf(2, 2));
      await expect(view.next).toHaveCount(0);
      expect(await target(view.previous), 'page 2 links back to the bare URL').toBe(`${frontendUrl}${url()}`);
    });
  });

  test('E2E-17-05 Product details arrive as server HTML with metadata, price block, About rows and review note', t5(),
    async ({ browser, api }) => {
      const [product] = fixture.products;
      const details = await publicCatalog(api).product(product.id);
      expect(showsMrp(details.price)).toBe(true);
      const html = await serverHtml(browser, `/products/${product.id}`);
      expect(html.status).toBe(200);
      expect(html.title).toBe(pageTitle(product.name));
      expect(html.metaDescription).toBe('Line one Line two');
      expect(html.canonical).toBe(canonical(`/products/${product.id}`));
      expect(html.h1).toEqual([product.name]);

      await withServerPage(browser, `/products/${product.id}`, async (page) => {
        const view = storefront(page);
        await expect(view.price).toHaveText([taka(details.price.price)]);
        await expect(view.wasPrice).toHaveCount(1);
        await expect(view.wasPrice).toContainText(taka(details.price.sellingPrice));
        await expect(view.badge).toHaveText([badgeText(details.price.discount!)]);
        await expect(view.badge).toHaveText(['10% OFF']);
        await expect(view.mrpLabel).toHaveText([`MRP ${taka(details.price.mrp!)}`]);
        const struckMrp = await view.mrpLabel.evaluateAll((labels) => labels.some((label) => {
          for (let element: Element | null = label; element; element = element.parentElement) {
            if (element.matches('s, del') || getComputedStyle(element).textDecorationLine.includes('line-through')) return true;
          }
          return false;
        }));
        expect(struckMrp, 'the MRP label and its ancestors are never struck').toBe(false);
        await expect(view.reviewNote).toBeVisible();
        await expect(view.breadcrumbLinks).toHaveText([storefrontCopy.home, fixture.category.name]);
        expect(await target(view.breadcrumbLinks.first())).toBe(`${frontendUrl}/`);
        expect(await target(view.breadcrumbLinks.last())).toBe(`${frontendUrl}${url()}`);
        expect(await aboutRows(view.about)).toEqual([
          [storefrontCopy.brand, product.brandName], [storefrontCopy.genericName, product.genericName],
          [storefrontCopy.dosageForm, product.dosageForm], [storefrontCopy.manufacturer, product.manufacturer],
          [storefrontCopy.saleUnit, product.saleUnit],
        ]);
        expect(await view.about.locator('.about-text').evaluate((element) => element.textContent))
          .toBe('Line one\nLine two');
        expect(await view.about.locator('.about-text').innerText(), 'description line breaks stay visible')
          .toBe('Line one\nLine two');
      });
    });

  test('E2E-17-05 one server-rendered details page costs two API reads (V-7)', t5(), async ({ request }, testInfo) => {
    const product = fixture.products[1];
    const before = apiResponseCount();
    const response = await request.get(`/products/${product.id}`, { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    await expect.poll(() => apiResponseCount() - before, { message: 'the category list and the Product were read' })
      .toBeGreaterThanOrEqual(2);
    const reads = apiResponseCount() - before;
    await testInfo.attach('v7-api-reads.json', {
      body: JSON.stringify({ page: '/products/{id}', expected: 2, reads }), contentType: 'application/json',
    });
    if (reads > 2) {
      testInfo.annotations.push({ type: 'V-7 cost', description: `${reads} API reads for one details page (2 expected)` });
    }
  });

  test('E2E-17-05 home page has an absolute canonical in server HTML', t5(), async ({ browser }) => {
    const home = await serverHtml(browser, '/');
    expect(home.status).toBe(200);
    expect(home.canonical).toBe(canonical('/'));
  });

  test('E2E-17-07 a guest browses home, all categories, a category, its second page and a Product', t5(),
    async ({ page, api }) => {
      const withAuthorization: string[] = [];
      const headerChecks: Promise<void>[] = [];
      page.on('request', (request) => {
        headerChecks.push(request.allHeaders().then((headers) => {
          if ('authorization' in headers) withAuthorization.push(new URL(request.url()).pathname);
        }, () => undefined));
      });
      const firstNames = firstCategories(await publicCatalog(api).categories()).map((category) => category.name);
      const bar = [...firstNames, storefrontCopy.allCategories];
      const view = storefront(page);

      await openStorefront(page, '/');
      await expect(view.homeCategories.locator('.cat-tile')).toHaveText(firstNames);
      await expect(view.categoryNavLinks).toHaveText(bar);
      expect(await target(view.seeAll)).toBe(`${frontendUrl}/categories`);

      await view.allCategoriesLink.click();
      await expect(page).toHaveURL('/categories');
      await view.main.getByRole('link', { name: fixture.category.name, exact: true }).click();
      await expect(page).toHaveURL(url());
      await expect(view.cards).toHaveCount(24);
      await expect(view.cardLink(fixture.products[0].name)).toBeVisible();
      await expect(view.pageStatus).toHaveText(pageOf(1, 2));

      await view.next.click();
      await expect(page).toHaveURL(url('?page=2'));
      await expect(view.cards).toHaveCount(1);
      const last = fixture.products[24];
      await view.cardLink(last.name).click();
      await expect(page).toHaveURL(`/products/${last.id}`);
      await expect(view.heading).toHaveText(last.name);
      await expect(view.categoryNavLinks).toHaveText(bar);
      const before = await mainText(page);

      await page.reload();
      await expect(view.heading).toHaveText(last.name);
      expect(await mainText(page)).toBe(before);
      await Promise.all(headerChecks);
      expect(withAuthorization, 'no request carried an Authorization header').toEqual([]);
    });

  test('E2E-17-08 ?page=1 redirects to the bare category URL', t5(), async ({ request }) => {
    const response = await request.get(url('?page=1'), { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    const location = response.headers()['location'];
    expect(location, 'a Location header').toBeDefined();
    expect(new URL(location, frontendUrl).href).toBe(`${frontendUrl}${url()}`);
  });

  test('E2E-17-08 page values past the end or not positive whole numbers show the not-found page', t5(),
    async ({ page, request }) => {
      const view = storefront(page);
      for (const value of ['3', '0', 'abc', '-1', '01', '2.0']) {
        const path = url(`?page=${value}`);
        expect((await request.get(path, { maxRedirects: 0 })).status(), path).toBe(404);
        await openStorefront(page, path, 404);
        await expect(view.notFoundTitle, path).toBeVisible();
        await expect(view.cards, path).toHaveCount(0);
      }
    });
});

test('E2E-17-05 /categories lists every listable category in API order, more than the bar shows', t5(),
  async ({ actors, api, browser }) => {
    const admin = await actors('admin');
    const own: string[] = [];
    for (const name of orderedNames(`Aisle ${token()}`, 9)) own.push((await seedCategory(admin, 1, { name })).category.id);
    const categories = await publicCatalog(api).categories();
    expect(categories.map((category) => category.id).filter((id) => own.includes(id))).toEqual(own);
    expect(categories.length).toBeGreaterThan(navCategoryCount);

    const html = await serverHtml(browser, '/categories');
    expect(html.status).toBe(200);
    expect(html.title).toBe(pageTitle(storefrontCopy.categoriesTitle));
    expect(html.canonical).toBe(canonical('/categories'));
    expect(html.metaDescription).toBe('All Medi Wish product categories.');
    expect(html.h1).toEqual([storefrontCopy.categoriesTitle]);
    await withServerPage(browser, '/categories', async (page) => {
      const view = storefront(page);
      await expect(view.tiles).toHaveText(categories.map((category) => category.name));
      const hrefs = await view.tiles.evaluateAll((tiles) => tiles.map((tile) => tile.getAttribute('href') ?? ''));
      expect(hrefs.map((href) => new URL(href, frontendUrl).pathname))
        .toEqual(categories.map((category) => `/categories/${category.id}`));
      await expect(view.categoryNavLinks, 'the bar still shows 8 plus All categories').toHaveCount(navCategoryCount + 1);
    });
  });

test.describe('E2E-17-06 catalog images', () => {
  let http: APIRequestContext;
  let shelf: StorefrontFixture;

  test.beforeAll(async ({ playwright }) => {
    http = await playwright.request.newContext({ baseURL: apiUrl });
    const admin = await ApiActor.open(http, 'admin');
    shelf = await seedCategory(admin, 3);
    const [gallery, , fallback] = shelf.products;
    await uploaded(http, admin, gallery.id, validPng(), { altText: 'Front of the box' });
    await uploaded(http, admin, gallery.id, validJpeg(), { name: 'side.jpg', mimeType: 'image/jpeg' });
    await uploaded(http, admin, fallback.id, validPng());
  });
  test.afterAll(async () => { await http?.dispose(); });

  test('E2E-17-06 server-rendered card images go through the image optimizer and answer WebP', t5(['@cross-15-17']),
    async ({ browser, request, api }) => {
      const [gallery, without, fallback] = shelf.products;
      const catalog = publicCatalog(api);
      const pageView = await catalog.categoryPage(shelf.category.id, 0);
      const galleryDetails = await catalog.product(gallery.id);
      const fallbackDetails = await catalog.product(fallback.id);
      const expectedImages = [
        { product: gallery, image: galleryDetails.images[0]! },
        { product: fallback, image: fallbackDetails.images[0]! },
      ] as const;
      expect(pageView.items.find(({ id }) => id === gallery.id)?.image).toEqual(galleryDetails.images[0]);
      expect(pageView.items.find(({ id }) => id === fallback.id)?.image).toEqual(fallbackDetails.images[0]);

      await withServerPage(browser, `/categories/${shelf.category.id}`, async (page) => {
        const view = storefront(page);
        for (const { product, image } of expectedImages) {
          const picture = view.card(product.name).locator('img');
          await expect(picture).toHaveCount(1);
          await expect(picture).toHaveAttribute('alt', image.altText ?? `${product.name}, image 1`);
          const src = (await picture.getAttribute('src')) ?? '';
          expect(src).toMatch(/^\/_next\/image\?url=/);
          expect(new URL(src, frontendUrl).searchParams.get('url')).toBe(publicImage(image.url));
          await expectWebp(request, src);
        }
        const placeholder = view.card(without.name);
        await expect(placeholder.locator('img')).toHaveCount(0);
        await expect(placeholder.locator('[role="img"]')).toHaveCount(1);
      });
    });

  test('E2E-17-06 the details gallery shows every image in order with its stored or fallback alt', t5(['@cross-15-17']),
    async ({ browser, request, api }) => {
      const [gallery] = shelf.products;
      const details = await publicCatalog(api).product(gallery.id);
      expect(details.images).toHaveLength(2);
      await withServerPage(browser, `/products/${gallery.id}`, async (page) => {
        const view = storefront(page);
        await expect(view.thumbnails).toHaveCount(2);
        await expect(view.thumbnails.first()).toHaveAttribute('aria-pressed', 'true');
        await expect(view.thumbnails.last()).toHaveAttribute('aria-pressed', 'false');
        const large = view.main.locator('.gallery-main img');
        const thumbnails = view.thumbnails.locator('img');
        const pictures = await thumbnails.evaluateAll((images) =>
          images.map((image) => ({ alt: image.getAttribute('alt'), src: image.getAttribute('src') ?? '' })));
        const expected = details.images.map((image, index) => ({
          alt: image.altText ?? `${gallery.name}, image ${index + 1}`,
          url: publicImage(image.url),
        }));
        expect(pictures.map(({ alt, src }) => ({ alt, url: new URL(src, frontendUrl).searchParams.get('url') })))
          .toEqual(expected);
        await expect(large).toHaveAttribute('alt', expected[0].alt);
        const largeSrc = (await large.getAttribute('src')) ?? '';
        expect(new URL(largeSrc, frontendUrl).searchParams.get('url')).toBe(expected[0].url);
        await expectWebp(request, pictures[1].src);
      });
    });

  test('E2E-17-06 a Product without images shows the placeholder on its details page', t5(['@cross-15-17']),
    async ({ browser }) => {
      const [, without] = shelf.products;
      await withServerPage(browser, `/products/${without.id}`, async (page) => {
        const view = storefront(page);
        await expect(view.main.locator('img')).toHaveCount(0);
        await expect(view.main.locator('[role="img"]')).toHaveCount(1);
        await expect(view.thumbnails).toHaveCount(0);
      });
    });
});

test('E2E-17-09 unpurchasable and malformed URLs show one identical not-found page with HTTP 404', t5(),
  async ({ actors, page, request }) => {
    const admin = await actors('admin');
    const { products: [listed] } = await seedCategory(admin, 1);
    const { products: [retired] } = await seedCategory(admin, 1);
    await updateProduct(admin, retired, { active: false });
    const hidden = await seedCategory(admin, 1);
    await updateCategory(admin, hidden.category, { active: false });
    expect((await request.get(`/products/${listed.id}`)).status(), 'the lower-case URL of the same Product works').toBe(200);

    const malformed = malformedIds(listed.id);
    const paths: Record<string, string> = {
      'unknown Product': `/products/${unknownId()}`,
      'inactive Product': `/products/${retired.id}`,
      'malformed Product': `/products/${malformed.text}`,
      'short Product id': `/products/${malformed.short}`,
      'long Product id': `/products/${malformed.long}`,
      'braced Product id': `/products/${malformed.braces}`,
      'upper-case Product id': `/products/${malformed.upper}`,
      'inactive category': `/categories/${hidden.category.id}`,
    };
    const view = storefront(page);
    const texts: Record<string, string> = {};
    for (const [label, path] of Object.entries(paths)) {
      expect((await request.get(path, { maxRedirects: 0 })).status(), label).toBe(404);
      await openStorefront(page, path, 404);
      await expect(view.notFoundTitle, label).toBeVisible();
      await expect(view.main.getByText(copyPattern(storefrontCopy.notFoundText)), label).toBeVisible();
      expect(await target(view.goHome), label).toBe(`${frontendUrl}/`);
      await expect(page.getByRole('banner'), `${label}: the store header stays`).toBeVisible();
      await expect(view.categoryNav, `${label}: the category bar stays`).toBeVisible();
      texts[label] = await mainText(page);
    }
    for (const [label, text] of Object.entries(texts)) expect(text, label).toBe(texts['unknown Product']);
  });

test('E2E-17-10 an empty active category shows the empty state without a pager', t5(), async ({ actors, browser, page }) => {
  const admin = await actors('admin');
  const empty = await createCategory(admin, `Empty ${token()}`);
  const html = await serverHtml(browser, `/categories/${empty.id}`);
  expect(html.status).toBe(200);
  expect(html.title).toBe(pageTitle(empty.name));

  await openStorefront(page, `/categories/${empty.id}`);
  const view = storefront(page);
  await expect(view.heading).toContainText(empty.name);
  await expect(view.emptyTitle).toBeVisible();
  await expect(view.main.getByText(storefrontCopy.emptyText, { exact: true })).toBeVisible();
  const browse = view.main.getByRole('link', { name: storefrontCopy.browseCategories, exact: true });
  expect(await target(browse)).toBe(`${frontendUrl}/categories`);
  await expect(view.cards).toHaveCount(0);
  await expect(view.pagination).toHaveCount(0);
  await expect(view.notFoundTitle).toHaveCount(0);
});

test('E2E-17-10 a Product of an inactive category keeps its Discount and shows Home only in the breadcrumb',
  t5(['@cross-16-17']), async ({ actors, api, page }) => {
    assertAwayFromDhakaMidnight();
    const admin = await actors('admin');
    const { category, products: [product] } = await seedCategory(admin, 1, { sellingPrice: '150.00' });
    await discountApi(admin).create(discountDraft('CATEGORY', category.id, { kind: 'PERCENTAGE', value: '10' }));
    await updateCategory(admin, category, { active: false });
    const price = await publicPrice(api, product.id);
    expect(price).toMatchObject({ price: '135.00', discount: { targetType: 'CATEGORY', kind: 'PERCENTAGE', value: '10' } });
    expect((await publicCatalog(api).product(product.id)).price).toEqual(withoutProductId(price));

    await openStorefront(page, `/products/${product.id}`);
    const view = storefront(page);
    await expect(view.heading).toHaveText(product.name);
    await expect(view.breadcrumbLinks).toHaveText([storefrontCopy.home]);
    expect(await target(view.breadcrumbLinks.first())).toBe(`${frontendUrl}/`);
    await expect(view.price).toHaveText([taka(price.price)]);
    await expect(view.wasPrice).toContainText(taka(price.sellingPrice));
    await expect(view.badge).toHaveText([badgeText(price.discount!)]);
  });

test('E2E-17-11 a signed-in Customer and a guest see the same details page', t5(['@cross-03-17']),
  async ({ actors, browser, page }) => {
    const admin = await actors('admin');
    const { products: [product] } = await seedCategory(admin, 1, { overrides: { requireValidation: true } });
    const path = `/products/${product.id}`;
    const customer = syntheticCustomer();
    await register(page, customer);

    await openStorefront(page, path);
    const signedIn = storefront(page);
    await expect(signedIn.heading).toHaveText(product.name);
    const account = page.getByRole('banner').getByRole('link', { name: customer.username, exact: true });
    await expect(account, 'the header shows the username (client-side)').toBeVisible();
    const signedInText = await mainText(page);
    expect(signedInText).not.toContain(customer.username);

    const guestContext = await browser.newContext({ baseURL: frontendUrl });
    try {
      const guestPage = await guestContext.newPage();
      await openStorefront(guestPage, path);
      await expect(storefront(guestPage).heading).toHaveText(product.name);
      await expect(guestPage.getByRole('banner').getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
      await expect(guestPage.getByText(customer.username)).toHaveCount(0);
      expect(await mainText(guestPage), 'the session changes nothing inside main').toBe(signedInText);
    } finally {
      await guestContext.close();
    }

    await account.click();
    await expect(page).toHaveURL('/account');
  });
