import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { ApiActor, expect, tabTo, test, token, type Product } from './catalogSupport';
import { validJpeg, validPng } from './imageFixtures';
import { uploadImage, type ImageView } from './productImageSupport';
import { openStorefront, seedCategory, storefront, storefrontCopy, storefrontPageSize } from './storefrontSupport';
import { apiUrl } from './testApi';

/**
 * Ticket 17 T7 accessibility and layout checks (plan T7 step 5): keyboard order and visible focus, named navigation
 * landmarks, image alt text, gallery thumbnails by keyboard, 44 px targets, and narrow/wide layouts without horizontal
 * page scroll. One shared synthetic category of 25 Products (two pages); its first Product has two images.
 */
const t7 = { tag: ['@t17', '@t17-T7', '@t17-ui'] };

let http: APIRequestContext;
let admin: ApiActor;
let categoryId: string;
let products: Product[];
let galleryImages: ImageView[];

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(180_000);
  http = await playwright.request.newContext({ baseURL: apiUrl });
  admin = await ApiActor.open(http, 'admin');
  const fixture = await seedCategory(admin, storefrontPageSize + 1, { prefix: `A11y ${token()}` });
  categoryId = fixture.category.id;
  products = fixture.products;
  galleryImages = [];
  for (const file of [
    { bytes: validPng(), name: 'front.png', mimeType: 'image/png' },
    { bytes: validJpeg(), name: 'back.jpg', mimeType: 'image/jpeg' },
  ]) {
    const uploaded = await uploadImage(http, admin, products[0].id, file.bytes, { name: file.name, mimeType: file.mimeType });
    expect(uploaded.status(), 'gallery image upload').toBe(201);
    galleryImages.push(await uploaded.json() as ImageView);
  }
});

test.afterAll(async () => {
  await http?.dispose();
});

const categoryPath = () => `/categories/${categoryId}`;
const detailsPath = () => `/products/${products[0].id}`;
const storePaths = () => ['/', '/categories', categoryPath(), detailsPath()];

type Focused = { zone: 'bar' | 'card' | 'pager' | 'other'; index: number; label: string; visibleFocus: boolean };

/** Where keyboard focus is now: which storefront zone, the element's index inside it, and whether focus is visible. */
function focused(page: Page): Promise<Focused> {
  return page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    if (!element || element === document.body) return { zone: 'other', index: -1, label: '', visibleFocus: false };
    const style = getComputedStyle(element);
    const visibleFocus = style.outlineStyle === 'solid' && Number.parseFloat(style.outlineWidth) >= 3
      && style.outlineColor === 'rgb(227, 155, 46)';
    const label = (element.getAttribute('aria-label') ?? element.textContent ?? '').trim();
    const bar = element.closest('nav[aria-label="Categories"]');
    if (bar) return { zone: 'bar', index: Array.from(bar.querySelectorAll('a')).indexOf(element as HTMLAnchorElement), label, visibleFocus };
    const pager = element.closest('nav[aria-label="Pagination"]');
    if (pager) return { zone: 'pager', index: Array.from(pager.querySelectorAll('a')).indexOf(element as HTMLAnchorElement), label, visibleFocus };
    const card = element.closest('main article');
    if (card) return { zone: 'card', index: Array.from(document.querySelectorAll('main article')).indexOf(card), label, visibleFocus };
    return { zone: 'other', index: -1, label, visibleFocus };
  }) as Promise<Focused>;
}

/** Presses Tab from the top of the page until focus reaches the pagination nav, recording every stop. */
async function tabUntilPager(page: Page, limit = 160): Promise<Focused[]> {
  const stops: Focused[] = [];
  for (let presses = 0; presses < limit; presses += 1) {
    await page.keyboard.press('Tab');
    const stop = await focused(page);
    stops.push(stop);
    if (stop.zone === 'pager') return stops;
  }
  throw new Error(`Pagination not reached with ${limit} Tab presses`);
}

