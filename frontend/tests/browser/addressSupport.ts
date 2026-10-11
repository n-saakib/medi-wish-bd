import { randomBytes, randomUUID } from 'node:crypto';
import { expect, type APIRequestContext, type APIResponse, type Page } from '@playwright/test';
import {
  expectNoStore, ProfileApi, syntheticFullName, syntheticMobile, type MfaStatus,
} from './profileSupport';
import { signIn, type Customer } from './support';
import { apiUrl, checkedTarget, psql } from './testApi';

/** Ticket 12's accepted own-book contract; no route accepts a User identifier. */
export const addressesPath = '/api/user/me/addresses';
export const addressPath = addressesPath;
export const addressKeys = ['accountState', 'changeAllowance', 'items', 'limit'];
export const allowanceKeys = ['perMonth', 'perWeek', 'remainingThisMonth', 'remainingThisWeek'];
export const addressItemKeys = ['addressLine', 'city', 'id', 'isDefault', 'label', 'mobile', 'recipientName', 'version'];

export type AddressFields = {
  label: string | null;
  recipientName: string;
  mobile: string;
  addressLine: string;
  city: string;
};
export type AddressCreate = AddressFields & { id: string; isDefault: boolean };
export type SavedAddress = AddressCreate & { version: number };
export type Address = SavedAddress;
export type AddressBook = {
  accountState: 'ACTIVE' | 'CLOSURE_REQUESTED';
  limit: number;
  changeAllowance: { perWeek: number; perMonth: number; remainingThisWeek: number; remainingThisMonth: number };
  items: SavedAddress[];
};

export const addressCopy = {
  INVALID_REQUEST: 'The request is invalid.',
  AUTHENTICATION_REQUIRED: 'Authentication is required.',
  MFA_REQUIRED: 'Authenticator verification is required.',
  NOT_FOUND: 'The requested resource was not found.',
  STALE_UPDATE: 'This record changed after you opened it. Reload and try again.',
  ID_CONFLICT: 'This id is already used by a different record.',
  ADDRESS_BOOK_FULL: 'This address book is full. Remove an address to add another.',
  ADDRESS_CHANGE_LIMIT_REACHED: "You've reached the address change limit for this week or month. You can still remove an address.",
  ACCOUNT_CLOSING: "This account is closing, so it can't be changed.",
} as const;

/** Small unique synthetic fixtures in the accepted lengths and ASCII mobile format. */
export function syntheticAddress(overrides: Partial<AddressCreate> = {}): AddressCreate {
  return {
    id: randomUUID(), label: 'Home', recipientName: syntheticFullName(), mobile: syntheticMobile(),
    addressLine: `Synthetic House ${randomBytes(4).toString('hex')}, Road 12`, city: 'Dhaka', isDefault: false,
    ...overrides,
  };
}

/** A strict edit payload: read-only id and account metadata never enter the body. */
export function addressEdit(address: SavedAddress, overrides: Partial<Omit<SavedAddress, 'id'>> = {}) {
  const { label, recipientName, mobile, addressLine, city, isDefault, version } = address;
  return { label, recipientName, mobile, addressLine, city, isDefault, version, ...overrides };
}

/** Reuses the existing serialized token/MFA renewal behavior instead of a second auth implementation. */
export class AddressApi {
  private constructor(private readonly auth: ProfileApi) {}

  static async register(api: APIRequestContext, customer?: Customer): Promise<AddressApi> {
    return new AddressApi(await ProfileApi.register(api, customer));
  }

  static forUser(api: APIRequestContext, customer: Customer): AddressApi {
    return new AddressApi(ProfileApi.forUser(api, customer));
  }

  static onSession(api: APIRequestContext, customer: Customer,
    session: { accessToken: string; mfa: MfaStatus }): AddressApi {
    return new AddressApi(ProfileApi.onSession(api, customer, session));
  }

  get user(): Customer { return this.auth.user; }
  get api(): APIRequestContext { return this.auth.api; }
  bearer(): Promise<string> { return this.auth.bearer(); }
  headers(extra: Record<string, string> = {}): Promise<Record<string, string>> { return this.auth.headers(extra); }

  async get(path = addressesPath): Promise<APIResponse> {
    return this.api.get(`${apiUrl}${path}`, { headers: await this.headers() });
  }

  async create(body: unknown, contentType = 'application/json'): Promise<APIResponse> {
    return this.api.post(`${apiUrl}${addressesPath}`, {
      headers: await this.headers({ 'Content-Type': contentType }),
      data: typeof body === 'string' ? body : JSON.stringify(body),
    });
  }

  async update(id: string, body: unknown, contentType = 'application/json'): Promise<APIResponse> {
    return this.api.put(`${apiUrl}${addressesPath}/${id}`, {
      headers: await this.headers({ 'Content-Type': contentType }),
      data: typeof body === 'string' ? body : JSON.stringify(body),
    });
  }

  async remove(id: string, version: number | string): Promise<APIResponse> {
    return this.api.delete(`${apiUrl}${addressesPath}/${id}?version=${encodeURIComponent(String(version))}`,
      { headers: await this.headers() });
  }

  async book(): Promise<AddressBook> { return expectAddressBook(await this.get()); }
}

