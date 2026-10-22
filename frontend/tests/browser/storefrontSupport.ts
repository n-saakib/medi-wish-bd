import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  expect, type APIRequestContext, type APIResponse, type Browser, type Locator, type Page,
} from '@playwright/test';
import {
  activeProduct, apiMessages, createCategory, equipmentDraft, medicineDraft, token, type ApiActor, type Category, type Product,
} from './catalogSupport';
import { apiLogPath, frontendUrl } from './testApi';

/**
 * Ticket 17 (public catalog browsing) end-to-end helpers: the test-owned public wire contract (plan §4.0.1), response
 * guards, a raw anonymous API client, synthetic storefront fixtures, server-HTML capture and page locators for the
 * storefront pages (plan §4.0.5). Independent of production code: these types are the contract the implementation must
 * meet, so a drift fails here. Not a spec.
 */

export type PublicTargetType = 'PRODUCT' | 'CATEGORY';
export type PublicDiscountKind = 'PERCENTAGE' | 'FLAT';
export type PublicCategory = { id: string; name: string };
export type PublicCategoryList = { categories: PublicCategory[] };
export type PublicImage = { url: string; altText: string | null; width: number; height: number };
export type PublicDiscount = { targetType: PublicTargetType; kind: PublicDiscountKind; value: string };
export type PublicPriceView = {
  sellingPrice: string; mrp: string | null; price: string; saving: string; discount: PublicDiscount | null;
};
export type PublicCard = {
  id: string; name: string; genericName: string | null; saleUnit: string; image: PublicImage | null; price: PublicPriceView;
};
export type PublicCategoryPage = {
  category: PublicCategory; items: PublicCard[]; page: number; size: number; totalItems: number;
};
export type PublicProduct = {
  id: string; name: string; brandName: string | null; genericName: string | null; dosageForm: string | null;
  manufacturer: string | null; saleUnit: string; description: string | null; requireValidation: boolean;
  category: PublicCategory | null; images: PublicImage[]; price: PublicPriceView;
};

/** Exact sorted key sets; no staff field (`version`, `status`, `active`, actors, counts, storage data) may appear. */
export const publicCategoryListKeys = ['categories'];
export const publicCategoryKeys = ['id', 'name'];
export const publicCategoryPageKeys = ['category', 'items', 'page', 'size', 'totalItems'];
export const publicCardKeys = ['genericName', 'id', 'image', 'name', 'price', 'saleUnit'];
export const publicProductKeys = [
  'brandName', 'category', 'description', 'dosageForm', 'genericName', 'id', 'images', 'manufacturer', 'name', 'price',
  'requireValidation', 'saleUnit',
];
/** The plan's name for the details key set (plan T5). */
export const publicDetailsKeys = publicProductKeys;
export const publicImageKeys = ['altText', 'height', 'url', 'width'];
export const publicPriceViewKeys = ['discount', 'mrp', 'price', 'saving', 'sellingPrice'];
export const publicDiscountKeys = ['kind', 'targetType', 'value'];

/** Field names that must never reach a public response or the public HTML (E1). */
export const staffOnlyFields = [
  'version', 'status', 'active', 'updatedAt', 'updatedBy', 'updatedByUsername', 'history', 'productCount', 'objectKey',
  'sha256', 'byteSize', 'contentType', 'kind', 'createdAt', 'position', 'appliedDiscount', 'effectivePrice',
];

/** The fixed page size (P2). */
export const storefrontPageSize = 24;
/** How many categories the header bar and the home grid show (C8). */
export const navCategoryCount = 8;

export const lowerUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const money = /^(?:0|[1-9][0-9]{0,6})\.[0-9]{2}$/;
const imagePath = /^\/api\/public\/product-images\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(png|jpg)$/;

/**
 * The English storefront copy of plan §4.0.5 (namespace `storefront`), exactly as the pages must show it. Apostrophes use the repository's
 * typographic `’` (as in `messages/en.json`); `copyPattern` also accepts a straight `'`.
 */
