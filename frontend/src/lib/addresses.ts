import { boundedError, boundedText, invalidResponse, isRecord, readJsonResponse } from './api';
import type { SessionClient } from './session';
export type SavedAddress = { id: string; label: string | null; recipientName: string; mobile: string; addressLine: string; city: string; isDefault: boolean; version: number };
export type AddressDraft = Omit<SavedAddress, 'id' | 'version'>;
export type ChangeAllowance = { perWeek: number; perMonth: number; remainingThisWeek: number; remainingThisMonth: number };
export type AddressBook = { accountState: 'ACTIVE' | 'CLOSURE_REQUESTED'; limit: number; changeAllowance: ChangeAllowance; items: SavedAddress[] };
type Session = Pick<SessionClient, 'authenticatedFetch'>;
const path = '/api/user/me/addresses';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function keys(value: unknown, expected: string[]): value is Record<string, unknown> {
  return isRecord(value) && !Array.isArray(value) && Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}
function safeText(value: unknown, max: number): value is string { return boundedText(value, max) && !/[\p{Cc}\p{Zl}\p{Zp}]/u.test(value) && value === value.replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, '').replace(/ +/g, ' '); }
function integer(value: unknown, minimum = 0): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum; }
export function projectAddressBook(body: unknown): AddressBook | undefined {
  if (!keys(body, ['accountState', 'limit', 'changeAllowance', 'items']) || (body.accountState !== 'ACTIVE' && body.accountState !== 'CLOSURE_REQUESTED') || !integer(body.limit, 1)
    || !keys(body.changeAllowance, ['perWeek', 'perMonth', 'remainingThisWeek', 'remainingThisMonth']) || !Array.isArray(body.items) || body.items.length > body.limit) return;
  const a = body.changeAllowance;
  if (!integer(a.perWeek, 1) || !integer(a.perMonth, 1) || !integer(a.remainingThisWeek) || !integer(a.remainingThisMonth) || a.remainingThisWeek > a.perWeek || a.remainingThisMonth > a.perMonth) return;
  const items: SavedAddress[] = [];
  for (const item of body.items) {
    if (!keys(item, ['id', 'label', 'recipientName', 'mobile', 'addressLine', 'city', 'isDefault', 'version']) || typeof item.id !== 'string' || !uuid.test(item.id)
      || !(item.label === null || safeText(item.label, 40)) || !safeText(item.recipientName, 100) || !boundedText(item.mobile, 11) || !/^[0-9]{11}$/.test(item.mobile)
      || !safeText(item.addressLine, 200) || !safeText(item.city, 60) || typeof item.isDefault !== 'boolean' || !integer(item.version)) return;
    if (items.some((saved) => saved.id === item.id)) return;
    items.push({ id: item.id, label: item.label, recipientName: item.recipientName, mobile: item.mobile, addressLine: item.addressLine, city: item.city, isDefault: item.isDefault, version: item.version });
  }
  if (items.length && items.filter((item) => item.isDefault).length !== 1) return;
  return { accountState: body.accountState, limit: body.limit, changeAllowance: { perWeek: a.perWeek, perMonth: a.perMonth, remainingThisWeek: a.remainingThisWeek, remainingThisMonth: a.remainingThisMonth }, items };
}
async function read(response: Response, statuses: number[]): Promise<AddressBook> {
  if (!statuses.includes(response.status)) throw await boundedError(response);
  const book = projectAddressBook(await readJsonResponse(response));
  if (!book) throw invalidResponse(response.status);
  return book;
}
export function loadAddresses(session: Session): Promise<AddressBook> { return session.authenticatedFetch(path, { method: 'GET' }, (response) => read(response, [200])); }
export function createAddress(session: Session, id: string, draft: AddressDraft): Promise<AddressBook> { return session.authenticatedFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...draft }) }, (response) => read(response, [200, 201])); }
export function updateAddress(session: Session, address: SavedAddress, draft: AddressDraft): Promise<AddressBook> { return session.authenticatedFetch(`${path}/${address.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...draft, version: address.version }) }, (response) => read(response, [200])); }
export function deleteAddress(session: Session, address: SavedAddress): Promise<AddressBook> { return session.authenticatedFetch(`${path}/${address.id}?version=${address.version}`, { method: 'DELETE' }, (response) => read(response, [200])); }
