import { randomBytes, randomUUID } from 'node:crypto';
import {
  expect, test as base, type APIRequestContext, type APIResponse, type Browser, type BrowserContext, type Locator, type Page,
} from '@playwright/test';
import { syntheticCustomer, verifiedAdmin, verifiedModerator, type Customer } from './support';
import { accessTokenLifetimeMs, apiUrl, frontendUrl, grantRole, type GrantableRole } from './testApi';
import { totpCode, totpStep } from './totp';

/**
 * Ticket 14 (staff Product catalog) end-to-end helpers: the fixed contract strings, an API client for verified staff
 * and other actors, synthetic Product and Category builders, and page locators for the catalog screens. Not a spec.
 */

/** The API error envelope messages the catalog routes return, exactly as `messages.properties` words them. */
export const apiMessages = {
  AUTHENTICATION_REQUIRED: 'Authentication is required.',
  ACCESS_DENIED: 'Access is denied.',
  MFA_REQUIRED: 'Authenticator verification is required.',
  INVALID_REQUEST: 'The request is invalid.',
  NOT_FOUND: 'The requested resource was not found.',
  STALE_UPDATE: 'This record changed after you opened it. Reload and try again.',
  PRICE_REQUIRED: 'Add a price before activating this product.',
  CATEGORY_NAME_TAKEN: 'A category with this name already exists.',
  ID_CONFLICT: 'This id is already used by a different record.',
} as const;
export type ApiErrorCode = keyof typeof apiMessages;

/** The English page copy the catalog screens must show (plan §10 contract strings). */
export const copy = {
  productSaved: 'Product saved.',
  pricingSaved: 'Pricing saved.',
  categorySaved: 'Category saved.',
  priceRequired: 'Add a price before activating this product.',
  moderatorPricingNote: 'Moderators can’t change prices.',
  productStale: 'Someone saved this product while you were editing. Review their changes first.',
  categoryStale: 'Someone saved this category while you were editing. Review their changes first.',
  categoryNameTaken: 'A category with this name already exists.',
  categoryNameRequired: 'Enter a category name.',
  productNotFound: 'Product not found.',
  noProducts: 'No products yet.',
  noMatches: 'No products match these filters.',
  nameRequired: 'Enter a name.',
  genericRequired: 'Enter the generic or salt name.',
  dosageRequired: 'Enter the dosage form and strength.',
  saleUnitRequired: 'Enter the sale unit.',
  categoryRequired: 'Choose a category.',
  sellingPriceRequired: 'Enter a selling price.',
  moneyFormat: 'Enter an amount like 125.50.',
  priceAboveMrp: 'The selling price can’t be more than the MRP.',
  saleUnitHint: 'Customers buy this exact unit. No pack conversions are calculated. To sell singles and strips, create two products.',
} as const;

export type ProductKind = 'MEDICINE' | 'EQUIPMENT';
export type ProductStatus = 'ACTIVE' | 'INACTIVE' | 'NEEDS_PRICE';
export type ChangeType =
  'CREATED' | 'CATALOG_UPDATED' | 'PRICE_CHANGED' | 'REQUIRE_VALIDATION_CHANGED' | 'ACTIVATED' | 'DEACTIVATED';

export type Category = { id: string; name: string; active: boolean; productCount: number; version: number };

export type ProductChange = {
  occurredAt: string;
  actorUsername: string | null;
  changeType: ChangeType;
  oldSellingPrice: string | null;
  newSellingPrice: string | null;
  oldMrp: string | null;
  newMrp: string | null;
  oldRequireValidation: boolean | null;
  newRequireValidation: boolean | null;
};

export type ProductSummary = {
  id: string;
  kind: ProductKind;
  name: string;
  brandName: string | null;
  genericName: string | null;
  dosageForm: string | null;
  manufacturer: string | null;
  categoryId: string;
  categoryName: string;
  saleUnit: string;
  sellingPrice: string | null;
  mrp: string | null;
  active: boolean;
  requireValidation: boolean;
  status: ProductStatus;
};

