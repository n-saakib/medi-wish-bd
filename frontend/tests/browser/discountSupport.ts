import { randomUUID } from 'node:crypto';
import { expect, type APIRequestContext, type APIResponse, type Page } from '@playwright/test';
import { apiMessages, historyKeys, productKeys, type ApiActor, type Product, type ProductChange } from './catalogSupport';

/** Test-owned Ticket 16 wire contract; intentionally independent of production projections and price math. */
export type DiscountTargetType = 'PRODUCT' | 'CATEGORY';
export type DiscountKind = 'PERCENTAGE' | 'FLAT';
export type DiscountStatus = 'ACTIVE' | 'SCHEDULED' | 'ENDED';
export type DiscountDraft = {
  id: string; targetType: DiscountTargetType; targetId: string; kind: DiscountKind; value: string;
  startsOn: string; endsOn: string | null;
};
export type DiscountEdit = Pick<DiscountDraft, 'kind' | 'value' | 'startsOn' | 'endsOn'> & { version: number };
export type Discount = DiscountDraft & {
  targetName: string; productCount: number | null; status: DiscountStatus; version: number;
  updatedAt: string; updatedByUsername: string | null;
};
export type DiscountPage = {
  items: Discount[]; page: number; size: number; totalItems: number; counts: { active: number; scheduled: number };
};
export type AppliedDiscount = {
  id: string; targetType: DiscountTargetType; targetName: string; kind: DiscountKind; value: string; saving: string;
};
export type HistoryDiscount = Pick<DiscountDraft, 'targetType' | 'kind' | 'value'>;
export type DiscountProduct = Omit<Product, 'history'> & {
  effectivePrice: string | null; appliedDiscount: AppliedDiscount | null;
  history: (Omit<ProductChange, 'changeType'> & {
    changeType: ProductChange['changeType'] | 'DISCOUNT_STARTED' | 'DISCOUNT_ENDED'; discount: HistoryDiscount | null;
  })[];
};
export type PublicPrice = {
  productId: string; sellingPrice: string; mrp: string | null; price: string; saving: string;
  discount: HistoryDiscount | null;
};

export const discountKeys = [
  'endsOn', 'id', 'kind', 'productCount', 'startsOn', 'status', 'targetId', 'targetName', 'targetType', 'updatedAt',
  'updatedByUsername', 'value', 'version',
];
export const appliedDiscountKeys = ['id', 'kind', 'saving', 'targetName', 'targetType', 'value'];
export const publicPriceKeys = ['discount', 'mrp', 'price', 'productId', 'saving', 'sellingPrice'];
export const historyDiscountKeys = ['kind', 'targetType', 'value'];
export const discountMessages = {
  ...apiMessages,
  DISCOUNT_ENDED: 'This discount has ended and can no longer be changed.',
  DISCOUNT_EXCEEDS_PRICE: "The discount must be smaller than the product's selling price.",
} as const;