export const storefrontCopy = {
  categories: 'Categories',
  seeAll: 'See all',
  allCategories: 'All categories',
  categoryNav: 'Categories',
  home: 'Home',
  breadcrumb: 'Breadcrumb',
  pagination: 'Pagination',
  previous: 'Previous',
  next: 'Next',
  emptyTitle: 'No products here yet',
  emptyText: 'Please try another category.',
  browseCategories: 'Browse categories',
  noCategories: 'No categories yet',
  reviewNote: 'Our team reviews this medicine before dispatch. No prescription upload needed.',
  about: 'About',
  brand: 'Brand',
  genericName: 'Generic name',
  dosageForm: 'Dosage form',
  manufacturer: 'Manufacturer',
  saleUnit: 'Sale unit',
  categoriesTitle: 'All categories',
  notFoundTitle: 'We couldn’t find that page.',
  notFoundText: 'The address may be wrong, or the page has moved.',
  goHome: 'Go to the home page',
  errorTitle: 'This page couldn’t load',
  errorText: 'Please try again in a moment.',
  tryAgain: 'Try again',
  siteTitle: 'Medi Wish',
} as const;

/** An exact, anchored pattern for a copy string that accepts `'` or `’` for each apostrophe. */
export function copyPattern(text: string): RegExp {
  const escaped = text.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&').replace(/[’']/g, '[\'’]');
  return new RegExp('^' + escaped + '$');
}

/** "Page {page} of {total}". */
export function pageOf(page: number, total: number): string {
  return `Page ${page} of ${total}`;
}

/** "{count} product(s)" as the ICU plural in `productCount` renders it. */
export function productCount(count: number): string {
  return count === 1 ? '1 product' : `${count} products`;
}

/** The page title the root layout template produces for a storefront page (E6). */
export function pageTitle(name: string): string {
  return `${name} · ${storefrontCopy.siteTitle}`;
}

/** Badge text for an applied Discount (C5): "10% OFF" or "৳15.00 OFF". */
export function badgeText(discount: PublicDiscount): string {
  return discount.kind === 'PERCENTAGE' ? `${discount.value}% OFF` : `${taka(discount.value)} OFF`;
}

/** The storefront's money display, `formatTaka` style: "৳1,234.50" (no space; plan §11 deviation). */
export function taka(amount: string): string {
  const [whole, fraction] = amount.split('.');
  return `৳${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction}`;
}

/** Integer paisa of a canonical money string; never a float. */
export function paisa(value: string): bigint {
  expect(value, 'canonical money').toMatch(money);
  return BigInt(value.replace('.', ''));
}

/** Whether the MRP label shows: MRP set and strictly above the current price (C5), in integer paisa. */
export function showsMrp(price: PublicPriceView): boolean {
  return price.mrp !== null && paisa(price.mrp) > paisa(price.price);
}

/** The absolute canonical URL the harness site origin (`MEDI_WISH_SITE_URL` = frontend URL) produces (C6, P9). */
export function canonical(path: string): string {
  return new URL(path, frontendUrl).href;
}

/** Collapses whitespace runs, so text from different pages compares by content only. */
export function normalizedText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** The plan's name for `normalizedText` applied to `main` text (plan T5). */
export const normalizedMain = normalizedText;

/** The first `count` categories in API order, the way the header bar and home grid must show them (C8). */
export function firstCategories(categories: PublicCategory[], count = navCategoryCount): PublicCategory[] {
  return categories.slice(0, count);
}

/** The 1-based storefront page count of a category with `totalItems` listed Products (C7: an empty category has 1). */
export function pageCount(totalItems: number): number {
  return Math.max(1, Math.ceil(totalItems / storefrontPageSize));
}

/**
 * Names that sort the same by `lower(name)` under every database collation but differently by byte order: a shared
 * prefix, then a two-letter code whose first letter alternates case (`aa`, `Ab`, `ac`, `Ad`, …). `count` ≤ 676.
 */
export function orderedNames(prefix: string, count: number): string[] {
  if (count > 676) throw new Error('At most 676 ordered names');
  return Array.from({ length: count }, (_, index) => {
    const first = String.fromCharCode(97 + Math.floor(index / 26));
    const second = String.fromCharCode(97 + (index % 26));
    return `${prefix} ${index % 2 === 1 ? first.toUpperCase() : first}${second}`;
  });
}