export type Product = ProductSummary & {
  description: string | null;
  version: number;
  updatedAt: string;
  updatedByUsername: string | null;
  history: ProductChange[];
};

export type ProductPage = { items: ProductSummary[]; page: number; size: number; totalItems: number };
export type CategoryPage = { items: Category[]; page: number; size: number; totalItems: number };

/** The exact keys of a list page, for products and categories alike. */
export const pageKeys = ['items', 'page', 'size', 'totalItems'];

/** The exact response keys of §4.2; no stock, quantity or other private field may appear. */
export const categoryKeys = ['active', 'id', 'name', 'productCount', 'version'];
export const productSummaryKeys = [
  'active', 'brandName', 'categoryId', 'categoryName', 'dosageForm', 'genericName', 'id', 'kind', 'manufacturer', 'mrp',
  'name', 'requireValidation', 'saleUnit', 'sellingPrice', 'status',
];
export const productKeys = [...productSummaryKeys, 'description', 'history', 'updatedAt', 'updatedByUsername', 'version']
  .sort();
export const historyKeys = [
  'actorUsername', 'changeType', 'newMrp', 'newRequireValidation', 'newSellingPrice', 'occurredAt', 'oldMrp',
  'oldRequireValidation', 'oldSellingPrice',
];

/** A short random token that keeps this run's names apart from every other test's in the shared run schema. */
export function token(): string {
  return randomBytes(4).toString('hex');
}

/** A synthetic Medicine create body; `overrides` set a field, or remove it when the value is `undefined`. */
export function medicineDraft(categoryId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: randomUUID(),
    kind: 'MEDICINE',
    name: `Napa 500 ${token()}`,
    brandName: 'Napa',
    genericName: 'Paracetamol',
    manufacturer: 'Beximco',
    dosageForm: 'Tablet 500 mg',
    saleUnit: 'Strip of 10 tablets',
    description: null,
    categoryId,
    requireValidation: false,
    ...overrides,
  };
}

/** A synthetic Equipment create body; Equipment has no generic/salt name and no dosage form. */
export function equipmentDraft(categoryId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: randomUUID(),
    kind: 'EQUIPMENT',
    name: `Digital thermometer ${token()}`,
    brandName: null,
    genericName: null,
    manufacturer: 'CareTech',
    dosageForm: null,
    saleUnit: '1 piece',
    description: null,
    categoryId,
    requireValidation: false,
    ...overrides,
  };
}

/** The full catalog `PUT` body for `product` as loaded, with `changes` applied; never any money field or `kind`. */
export function catalogBody(product: Product, changes: Record<string, unknown> = {}): Record<string, unknown> {
  const { name, brandName, genericName, manufacturer, dosageForm, saleUnit, description, categoryId } = product;
  return {
    name, brandName, genericName, manufacturer, dosageForm, saleUnit, description, categoryId,
    requireValidation: product.requireValidation,
    active: product.active,
    version: product.version,
    ...changes,
  };
}

export type ActorKind = 'admin' | 'moderator' | 'customer' | 'deliveryPerson' | 'restrictedStaff';

const roleOf: Record<ActorKind, GrantableRole | null> = {
  admin: 'ADMIN',
  moderator: 'MODERATOR',
  customer: null,
  deliveryPerson: 'DELIVERY_PERSON',
  restrictedStaff: 'ADMIN',
};

export type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

/**
 * Keeps one session's access token fresh. Once the token is older than 60% of its lifetime, the next call starts one
 * renewal and every concurrent call awaits that same renewal, because a replayed refresh cookie would revoke the
 * session. A failed renewal fails every call waiting on it, and the next call starts a new one. The refresh call and
 * the clock are injected, so `tests/catalogSupport.test.ts` controls both.
 */
export class TokenRenewal {
  private accessToken = '';
  private issuedAt = 0;
  private renewal: Promise<void> | null = null;

  constructor(private readonly refresh: () => Promise<string>, private readonly now: () => number = Date.now,
              private readonly lifetimeMs = accessTokenLifetimeMs) {}