/** Asia/Dhaka currently has UTC+6 and no DST. The formatter makes the date boundary explicit. */
export function dhakaToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const part = (name: string) => parts.find((item) => item.type === name)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Date-only arithmetic in UTC; no local machine timezone participates. */
export function dateOffset(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function dhakaTomorrow(now = new Date()): string {
  return dateOffset(dhakaToday(now), 1);
}

/** Fail clearly instead of allowing wall-clock fixtures to straddle Dhaka midnight (18:00 UTC). */
export function assertAwayFromDhakaMidnight(now = new Date()): void {
  const utcMs = ((now.getUTCHours() * 60 + now.getUTCMinutes()) * 60 + now.getUTCSeconds()) * 1000
    + now.getUTCMilliseconds();
  if (Math.abs(utcMs - 18 * 60 * 60 * 1000) <= 5 * 60 * 1000) {
    throw new Error('Ticket 16 date fixtures must run outside 17:55–18:05 UTC (Asia/Dhaka midnight). Rerun after 18:05 UTC.');
  }
}

export function discountDraft(targetType: DiscountTargetType, targetId: string,
                              overrides: Partial<DiscountDraft> = {}): DiscountDraft {
  return { id: randomUUID(), targetType, targetId, kind: 'PERCENTAGE', value: '10', startsOn: dhakaToday(),
    endsOn: null, ...overrides };
}

export function discountBody(discount: Discount, changes: Partial<DiscountEdit> = {}): DiscountEdit {
  const { kind, value, startsOn, endsOn, version } = discount;
  return { kind, value, startsOn, endsOn, version, ...changes };
}

/** Every response, including 400, has an exact bounded envelope and the same request id in its header. */
export async function expectDiscountError(response: APIResponse, status: number,
                                          code: keyof typeof discountMessages): Promise<void> {
  expect(response.status(), `status for ${code}`).toBe(status);
  expect(response.headers()['cache-control']).toBe('no-store');
  const body = await response.json() as Record<string, unknown>;
  expect(Object.keys(body).sort()).toEqual(['code', 'message', 'requestId']);
  expect(response.headers()['x-request-id']).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  expect(body).toEqual({ code, message: discountMessages[code], requestId: response.headers()['x-request-id'] });
}

export async function expectDiscountJson<T>(response: APIResponse, status: number): Promise<T> {
  expect(response.status(), `expected ${status} JSON response`).toBe(status);
  expect(response.headers()['cache-control']).toBe('no-store');
  expect(response.headers()['x-request-id']).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  expect(response.headers()['content-type']).toContain('application/json');
  return await response.json() as T;
}

function expectMoney(value: string, positive = false): bigint {
  expect(value).toMatch(/^(?:0|[1-9][0-9]{0,6})\.[0-9]{2}$/);
  if (positive) expect(value).not.toBe('0.00');
  return BigInt(value.replace('.', ''));
}

function expectDiscountValue(discount: HistoryDiscount): void {
  expect(['PRODUCT', 'CATEGORY']).toContain(discount.targetType);
  expect(['PERCENTAGE', 'FLAT']).toContain(discount.kind);
  if (discount.kind === 'PERCENTAGE') expect(discount.value).toMatch(/^[1-9][0-9]?$/);
  else expectMoney(discount.value, true);
}

function expectDate(value: string): void {
  expect(value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  const parsed = new Date(`${value}T00:00:00Z`);
  expect(Number.isNaN(parsed.getTime())).toBe(false);
  expect(parsed.toISOString().slice(0, 10)).toBe(value);
}

function expectInstant(value: string): void {
  expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.[0-9]{1,9})?Z$/);
  expectDate(value.slice(0, 10));
  expect(Number.isNaN(Date.parse(value))).toBe(false);
  expect(Number(value.slice(11, 13))).toBeLessThan(24);
}