/** The public order (C3): `lower(name)`, then id. Valid for `orderedNames` output and for equal names. */
export function publicOrder<T extends { id: string; name: string }>(items: T[]): T[] {
  return [...items].sort((left, right) => {
    const a = left.name.toLowerCase();
    const b = right.name.toLowerCase();
    if (a !== b) return a < b ? -1 : 1;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
}

/** Text that must stay inert data everywhere it is rendered (E7, R1). */
export const injection = {
  productName: '<script>window.__t17=1</script>Inject',
  description: '<img src=x onerror="window.__t17=2">\nSecond line <b>bold</b>',
  categoryName: '"><svg onload="window.__t17=3">',
  altText: '<b onmouseover="window.__t17=4">alt</b>',
} as const;

/** Asserts a successful public JSON response (status, no-store, correlation, JSON, no cookie) and returns the body. */
export async function expectPublicJson<T>(response: APIResponse, status = 200): Promise<T> {
  expect(response.status(), `public read ${response.url()}`).toBe(status);
  const headers = response.headers();
  expect(headers['cache-control'], 'Cache-Control').toBe('no-store');
  expect(headers['x-request-id'], 'X-Request-ID').toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  expect(headers['content-type'] ?? '').toContain('application/json');
  expect(headers['set-cookie'], 'a public read never sets a cookie').toBeUndefined();
  return await response.json() as T;
}

/**
 * Asserts the bounded `404 NOT_FOUND` envelope (C2: every unpurchasable case looks the same) with the request id of
 * the header, and returns the body without `requestId` so callers can compare cases.
 */
export async function expectPublicNotFound(response: APIResponse): Promise<Record<string, unknown>> {
  expect(response.status(), `not-found for ${response.url()}`).toBe(404);
  const headers = response.headers();
  expect(headers['cache-control']).toBe('no-store');
  expect(headers['x-request-id'], 'X-Request-ID').toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  expect(headers['set-cookie']).toBeUndefined();
  const body = await response.json() as Record<string, unknown>;
  expect(Object.keys(body).sort()).toEqual(['code', 'message', 'requestId']);
  expect(body).toEqual({ code: 'NOT_FOUND', message: apiMessages.NOT_FOUND, requestId: headers['x-request-id'] });
  return Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'requestId'));
}

export function expectPublicCategory(category: PublicCategory): void {
  expect(Object.keys(category).sort()).toEqual(publicCategoryKeys);
  expect(category.id).toMatch(lowerUuid);
  expect(typeof category.name).toBe('string');
  expect(category.name.length).toBeGreaterThan(0);
  expect(category.name.length).toBeLessThanOrEqual(80);
}

export function expectPublicImage(image: PublicImage): void {
  expect(Object.keys(image).sort()).toEqual(publicImageKeys);
  expect(image.url).toMatch(imagePath);
  for (const size of [image.width, image.height]) expect(Number.isInteger(size) && size > 0).toBe(true);
  expect(image.altText === null || (typeof image.altText === 'string' && image.altText.length <= 160)).toBe(true);
}

/** Price consistency only (price + saving = selling price; FLAT value = saving); never a second price calculator. */
export function expectPublicPrice(price: PublicPriceView): void {
  expect(Object.keys(price).sort()).toEqual(publicPriceViewKeys);
  const selling = paisa(price.sellingPrice);
  const current = paisa(price.price);
  const saving = paisa(price.saving);
  expect(selling > 0n && current > 0n).toBe(true);
  expect(current + saving).toBe(selling);
  expect(price.discount === null).toBe(saving === 0n);
  if (price.mrp !== null) expect(paisa(price.mrp) >= selling).toBe(true);
  if (price.discount !== null) {
    expect(Object.keys(price.discount).sort()).toEqual(publicDiscountKeys);
    expect(['PRODUCT', 'CATEGORY']).toContain(price.discount.targetType);
    expect(['PERCENTAGE', 'FLAT']).toContain(price.discount.kind);
    if (price.discount.kind === 'PERCENTAGE') expect(price.discount.value).toMatch(/^[1-9][0-9]?$/);
    else expect(paisa(price.discount.value)).toBe(saving);
  }
}

