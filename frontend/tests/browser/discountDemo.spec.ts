import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { APIResponse, Locator, Page, Request, Route } from '@playwright/test';
import {
  activeProduct, createCategory, expect, medicineDraft, openProduct, productEditor, productList, staffContext,
  test, token,
} from './catalogSupport';
import {
  assertAwayFromDhakaMidnight, dhakaToday, dhakaTomorrow, discountDialog, discountManager, publicPrice,
  type DiscountStatus,
} from './discountSupport';
import { verifiedAdmin } from './support';
import { apiUrl } from './testApi';

/** The only opt-in test. Ordinary runs skip the file before its calendar guard or fixtures run. */
test.skip(!process.env.MEDI_WISH_DEMO_DIR, 'Set MEDI_WISH_DEMO_DIR to save the Ticket 16 browser/API demonstration.');
test.beforeEach(() => assertAwayFromDhakaMidnight());

/** Observe new attempts continuously; a 401 may refresh and retry this exact GET once. */
async function requestDiscountPage(page: Page, status: DiscountStatus | undefined, action: () => Promise<void>,
                                   pageNumber?: number): Promise<APIResponse> {
  const matches = (request: Request) => {
    const url = new URL(request.url());
    return request.method() === 'GET' && url.pathname === '/api/staff/discounts'
      && (status === undefined || url.searchParams.get('status') === status)
      && (pageNumber === undefined || Number(url.searchParams.get('page') ?? 0) === pageNumber);
  };
  const attempts: Request[] = [];
  const captured = new Map<Request, APIResponse>();
  const pattern = `${apiUrl}/api/staff/discounts?*`;
  const forward = async (route: Route) => {
    if (!matches(route.request())) return route.fallback();
    const response = await route.fetch({ maxRedirects: 0 });
    await response.body();
    captured.set(route.request(), response);
    await route.fulfill({ response });
  };
  await page.route(pattern, forward);
  const observe = (request: Request) => { if (matches(request)) attempts.push(request); };
  page.on('request', observe);
  const requested = page.waitForRequest(matches);
  try {
    await action();
    const first = await requested;
    let response = await first.response();
    expect(response, 'the action initiated a completed list read').not.toBeNull();
    if (response!.status() === 401) {
      expect(/^Bearer \S+$/.test(await first.headerValue('authorization') ?? ''), 'authenticated first attempt').toBe(true);
      // A fast retry may already be in the collector before the first response is inspected.
      const retry = attempts.find((request) => request !== first && request.url() === first.url())
        ?? await page.waitForRequest((request) => matches(request) && request.url() === first.url());
      expect(/^Bearer \S+$/.test(await retry.headerValue('authorization') ?? ''), 'authenticated single retry').toBe(true);
      response = await retry.response();
      expect(response, 'the authenticated retry completed').not.toBeNull();
    }
    expect(response!.status()).toBe(200);
    const complete = captured.get(response!.request());
    expect(complete, 'the exact list response body was fully forwarded').toBeDefined();
    return complete!;
  } finally {
    page.off('request', observe);
    await page.unroute(pattern, forward);
  }
}