  /** Stores a token just issued by sign-in, enrollment or a refresh. */
  remember(accessToken: string): void {
    this.accessToken = accessToken;
    this.issuedAt = this.now();
  }

  /** A current Bearer header; renews the token first once it is older than 60% of its lifetime. */
  async authorization(): Promise<Record<string, string>> {
    if (this.now() - this.issuedAt > this.lifetimeMs * 0.6) {
      this.renewal ??= this.refresh()
        .then((accessToken) => this.remember(accessToken))
        .finally(() => { this.renewal = null; });
      await this.renewal;
    }
    return { Authorization: `Bearer ${this.accessToken}` };
  }
}

/**
 * One signed-in User calling the API with a Bearer token, like the staff pages do. Admins and Moderators enroll an
 * authenticator first, so their session is MFA-verified; `restrictedStaff` is an Admin who has not enrolled yet. The
 * test API's access tokens live 10 seconds, so `TokenRenewal` renews the token through the refresh cookie (with the
 * CSRF pair) before it gets old.
 */
export class ApiActor {
  private readonly tokens = new TokenRenewal(() => this.refresh());

  private constructor(private readonly http: APIRequestContext, readonly user: Customer, readonly kind: ActorKind) {}

  get username(): string {
    return this.user.username;
  }

  static async open(http: APIRequestContext, kind: ActorKind): Promise<ApiActor> {
    const user = syntheticCustomer();
    const { username, mobile, email, password } = user;
    expect((await http.post('/api/auth/register', { data: { username, mobile, email, password } })).status()).toBe(201);
    const role = roleOf[kind];
    if (role) grantRole(username, role);
    const actor = new ApiActor(http, user, kind);

    const login = await http.post('/api/auth/login', { data: { identifier: username, password } });
    expect(login.status()).toBe(200);
    const session = await login.json() as { accessToken: string; mfa: string };
    if (kind !== 'admin' && kind !== 'moderator') {
      expect(session.mfa).toBe(kind === 'restrictedStaff' ? 'ENROLLMENT_REQUIRED' : 'NOT_REQUIRED');
      actor.tokens.remember(session.accessToken);
      return actor;
    }

    expect(session.mfa).toBe('ENROLLMENT_REQUIRED');
    const restricted = { Authorization: `Bearer ${session.accessToken}` };
    const started = await http.post('/api/auth/mfa/enrollment', { headers: restricted });
    expect(started.status()).toBe(201);
    const { enrollmentId, secret } = await started.json() as { enrollmentId: string; secret: string };
    const verified = await http.post('/api/auth/mfa/enrollment/verify', {
      headers: restricted,
      data: { enrollmentId, code: totpCode(secret, totpStep()) },
    });
    expect(verified.status()).toBe(200);
    const enrolled = await verified.json() as { accessToken: string; mfa: string };
    expect(enrolled.mfa).toBe('VERIFIED');
    actor.tokens.remember(enrolled.accessToken);
    return actor;
  }

  /** One refresh through the CSRF pair and the refresh cookie; returns the new access token. */
  private async refresh(): Promise<string> {
    const csrf = await this.http.get('/api/auth/csrf');
    expect(csrf.status()).toBe(200);
    const { csrfToken } = await csrf.json() as { csrfToken: string };
    const refreshed = await this.http.post('/api/auth/refresh', { headers: { 'X-XSRF-TOKEN': csrfToken } });
    expect(refreshed.status(), 'the session refresh').toBe(200);
    return (await refreshed.json() as { accessToken: string }).accessToken;
  }

  /** A current Bearer header (see `TokenRenewal`). */
  authorization(): Promise<Record<string, string>> {
    return this.tokens.authorization();
  }

  /** Sends `body` as JSON: an object is serialized, a string is sent exactly as written (for malformed bodies). */
  async send(method: Method, path: string, body?: unknown): Promise<APIResponse> {
    return sendJson(this.http, method, path, body, await this.authorization());
  }

  get(path: string): Promise<APIResponse> {
    return this.send('GET', path);
  }