/** Asserts bar links in DOM order, then every card in grid order, then the pagination link `pagerLabel`. */
function expectStorefrontOrder(stops: Focused[], barLinks: number, cards: number, pagerLabel: string): void {
  const position = (zone: Focused['zone']) => stops.map((stop, at) => (stop.zone === zone ? at : -1)).filter((at) => at >= 0);
  const bar = stops.filter((stop) => stop.zone === 'bar').map((stop) => stop.index);
  const card = stops.filter((stop) => stop.zone === 'card').map((stop) => stop.index);
  expect(bar, 'every category bar link once, in order').toEqual(Array.from({ length: barLinks }, (_, index) => index));
  expect([...new Set(card)], 'every card, in grid order').toEqual(Array.from({ length: cards }, (_, index) => index));
  expect(card, 'card focus never goes back').toEqual([...card].sort((a, b) => a - b));
  expect(Math.max(...position('bar')), 'the bar comes before the cards').toBeLessThan(Math.min(...position('card')));
  expect(Math.max(...position('card')), 'the cards come before pagination').toBeLessThan(Math.min(...position('pager')));
  expect(stops.at(-1)!.label).toBe(pagerLabel);
  for (const stop of stops.filter((item) => item.zone !== 'other')) {
    expect(stop.visibleFocus, `visible focus on ${stop.zone} "${stop.label}"`).toBe(true);
  }
}

/** Every visible link and button inside `scopes` is at least 44 px tall. */
async function expectTallTargets(scopes: Locator[]): Promise<void> {
  for (const scope of scopes) {
    for (const control of await scope.locator('a[href], button').all()) {
      if (!await control.isVisible()) continue;
      const box = await control.boundingBox();
      const name = (await control.getAttribute('aria-label')) ?? (await control.innerText()).trim();
      expect(box, `a measurable target for "${name}"`).not.toBeNull();
      expect(box!.height, `44 px minimum height for "${name}"`).toBeGreaterThanOrEqual(44);
    }
  }
}

test.describe('E2E-17-19 keyboard and labels', () => {
  test('E2E-17-19 Tab reaches the category bar, then the cards in grid order, then Next and Previous with visible focus',
    t7, async ({ page }) => {
      const view = storefront(page);
      await openStorefront(page, categoryPath());
      await expect(view.cards).toHaveCount(storefrontPageSize);
      const barLinks = await view.categoryNavLinks.count();
      expect(barLinks).toBeGreaterThan(0);
      expectStorefrontOrder(await tabUntilPager(page), barLinks, storefrontPageSize, storefrontCopy.next);

      await openStorefront(page, `${categoryPath()}?page=2`);
      await expect(view.cards).toHaveCount(1);
      expectStorefrontOrder(await tabUntilPager(page), barLinks, 1, storefrontCopy.previous);
    });

  test('E2E-17-19 named Categories, Breadcrumb and Pagination navs, one h1 and non-empty image alt text on every page',
    t7, async ({ page }) => {
      const view = storefront(page);
      for (const path of storePaths()) {
        await openStorefront(page, path);
        await expect(page.locator('h1'), `one h1 on ${path}`).toHaveCount(1);
        await expect(view.categoryNav, `Categories nav on ${path}`).toHaveCount(1);
        const alts = await page.locator('img').evaluateAll((images) => images.map((image) => image.getAttribute('alt')));
        for (const alt of alts) expect(alt?.trim() ?? '', `non-empty img alt on ${path}`).not.toBe('');
      }
      await openStorefront(page, categoryPath());
      await expect(view.pagination).toHaveCount(1);
      await openStorefront(page, detailsPath());
      await expect(view.breadcrumb).toHaveCount(1);
      await expect(view.main.locator('img').first()).toBeVisible();
    });

  test('E2E-17-19 gallery thumbnails toggle with Enter and Space and expose aria-pressed', t7, async ({ page }) => {
    const view = storefront(page);
    await openStorefront(page, detailsPath());
    await expect(view.thumbnails).toHaveCount(2);
    const [first, second] = [view.thumbnails.nth(0), view.thumbnails.nth(1)];
    const large = view.main.locator('.gallery-main img');
    await expect(first).toHaveAttribute('aria-pressed', 'true');
    await expect(second).toHaveAttribute('aria-pressed', 'false');
    await expect(large).toHaveAttribute('src', new RegExp(galleryImages[0].id));

    await tabTo(page, second);
    await page.keyboard.press('Enter');
    await expect(second).toHaveAttribute('aria-pressed', 'true');
    await expect(first).toHaveAttribute('aria-pressed', 'false');
    await expect(large).toHaveAttribute('src', new RegExp(galleryImages[1].id));

    await page.keyboard.press('Shift+Tab');
    await expect(first).toBeFocused();
    await page.keyboard.press('Space');
    await expect(first).toHaveAttribute('aria-pressed', 'true');
    await expect(second).toHaveAttribute('aria-pressed', 'false');
    await expect(large).toHaveAttribute('src', new RegExp(galleryImages[0].id));
  });

  test('E2E-17-19 every storefront link and button is at least 44 px tall', t7, async ({ page }) => {
    const view = storefront(page);
    await openStorefront(page, '/');
    await expectTallTargets([view.categoryNav, view.homeCategories]);
    for (const path of ['/categories', categoryPath(), `${categoryPath()}?page=2`, detailsPath()]) {
      await openStorefront(page, path);
      await expectTallTargets([view.categoryNav, view.main]);
    }
  });
});