/** Exact staff list/detail descriptor; absent discounts must be explicitly null. */
export function expectAppliedDiscountShape(discount: AppliedDiscount | null): void {
  if (discount === null) return;
  expect(Object.keys(discount).sort()).toEqual(appliedDiscountKeys);
  expect(discount.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  expect(typeof discount.targetName).toBe('string');
  expect(discount.targetName.length).toBeGreaterThan(0);
  expectDiscountValue(discount);
  const saving = expectMoney(discount.saving, true);
  if (discount.kind === 'FLAT') expect(expectMoney(discount.value, true)).toBe(saving);
}

export function expectDiscountShape(discount: Discount): void {
  expect(Object.keys(discount).sort()).toEqual(discountKeys);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  expect(discount.id).toMatch(uuid);
  expect(discount.targetId).toMatch(uuid);
  expectDiscountValue(discount);
  expect(['ACTIVE', 'SCHEDULED', 'ENDED']).toContain(discount.status);
  expectDate(discount.startsOn);
  if (discount.endsOn !== null) expectDate(discount.endsOn);
  expect(Number.isInteger(discount.version) && discount.version >= 0).toBe(true);
  expectInstant(discount.updatedAt);
  expect(discount.updatedByUsername === null || typeof discount.updatedByUsername === 'string').toBe(true);
  expect(discount.targetName.length).toBeGreaterThan(0);
  if (discount.targetType === 'PRODUCT') expect(discount.productCount).toBeNull();
  else expect(Number.isInteger(discount.productCount) && discount.productCount! >= 0).toBe(true);
}

/** Uses catalog actors' renewable real bearer sessions, which are also used by Ticket 14's cumulative suites. */
export function discountApi(actor: ApiActor) {
  return {
    async create(body: DiscountDraft): Promise<Discount> {
      const view = await expectDiscountJson<Discount>(await actor.post('/api/staff/discounts', body), 201);
      expectDiscountShape(view);
      return view;
    },
    async update(discount: Discount, changes: Partial<DiscountEdit>): Promise<Discount> {
      const view = await expectDiscountJson<Discount>(
        await actor.put(`/api/staff/discounts/${discount.id}`, discountBody(discount, changes)), 200);
      expectDiscountShape(view);
      return view;
    },
    async end(discount: Discount): Promise<Discount> {
      const view = await expectDiscountJson<Discount>(
        await actor.post(`/api/staff/discounts/${discount.id}/end`, { version: discount.version }), 200);
      expectDiscountShape(view);
      return view;
    },
    async list(status: DiscountStatus, page = 0, size = 20): Promise<DiscountPage> {
      const view = await expectDiscountJson<DiscountPage>(
        await actor.get(`/api/staff/discounts?status=${status}&page=${page}&size=${size}`), 200);
      expect(Object.keys(view).sort()).toEqual(['counts', 'items', 'page', 'size', 'totalItems']);
      expect(Object.keys(view.counts).sort()).toEqual(['active', 'scheduled']);
      for (const count of [view.totalItems, view.counts.active, view.counts.scheduled]) {
        expect(Number.isInteger(count) && count >= 0).toBe(true);
      }
      expect(view.page).toBe(page);
      expect(view.size).toBe(size);
      expect(Array.isArray(view.items)).toBe(true);
      expect(view.items.length).toBeLessThanOrEqual(size);
      for (const item of view.items) { expectDiscountShape(item); expect(item.status).toBe(status); }
      return view;
    },
  };
}

export async function allDiscounts(actor: ApiActor, status: DiscountStatus): Promise<Discount[]> {
  const items: Discount[] = [];
  for (let page = 0; page < 200; page += 1) {
    const listed = await discountApi(actor).list(status, page, 50);
    items.push(...listed.items);
    if ((page + 1) * listed.size >= listed.totalItems) return items;
  }
  throw new Error('More Discount pages than expected');
}

export async function getDiscountProduct(actor: ApiActor, id: string): Promise<DiscountProduct> {
  const product = await expectDiscountJson<DiscountProduct>(await actor.get(`/api/staff/products/${id}`), 200);
  expect(Object.keys(product).sort()).toEqual(productKeys);
  expect(product.id).toBe(id);
  expectAppliedDiscountShape(product.appliedDiscount);
  if (product.sellingPrice === null) {
    expect(product.effectivePrice).toBeNull();
    expect(product.appliedDiscount).toBeNull();
    expect(product.mrp).toBeNull();
  } else {
    const selling = expectMoney(product.sellingPrice, true);
    const effective = expectMoney(product.effectivePrice!, true);
    const saving = product.appliedDiscount === null ? 0n : expectMoney(product.appliedDiscount.saving, true);
    expect(effective + saving).toBe(selling);
    if (product.mrp !== null) expect(expectMoney(product.mrp, true) >= selling).toBe(true);
  }
  expect(Array.isArray(product.history)).toBe(true);
  expect(product.history.length).toBeLessThanOrEqual(20);
  for (const entry of product.history) {
    expect(Object.keys(entry).sort()).toEqual(historyKeys);
    expect(['CREATED', 'CATALOG_UPDATED', 'PRICE_CHANGED', 'REQUIRE_VALIDATION_CHANGED', 'ACTIVATED', 'DEACTIVATED',
      'DISCOUNT_STARTED', 'DISCOUNT_ENDED']).toContain(entry.changeType);
    expectInstant(entry.occurredAt);
    expect(entry.actorUsername === null || typeof entry.actorUsername === 'string').toBe(true);
    if (entry.changeType === 'DISCOUNT_STARTED' || entry.changeType === 'DISCOUNT_ENDED') {
      expect(Object.keys(entry.discount!).sort()).toEqual(historyDiscountKeys);
      expectDiscountValue(entry.discount!);
      for (const key of ['oldSellingPrice', 'newSellingPrice', 'oldMrp', 'newMrp',
        'oldRequireValidation', 'newRequireValidation'] as const) expect(entry[key]).toBeNull();
    } else expect(entry.discount).toBeNull();
  }
  return product;
}

export async function publicPrice(http: APIRequestContext, id: string): Promise<PublicPrice> {
  const price = await expectDiscountJson<PublicPrice>(await http.get(`/api/products/${id}/price`), 200);
  expect(Object.keys(price).sort()).toEqual(publicPriceKeys);
  expect(price.productId).toBe(id);
  const selling = expectMoney(price.sellingPrice, true);
  const effective = expectMoney(price.price, true);
  const saving = expectMoney(price.saving);
  expect(effective + saving).toBe(selling);
  expect(price.discount === null).toBe(saving === 0n);
  if (price.mrp !== null) expect(expectMoney(price.mrp, true) >= selling).toBe(true);
  if (price.discount !== null) {
    expect(Object.keys(price.discount).sort()).toEqual(historyDiscountKeys);
    expectDiscountValue(price.discount);
    if (price.discount.kind === 'FLAT') expect(expectMoney(price.discount.value, true)).toBe(saving);
  }
  return price;
}

export function discountManager(page: Page) {
  return {
    newDiscount: page.getByRole('button', { name: 'New discount', exact: true }),
    active: page.getByRole('button', { name: /^Active(?: \d+)?$/ }),
    scheduled: page.getByRole('button', { name: /^Scheduled(?: \d+)?$/ }),
    ended: page.getByRole('button', { name: 'Ended', exact: true }),
    rows: page.locator('table tbody tr'),
    row: (name: string) => page.getByRole('row').filter({ hasText: name }),
    next: page.getByRole('button', { name: 'Next', exact: true }),
    previous: page.getByRole('button', { name: 'Previous', exact: true }),
    pager: page.getByText(/^Showing \d+–\d+ of \d+$/),
  };
}

export function discountDialog(page: Page) {
  const dialog = page.getByRole('dialog');
  return {
    dialog,
    category: dialog.getByRole('radio', { name: 'Category', exact: true }),
    product: dialog.getByRole('radio', { name: 'One product', exact: true }),
    oneProduct: dialog.getByRole('radio', { name: 'One product', exact: true }),
    target: dialog.getByRole('combobox', { name: /^(?:Target|Category|Product)$/ }),
    search: dialog.getByRole('textbox', { name: 'Search products', exact: true }),
    type: dialog.getByLabel('Type', { exact: true }),
    percentage: dialog.getByRole('radio', { name: 'Percentage', exact: true }),
    flat: dialog.getByRole('radio', { name: 'Flat amount (৳)', exact: true }),
    value: dialog.getByLabel('Value', { exact: true }),
    starts: dialog.getByLabel('Starts', { exact: true }),
    ends: dialog.getByLabel('Ends (optional)', { exact: true }),
    save: dialog.getByRole('button', { name: 'Save discount', exact: true }),
    endNow: dialog.getByRole('button', { name: 'End now', exact: true }),
    confirm: dialog.getByRole('button', { name: 'Confirm', exact: true }),
    cancel: dialog.getByRole('button', { name: 'Cancel', exact: true }),
    reload: dialog.getByRole('button', { name: 'Reload', exact: true }),
  };
}

/** Visible interactive targets meet the design's 44px hit area and every field has an accessible name. */
export async function expectLabelledTargets(page: Page): Promise<void> {
  const controls = page.locator('button, a[href], input:not([type="hidden"]), select, textarea');
  for (const control of await controls.all()) {
    if (!await control.isVisible()) continue;
    const type = await control.getAttribute('type');
    const target = type === 'radio' || type === 'checkbox' ? control.locator('xpath=ancestor::label') : control;
    const box = await target.boundingBox();
    expect(box, 'a visible control has a measurable target').not.toBeNull();
    expect(box!.height, '44px minimum target height').toBeGreaterThanOrEqual(44);
    expect(box!.width, '44px minimum target width').toBeGreaterThanOrEqual(44);
    await expect(control).toHaveAccessibleName(/\S/);
  }
}