  post(path: string, body: unknown): Promise<APIResponse> {
    return this.send('POST', path, body);
  }

  put(path: string, body: unknown): Promise<APIResponse> {
    return this.send('PUT', path, body);
  }
}

/** A request with no credentials at all, as an anonymous caller sends it. */
export function sendJson(http: APIRequestContext, method: Method, path: string, body?: unknown,
                         headers: Record<string, string> = {}): Promise<APIResponse> {
  if (body === undefined) return http.fetch(path, { method, headers });
  return http.fetch(path, {
    method,
    headers: { ...headers, 'Content-Type': 'application/json' },
    data: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/**
 * Asserts the status and `Cache-Control: no-store` (every catalog response is private) and returns the JSON body; the
 * failure message carries the bounded response body.
 */
export async function expectJson<T>(response: APIResponse, status: number): Promise<T> {
  expect(response.status(), await response.text()).toBe(status);
  expect(response.headers()['cache-control'], 'Cache-Control').toBe('no-store');
  return await response.json() as T;
}

/**
 * Asserts the bounded error envelope: its status, `code`, exact `message` and a request id. A `400` may add field
 * detail (T1 decides), so only the other statuses are held to exactly these three keys.
 */
export async function expectApiError(response: APIResponse, status: number, code: ApiErrorCode): Promise<void> {
  expect(response.status(), await response.text()).toBe(status);
  const body = await response.json() as Record<string, unknown>;
  expect(body.code).toBe(code);
  expect(body.message).toBe(apiMessages[code]);
  expect(typeof body.requestId).toBe('string');
  if (status !== 400) expect(Object.keys(body).sort()).toEqual(['code', 'message', 'requestId']);
  expect(response.headers()['cache-control']).toBe('no-store');
}

export async function createCategory(actor: ApiActor, name = `Pain relief ${token()}`): Promise<Category> {
  return expectJson<Category>(await actor.post('/api/staff/categories', { id: randomUUID(), name }), 201);
}

export async function updateCategory(actor: ApiActor, category: Category, changes: Partial<Category>): Promise<Category> {
  const { name, active, version } = { ...category, ...changes };
  return expectJson<Category>(await actor.put(`/api/staff/categories/${category.id}`, { name, active, version }), 200);
}

/** One page of the category list; `query` holds `includeInactive`, `page` and `size` as the caller sets them. */
export async function listCategories(actor: ApiActor, query: Record<string, string | number | boolean> = {}):
  Promise<CategoryPage> {
  const search = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]));
  return expectJson<CategoryPage>(await actor.get(`/api/staff/categories?${search}`), 200);
}

/**
 * Every category, in list order, read page by page at the largest size: the run's schema is shared, so a test's own
 * category may be on any page.
 */
export async function allCategories(actor: ApiActor, includeInactive = true): Promise<Category[]> {
  const items: Category[] = [];
  for (let page = 0; page < 200; page += 1) {
    const listed = await listCategories(actor, { includeInactive, page, size: 50 });
    items.push(...listed.items);
    if ((page + 1) * listed.size >= listed.totalItems) return items;
  }
  throw new Error('More category pages than expected');
}

/** The listed category with `id`, wherever it is in the paged list. */
export async function findCategory(actor: ApiActor, id: string): Promise<Category | undefined> {
  return (await allCategories(actor)).find((category) => category.id === id);
}

export async function createProduct(actor: ApiActor, draft: Record<string, unknown>): Promise<Product> {
  return expectJson<Product>(await actor.post('/api/staff/products', draft), 201);
}

export async function getProduct(actor: ApiActor, id: string): Promise<Product> {
  return expectJson<Product>(await actor.get(`/api/staff/products/${id}`), 200);
}

export async function updateProduct(actor: ApiActor, product: Product, changes: Record<string, unknown>): Promise<Product> {
  return expectJson<Product>(await actor.put(`/api/staff/products/${product.id}`, catalogBody(product, changes)), 200);
}

