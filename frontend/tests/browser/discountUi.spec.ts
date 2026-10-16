import type { APIResponse, Locator, Page, Request, Route } from '@playwright/test';
import {
  activeProduct, chooseWithArrowKeys, createCategory, expect, getProduct, medicineDraft, openProduct,
  productEditor, productList, staffContext, tabTo, test, token, type ApiActor,
} from './catalogSupport';
import {
  allDiscounts, assertAwayFromDhakaMidnight, dateOffset, dhakaToday, dhakaTomorrow, discountApi, discountDialog,
  discountDraft, discountManager, expectLabelledTargets, getDiscountProduct, type DiscountPage, type DiscountStatus,
} from './discountSupport';
import { registeredAdmin, signIn, verifiedAdmin } from './support';
import { apiUrl, checkedTarget, psql, removeRole } from './testApi';

/** List barriers forward unchanged real responses; controlled state/shape probes are explicitly identified below. */
test.beforeEach(() => assertAwayFromDhakaMidnight());

const tags = ['@t16', '@t16-T5'];
const stale = /changed|saved.*editing/i;
const moderatorNote = 'Moderators can’t change prices or discounts. Ask an Admin.';
const listRoute = `${apiUrl}/api/staff/discounts?*`;

/** Subscribe before changing intent: cancelling an obsolete request is also a valid race defence. */
function requestCompletion(page: Page, request: Request): Promise<void> {
  return new Promise((resolve) => {
    const complete = (finished: Request) => {
      if (finished !== request) return;
      page.off('requestfinished', complete);
      page.off('requestfailed', complete);
      resolve();
    };
    page.on('requestfinished', complete);
    page.on('requestfailed', complete);
  });
}

async function afterBrowserPaint(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}

type InterceptedResponse = { route: Route; request: Request; response: APIResponse; body: unknown };

/** Real responses only: validate a single identical auth retry separately from business commands. */
async function interceptApiOperations(page: Page, pattern: string, method: string, expectedStatuses: readonly number[],
  delivery: 'pass' | 'lose-first' | 'hold' | ((terminal: InterceptedResponse, index: number) => Promise<void>) = 'pass',
  accept: (request: Request) => boolean = () => true) {
  const endpoint = new URL(pattern.endsWith('*') ? pattern.slice(0, -1) : pattern);
  const belongs = (request: Request) => {
    const url = new URL(request.url());
    return request.method() === method && url.origin === endpoint.origin && url.pathname === endpoint.pathname && accept(request);
  };
  const matches = (request: Request) => belongs(request)
    && (pattern.endsWith('*') ? request.url().startsWith(pattern.slice(0, -1)) : request.url() === pattern);
  const attempts: Request[] = [];
  const results: { request: Request; status: number }[] = [];
  const terminals: InterceptedResponse[] = [];
  let firstRequest: Request | undefined;
  let firstBody: unknown;
  let retried = false;
  let fault: unknown;
  let resolveFirst!: (terminal: InterceptedResponse) => void;
  let rejectFirst!: (reason: unknown) => void;
  const first = new Promise<InterceptedResponse>((resolve, reject) => { resolveFirst = resolve; rejectFirst = reject; });
  // Route failures remain observable through first/check, including after first has already resolved.
  void first.catch(() => undefined);
  const observe = (request: Request) => { if (belongs(request)) attempts.push(request); };
  const handler = async (route: Route) => {
    const request = route.request();
    if (!matches(request)) return route.continue();
    try {
      expect(terminals.length, 'no extra business command').toBeLessThan(expectedStatuses.length);
      const body = method === 'GET' ? null : request.postDataJSON();
      if (firstRequest) {
        expect(request.url()).toBe(firstRequest.url());
        expect(body, 'auth retry preserves the full command').toEqual(firstBody);
        expect(/^Bearer \S+$/.test(await request.headerValue('authorization') ?? ''), 'authenticated retry').toBe(true);
      } else {
        firstRequest = request;
        firstBody = body;
      }
      const response = await route.fetch();
      results.push({ request, status: response.status() });
      if (response.status() === 401) {
        expect(retried, 'at most one auth 401 prefix').toBe(false);
        expect(/^Bearer \S+$/.test(await request.headerValue('authorization') ?? ''), 'authenticated attempt').toBe(true);
        retried = true;
        await route.fulfill({ response });
        return;
      }
      const index = terminals.length;
      expect(response.status(), 'terminal business response').toBe(expectedStatuses[index]);
      const terminal = { route, request, response, body };
      terminals.push(terminal);
      firstRequest = undefined;
      firstBody = undefined;
      retried = false;
      resolveFirst(terminal);
      if (typeof delivery === 'function') await delivery(terminal, index);
      else if (delivery === 'lose-first' && index === 0) await route.abort('failed');
      else if (delivery !== 'hold') await route.fulfill({ response });
    } catch (reason) {
      fault = reason;
      rejectFirst(reason);
      await route.abort('failed').catch(() => undefined);
    }
  };
  page.on('request', observe);
  await page.route(pattern, handler);
  return { attempts, terminals, first,
    check(count: number) {
      if (fault !== undefined) throw fault;
      expect(terminals).toHaveLength(count);
      expect(attempts, 'every raw attempt has an accounted real response').toHaveLength(results.length);
    },
    async stop() { page.off('request', observe); await page.unroute(pattern, handler); },
  };
}

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
  const forward = async (route: Route) => {
    if (!matches(route.request())) return route.fallback();
    const response = await route.fetch({ maxRedirects: 0 });
    await response.body();
    captured.set(route.request(), response);
    await route.fulfill({ response });
  };
  await page.route(listRoute, forward);
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
    await page.unroute(listRoute, forward);
  }
}

/** A selected tab alone does not prove its response replaced the previous tab's rows. */
async function loadDiscountPage(page: Page, status: DiscountStatus | undefined, action: () => Promise<void>,
                                pageNumber?: number) {
  await expectRenderedDiscountPage(page, await requestDiscountPage(page, status, action, pageNumber));
}