async function loadDiscountPage(page: Page, status: DiscountStatus | undefined, action: () => Promise<void>) {
  const manager = discountManager(page);
  const response = await requestDiscountPage(page, status, action);
  const body = await response.json() as { items: { targetName: string; kind: string; value: string }[]; page: number };
  expect(body.page).toBe(Number(new URL(response.url()).searchParams.get('page') ?? 0));
  await expect(manager.rows).toHaveCount(body.items.length);
  const renderedStatus = new URL(response.url()).searchParams.get('status');
  const label = renderedStatus === 'ACTIVE' ? 'Active' : renderedStatus === 'SCHEDULED' ? 'Scheduled' : 'Ended';
  for (let index = 0; index < body.items.length; index += 1) {
    const row = manager.rows.nth(index);
    const item = body.items[index];
    await expect(row).toContainText(item.targetName);
    const value = item.kind === 'PERCENTAGE' ? `${item.value}%`
      : `৳${Number(item.value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    await expect(row.getByText(value, { exact: true })).toBeVisible();
    await expect(row.getByText(label, { exact: true })).toBeVisible();
  }
}

async function rowOnTab(page: Page, name: string, status: DiscountStatus): Promise<Locator> {
  const manager = discountManager(page);
  const tab = status === 'ACTIVE' ? manager.active : status === 'SCHEDULED' ? manager.scheduled : manager.ended;
  if (await tab.getAttribute('aria-pressed') !== 'true') await loadDiscountPage(page, status, () => tab.click());
  await expect(tab).toHaveAttribute('aria-pressed', 'true');
  await expect(manager.pager).toBeVisible();
  while (await manager.previous.isEnabled()) {
    const previous = await manager.pager.innerText();
    await loadDiscountPage(page, status, () => manager.previous.click());
    await expect(manager.pager).not.toHaveText(previous);
  }
  for (let index = 0; index < 200; index += 1) {
    if (await manager.row(name).count()) {
      await expect(manager.row(name).getByText(status === 'ACTIVE' ? 'Active' : status === 'SCHEDULED' ? 'Scheduled' : 'Ended',
        { exact: true })).toBeVisible();
      return manager.row(name);
    }
    if (!await manager.next.isEnabled()) break;
    const previous = await manager.pager.innerText();
    await loadDiscountPage(page, status, () => manager.next.click());
    await expect(manager.pager).not.toHaveText(previous);
  }
  throw new Error('Synthetic demonstration discount was absent.');
}

async function createInDialog(page: Page, scope: 'CATEGORY' | 'PRODUCT', name: string, value: string, starts: string,
                              beforeSave?: () => Promise<void>) {
  // Counts appear only after the initial list read; settle it before creating the first discount.
  await expect(discountManager(page).active).toHaveAccessibleName(/^Active \d+$/);
  await discountManager(page).newDiscount.click();
  const dialog = discountDialog(page);
  await expect(dialog.dialog).toBeVisible();
  if (scope === 'PRODUCT') {
    await dialog.product.check();
    await dialog.search.fill(name);
  } else await dialog.category.check();
  await expect(dialog.target.locator('option').filter({ hasText: name })).toHaveCount(1);
  await dialog.target.selectOption({ label: name });
  await dialog.type.selectOption({ label: 'Percentage' });
  await dialog.value.fill(value);
  await dialog.starts.fill(starts);
  await beforeSave?.();
  await loadDiscountPage(page, undefined, () => dialog.save.click());
  await expect(dialog.dialog).not.toBeVisible();
}

test('Ticket 16 complete browser/API demonstration: one greatest saving, scheduling, edit, end and Moderator',
  { tag: ['@t16-demo'] }, async ({ page, browser, playwright, actors }, testInfo) => {
    test.setTimeout(240_000);
    const output = join(process.env.MEDI_WISH_DEMO_DIR!, testInfo.project.name);
    await mkdir(output, { recursive: true });
    const screenshot = async (target: Page, name: string) => {
      const path = join(output, `${name}.png`);
      await target.screenshot({ path, fullPage: true });
      await testInfo.attach(name, { path, contentType: 'image/png' });
    };
    await verifiedAdmin(page);
    const admin = await actors('admin');
    const anonymous = await playwright.request.newContext({ baseURL: apiUrl });
    try {
      const mark = token();
      const category = await createCategory(admin, `Demo Antibiotics ${mark}`);
      const product = await activeProduct(admin,
        medicineDraft(category.id, { name: `Demo Amoxicillin 500 ${mark}` }), '150.00', '150.00');

      await test.step('1–2: Product 10% and Category 15% apply the Category saving once', async () => {
        await page.goto('/staff/discounts');
        await createInDialog(page, 'PRODUCT', product.name, '10', dhakaToday(),
          () => screenshot(page, '02-product-discount-dialog'));
        await createInDialog(page, 'CATEGORY', category.name, '15', dhakaToday());
        await rowOnTab(page, category.name, 'ACTIVE');
        await screenshot(page, '02-active-discounts');
        await page.goto('/staff/products');
        await productList(page).search.fill(product.name);
        await productList(page).apply.click();
        await expect(productList(page).row(product.name)).toContainText('Category −15%');
        await screenshot(page, '02-products-winner');
        await openProduct(page, product);
        await expect(productEditor(page).pricing).toContainText(`Active discount: ${category.name} category −15% → ৳127.50`);
        expect((await publicPrice(anonymous, product.id)).price).toBe('127.50');
        await screenshot(page, '02-product-price');
      });

      await test.step('3: scheduled Product 30% starts tomorrow and cannot change today’s price', async () => {
        await page.goto('/staff/discounts');
        await createInDialog(page, 'PRODUCT', product.name, '30', dhakaTomorrow());
        await expect(await rowOnTab(page, product.name, 'SCHEDULED')).toContainText('30%');
        await screenshot(page, '03-scheduled-discount');
        await openProduct(page, product);
        await expect(productEditor(page).pricing).toContainText('৳127.50');
        expect((await publicPrice(anonymous, product.id)).price).toBe('127.50');
      });

      await test.step('4: Category becomes 5%; Product 10% wins instead', async () => {
        await page.goto('/staff/discounts');
        await (await rowOnTab(page, category.name, 'ACTIVE')).getByRole('button', { name: 'Edit', exact: true }).click();
        const dialog = discountDialog(page);
        await dialog.value.fill('5');
        await dialog.save.click();
        await expect(dialog.dialog).not.toBeVisible();
        await openProduct(page, product);
        await expect(productEditor(page).pricing).toContainText(`Active discount: ${product.name} product −10% → ৳135.00`);
        expect((await publicPrice(anonymous, product.id)).price).toBe('135.00');
        await screenshot(page, '04-product-wins');
      });

      await test.step('5: End Product 10% immediately; Category 5% wins and Scheduled remains', async () => {
        await page.goto('/staff/discounts');
        await (await rowOnTab(page, product.name, 'ACTIVE')).getByRole('button', { name: 'Edit', exact: true }).click();
        const dialog = discountDialog(page);
        await dialog.endNow.click();
        await expect(dialog.confirm).toBeVisible();
        await dialog.confirm.click();
        await expect(dialog.dialog).not.toBeVisible();
        await expect(await rowOnTab(page, product.name, 'ENDED')).toContainText('10%');
        await screenshot(page, '05-ended-product-discount');
        await expect(await rowOnTab(page, product.name, 'SCHEDULED')).toContainText('30%');
        await openProduct(page, product);
        await expect(productEditor(page).pricing).toContainText(`Active discount: ${category.name} category −5% → ৳142.50`);
        expect((await publicPrice(anonymous, product.id)).price).toBe('142.50');
        await screenshot(page, '05-category-fallback-price');
      });

      const moderator = await staffContext(browser, 'moderator');
      try {
        await test.step('6: Moderator reads the winner and cannot list Discounts', async () => {
          const target = moderator.page;
          await expect(target.getByRole('link', { name: 'Discounts', exact: true })).toHaveCount(0);
          await target.goto('/staff/discounts');
          await expect(target.getByRole('main').getByRole('alert')).toContainText('You don’t have permission to do that.');
          await screenshot(target, '06-moderator-discounts-denied');
          await target.goto('/staff/products');
          await productList(target).search.fill(product.name);
          await productList(target).apply.click();
          await expect(productList(target).row(product.name)).toContainText('Category −5%');
          await screenshot(target, '06-moderator-products');
          await openProduct(target, product);
          await expect(productEditor(target).pricing).toContainText('৳142.50');
          await expect(productEditor(target).sellingPrice).toBeDisabled();
          await expect(productEditor(target).pricing).toContainText('Moderators can’t change prices or discounts. Ask an Admin.');
          await screenshot(target, '06-moderator-read-only');
          const actor = await actors('moderator');
          const denied = await actor.get('/api/staff/discounts?status=ACTIVE');
          expect(denied.status()).toBe(403);
          const body = await denied.json() as Record<string, unknown>;
          expect(Object.keys(body).sort()).toEqual(['code', 'message', 'requestId']);
          expect(body.code).toBe('ACCESS_DENIED');
          expect(body.message).toBe('Access is denied.');
        });

        await test.step('7: reloading the manager, list and both editors keeps all final state', async () => {
          await moderator.page.reload();
          await expect(productEditor(moderator.page).pricing).toContainText('৳142.50');
          await page.reload();
          await expect(productEditor(page).pricing).toContainText('৳142.50');
          await page.goto('/staff/products');
          await productList(page).search.fill(product.name);
          await productList(page).apply.click();
          await page.reload();
          await productList(page).search.fill(product.name);
          await productList(page).apply.click();
          await expect(productList(page).row(product.name)).toContainText('Category −5%');
          await loadDiscountPage(page, 'ACTIVE', async () => { await page.goto('/staff/discounts'); });
          await loadDiscountPage(page, 'ACTIVE', async () => { await page.reload(); });
          await expect(await rowOnTab(page, category.name, 'ACTIVE')).toContainText('5%');
          await expect(await rowOnTab(page, product.name, 'SCHEDULED')).toContainText('30%');
          await expect(await rowOnTab(page, product.name, 'ENDED')).toContainText('10%');
          expect((await publicPrice(anonymous, product.id)).price).toBe('142.50');
          await screenshot(page, '07-reloaded-ended-list');
        });
      } finally { await moderator.context.close(); }
    } finally { await anonymous.dispose(); }
  });