export async function priceProduct(actor: ApiActor, product: Product, sellingPrice: string | null,
                                   mrp: string | null = null): Promise<Product> {
  return expectJson<Product>(await actor.put(`/api/staff/products/${product.id}/pricing`,
    { sellingPrice, mrp, version: product.version }), 200);
}

export async function listProducts(actor: ApiActor, query: Record<string, string | number | boolean>): Promise<ProductPage> {
  const search = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]));
  return expectJson<ProductPage>(await actor.get(`/api/staff/products?${search}`), 200);
}

/** A priced, active Product in `categoryId`, created by `admin` through the real routes. */
export async function activeProduct(admin: ApiActor, draft: Record<string, unknown>, sellingPrice: string,
                                    mrp: string | null = null): Promise<Product> {
  const priced = await priceProduct(admin, await createProduct(admin, draft), sellingPrice, mrp);
  return updateProduct(admin, priced, { active: true });
}

/**
 * The `actors` fixture opens API actors on their own request contexts, so each keeps its own refresh cookie, and
 * disposes of them after the test.
 */
export const test = base.extend<{ actors: (kind: ActorKind) => Promise<ApiActor>; api: APIRequestContext }>({
  api: async ({ playwright }, provide) => {
    const http = await playwright.request.newContext({ baseURL: apiUrl });
    await provide(http);
    await http.dispose();
  },
  actors: async ({ playwright }, provide) => {
    const contexts: APIRequestContext[] = [];
    await provide(async (kind) => {
      const http = await playwright.request.newContext({ baseURL: apiUrl });
      contexts.push(http);
      return ApiActor.open(http, kind);
    });
    for (const http of contexts) await http.dispose();
  },
});
export { expect };

/**
 * A second browser session, in its own context so its cookies and memory-only token stay apart from `page`'s. The
 * caller closes the returned context; when registration, sign-in or enrollment fails, the helper closes it first.
 */
export async function staffContext(browser: Browser, role: 'admin' | 'moderator'):
  Promise<{ context: BrowserContext; page: Page; user: Customer }> {
  const context = await browser.newContext({ baseURL: frontendUrl });
  try {
    const page = await context.newPage();
    const user = role === 'admin' ? await verifiedAdmin(page) : await verifiedModerator(page);
    return { context, page, user };
  } catch (error) {
    await context.close();
    throw error;
  }
}

/** The product editor's controls, by the labels and names of the §10 UI contract. */
export function productEditor(page: Page) {
  const pricing = page.getByRole('region', { name: 'Pricing' });
  return {
    kind: page.getByRole('group', { name: 'Product kind' }),
    medicine: page.getByRole('radio', { name: 'Medicine' }),
    equipment: page.getByRole('radio', { name: 'Equipment' }),
    name: page.getByLabel('Name', { exact: true }),
    brandName: page.getByLabel('Brand name'),
    genericName: page.getByLabel('Generic / salt name'),
    manufacturer: page.getByLabel('Manufacturer'),
    category: page.getByLabel('Category', { exact: true }),
    dosageForm: page.getByLabel('Dosage form and strength'),
    saleUnit: page.getByLabel('Sale unit (what one quantity means)'),
    description: page.getByLabel('Description'),
    active: page.getByLabel('Active (shown on store)'),
    review: page.getByLabel(/^Require review before dispatch/),
    /** The header's status chip: `Active`, `Inactive` or `Needs price`, as text. */
    statusChip: (text: string) => page.getByText(text, { exact: true }),
    save: page.getByRole('button', { name: 'Save', exact: true }),
    pricing,
    mrp: pricing.getByLabel('MRP (৳)'),
    sellingPrice: pricing.getByLabel('Selling price (৳)'),
    savePricing: pricing.getByRole('button', { name: 'Save pricing' }),
    history: page.getByRole('list', { name: 'Change history' }),
    status: (text: string) => page.getByRole('status').filter({ hasText: text }),
  };
}

/** Opens a product's editor and waits until its heading shows the product's name. */
export async function openProduct(page: Page, product: { id: string; name: string }): Promise<void> {
  await page.goto(`/staff/products/${product.id}`);
  await expect(page.getByRole('heading', { level: 1, name: product.name })).toBeVisible();
}