const viewports = [
  { label: 'narrow', width: 375, height: 812, columns: (count: number) => expect(count).toBe(2) },
  { label: 'wide', width: 1280, height: 800, columns: (count: number) => expect(count).toBeGreaterThanOrEqual(4) },
];

test.describe('E2E-17-20 layouts', () => {
  for (const viewport of viewports) {
    test(`E2E-17-20 ${viewport.label} ${viewport.width}×${viewport.height}: no horizontal page scroll, product grid columns, only the bar scrolls`,
      t7, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        if (viewport.label === 'narrow') {
          for (let index = 0; index < 2; index++) {
            await seedCategory(admin, 1, { name: `A11y Scroll ${token()} ${'Wide '.repeat(10)}${index}` });
          }
        }
        const view = storefront(page);
        for (const path of storePaths()) {
          await openStorefront(page, path);
          await expect(view.main).toBeVisible();
          const widths = await page.evaluate(() => ({
            scroll: document.documentElement.scrollWidth, inner: window.innerWidth,
          }));
          expect(widths.scroll, `no horizontal page scroll on ${path}`).toBeLessThanOrEqual(widths.inner);
          const scrollers = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('body *'))
            .filter((element) => ['auto', 'scroll'].includes(getComputedStyle(element).overflowX)
              && element.scrollWidth > element.clientWidth + 1 && !element.matches('.catnav .container'))
            .map((element) => `${element.tagName.toLowerCase()}.${element.className}`));
          expect(scrollers, `only the category bar scrolls horizontally on ${path}`).toEqual([]);
          if (viewport.label === 'narrow') {
            const bar = page.locator('.catnav .container');
            const scroll = await bar.evaluate((element) => {
              element.scrollLeft = element.scrollWidth;
              const links = element.querySelectorAll('a');
              return {
                overflowX: getComputedStyle(element).overflowX,
                available: element.clientWidth,
                content: element.scrollWidth,
                left: element.scrollLeft,
                lastLinkRight: links[links.length - 1].getBoundingClientRect().right,
                barRight: element.getBoundingClientRect().right,
              };
            });
            expect(['auto', 'scroll'], `category bar overflow mode on ${path}`).toContain(scroll.overflowX);
            expect(scroll.content, `category bar content overflows on ${path}`).toBeGreaterThan(scroll.available + 1);
            expect(scroll.left, `category bar moves horizontally on ${path}`).toBeGreaterThan(0);
            expect(scroll.lastLinkRight, `last category bar link is reachable on ${path}`)
              .toBeLessThanOrEqual(scroll.barRight + 1);
          }
        }

        await openStorefront(page, categoryPath());
        await expect(view.cards).toHaveCount(storefrontPageSize);
        const boxes = (await Promise.all((await view.cards.all()).map((card) => card.boundingBox())))
          .filter((box): box is NonNullable<typeof box> => box !== null);
        const top = Math.min(...boxes.map((box) => box.y));
        const columns = new Set(boxes.filter((box) => Math.abs(box.y - top) < 2).map((box) => Math.round(box.x)));
        viewport.columns(columns.size);
      });
  }
});