export function expectPublicCard(card: PublicCard): void {
  expect(Object.keys(card).sort()).toEqual(publicCardKeys);
  expect(card.id).toMatch(lowerUuid);
  expect(card.name.length).toBeGreaterThan(0);
  expect(card.name.length).toBeLessThanOrEqual(160);
  expect(card.genericName === null || card.genericName.length <= 200).toBe(true);
  expect(card.saleUnit.length).toBeGreaterThan(0);
  expect(card.saleUnit.length).toBeLessThanOrEqual(80);
  if (card.image !== null) expectPublicImage(card.image);
  expectPublicPrice(card.price);
}

export function expectPublicCategoryPage(view: PublicCategoryPage, page: number): void {
  expect(Object.keys(view).sort()).toEqual(publicCategoryPageKeys);
  expectPublicCategory(view.category);
  expect(view.page).toBe(page);
  expect(view.size).toBe(storefrontPageSize);
  expect(Number.isInteger(view.totalItems) && view.totalItems >= 0).toBe(true);
  expect(Array.isArray(view.items)).toBe(true);
  expect(view.items.length).toBe(Math.max(0, Math.min(storefrontPageSize, view.totalItems - page * storefrontPageSize)));
  view.items.forEach(expectPublicCard);
  expect(new Set(view.items.map((item) => item.id)).size).toBe(view.items.length);
}

export function expectPublicProduct(view: PublicProduct): void {
  expect(Object.keys(view).sort()).toEqual(publicProductKeys);
  expect(view.id).toMatch(lowerUuid);
  expect(view.name.length).toBeGreaterThan(0);
  expect(typeof view.requireValidation).toBe('boolean');
  expect(view.description === null || view.description.length <= 4000).toBe(true);
  if (view.category !== null) expectPublicCategory(view.category);
  expect(Array.isArray(view.images)).toBe(true);
  expect(view.images.length).toBeLessThanOrEqual(8);
  view.images.forEach(expectPublicImage);
  expectPublicPrice(view.price);
}

/** The `price` object of a public read equals the Ticket 16 price route's body without `productId`. */
export function withoutProductId<T extends { productId: string }>(price: T): Omit<T, 'productId'> {
  return Object.fromEntries(Object.entries(price).filter(([key]) => key !== 'productId')) as Omit<T, 'productId'>;
}

/** Raw anonymous calls to the three Ticket 17 routes (plan §4.0.1); `page` is the API's 0-based value, sent as is. */
export function publicApi(http: APIRequestContext) {
  return {
    categories: (headers: Record<string, string> = {}) => http.get('/api/categories', { headers }),
    categoryPage: (id: string, page?: string | number, headers: Record<string, string> = {}) =>
      http.get(`/api/categories/${id}/products${page === undefined ? '' : `?page=${encodeURIComponent(String(page))}`}`,
        { headers }),
    categoryPath: (path: string, headers: Record<string, string> = {}) => http.get(path, { headers }),
    product: (id: string, headers: Record<string, string> = {}) => http.get(`/api/products/${id}`, { headers }),
  };
}

/** Validated reads of the three routes. */
export function publicCatalog(http: APIRequestContext) {
  const raw = publicApi(http);
  return {
    async categories(): Promise<PublicCategory[]> {
      const body = await expectPublicJson<PublicCategoryList>(await raw.categories());
      expect(Object.keys(body)).toEqual(publicCategoryListKeys);
      body.categories.forEach(expectPublicCategory);
      expect(new Set(body.categories.map((category) => category.id)).size).toBe(body.categories.length);
      expect(publicOrder(body.categories).map((category) => category.id)).toEqual(body.categories.map((category) => category.id));
      return body.categories;
    },
    async categoryPage(id: string, page = 0): Promise<PublicCategoryPage> {
      const body = await expectPublicJson<PublicCategoryPage>(await raw.categoryPage(id, page === 0 ? undefined : page));
      expectPublicCategoryPage(body, page);
      expect(body.category.id).toBe(id);
      return body;
    },
    /** Every card of a category, page by page. */
    async allCards(id: string): Promise<PublicCard[]> {
      const cards: PublicCard[] = [];
      for (let page = 0; page < 100; page += 1) {
        const view = await this.categoryPage(id, page);
        cards.push(...view.items);
        if ((page + 1) * storefrontPageSize >= view.totalItems) return cards;
      }
      throw new Error('More category pages than expected');
    },
    async product(id: string): Promise<PublicProduct> {
      const body = await expectPublicJson<PublicProduct>(await raw.product(id));
      expectPublicProduct(body);
      expect(body.id).toBe(id);
      return body;
    },
  };
}