/** The Products list filter bar and table. */
export function productList(page: Page) {
  return {
    search: page.getByLabel('Search products'),
    category: page.getByLabel('Category', { exact: true }),
    status: page.getByLabel('Status', { exact: true }),
    reviewOnly: page.getByLabel('Review required only'),
    apply: page.getByRole('button', { name: 'Apply' }),
    rows: page.locator('table tbody tr'),
    row: (name: string) => page.getByRole('row').filter({ hasText: name }),
    next: page.getByRole('button', { name: 'Next' }),
    previous: page.getByRole('button', { name: 'Previous' }),
  };
}

/** The Categories page controls; only one inline category form is open at a time. The table shows 20 rows a page. */
export function categoryManager(page: Page) {
  return {
    add: page.getByRole('button', { name: 'Add category' }),
    name: page.getByLabel('Category name'),
    active: page.getByLabel('Active', { exact: true }),
    save: page.getByRole('button', { name: 'Save', exact: true }),
    cancel: page.getByRole('button', { name: 'Cancel', exact: true }),
    rows: page.locator('table tbody tr'),
    row: (name: string) => page.getByRole('row').filter({ has: page.getByRole('cell', { name, exact: true }) }),
    pager: page.getByText(/^Showing \d+–\d+ of \d+$/),
    next: page.getByRole('button', { name: 'Next' }),
    previous: page.getByRole('button', { name: 'Previous' }),
  };
}

/** Clicks a pager button and waits until the "Showing …" text changes. */
async function turnPage(pager: Locator, button: Locator): Promise<void> {
  const before = await pager.innerText();
  await button.click();
  await expect(pager).not.toHaveText(before);
}

/**
 * The Categories page row named `name`, wherever it is: the run's schema is shared, so it may be on any page. Stays on
 * the current page when the row is there; otherwise goes back to the first page with **Previous**, then forward with
 * **Next** until the row shows. Returns the row and the 0-based page it is on (20 rows a page).
 */
export async function showCategory(page: Page, name: string): Promise<{ row: Locator; pageIndex: number }> {
  const { pager, previous, next, row: rowOf } = categoryManager(page);
  const row = rowOf(name);
  // A save click returns before its request settles; inspect paging only after the editor closes.
  await expect(categoryManager(page).save).toHaveCount(0);
  await expect(pager).toBeVisible();
  if (await row.count() === 0) {
    while (await previous.isEnabled()) await turnPage(pager, previous);
    while (await row.count() === 0) {
      if (!await next.isEnabled()) throw new Error(`No category row named ${name}`);
      await turnPage(pager, next);
    }
  }
  await expect(row).toBeVisible();
  const first = Number(/^Showing (\d+)/.exec(await pager.innerText())?.[1]);
  return { row, pageIndex: Math.floor((first - 1) / 20) };
}

/** Presses Tab until `target` has focus, so the control is proven reachable by keyboard alone. */
export async function tabTo(page: Page, target: Locator, limit = 80): Promise<void> {
  for (let presses = 0; presses < limit; presses += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`Not reachable with ${limit} Tab presses`);
}

/**
 * Chooses the option labelled `label` in the focused native select with the arrow keys only: Home, then ArrowDown until
 * it is selected. Unlike type-ahead, this works the same in Chrome and Edge.
 */
export async function chooseWithArrowKeys(page: Page, select: Locator, label: string): Promise<void> {
  await expect(select).toBeFocused();
  const options = await select.locator('option').count();
  await page.keyboard.press('Home');
  for (let presses = 0; presses <= options; presses += 1) {
    if (await select.evaluate((element) => (element as HTMLSelectElement).selectedOptions[0]?.label) === label) return;
    await page.keyboard.press('ArrowDown');
  }
  throw new Error(`No option labelled ${label}`);
}

/** Regex-escapes text for a substring match. */
export function literal(text: string): RegExp {
  return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}
