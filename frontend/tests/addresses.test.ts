import { describe, expect, it } from 'vitest';
import { projectAddressBook } from '../src/lib/addresses';
const book = { accountState: 'ACTIVE', limit: 3, changeAllowance: { perWeek: 5, perMonth: 10, remainingThisWeek: 4, remainingThisMonth: 9 }, items: [{ id: '4c1f6f1e-6f3c-4a9e-9d62-0b8f7f3b2a11', label: 'Home', recipientName: 'Rahim Uddin', mobile: '01711000000', addressLine: 'House 12, Road 5', city: 'Dhaka', isDefault: true, version: 0 }] };
describe('address book projection', () => {
  it('accepts the accepted contract and only trusted fields', () => { expect(projectAddressBook(book)).toEqual(book); });
});

it.each([
  { ...book, extra: true }, { ...book, limit: 0 }, { ...book, limit: 0.5 },
  { ...book, items: [{ ...book.items[0], extra: true }] },
  { ...book, items: [{ ...book.items[0], id: '1-1-1-1-1' }] },
  { ...book, items: [{ ...book.items[0], id: book.items[0].id.toUpperCase() }] },
  { ...book, changeAllowance: { ...book.changeAllowance, extra: true } },
  { ...book, changeAllowance: { ...book.changeAllowance, perWeek: 0 } },
  { ...book, changeAllowance: { ...book.changeAllowance, remainingThisWeek: -1 } },
  { ...book, changeAllowance: { ...book.changeAllowance, remainingThisMonth: 0.5 } },
  { ...book, changeAllowance: { ...book.changeAllowance, remainingThisWeek: 6 } },
  { ...book, items: [{ ...book.items[0], version: -1 }] },
  { ...book, items: [{ ...book.items[0], isDefault: false }] },
  { ...book, items: [{ ...book.items[0], label: 'H'.repeat(41) }] },
  { ...book, items: [{ ...book.items[0], city: 'C'.repeat(61) }] },
])('rejects an untrusted book %#', (invalid) => { expect(projectAddressBook(invalid)).toBeUndefined(); });
it('accepts zero remaining allowance without disabling valid projection', () => {
  expect(projectAddressBook({ ...book, changeAllowance: { perWeek: 7, perMonth: 12, remainingThisWeek: 0, remainingThisMonth: 0 } })?.changeAllowance).toEqual({ perWeek: 7, perMonth: 12, remainingThisWeek: 0, remainingThisMonth: 0 });
});

it('sends exact commands and accepts create replay; errors remain bounded', async () => {
  const { loadAddresses, createAddress, updateAddress, deleteAddress } = await import('../src/lib/addresses');
  const calls: { path: string; init: RequestInit }[] = [];
  let response = Response.json(book);
  const session = { authenticatedFetch: async <T,>(path: string, init: RequestInit, read: (response: Response) => Promise<T>) => { calls.push({ path, init }); return read(response.clone()); } };
  const draft = { label: 'Home', recipientName: 'Rahim Uddin', mobile: '01711000000', addressLine: 'House 12, Road 5', city: 'Dhaka', isDefault: true };
  expect(await loadAddresses(session)).toEqual(book);
  response = Response.json(book, { status: 201 }); expect(await createAddress(session, book.items[0].id, draft)).toEqual(book);
  response = Response.json(book); expect(await createAddress(session, book.items[0].id, draft)).toEqual(book);
  await updateAddress(session, book.items[0], draft); await deleteAddress(session, book.items[0]);
  expect(calls.map((call) => [call.path, call.init.method])).toEqual([
    ['/api/user/me/addresses', 'GET'], ['/api/user/me/addresses', 'POST'], ['/api/user/me/addresses', 'POST'],
    ['/api/user/me/addresses/4c1f6f1e-6f3c-4a9e-9d62-0b8f7f3b2a11', 'PUT'], ['/api/user/me/addresses/4c1f6f1e-6f3c-4a9e-9d62-0b8f7f3b2a11?version=0', 'DELETE'],
  ]);
  expect(JSON.parse(String(calls[1].init.body))).toEqual({ id: book.items[0].id, ...draft });
  expect(JSON.parse(String(calls[3].init.body))).toEqual({ ...draft, version: 0 });
  expect(calls[4].init.body).toBeUndefined();
  response = Response.json({ code: 'ADDRESS_BOOK_FULL', message: 'private diagnostic' }, { status: 409 });
  await expect(createAddress(session, book.items[0].id, draft)).rejects.toMatchObject({ code: 'ADDRESS_BOOK_FULL', status: 409, message: '' });
  response = new Response('private diagnostic', { status: 500 });
  await expect(loadAddresses(session)).rejects.toMatchObject({ code: 'REQUEST_FAILED', status: 500, message: '' });
});