async function expectRenderedDiscountPage(page: Page, response: APIResponse) {
  const body = await response.json() as { items: { targetName: string; kind: string; value: string }[]; page: number };
  expect(body.page).toBe(Number(new URL(response.url()).searchParams.get('page') ?? 0));
  await expect(discountManager(page).rows).toHaveCount(body.items.length);
  const renderedStatus = new URL(response.url()).searchParams.get('status');
  const label = renderedStatus === 'ACTIVE' ? 'Active' : renderedStatus === 'SCHEDULED' ? 'Scheduled' : 'Ended';
  for (let index = 0; index < body.items.length; index += 1) {
    const row = discountManager(page).rows.nth(index);
    await expect(row).toContainText(body.items[index].targetName);
    const item = body.items[index];
    const value = item.kind === 'PERCENTAGE' ? `${item.value}%`
      : `৳${Number(item.value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    await expect(row.getByText(value, { exact: true })).toBeVisible();
    await expect(row.getByText(label, { exact: true })).toBeVisible();
  }
}

/** Find synthetic data in the shared run's real paged catalog without assuming it is on page one. */
async function showDiscount(page: Page, name: string, status: DiscountStatus = 'ACTIVE'): Promise<Locator> {
  const manager = discountManager(page);
  const tab = status === 'ACTIVE' ? manager.active : status === 'SCHEDULED' ? manager.scheduled : manager.ended;
  if (await tab.getAttribute('aria-pressed') !== 'true') {
    await loadDiscountPage(page, status, () => tab.click());
  }
  await expect(tab).toHaveAttribute('aria-pressed', 'true');
  await expect(manager.pager).toBeVisible();
  while (await manager.previous.isEnabled()) {
    const before = await manager.pager.innerText();
    await loadDiscountPage(page, status, () => manager.previous.click());
    await expect(manager.pager).not.toHaveText(before);
  }
  for (let index = 0; index < 200; index += 1) {
    if (await manager.row(name).count()) {
      await expect(manager.row(name)).toBeVisible();
      await expect(manager.row(name).getByText(status === 'ACTIVE' ? 'Active' : status === 'SCHEDULED' ? 'Scheduled' : 'Ended',
        { exact: true })).toBeVisible();
      return manager.row(name);
    }
    if (!await manager.next.isEnabled()) break;
    const before = await manager.pager.innerText();
    await loadDiscountPage(page, status, () => manager.next.click());
    await expect(manager.pager).not.toHaveText(before);
  }
  throw new Error('Synthetic discount was absent from the real paged list.');
}

async function fixture(admin: ApiActor, sellingPrice = '150.00') {
  const category = await createCategory(admin, `Discount care ${token()}`);
  const product = await activeProduct(admin, medicineDraft(category.id), sellingPrice, sellingPrice);
  return { category, product };
}

async function openNew(page: Page, name: string, scope: 'CATEGORY' | 'PRODUCT' = 'CATEGORY') {
  const manager = discountManager(page);
  // The accepted initial loading state has no count; wait before starting a mutation journey.
  await expect(manager.active).toHaveAccessibleName(/^Active \d+$/);
  await manager.newDiscount.click();
  const dialog = discountDialog(page);
  await expect(dialog.dialog).toBeVisible();
  if (scope === 'PRODUCT') {
    await dialog.product.check();
    await dialog.search.fill(name);
  } else await dialog.category.check();
  await expect(dialog.target.locator('option').filter({ hasText: name })).toHaveCount(1);
  await dialog.target.selectOption({ label: name });
  await dialog.type.selectOption({ label: 'Percentage' });
  await dialog.starts.fill(dhakaToday());
  return dialog;
}

async function expectCounts(page: Page, admin: ApiActor) {
  const expected = (await discountApi(admin).list('ACTIVE')).counts;
  await expect(discountManager(page).active).toHaveAccessibleName(`Active ${expected.active}`);
  await expect(discountManager(page).scheduled).toHaveAccessibleName(`Scheduled ${expected.scheduled}`);
  await expect(discountManager(page).ended).toHaveAccessibleName('Ended');
}

/** Successful close must leave a live keyboard destination, including when End removes its opener. */
async function expectUsablePageFocus(page: Page) {
  const focused = page.locator(':focus');
  await expect(focused).toBeVisible();
  await expect(focused).toBeEnabled();
  expect(await focused.evaluate((element) => element.matches('button, a[href], input, select, textarea'))).toBe(true);
  await expect(focused).toHaveAccessibleName(/\S/);
  await page.keyboard.press('Tab');
  const next = page.locator(':focus');
  await expect(next).toBeVisible();
  await expect(next).toBeEnabled();
  expect(await next.evaluate((element) => element.matches('button, a[href], input, select, textarea'))).toBe(true);
}

async function expectLinkedError(field: Locator, message: string) {
  await expect(field).toBeFocused();
  const ids = (await field.getAttribute('aria-describedby'))?.trim().split(/\s+/) ?? [];
  expect(ids.length, 'field error is linked with aria-describedby').toBeGreaterThan(0);
  const linked = await field.evaluate((element, referenced) => referenced.map((id) => {
    const node = element.ownerDocument.getElementById(id);
    return node && node.getClientRects().length > 0 ? node.textContent : null;
  }), ids);
  expect(linked).toContain(message);
}

async function expectFocusRing(page: Page) {
  expect(await page.evaluate(() => {
    const style = getComputedStyle(document.activeElement as HTMLElement);
    return { color: style.outlineColor, style: style.outlineStyle, wide: Number.parseFloat(style.outlineWidth) >= 2 };
  })).toEqual({ color: 'rgb(227, 155, 46)', style: 'solid', wide: true });
}

test('E2E-16-09 Discounts navigation admits Admin only; direct Moderator access is bounded',
  { tag: ['@t16', '@t16-T3'] }, async ({ page, browser }) => {
    await verifiedAdmin(page);
    const link = page.getByRole('link', { name: 'Discounts', exact: true });
    await expect(link).toHaveAttribute('href', '/staff/discounts');
    await link.click();
    await expect(page.getByRole('heading', { name: 'Discounts', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Categories', exact: true })).toHaveAttribute('href', '/staff/categories');
    const moderator = await staffContext(browser, 'moderator');
    try {
      await expect(moderator.page.getByRole('link', { name: 'Discounts', exact: true })).toHaveCount(0);
      await moderator.page.goto('/staff/discounts');
      await expect(moderator.page.getByRole('main').getByRole('alert')).toHaveText('You don’t have permission to do that.');
      await expect(moderator.page.getByRole('table')).toHaveCount(0);
      await expect(discountManager(moderator.page).newDiscount).toHaveCount(0);
    } finally { await moderator.context.close(); }
  });

test('E2E-16-09 signed-out and MFA-pending visitors are redirected before any discount request',
  { tag: ['@t16', '@t16-T3'] }, async ({ page }) => {
    const paths: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/api/staff/discounts')) paths.push(request.method());
    });
    await page.goto('/staff/discounts');
    await expect(page).toHaveURL(/\/sign-in(?:\?|$)/);
    const admin = await registeredAdmin(page);
    await signIn(page, admin.username, admin.password);
    await expect(page).toHaveURL('/staff/mfa/enroll');
    await page.goto('/staff/discounts');
    await expect(page).toHaveURL('/staff/mfa/enroll');
    expect(paths).toEqual([]);
  });

test('E2E-16-10 @smoke keyboard creates a Category discount; counts, winner, history and reload persist',
  { tag: [...tags, '@smoke'] }, async ({ page, actors }) => {
    await verifiedAdmin(page);
    const admin = await actors('admin');
    const { category, product } = await fixture(admin);
    const before = (await discountApi(admin).list('ACTIVE')).counts.active;
    await page.goto('/staff/discounts');
    await expect(discountManager(page).active).toHaveAccessibleName(`Active ${before}`);
    await expect(page.getByText('When product and category discounts overlap, customers get the single biggest saving. Discounts never stack.')).toBeVisible();
    await expect(page.getByText('Changing a discount never reprices orders already placed.')).toBeVisible();
    await tabTo(page, discountManager(page).newDiscount);
    await expectFocusRing(page);
    await page.keyboard.press('Enter');
    const dialog = discountDialog(page);
    await expect(dialog.dialog).toBeVisible();
    await expectLabelledTargets(page);
    const categoryOption = dialog.target.getByRole('option', { name: category.name, exact: true, includeHidden: true });
    await expect(categoryOption).toHaveCount(1);
    await expect(categoryOption).toHaveAttribute('value', category.id);
    await expect(dialog.target).toBeEnabled();
    await tabTo(page, dialog.target);
    await chooseWithArrowKeys(page, dialog.target, category.name);
    await tabTo(page, dialog.value);
    await page.keyboard.type('10');
    await expect(dialog.starts).toHaveValue(dhakaToday());
    await expect(dialog.starts).toHaveAttribute('min', dhakaToday());
    await expect(dialog.ends).toHaveAttribute('min', dhakaToday());
    await tabTo(page, dialog.save);
    await expectFocusRing(page);
    await loadDiscountPage(page, undefined, () => page.keyboard.press('Enter'));
    await expect(dialog.dialog).not.toBeVisible();
    await expectUsablePageFocus(page);
    const row = await showDiscount(page, category.name);
    for (const text of ['Percentage', '10%', 'No end']) await expect(row).toContainText(text);
    await expect(row).toContainText(/category · 1 products?/);
    await expect(row.getByText('Active', { exact: true })).toBeVisible();
    await expect(discountManager(page).active).toHaveAccessibleName(`Active ${before + 1}`);
    await expectCounts(page, admin);
    await expectLabelledTargets(page);
    await page.reload();
    await showDiscount(page, category.name);
    await expectCounts(page, admin);
    // Cancel/Esc proves focus returns to the actual Edit opener, including keyboard focus trapping.
    const opener = discountManager(page).row(category.name).getByRole('button', { name: 'Edit', exact: true });
    await opener.focus();
    await page.keyboard.press('Enter');
    await expect(dialog.dialog).toBeVisible();
    await expect(dialog.dialog).toHaveAccessibleName(/discount/i);
    expect(await dialog.dialog.evaluate((node) => node.matches(':modal') || node.getAttribute('aria-modal') === 'true'))
      .toBe(true);
    expect(await dialog.dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    for (let index = 0; index < 12; index += 1) {
      await page.keyboard.press('Tab');
      expect(await dialog.dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    }
    for (let index = 0; index < 12; index += 1) {
      await page.keyboard.press('Shift+Tab');
      expect(await dialog.dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialog.dialog).not.toBeVisible();
    await expect(opener).toBeFocused();
    await discountManager(page).newDiscount.focus();
    await page.keyboard.press('Enter');
    await expect(dialog.dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog.dialog).not.toBeVisible();
    await expect(discountManager(page).newDiscount).toBeFocused();
    await page.goto('/staff/products');
    const list = productList(page);
    await list.search.fill(product.name);
    await list.apply.click();
    await expect(list.row(product.name)).toContainText('Category −10%');
    await openProduct(page, product);
    await expect(productEditor(page).pricing).toContainText(`Active discount: ${category.name} category −10% → ৳135.00`);
    await expect(productEditor(page).history).toContainText('Category discount −10% started');
    await page.reload();
    await expect(productEditor(page).pricing).toContainText('৳135.00');
  });

test('E2E-16-10 a Product flat discount displays formatted money, fixed target and disabled started date',
  { tag: tags }, async ({ page, actors }) => {
    await verifiedAdmin(page);
    const admin = await actors('admin');
    const { product } = await fixture(admin, '1500.00');
    await page.goto('/staff/discounts');
    const dialog = await openNew(page, product.name, 'PRODUCT');
    await dialog.type.selectOption({ label: 'Flat amount (৳)' });
    await dialog.value.fill('1234.50');
    await loadDiscountPage(page, undefined, () => dialog.save.click());
    await expect(dialog.dialog).not.toBeVisible();
    const row = await showDiscount(page, product.name);
    await expect(row).toContainText('Flat amount');
    await expect(row).toContainText('৳1,234.50');
    await row.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(dialog.dialog).toContainText(product.name);
    await expect(dialog.target).toHaveCount(0);
    await expect(dialog.category).toHaveCount(0);
    await expect(dialog.product).toHaveCount(0);
    await expect(dialog.starts).toBeDisabled();
    await expect(dialog.endNow).toBeVisible();
    await expect(dialog.dialog.getByText(/preview|already have a bigger|loses to/i)).toHaveCount(0);
    await dialog.cancel.click();
    await page.goto('/staff/products');
    await productList(page).search.fill(product.name);
    await productList(page).apply.click();
    await expect(productList(page).row(product.name)).toContainText('Product −৳1,234.50');
    await openProduct(page, product);
    await expect(productEditor(page).pricing).toContainText(`Active discount: ${product.name} product −৳1,234.50 → ৳265.50`);
  });

test('E2E-16-10 Scheduled edits can start today; all tab counts refresh and dates are inclusive',
  { tag: tags }, async ({ page, actors }) => {
    await verifiedAdmin(page);
    const admin = await actors('admin');
    const { category, product } = await fixture(admin);
    await page.goto('/staff/discounts');
    const dialog = await openNew(page, product.name, 'PRODUCT');
    await dialog.value.fill('30');
    await dialog.starts.fill(dhakaTomorrow());
    await dialog.ends.fill(dhakaTomorrow());
    await dialog.save.click();
    await expect(dialog.dialog).not.toBeVisible();
    const row = await showDiscount(page, product.name, 'SCHEDULED');
    await expect(row.getByText('Scheduled', { exact: true })).toBeVisible();
    await expectCounts(page, admin);
    await row.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(dialog.starts).toBeEnabled();
    await expect(dialog.target).toHaveCount(0);
    await dialog.starts.fill(dhakaToday());
    await expect(dialog.ends).toHaveAttribute('min', dhakaToday());
    await dialog.ends.fill(dhakaToday());
    await dialog.save.click();
    await expect(dialog.dialog).not.toBeVisible();
    await showDiscount(page, product.name);
    await expectCounts(page, admin);
    const date = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
      .format(new Date(`${dhakaToday()}T12:00:00Z`));
    await expect(discountManager(page).row(product.name)).toContainText(date);
    await openProduct(page, product);
    await expect(productEditor(page).pricing).toContainText('৳105.00');
    expect((await getProduct(admin, product.id)).categoryId).toBe(category.id);
  });

test('E2E-16-10 overlapping flat and percentage discounts show one winner and fall back after edit and End now',
  { tag: tags }, async ({ page, actors }) => {
    await verifiedAdmin(page);
    const admin = await actors('admin');
    const { category, product } = await fixture(admin);
    await discountApi(admin).create(discountDraft('PRODUCT', product.id, { value: '10' }));
    await discountApi(admin).create(discountDraft('CATEGORY', category.id, { kind: 'FLAT', value: '20.00' }));
    const assertWinner = async (chip: string, detail: string) => {
      await page.goto('/staff/products');
      await productList(page).search.fill(product.name);
      await productList(page).apply.click();
      const columns = await page.getByRole('columnheader').allTextContents();
      const discountColumn = columns.findIndex((name) => name.trim() === 'Discount');
      expect(discountColumn).toBeGreaterThanOrEqual(0);
      await expect(productList(page).row(product.name).getByRole('cell').nth(discountColumn)).toHaveText(chip);
      await openProduct(page, product);
      await expect(productEditor(page).pricing).toContainText(detail);
      await page.reload();
      await expect(productEditor(page).pricing).toContainText(detail);
    };
    // 20.00 beats 10% of 150.00 (15.00); a stacked price would be 115.00.
    await assertWinner('Category −৳20.00', `Active discount: ${category.name} category −৳20.00 → ৳130.00`);
    await page.goto('/staff/discounts');
    await (await showDiscount(page, category.name)).getByRole('button', { name: 'Edit', exact: true }).click();
    await discountDialog(page).value.fill('5.00');
    await discountDialog(page).save.click();
    await expect(discountDialog(page).dialog).not.toBeVisible();
    await assertWinner('Product −10%', `Active discount: ${product.name} product −10% → ৳135.00`);
    await page.goto('/staff/discounts');
    await (await showDiscount(page, product.name)).getByRole('button', { name: 'Edit', exact: true }).click();
    await discountDialog(page).endNow.click();
    await discountDialog(page).confirm.click();
    await expect(discountDialog(page).dialog).not.toBeVisible();
    await showDiscount(page, product.name, 'ENDED');
    await assertWinner('Category −৳5.00', `Active discount: ${category.name} category −৳5.00 → ৳145.00`);
  });

test('E2E-16-11 End now on a Scheduled discount leaves price and Product history unchanged',
  { tag: tags }, async ({ page, actors }) => {
    await verifiedAdmin(page);
    const admin = await actors('admin');
    const { product } = await fixture(admin);
    const created = await discountApi(admin).create(discountDraft('PRODUCT', product.id, { startsOn: dhakaTomorrow() }));
    const before = await getDiscountProduct(admin, product.id);
    const beforeCounts = (await discountApi(admin).list('SCHEDULED')).counts;
    await page.goto('/staff/discounts');
    await (await showDiscount(page, product.name, 'SCHEDULED')).getByRole('button', { name: 'Edit', exact: true }).click();
    const dialog = discountDialog(page);
    await dialog.endNow.click();
    await dialog.confirm.click();
    await expect(dialog.dialog).not.toBeVisible();
    await showDiscount(page, product.name, 'ENDED');
    await expect(discountManager(page).scheduled).toHaveAccessibleName(`Scheduled ${beforeCounts.scheduled - 1}`);
    await expectCounts(page, admin);
    expect((await allDiscounts(admin, 'ENDED')).find((item) => item.id === created.id))
      .toMatchObject({ status: 'ENDED', version: 1 });
    const after = await getDiscountProduct(admin, product.id);
    expect(after.history).toEqual(before.history);
    expect(after).toMatchObject({ effectivePrice: '150.00', appliedDiscount: null });
    await openProduct(page, product);
    await expect(productEditor(page).pricing).not.toContainText('Active discount:');
    await expect(productEditor(page).history).not.toContainText(/Product discount .* (?:started|ended)/);
  });

test('E2E-16-12 editing a started discount rejects a typed past End date before PUT',
  { tag: tags }, async ({ page, actors }) => {
    await verifiedAdmin(page);
    const admin = await actors('admin');
    const category = await createCategory(admin);
    const created = await discountApi(admin).create(discountDraft('CATEGORY', category.id));
    const schema = checkedTarget('discount UI historical fixture');
    expect(created.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    const started = dateOffset(dhakaToday(), -2);
    psql(`UPDATE ${schema}.discounts SET starts_on = '${started}' WHERE id = '${created.id}';`);
    await page.goto('/staff/discounts');
    await (await showDiscount(page, category.name)).getByRole('button', { name: 'Edit', exact: true }).click();
    const dialog = discountDialog(page);
    await expect(dialog.starts).toBeDisabled();
    await expect(dialog.starts).toHaveValue(started);
    await expect(dialog.ends).toHaveAttribute('min', dhakaToday());
    const writes = await interceptApiOperations(page, `${apiUrl}/api/staff/discounts/${created.id}`, 'PUT', [200]);
    await dialog.ends.fill(dateOffset(dhakaToday(), -1));
    await dialog.save.click();
    await expectLinkedError(dialog.ends, 'The end date can’t be before the start date or today.');
    expect(writes.attempts).toHaveLength(0);
    await dialog.ends.fill(dhakaToday());
    await dialog.save.click();
    await expect(dialog.dialog).not.toBeVisible();
    await writes.first;
    writes.check(1);
    await writes.stop();
    expect((await allDiscounts(admin, 'ACTIVE')).find((item) => item.id === created.id))
      .toMatchObject({ endsOn: dhakaToday(), version: 1 });
  });

test('E2E-16-11 edit and confirmed End now refresh counts and derived history; cancel does nothing',
  { tag: tags }, async ({ page, actors }) => {
    const operator = await verifiedAdmin(page);
    const admin = await actors('admin');
    const { category, product } = await fixture(admin);
    const created = await discountApi(admin).create(discountDraft('CATEGORY', category.id));
    const before = (await discountApi(admin).list('ACTIVE')).counts.active;
    await page.goto('/staff/discounts');
    await (await showDiscount(page, category.name)).getByRole('button', { name: 'Edit', exact: true }).click();
    const dialog = discountDialog(page);
    await dialog.value.fill('15');
    await loadDiscountPage(page, undefined, () => dialog.save.click());
    await expect(dialog.dialog).not.toBeVisible();
    await expectUsablePageFocus(page);
    await expect((await showDiscount(page, category.name))).toContainText('15%');
    await (await showDiscount(page, category.name)).getByRole('button', { name: 'Edit', exact: true }).click();
    const rawEndRequests: Request[] = [];
    const observeEnd = (request: Request) => {
      if (new URL(request.url()).pathname === `/api/staff/discounts/${created.id}/end`) rawEndRequests.push(request);
    };
    page.on('request', observeEnd);
    const endRequests = await interceptApiOperations(page, `${apiUrl}/api/staff/discounts/${created.id}/end`, 'POST', [200]);
    await dialog.endNow.click();
    await expect(dialog.dialog.getByText('End this discount now? Prices go back to the next best discount or the selling price.')).toBeVisible();
    expect(rawEndRequests).toHaveLength(0);
    await dialog.cancel.click();
    await expect(dialog.confirm).toHaveCount(0);
    expect(rawEndRequests).toHaveLength(0);
    expect((await getProduct(admin, product.id)).effectivePrice).toBe('127.50');
    await dialog.endNow.click();
    await loadDiscountPage(page, undefined, () => dialog.confirm.click());
    await expect(dialog.dialog).not.toBeVisible();
    await expectUsablePageFocus(page);
    await endRequests.first;
    endRequests.check(1);
    expect(rawEndRequests).toHaveLength(endRequests.attempts.length);
    expect(rawEndRequests.every((request) => request.method() === 'POST')).toBe(true);
    page.off('request', observeEnd);
    await endRequests.stop();
    const row = await showDiscount(page, category.name, 'ENDED');
    await expect(row.getByText('Ended', { exact: true })).toBeVisible();
    await expect(row.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
    await expect(discountManager(page).active).toHaveAccessibleName(`Active ${before - 1}`);
    await expectCounts(page, admin);
    await page.reload();
    await showDiscount(page, category.name, 'ENDED');
    await page.goto('/staff/products');
    await productList(page).search.fill(product.name);
    await productList(page).apply.click();
    const columns = await page.getByRole('columnheader').allTextContents();
    const discountColumn = columns.findIndex((name) => name.trim() === 'Discount');
    expect(discountColumn, 'Products has a Discount column').toBeGreaterThanOrEqual(0);
    await expect(productList(page).row(product.name).getByRole('cell').nth(discountColumn)).toHaveText('—');
    await expect(productList(page).row(product.name)).not.toContainText('Category −');
    await openProduct(page, product);
    await expect(productEditor(page).pricing).not.toContainText('Active discount:');
    await expect(productEditor(page).history).toContainText(`Category discount −15% ended by ${operator.username}`);
    expect(await getProduct(admin, product.id)).toMatchObject({ sellingPrice: '150.00', effectivePrice: '150.00' });
  });

const invalidValues = [
  { kind: 'Percentage', value: '', error: 'Enter a discount value.' },
  ...['0', '100', '-5', 'abc', '1.5', '01', '1e1'].map((value) =>
    ({ kind: 'Percentage', value, error: 'Enter a whole percentage from 1 to 99.' })),
  ...['abc', '1.234', '1e2'].map((value) =>
    ({ kind: 'Flat amount (৳)', value, error: 'Enter an amount like 125.50.' })),
  ...['0', '10000000.00'].map((value) =>
    ({ kind: 'Flat amount (৳)', value, error: 'Enter an amount from 0.01 to 9,999,999.99.' })),
];
for (const { kind, value, error } of invalidValues) {
  test(`E2E-16-12 client rejects ${kind} value ${JSON.stringify(value)} before mutation and links/focuses the field`,
    { tag: tags }, async ({ page, actors }) => {
      await verifiedAdmin(page);
      const category = await createCategory(await actors('admin'));
      await page.goto('/staff/discounts');
      const dialog = await openNew(page, category.name);
      await dialog.type.selectOption({ label: kind });
      await dialog.value.fill(value);
      const mutations: string[] = [];
      page.on('request', (request) => {
        if (request.method() !== 'GET' && request.method() !== 'OPTIONS'
          && new URL(request.url()).pathname.startsWith('/api/staff/discounts')) mutations.push(request.method());
      });
      await dialog.save.click();
      await expectLinkedError(dialog.value, error);
      expect(mutations).toEqual([]);
      await expect(dialog.dialog).toBeVisible();
    });
}

test('E2E-16-12 required target/value/date and invalid date ordering focus the first invalid field without POST',
  { tag: tags }, async ({ page, actors }) => {
    await verifiedAdmin(page);
    const category = await createCategory(await actors('admin'));
    await page.goto('/staff/discounts');
    await discountManager(page).newDiscount.click();
    const dialog = discountDialog(page);
    await expect(dialog.dialog).toBeVisible();
    const mutations: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/staff/discounts') mutations.push('POST');
    });
    await dialog.target.selectOption('');
    await dialog.value.fill('');
    await dialog.starts.fill('');
    await dialog.save.click();
    await expectLinkedError(dialog.target, 'Choose a category or product.');
    await dialog.target.selectOption({ label: category.name });
    await dialog.save.click();
    await expectLinkedError(dialog.value, 'Enter a discount value.');
    await dialog.value.fill('10');
    await dialog.save.click();
    await expectLinkedError(dialog.starts, 'Choose a start date.');
    await dialog.starts.fill(dateOffset(dhakaToday(), -1));
    await dialog.save.click();
    await expectLinkedError(dialog.starts, 'Choose today or a later date.');
    await dialog.starts.fill(dhakaTomorrow());
    await expect(dialog.ends).toHaveAttribute('min', dhakaTomorrow());
    await dialog.ends.fill(dhakaToday());
    await dialog.save.click();
    await expectLinkedError(dialog.ends, 'The end date can’t be before the start date or today.');
    expect(mutations).toEqual([]);
  });

test('E2E-16-12 stale error preserves typed intent; Reload shows the current revision, then reapplying saves',
  { tag: tags }, async ({ page, actors }) => {
    await verifiedAdmin(page);
    const admin = await actors('admin');
    const category = await createCategory(admin);
    const api = discountApi(admin);
    const created = await api.create(discountDraft('CATEGORY', category.id));
    await page.goto('/staff/discounts');
    await (await showDiscount(page, category.name)).getByRole('button', { name: 'Edit', exact: true }).click();
    const dialog = discountDialog(page);
    await dialog.value.fill('25');
    await api.update(created, { value: '15' });
    await dialog.save.click();
    const warning = dialog.dialog.getByRole('status').filter({ hasText: stale });
    await expect(warning).toContainText(stale);
    await expect(warning).toBeFocused();
    await expect(dialog.value).toHaveValue('25');
    await expect(dialog.reload).toBeVisible();
    const reloaded = await requestDiscountPage(page, undefined, () => dialog.reload.click());
    await expect(dialog.dialog).not.toBeVisible();
    await expectRenderedDiscountPage(page, reloaded);
    await expect(page.getByText('Discount saved.', { exact: true })).toHaveCount(0);
    await expect(discountManager(page).active).toBeFocused();
    await expectUsablePageFocus(page);
    expect((await allDiscounts(admin, 'ACTIVE')).find((item) => item.id === created.id))
      .toMatchObject({ value: '15', version: 1 });
    await (await showDiscount(page, category.name)).getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(dialog.value).toHaveValue('15');
    await dialog.value.fill('25');
    await loadDiscountPage(page, undefined, () => dialog.save.click());
    await expect(dialog.dialog).not.toBeVisible();
    await expect(await showDiscount(page, category.name)).toContainText('25%');
    const saved = (await allDiscounts(admin, 'ACTIVE')).find((item) => item.id === created.id);
    expect(saved).toMatchObject({ value: '25', version: 2 });
  });

test('E2E-16-12 naturally ended fixture rejects an open-dialog edit without a version change and preserves input',
  { tag: tags }, async ({ page, actors }) => {
    await verifiedAdmin(page);
    const admin = await actors('admin');
    const category = await createCategory(admin);
    const created = await discountApi(admin).create(discountDraft('CATEGORY', category.id));
    const schema = checkedTarget('discount UI date-ended fixture');
    expect(created.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    const yesterday = dateOffset(dhakaToday(), -1);
    psql(`UPDATE ${schema}.discounts SET starts_on = '${yesterday}' WHERE id = '${created.id}';`);
    await page.goto('/staff/discounts');
    await (await showDiscount(page, category.name)).getByRole('button', { name: 'Edit', exact: true }).click();
    const dialog = discountDialog(page);
    await expect(dialog.starts).toHaveValue(yesterday);
    await dialog.value.fill('25');
    // A controlled stored-date boundary exercises the real error; no API End or calendar advance occurs.
    // Date expiry writes no version, unlike End now, which would correctly make this dialog stale.
    psql(`UPDATE ${schema}.discounts SET ends_on = '${yesterday}' WHERE id = '${created.id}';`);
    const before = psql(`SELECT row_to_json(d) FROM ${schema}.discounts d WHERE id = '${created.id}';`);
    const endedBefore = (await allDiscounts(admin, 'ENDED')).find((item) => item.id === created.id);
    expect(endedBefore).toMatchObject({ status: 'ENDED', version: created.version, value: '10' });
    const failed = await interceptApiOperations(page, `${apiUrl}/api/staff/discounts/${created.id}`, 'PUT', [409]);
    await dialog.save.click();
    const terminal = await failed.first;
    const response = terminal.response;
    expect(terminal.body).toMatchObject({ version: created.version, value: '25' });
    failed.check(1);
    await failed.stop();
    expect(response.status()).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'DISCOUNT_ENDED',
      message: 'This discount has ended and can no longer be changed.' });
    await expect(dialog.dialog.getByRole('alert'))
      .toContainText('This discount has ended and can no longer be changed.');
    await expect(dialog.dialog).toBeVisible();
    await expect(dialog.value).toHaveValue('25');
    expect(psql(`SELECT row_to_json(d) FROM ${schema}.discounts d WHERE id = '${created.id}';`)).toBe(before);
    expect((await allDiscounts(admin, 'ENDED')).find((item) => item.id === created.id)).toEqual(endedBefore);
    await dialog.cancel.click();
    await loadDiscountPage(page, 'ACTIVE', async () => { await page.reload(); }, 0);
    const row = await showDiscount(page, category.name, 'ENDED');
    await expect(row.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
    await expect(row.getByRole('button', { name: 'End now', exact: true })).toHaveCount(0);
  });

test('E2E-16-12 product flat exceeding price retains the draft and reports the bounded API error',
  { tag: tags }, async ({ page, actors }) => {
    await verifiedAdmin(page);
    const admin = await actors('admin');
    const { product } = await fixture(admin);
    await page.goto('/staff/discounts');
    const dialog = await openNew(page, product.name, 'PRODUCT');
    await dialog.type.selectOption({ label: 'Flat amount (৳)' });
    await dialog.value.fill('150.00');
    await dialog.save.click();
    await expect(dialog.dialog.getByRole('alert')).toContainText("The discount must be smaller than the product's selling price.");
    await expect(dialog.value).toHaveValue('150.00');
    expect((await getProduct(admin, product.id)).effectivePrice).toBe('150.00');
    await dialog.value.fill('20.00');
    await dialog.save.click();
    await expect(dialog.dialog).not.toBeVisible();
    expect((await getProduct(admin, product.id)).effectivePrice).toBe('130.00');
  });

test('E2E-16-12 a role removed mid-session denies a save without discarding input or writing discounts',
  { tag: tags }, async ({ page, actors }) => {
    const operator = await verifiedAdmin(page);
    const admin = await actors('admin');
    const category = await createCategory(admin);
    const before = await discountApi(admin).list('ACTIVE');
    await page.goto('/staff/discounts');
    const dialog = await openNew(page, category.name);
    await dialog.value.fill('25');
    removeRole(operator.username, 'ADMIN');
    await dialog.save.click();
    await expect(dialog.dialog.getByRole('alert')).toContainText('You don’t have permission to do that.');
    await expect(dialog.value).toHaveValue('25');
    expect((await discountApi(admin).list('ACTIVE')).totalItems).toBe(before.totalItems);
  });

test('E2E-16-12 a failed list read shows Retry and preserves usable navigation after recovery',
  { tag: tags }, async ({ page, actors }) => {
    await verifiedAdmin(page);
    const admin = await actors('admin');
    const category = await createCategory(admin);
    await discountApi(admin).create(discountDraft('CATEGORY', category.id));
    await page.route(listRoute, (route) => route.abort('failed'), { times: 1 });
    await page.goto('/staff/discounts');
    await expect(page.getByRole('main').getByRole('alert')).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
    await page.getByRole('button', { name: /Retry|Try again/i }).click();
    await showDiscount(page, category.name);
    await expectCounts(page, admin);
  });

test('E2E-16-12 picker Retry keeps usable keyboard focus during loading and respects user movement',
  { tag: tags }, async ({ page, actors }) => {
    await verifiedAdmin(page);
    const admin = await actors('admin');
    await createCategory(admin);
    await page.goto('/staff/discounts');
    const manager = discountManager(page);
    await expect(manager.active).toHaveAccessibleName(/^Active \d+$/);
    const categoryRoute = `${apiUrl}/api/staff/categories?*`;
    for (const moveFocus of [false, true]) {
      // Fetch an actual terminal 200 before losing transport; hold the unchanged real retry response.
      const reads = await interceptApiOperations(page, categoryRoute, 'GET', [200, 200], async (terminal, index) => {
        if (index === 0) {
          const real = await terminal.response.json() as { items: { id: string; name: string }[] };
          expect(real.items.length, 'the failed delivery follows a real nonempty category read').toBeGreaterThan(0);
          await terminal.route.abort('failed');
        }
      }, (request) => Number(new URL(request.url()).searchParams.get('page') ?? 0) === 0);
      let retryReleased = false;
      try {
        await manager.newDiscount.click();
        const dialog = discountDialog(page);
        const retry = dialog.dialog.getByRole('button', { name: 'Try again', exact: true });
        await expect(dialog.dialog.getByRole('alert')).toContainText('The request could not be completed.');
        await expect(retry).toBeVisible();
        await expect(dialog.target).toBeDisabled();
        await tabTo(page, retry);
        await expect(retry).toBeFocused();
        await page.keyboard.press('Enter');
        await expect.poll(() => reads.terminals.length).toBe(2);
        const held = reads.terminals[1];
        const real = await held.response.json() as { items: { id: string; name: string }[] };
        expect(real.items.length).toBeGreaterThan(0);
        await expect(retry).toHaveCount(0);
        await expect(dialog.dialog.getByRole('status')).toHaveText('Loading categories or products…');
        await expect(dialog.target).toBeDisabled();
        await expect(dialog.category).toBeEnabled();
        await expect(dialog.category).toBeFocused();
        if (moveFocus) {
          await tabTo(page, dialog.value);
          await expect(dialog.value).toBeFocused();
        }
        const completed = requestCompletion(page, held.request);
        await held.route.fulfill({ response: held.response });
        retryReleased = true;
        await completed;
        await expect(dialog.target).toBeEnabled();
        await afterBrowserPaint(page);
        for (const item of real.items) {
          await expect(dialog.target.getByRole('option', { name: item.name, exact: true })).toHaveAttribute('value', item.id);
        }
        await expect(dialog.dialog.getByRole('alert')).toHaveCount(0);
        await expect(moveFocus ? dialog.value : dialog.category).toBeFocused();
        reads.check(2);
        await dialog.cancel.click();
        await expect(dialog.dialog).not.toBeVisible();
      } finally {
        const held = reads.terminals[1];
        if (held && !retryReleased) await held.route.abort('failed').catch(() => undefined);
        await reads.stop();
      }
    }
  });

test('E2E-16-12 malformed enum list response shows bounded Retry and recovers with real data',
  { tag: tags }, async ({ page, actors }) => {
    await verifiedAdmin(page);
    const admin = await actors('admin');
    const category = await createCategory(admin);
    await discountApi(admin).create(discountDraft('CATEGORY', category.id));
    // Controlled response-shape boundary: retain real rows/counts and change only one enum's JSON type.
    const reads = await interceptApiOperations(page, listRoute, 'GET', [200], async (terminal) => {
      const real = await terminal.response.json() as DiscountPage;
      expect(real.items.length, 'a real nonempty list is required for the malformed enum probe').toBeGreaterThan(0);
      expect(real.items[0].status).toBe('ACTIVE');
      await terminal.route.fulfill({ response: terminal.response, json: { ...real,
        items: [{ ...real.items[0], status: [real.items[0].status] }, ...real.items.slice(1)] } });
    });
    try {
      await page.goto('/staff/discounts');
      const alert = page.getByRole('main').getByRole('alert');
      await expect(alert).toContainText('The service returned an invalid response.');
      await expect(alert.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
      await expect(page.getByRole('table')).toHaveCount(0);
      reads.check(1);
    } finally {
      await reads.stop();
    }
    // Retry forwards a fresh actual response unchanged and verifies its rendered rows and counts.
    await loadDiscountPage(page, 'ACTIVE', () => page.getByRole('button', { name: 'Try again', exact: true }).click(), 0);
    await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
    await expect(discountManager(page).newDiscount).toBeEnabled();
    await expectCounts(page, admin);
  });

test('E2E-16-12 cancelled scheduled create retries its lost committed response with the same id and intent',
  { tag: tags }, async ({ page, actors }) => {
    await verifiedAdmin(page);
    const admin = await actors('admin');
    const category = await createCategory(admin);
    await page.goto('/staff/discounts');
    const dialog = await openNew(page, category.name);
    await dialog.value.fill('10');
    const startsOn = dhakaTomorrow();
    await dialog.starts.fill(startsOn);
    const lost = await interceptApiOperations(page, `${apiUrl}/api/staff/discounts`, 'POST', [201, 200], 'lose-first');
    await dialog.save.click();
    await expect(dialog.dialog.getByRole('alert')).toBeVisible();
    await expect(dialog.value).toHaveValue('10');
    await loadDiscountPage(page, 'ACTIVE', () => dialog.cancel.click());
    await expect(dialog.dialog).not.toBeVisible();
    await expect(discountManager(page).newDiscount).toBeDisabled();
    await expect(page.getByRole('row').filter({ hasText: category.name })).toHaveCount(0);
    await page.getByRole('button', { name: 'Retry pending discount', exact: true }).click();
    await expect(dialog.dialog).toBeVisible();
    await expect(dialog.starts).toHaveValue(startsOn);
    await expect(dialog.value).toHaveValue('10');
    await expect(dialog.value).toBeDisabled();
    await loadDiscountPage(page, 'ACTIVE', () => dialog.save.click());
    await expect(dialog.dialog).not.toBeVisible();
    lost.check(2);
    expect(lost.terminals[1].body).toEqual(lost.terminals[0].body);
    const body = lost.terminals[0].body as Record<string, unknown>;
    await lost.stop();
    const rows = (await allDiscounts(admin, 'SCHEDULED')).filter((item) => item.targetId === category.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: body.id, version: 0, targetId: category.id, value: '10', kind: 'PERCENTAGE', startsOn, status: 'SCHEDULED' });
  });

test('E2E-16-12 lost update and End responses replay the same body without another version increment',
  { tag: tags }, async ({ page, actors }) => {
    await verifiedAdmin(page);
    const admin = await actors('admin');
    const category = await createCategory(admin);
    const created = await discountApi(admin).create(discountDraft('CATEGORY', category.id));
    await page.goto('/staff/discounts');
    await (await showDiscount(page, category.name)).getByRole('button', { name: 'Edit', exact: true }).click();
    const dialog = discountDialog(page);
    await dialog.value.fill('20');
    const updates = await interceptApiOperations(page, `${apiUrl}/api/staff/discounts/${created.id}`, 'PUT', [200, 200], 'lose-first');
    await dialog.save.click();
    await expect(dialog.dialog.getByRole('alert')).toBeVisible();
    await expect(dialog.value).toHaveValue('20');
    await loadDiscountPage(page, undefined, () => dialog.save.click());
    await expect(dialog.dialog).not.toBeVisible();
    updates.check(2);
    expect(updates.terminals[1].body).toEqual(updates.terminals[0].body);
    await updates.stop();
    expect((await allDiscounts(admin, 'ACTIVE')).find((item) => item.id === created.id))
      .toMatchObject({ value: '20', version: 1 });

    await (await showDiscount(page, category.name)).getByRole('button', { name: 'Edit', exact: true }).click();
    await dialog.endNow.click();
    const endings = await interceptApiOperations(page, `${apiUrl}/api/staff/discounts/${created.id}/end`, 'POST', [200, 200], 'lose-first');
    await dialog.confirm.click();
    await expect(dialog.dialog.getByRole('alert')).toBeVisible();
    // A retry can retain the confirmation or return to End now; either must require explicit confirmation.
    if (!await dialog.confirm.isVisible()) await dialog.endNow.click();
    await dialog.confirm.click();
    await expect(dialog.dialog).not.toBeVisible();
    endings.check(2);
    expect(endings.terminals[1].body).toEqual(endings.terminals[0].body);
    await endings.stop();
    expect((await allDiscounts(admin, 'ENDED')).find((item) => item.id === created.id))
      .toMatchObject({ value: '20', version: 2, status: 'ENDED' });
  });

test('E2E-16-12 pending Save blocks repeat submission until the actual API response arrives',
  { tag: tags }, async ({ page, actors }) => {
    await verifiedAdmin(page);
    const admin = await actors('admin');
    const category = await createCategory(admin);
    await page.goto('/staff/discounts');
    const dialog = await openNew(page, category.name);
    await dialog.value.fill('10');
    const pending = await interceptApiOperations(page, `${apiUrl}/api/staff/discounts`, 'POST', [201], 'hold');
    await dialog.save.focus();
    await page.keyboard.press('Enter');
    const { route: delayed, response } = await pending.first;
    pending.check(1);
    const attemptsBeforeRepeat = pending.attempts.length;
    await expect(dialog.save).toBeDisabled();
    await page.keyboard.press('Enter');
    await afterBrowserPaint(page);
    expect(pending.attempts).toHaveLength(attemptsBeforeRepeat);
    await loadDiscountPage(page, undefined, () => delayed.fulfill({ response }));
    await expect(dialog.dialog).not.toBeVisible();
    expect(pending.attempts).toHaveLength(attemptsBeforeRepeat);
    pending.check(1);
    await pending.stop();
    await showDiscount(page, category.name);
  });

for (const command of ['update', 'end'] as const) {
  test(`E2E-16-12 pending ${command} prevents repeated command before its real response arrives`,
    { tag: tags }, async ({ page, actors }) => {
      await verifiedAdmin(page);
      const admin = await actors('admin');
      const category = await createCategory(admin);
      const created = await discountApi(admin).create(discountDraft('CATEGORY', category.id));
      await page.goto('/staff/discounts');
      await (await showDiscount(page, category.name)).getByRole('button', { name: 'Edit', exact: true }).click();
      const dialog = discountDialog(page);
      if (command === 'update') await dialog.value.fill('20');
      else await dialog.endNow.click();
      const path = `/api/staff/discounts/${created.id}${command === 'end' ? '/end' : ''}`;
      const method = command === 'end' ? 'POST' : 'PUT';
      const pending = await interceptApiOperations(page, `${apiUrl}${path}`, method, [200], 'hold');
      const submit = command === 'end' ? dialog.confirm : dialog.save;
      await submit.focus();
      await page.keyboard.press('Enter');
      const { route: delayed, response } = await pending.first;
      pending.check(1);
      const attemptsBeforeRepeat = pending.attempts.length;
      await expect(submit).toBeDisabled();
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      await afterBrowserPaint(page);
      expect(pending.attempts).toHaveLength(attemptsBeforeRepeat);
      expect(pending.terminals[0].body).toMatchObject({ version: created.version });
      await delayed.fulfill({ response });
      await expect(dialog.dialog).not.toBeVisible();
      expect(pending.attempts).toHaveLength(attemptsBeforeRepeat);
      pending.check(1);
      await pending.stop();
      const status = command === 'end' ? 'ENDED' : 'ACTIVE';
      expect((await allDiscounts(admin, status)).find((item) => item.id === created.id))
        .toMatchObject({ status, version: created.version + 1, value: command === 'end' ? '10' : '20' });
    });
}

test('E2E-16-10 the manager pages 20 real rows, keeps counts across tabs and preserves keyboard pager focus',
  { tag: tags }, async ({ page, actors }) => {
    await verifiedAdmin(page);
    const admin = await actors('admin');
    const mark = token();
    const names = new Set<string>();
    for (let index = 1; index <= 21; index += 1) {
      const category = await createCategory(admin, `Paged discounts ${mark} ${String(index).padStart(2, '0')}`);
      names.add(category.name);
      await discountApi(admin).create(discountDraft('CATEGORY', category.id));
    }
    const total = (await discountApi(admin).list('ACTIVE')).totalItems;
    await page.goto('/staff/discounts');
    const manager = discountManager(page);
    await expect(manager.pager).toHaveText(`Showing 1–20 of ${total}`);
    await expect(manager.rows).toHaveCount(20);
    await expect(manager.previous).toBeDisabled();
    await expectCounts(page, admin);
    const seen = new Set<string>();
    const pages = Math.ceil(total / 20);
    for (let index = 0; index < pages; index += 1) {
      await expect(manager.pager).toHaveText(`Showing ${index * 20 + 1}–${Math.min((index + 1) * 20, total)} of ${total}`);
      await expect(manager.rows).toHaveCount(Math.min(20, total - index * 20));
      for (const text of await manager.rows.allInnerTexts()) {
        for (const name of names) if (text.includes(name)) seen.add(name);
      }
      if (index + 1 < pages) {
        const before = await manager.pager.innerText();
        await manager.next.focus();
        await loadDiscountPage(page, 'ACTIVE', () => page.keyboard.press('Enter'), index + 1);
        await expect(manager.pager).not.toHaveText(before);
      }
    }
    expect([...seen].sort()).toEqual([...names].sort());
    await expect(manager.next).toBeDisabled();
    await expect(manager.previous).toBeFocused();
    await expectCounts(page, admin);
    // A selected tab on a later page still returns to page zero.
    await loadDiscountPage(page, 'ACTIVE', () => manager.active.click(), 0);
    await expect(manager.pager).toHaveText(`Showing 1–20 of ${total}`);
    for (const [status, tab] of [['ACTIVE', manager.active], ['SCHEDULED', manager.scheduled],
      ['ENDED', manager.ended]] as const) {
      if (status !== 'ACTIVE') await loadDiscountPage(page, status, () => tab.click(), 0);
      const rows = await manager.rows.allInnerTexts();
      const counts = [await manager.active.innerText(), await manager.scheduled.innerText()];
      await tab.click();
      await tab.click();
      await afterBrowserPaint(page);
      await expect(tab).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByText('Loading discounts…', { exact: true })).toHaveCount(0);
      expect(await manager.rows.allInnerTexts()).toEqual(rows);
      expect([await manager.active.innerText(), await manager.scheduled.innerText()]).toEqual(counts);
      await expect(manager.newDiscount).toBeEnabled();
      await expectCounts(page, admin);
    }
    await loadDiscountPage(page, 'ACTIVE', () => manager.active.click(), 0);
    await expect(manager.pager).toHaveText(`Showing 1–20 of ${total}`);
    expect(new URL(page.url()).search).toBe('');
    // Controlled UI-state boundary only: preserve all shared data and the real paging proof above.
    // Concurrent deletion/expiry may leave this requested page empty with either zero or a smaller total.
    for (const remaining of [0, 20]) {
      const reads = await interceptApiOperations(page, listRoute, 'GET', [200], 'hold', (request) => {
        const url = new URL(request.url());
        return url.searchParams.get('status') === 'ACTIVE' && url.searchParams.get('page') === '1';
      });
      try {
        await manager.next.focus();
        await page.keyboard.press('Enter');
        const held = await reads.first;
        const real = await held.response.json() as DiscountPage;
        expect(real.page).toBe(1);
        expect(real.items.length, 'the held response came from the real nonempty second page').toBeGreaterThan(0);
        expect(real.totalItems).toBe(total);
        await expect(page.getByText('Loading discounts…', { exact: true })).toBeVisible();
        await expect(manager.active).toBeFocused();
        const completed = requestCompletion(page, held.request);
        await held.route.fulfill({ response: held.response, json: { ...real, items: [], totalItems: remaining,
          counts: { ...real.counts, active: remaining } } });
        await completed;
        await expect(manager.rows).toHaveCount(0);
        await expect(page.getByText('Loading discounts…', { exact: true })).toHaveCount(0);
        await expect(manager.active).toHaveAccessibleName(`Active ${remaining}`);
        if (remaining === 0) {
          await expect(page.getByText('No active discounts.', { exact: true })).toBeVisible();
          await expect(page.locator('.catalog-pager')).toHaveCount(0);
          await expect(manager.active).toBeFocused();
        } else {
          await expect(page.locator('.catalog-pager span')).toHaveText('No discounts on this page.');
          await expect(manager.next).toBeDisabled();
          await expect(manager.previous).toBeEnabled();
          await expect(manager.previous).toBeFocused();
        }
        reads.check(1);
      } finally {
        await reads.stop();
      }
      await loadDiscountPage(page, 'ACTIVE', () => manager.active.click(), 0);
      await expect(manager.pager).toHaveText(`Showing 1–20 of ${total}`);
      await expectCounts(page, admin);
    }
    expect((await discountApi(admin).list('ACTIVE')).totalItems).toBe(total);
  });

test('E2E-16-10 state-only list boundary: loading then empty copy for each tab without assuming an empty database',
  { tag: tags }, async ({ page }) => {
    await verifiedAdmin(page);
    const reads = await interceptApiOperations(page, listRoute, 'GET', [200, 200, 200], async (terminal, index) => {
      if (index === 0) return; // The test holds the initial terminal 200 to inspect loading.
      const body = await terminal.response.json() as { counts: { active: number; scheduled: number } };
      const status = new URL(terminal.request.url()).searchParams.get('status');
      const counts = { ...body.counts };
      if (status === 'ACTIVE') counts.active = 0;
      if (status === 'SCHEDULED') counts.scheduled = 0;
      await terminal.route.fulfill({ response: terminal.response, json: { ...body, items: [], page: 0, totalItems: 0, counts } });
    });
    await page.goto('/staff/discounts');
    const { route: delayed, response } = await reads.first;
    await expect(page.getByRole('main').getByRole('status')).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
    const real = await response.json() as { counts: { active: number; scheduled: number } };
    await delayed.fulfill({ response, json: { ...real, items: [], page: 0, totalItems: 0,
      counts: { ...real.counts, active: 0 } } });
    await expect(page.getByText('No active discounts.', { exact: true })).toBeVisible();
    await expect(discountManager(page).active).toHaveAccessibleName('Active 0');
    await discountManager(page).scheduled.click();
    await expect(page.getByText('No scheduled discounts.', { exact: true })).toBeVisible();
    await expect(discountManager(page).scheduled).toHaveAccessibleName('Scheduled 0');
    await discountManager(page).ended.click();
    await expect(page.getByText('No ended discounts.', { exact: true })).toBeVisible();
    await expect(discountManager(page).rows).toHaveCount(0);
    reads.check(3);
    await reads.stop();
  });

test('E2E-16-12 delayed Active read cannot overwrite the latest Scheduled tab or its counts',
  { tag: tags }, async ({ page, actors }) => {
    await verifiedAdmin(page);
    const admin = await actors('admin');
    const category = await createCategory(admin);
    await discountApi(admin).create(discountDraft('CATEGORY', category.id, { startsOn: dhakaTomorrow() }));
    const reads = await interceptApiOperations(page, listRoute, 'GET', [200], 'hold',
      (request) => new URL(request.url()).searchParams.get('status') === 'ACTIVE');
    await page.goto('/staff/discounts');
    // Fetch the old terminal data response now, then deliver it after Scheduled renders.
    const { route: delayed, response: old } = await reads.first;
    // Re-selecting the pending tab preserves its one real response and disabled creation state.
    const attemptsBefore = reads.attempts.length;
    await discountManager(page).active.click();
    await discountManager(page).active.click();
    await afterBrowserPaint(page);
    expect(reads.attempts).toHaveLength(attemptsBefore);
    await expect(page.getByText('Loading discounts…', { exact: true })).toBeVisible();
    await expect(discountManager(page).newDiscount).toBeDisabled();
    const oldCounts = (await old.json() as { counts: { active: number; scheduled: number } }).counts;
    // A real intervening write gives the newer list a different global count snapshot.
    const extra = await createCategory(admin);
    await discountApi(admin).create(discountDraft('CATEGORY', extra.id, { startsOn: dhakaTomorrow() }));
    const newCounts = (await discountApi(admin).list('SCHEDULED')).counts;
    expect(newCounts).toEqual({ active: oldCounts.active, scheduled: oldCounts.scheduled + 1 });
    const completed = requestCompletion(page, delayed.request());
    await expect(page.getByRole('main').getByRole('status')).toBeVisible();
    await discountManager(page).scheduled.click();
    await expect(discountManager(page).scheduled).toHaveAttribute('aria-pressed', 'true');
    await expect(discountManager(page).pager).toBeVisible();
    // Locate the fixture before taking the snapshot, while the obsolete Active read is still held.
    await showDiscount(page, category.name, 'SCHEDULED');
    await expect(discountManager(page).scheduled).toHaveAccessibleName(`Scheduled ${newCounts.scheduled}`);
    const visibleBefore = await discountManager(page).rows.allInnerTexts();
    const activeCountBefore = (await discountManager(page).active.getAttribute('aria-label')
      ?? await discountManager(page).active.innerText()).replace(/\s+/g, ' ').trim();
    const scheduledCountBefore = (await discountManager(page).scheduled.getAttribute('aria-label')
      ?? await discountManager(page).scheduled.innerText()).replace(/\s+/g, ' ').trim();
    await delayed.fulfill({ response: old });
    await completed;
    await afterBrowserPaint(page);
    reads.check(1);
    await reads.stop();
    await expect(discountManager(page).scheduled).toHaveAttribute('aria-pressed', 'true');
    expect(await discountManager(page).rows.allInnerTexts()).toEqual(visibleBefore);
    await expect(discountManager(page).active).toHaveAccessibleName(activeCountBefore);
    await expect(discountManager(page).scheduled).toHaveAccessibleName(scheduledCountBefore);
    await expectCounts(page, admin);
  });

test('E2E-16-12 product picker ignores an earlier search response delivered after the latest real search',
  { tag: tags }, async ({ page, actors }) => {
    await verifiedAdmin(page);
    const admin = await actors('admin');
    const { category, product: first } = await fixture(admin);
    const second = await activeProduct(admin, medicineDraft(category.id), '100.00');
    await page.goto('/staff/discounts');
    await discountManager(page).newDiscount.click();
    const dialog = discountDialog(page);
    await dialog.product.check();
    const productRoute = `${apiUrl}/api/staff/products?*`;
    const reads = await interceptApiOperations(page, productRoute, 'GET', [200], 'hold',
      (request) => new URL(request.url()).searchParams.get('q') === first.name);
    await dialog.search.fill(first.name);
    const { route: delayed, response: old } = await reads.first;
    const oldItems = (await old.json() as { items: { id: string; name: string }[] }).items;
    expect(oldItems).toContainEqual(expect.objectContaining({ id: first.id, name: first.name }));
    expect(oldItems.some((item) => item.id === second.id)).toBe(false);
    const completed = requestCompletion(page, delayed.request());
    await dialog.search.fill(second.name);
    await expect(dialog.target.locator('option').filter({ hasText: second.name })).toHaveCount(1);
    await delayed.fulfill({ response: old });
    await completed;
    await afterBrowserPaint(page);
    reads.check(1);
    await reads.stop();
    await expect(dialog.target.locator('option').filter({ hasText: second.name })).toHaveCount(1);
    await expect(dialog.target.locator('option').filter({ hasText: first.name })).toHaveCount(0);
    await dialog.target.selectOption({ label: second.name });
    await dialog.value.fill('10');
    await dialog.save.click();
    await expect(dialog.dialog).not.toBeVisible();
    expect((await getProduct(admin, second.id)).effectivePrice).toBe('90.00');
    expect((await getProduct(admin, first.id)).effectivePrice).toBe('150.00');
  });

test('E2E-16-12 scope switch clears Product selection and ignores its delayed search before Category save',
  { tag: tags }, async ({ page, actors }) => {
    await verifiedAdmin(page);
    const admin = await actors('admin');
    const { category: categoryA, product: productA } = await fixture(admin);
    const { category: categoryB, product: productB } = await fixture(admin);
    const laterProduct = await activeProduct(admin, medicineDraft(categoryA.id), '100.00');
    await page.goto('/staff/discounts');
    const dialog = await openNew(page, productA.name, 'PRODUCT');
    await expect(dialog.target).toHaveValue(productA.id);
    const productRoute = `${apiUrl}/api/staff/products?*`;
    const reads = await interceptApiOperations(page, productRoute, 'GET', [200], 'hold',
      (request) => new URL(request.url()).searchParams.get('q') === laterProduct.name);
    await dialog.search.fill(laterProduct.name);
    const { route: delayed, response: old } = await reads.first;
    const oldItems = (await old.json() as { items: { id: string; name: string }[] }).items;
    expect(oldItems).toContainEqual(expect.objectContaining({ id: laterProduct.id, name: laterProduct.name }));
    expect(oldItems.some((item) => item.id === productA.id || item.id === productB.id)).toBe(false);
    const completed = requestCompletion(page, delayed.request());
    await dialog.category.check();
    await expect(dialog.target.locator('option').filter({ hasText: categoryB.name })).toHaveCount(1);
    await expect(dialog.target).not.toHaveValue(productA.id);
    await dialog.target.selectOption({ label: categoryB.name });
    await delayed.fulfill({ response: old });
    await completed;
    await afterBrowserPaint(page);
    reads.check(1);
    await reads.stop();
    await expect(dialog.target).toHaveValue(categoryB.id);
    await expect(dialog.target.locator('option').filter({ hasText: laterProduct.name })).toHaveCount(0);
    await dialog.value.fill('10');
    await dialog.save.click();
    await expect(dialog.dialog).not.toBeVisible();
    const saved = (await allDiscounts(admin, 'ACTIVE')).filter((item) => item.targetId === categoryB.id);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ targetType: 'CATEGORY', targetId: categoryB.id, value: '10' });
    expect((await getProduct(admin, productB.id)).effectivePrice).toBe('135.00');
    expect((await getProduct(admin, productA.id)).effectivePrice).toBe('150.00');
    expect((await getProduct(admin, laterProduct.id)).effectivePrice).toBe('100.00');
  });

test('E2E-16-13 Moderator sees the same applied discount and history read-only across reload',
  { tag: tags }, async ({ browser, actors }) => {
    const admin = await actors('admin');
    const { category, product } = await fixture(admin);
    await discountApi(admin).create(discountDraft('CATEGORY', category.id));
    const moderator = await staffContext(browser, 'moderator');
    try {
      const page = moderator.page;
      await page.goto('/staff/products');
      await productList(page).search.fill(product.name);
      await productList(page).apply.click();
      await expect(productList(page).row(product.name)).toContainText('Category −10%');
      await openProduct(page, product);
      const editor = productEditor(page);
      await expect(editor.pricing).toContainText(`Active discount: ${category.name} category −10% → ৳135.00`);
      await expect(editor.pricing.getByText(moderatorNote)).toBeVisible();
      await expect(editor.sellingPrice).toBeDisabled();
      await expect(editor.mrp).toBeDisabled();
      await expect(editor.savePricing).toHaveCount(0);
      await expect(editor.history).toContainText('Category discount −10% started');
      await expect(page.getByRole('link', { name: 'Discounts', exact: true })).toHaveCount(0);
      await page.reload();
      await expect(editor.pricing).toContainText('৳135.00');
    } finally { await moderator.context.close(); }
  });

for (const width of [375, 1280]) {
  test.describe(`discount layout at ${width}px`, () => {
    test.use({ viewport: { width, height: 800 } });
    test('E2E-16-10 list and dialog remain labelled, usable and within the viewport',
      { tag: tags }, async ({ page, actors }) => {
        await verifiedAdmin(page);
        const admin = await actors('admin');
        const category = await createCategory(admin, `Long ${token()} ${'x'.repeat(60)}`);
        await discountApi(admin).create(discountDraft('CATEGORY', category.id));
        await page.goto('/staff/discounts');
        await showDiscount(page, category.name);
        await expectLabelledTargets(page);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
        if (width === 375) {
          const container = page.locator('.catalog-table-scroll');
          expect(await container.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
          const edit = discountManager(page).row(category.name).getByRole('button', { name: 'Edit', exact: true });
          // Scroll the padded cell so Chromium rounding cannot clip the interactive target.
          await discountManager(page).row(category.name).locator('td').last().scrollIntoViewIfNeeded();
          await expect(edit).toBeInViewport({ ratio: 1 });
        }
        await discountManager(page).row(category.name).getByRole('button', { name: 'Edit', exact: true }).click();
        await expect(discountDialog(page).dialog).toBeVisible();
        await expectLabelledTargets(page);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
        if (width === 375) {
          // A short viewport represents the space left while a mobile keyboard is open.
          await page.setViewportSize({ width: 375, height: 400 });
          const dialog = discountDialog(page);
          await tabTo(page, dialog.value);
          await expect(dialog.value).toBeInViewport({ ratio: 1 });
          await page.keyboard.press('ControlOrMeta+A');
          await page.keyboard.type('20');
          await tabTo(page, dialog.ends);
          await expect(dialog.ends).toBeInViewport({ ratio: 1 });
          await tabTo(page, dialog.save);
          await expect(dialog.save).toBeInViewport({ ratio: 1 });
          await expectFocusRing(page);
          expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
          await loadDiscountPage(page, undefined, () => page.keyboard.press('Enter'));
          await expect(dialog.dialog).not.toBeVisible();
          await expectUsablePageFocus(page);
          const row = await showDiscount(page, category.name);
          await expect(row).toContainText('20%');
          const edit = row.getByRole('button', { name: 'Edit', exact: true });
          await edit.focus();
          await page.keyboard.press('Enter');
          await expect(dialog.dialog).toBeVisible();
          await page.keyboard.press('Escape');
          await expect(dialog.dialog).not.toBeVisible();
          await expect(edit).toBeFocused();
        } else {
          await discountDialog(page).cancel.click();
        }
      });
  });
}