export type StorefrontFixture = { category: Category; products: Product[] };

/**
 * One active category with `count` active, priced Medicines named by `orderedNames`, created by `admin` through the real
 * staff routes, returned in public order. `overrides` apply to every draft.
 */
export async function seedCategory(admin: ApiActor, count: number, options: {
  name?: string; prefix?: string; sellingPrice?: string; mrp?: string | null; overrides?: Record<string, unknown>;
} = {}): Promise<StorefrontFixture> {
  const category = await createCategory(admin, options.name ?? `Storefront ${token()}`);
  const names = orderedNames(options.prefix ?? `Shelf ${token()}`, count);
  const products: Product[] = [];
  for (const name of names) {
    products.push(await activeProduct(admin, medicineDraft(category.id, { name, ...options.overrides }),
      options.sellingPrice ?? '120.00', options.mrp ?? null));
  }
  return { category, products: publicOrder(products) };
}

/** One active Equipment Product in `categoryId` (C4: no generic name, no dosage form publicly). */
export function seedEquipment(admin: ApiActor, categoryId: string, overrides: Record<string, unknown> = {},
                              sellingPrice = '450.00'): Promise<Product> {
  return activeProduct(admin, equipmentDraft(categoryId, { name: `Thermo ${token()}`, ...overrides }), sellingPrice);
}

/** A fresh lower-case UUID that names nothing. */
export function unknownId(): string {
  return randomUUID();
}

/** Malformed ids for public URLs and API paths (P16, C2). `upper` is a valid UUID the storefront still rejects. */
export function malformedIds(validId: string): Record<string, string> {
  return {
    text: 'not-a-uuid',
    short: validId.slice(0, 35),
    long: `${validId}0`,
    upper: validId.toUpperCase(),
    braces: `{${validId}}`,
  };
}

export type ServerHtml = {
  status: number; title: string; canonical: string | null; metaDescription: string | null; robots: string | null;
  h1: string[]; mainText: string; cardNames: string[]; html: string; links: string[];
};

/**
 * The server-rendered page exactly as a crawler gets it: a fresh context with JavaScript disabled, so nothing seen here
 * was added by client code (AC3). Reads the canonical link and meta tags anywhere in the document (V-8).
 */