/** Checks the complete private projection, bounded size, versions, defaults, cache and correlation contract. */
export async function expectAddressBook(response: APIResponse, status: 200 | 201 = 200): Promise<AddressBook> {
  expect(response.status()).toBe(status);
  expectNoStore(response);
  expect(response.headers()['x-request-id']).toMatch(/\S/);
  const book = await response.json() as AddressBook;
  expect(Object.keys(book).sort()).toEqual(addressKeys);
  expect(['ACTIVE', 'CLOSURE_REQUESTED']).toContain(book.accountState);
  expect(book.limit).toBe(3);
  expect(Array.isArray(book.items)).toBe(true);
  expect(book.items.length).toBeLessThanOrEqual(book.limit);
  expect(new Set(book.items.map(({ id }) => id)).size).toBe(book.items.length);
  expect(book.items.filter(({ isDefault }) => isDefault)).toHaveLength(book.items.length ? 1 : 0);
  expect(Object.keys(book.changeAllowance).sort()).toEqual(allowanceKeys);
  const { perWeek, perMonth, remainingThisWeek, remainingThisMonth } = book.changeAllowance;
  for (const limit of [perWeek, perMonth]) expect(Number.isInteger(limit) && limit >= 1).toBe(true);
  for (const [remaining, limit] of [[remainingThisWeek, perWeek], [remainingThisMonth, perMonth]]) {
    expect(Number.isInteger(remaining) && remaining >= 0 && remaining <= limit).toBe(true);
  }
  for (const item of book.items) {
    expect(Object.keys(item).sort()).toEqual(addressItemKeys);
    expect(item.id).toMatch(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
    for (const [value, max] of [[item.label, 40], [item.recipientName, 100], [item.addressLine, 200], [item.city, 60]] as const) {
      if (value === null && max === 40) continue;
      expect(typeof value === 'string' && value.length > 0 && value.length <= max).toBe(true);
      // A3's stored projection rejects controls and uses Java trim plus ASCII-space collapsing.
      // JavaScript trim would incorrectly reject accepted NBSP/FEFF values.
      expect(value).not.toMatch(/[\p{Cc}\p{Zl}\p{Zp}]/u);
      expect(value).toBe(value!.replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, '').replace(/ +/g, ' '));
    }
    expect(item.mobile).toMatch(/^[0-9]{11}$/);
    expect(typeof item.isDefault).toBe('boolean');
    expect(Number.isInteger(item.version) && item.version >= 0).toBe(true);
  }
  return book;
}

/** Reads synthetic own-book rows in PostgreSQL's authoritative created_at/id order. */
export function storedAddresses(username: string): SavedAddress[] {
  const schema = checkedTarget('storedAddresses', username);
  const row = psql(`SELECT coalesce(json_agg(json_build_object('id', a.id, 'label', a.label,`
    + ` 'recipientName', a.recipient_name, 'mobile', a.mobile, 'addressLine', a.address_line, 'city', a.city,`
    + ` 'isDefault', a.is_default, 'version', a.version) ORDER BY a.created_at, a.id), '[]'::json)`
    + ` FROM ${schema}.saved_addresses a JOIN ${schema}.users u ON u.id = a.user_id`
    + ` WHERE u.username = '${username}';`);
  if (!row) throw new Error('storedAddresses returned no database projection');
  return JSON.parse(row) as SavedAddress[];
}

/** Complete own rows, including identity and timestamps, for exact no-write assertions. */
export function storedAddressState(username: string): {
  addresses: Record<string, unknown>[];
  changes: Record<string, unknown>[];
} {
  const schema = checkedTarget('storedAddressState', username);
  const row = psql(`SELECT json_build_object('addresses',`
    + ` (SELECT coalesce(json_agg(to_jsonb(a) ORDER BY a.created_at, a.id), '[]'::json)`
    + ` FROM ${schema}.saved_addresses a JOIN ${schema}.users u ON u.id = a.user_id`
    + ` WHERE u.username = '${username}'), 'changes',`
    + ` (SELECT coalesce(json_agg(to_jsonb(c) ORDER BY c.changed_at, c.id), '[]'::json)`
    + ` FROM ${schema}.saved_address_changes c JOIN ${schema}.users u ON u.id = c.user_id`
    + ` WHERE u.username = '${username}'));`);
  if (!row) throw new Error('storedAddressState returned no database projection');
  return JSON.parse(row);
}

/** The counted change instants; deletes, retries and denied operations must add no row. */
export function storedAddressChanges(username: string): string[] {
  const schema = checkedTarget('storedAddressChanges', username);
  const row = psql(`SELECT coalesce(json_agg(c.changed_at ORDER BY c.changed_at, c.id), '[]'::json)`
    + ` FROM ${schema}.saved_address_changes c JOIN ${schema}.users u ON u.id = c.user_id`
    + ` WHERE u.username = '${username}';`);
  if (!row) throw new Error('storedAddressChanges returned no database projection');
  return JSON.parse(row) as string[];
}

/** Real-clock limit tests fail clearly near either relevant Dhaka period boundary; they never skip. */
export function assertAwayFromDhakaPeriodStart(now = new Date()): void {
  const timestamp = now.getTime();
  if (!Number.isFinite(timestamp)) throw new Error('A valid test date is required');
  const dhaka = new Date(timestamp + 6 * 60 * 60 * 1000);
  const midnight = Date.UTC(dhaka.getUTCFullYear(), dhaka.getUTCMonth(), dhaka.getUTCDate());
  for (const boundary of [midnight, midnight + 86_400_000]) {
    const day = new Date(boundary);
    if ((day.getUTCDay() === 1 || day.getUTCDate() === 1)
      && Math.abs(dhaka.getTime() - boundary) <= 5 * 60 * 1000) {
      throw new Error('Ticket 12 real-clock allowance checks must run more than five minutes from a Monday or month-start midnight in Asia/Dhaka');
    }
  }
}

export async function openAddresses(page: Page, customer: Customer): Promise<void> {
  await signIn(page, customer.username, customer.password);
  await expect(page).toHaveURL('/account');
  await page.goto('/account/addresses');
  await expect(page.getByRole('heading', { level: 1, name: 'Addresses' })).toBeVisible();
}

export function addressDialog(page: Page) { return page.getByRole('dialog'); }