export async function serverHtml(browser: Browser, path: string): Promise<ServerHtml> {
  const context = await browser.newContext({ baseURL: frontendUrl, javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    const response = await page.goto(path);
    expect(response, `a response for ${path}`).not.toBeNull();
    const html = await response!.text();
    const attribute = async (selector: string, name: string) =>
      (await page.locator(selector).count()) > 0 ? page.locator(selector).first().getAttribute(name) : null;
    return {
      status: response!.status(),
      title: await page.title(),
      canonical: await attribute('link[rel="canonical"]', 'href'),
      metaDescription: await attribute('meta[name="description"]', 'content'),
      robots: await attribute('meta[name="robots"]', 'content'),
      h1: (await page.locator('h1').allInnerTexts()).map(normalizedText),
      // No waiting: a page without `main` (for example a framework 404) must fail on the caller's status check at once.
      mainText: normalizedText((await page.locator('main').allInnerTexts()).join(' ')),
      cardNames: (await page.locator('main article a[href^="/products/"]').allInnerTexts()).map(normalizedText)
        .filter((name) => name.length > 0),
      html,
      links: await page.locator('main a[href]').evaluateAll((anchors) =>
        anchors.map((anchor) => anchor.getAttribute('href') ?? '')),
    };
  } finally {
    await context.close();
  }
}

/** The count of request status lines the harness API logged so far (V-7 measurement). */
export function apiResponseCount(): number {
  return readFileSync(apiLogPath, 'utf8').split(/\r?\n/).filter((line) => line.includes('HTTP response status=')).length;
}

/** The harness API log, for privacy assertions (logs must hold no catalog text). */
export function apiLog(): string {
  return readFileSync(apiLogPath, 'utf8');
}

/** Storefront locators by role and accessible name (plan §4.0.5); CSS classes only where the plan fixes them. */
export function storefront(page: Page) {
  const main = page.getByRole('main');
  const categoryNav = page.getByRole('navigation', { name: storefrontCopy.categoryNav, exact: true });
  const breadcrumb = page.getByRole('navigation', { name: storefrontCopy.breadcrumb, exact: true });
  const pagination = page.getByRole('navigation', { name: storefrontCopy.pagination, exact: true });
  return {
    main,
    heading: main.getByRole('heading', { level: 1 }),
    categoryNav,
    categoryNavLinks: categoryNav.getByRole('link'),
    allCategoriesLink: categoryNav.getByRole('link', { name: storefrontCopy.allCategories, exact: true }),
    // The home section is found by its "Categories" heading; the plan does not require a labelled region.
    homeCategories: main.locator('section').filter({
      has: page.getByRole('heading', { name: storefrontCopy.categories, exact: true }),
    }),
    seeAll: main.getByRole('link', { name: storefrontCopy.seeAll, exact: true }),
    breadcrumb,
    breadcrumbLinks: breadcrumb.getByRole('link'),
    pagination,
    next: pagination.getByRole('link', { name: storefrontCopy.next, exact: true }),
    previous: pagination.getByRole('link', { name: storefrontCopy.previous, exact: true }),
    pageStatus: pagination.getByText(/^Page \d+ of \d+$/),
    cards: main.getByRole('article'),
    card: (name: string) => main.getByRole('article').filter({ has: page.getByRole('link', { name, exact: true }) }),
    cardLink: (name: string) => main.getByRole('article').getByRole('link', { name, exact: true }),
    tiles: main.locator('.cat-tile'),
    emptyTitle: main.getByRole('heading', { name: storefrontCopy.emptyTitle, exact: true }),
    notFoundTitle: main.getByRole('heading', { name: copyPattern(storefrontCopy.notFoundTitle) }),
    errorTitle: main.getByRole('heading', { name: copyPattern(storefrontCopy.errorTitle) }),
    tryAgain: main.getByRole('button', { name: storefrontCopy.tryAgain, exact: true }),
    goHome: main.getByRole('link', { name: storefrontCopy.goHome, exact: true }),
    about: main.getByRole('region', { name: storefrontCopy.about, exact: true }),
    reviewNote: main.getByText(storefrontCopy.reviewNote, { exact: true }),
    thumbnails: main.getByRole('button', { name: /^Image \d+$/ }),
    price: main.locator('.price'),
    wasPrice: main.locator('s.price-was'),
    badge: main.locator('.badge-sale'),
    mrpLabel: main.locator('.mrp-label'),
    images: main.getByRole('img'),
  };
}

/** The visible `<dt>`→`<dd>` pairs of the About list, in order. */
export async function aboutRows(about: Locator): Promise<[string, string][]> {
  return about.locator('dl').first().evaluate((list) => {
    const rows: [string, string][] = [];
    for (const term of Array.from(list.querySelectorAll('dt'))) {
      const value = term.nextElementSibling;
      rows.push([term.textContent?.trim() ?? '', value?.textContent?.trim() ?? '']);
    }
    return rows;
  });
}

/** Opens `path`, asserts the HTTP status of the document response and returns it. */
export async function openStorefront(page: Page, path: string, status = 200) {
  const response = await page.goto(path);
  expect(response, `a response for ${path}`).not.toBeNull();
  expect(response!.status(), `HTTP status of ${path}`).toBe(status);
  return response!;
}

/** Fails the test if any dialog opens or `window.__t17` gets set: injected catalog text must never execute (E7). */
export function watchForInjection(page: Page): { dialogs: string[]; assertInert: () => Promise<void> } {
  const dialogs: string[] = [];
  page.on('dialog', async (dialog) => { dialogs.push(dialog.message()); await dialog.dismiss(); });
  return {
    dialogs,
    async assertInert() {
      expect(dialogs, 'no dialog opened').toEqual([]);
      expect(await page.evaluate(() => (window as unknown as { __t17?: number }).__t17 ?? null)).toBeNull();
    },
  };
}
