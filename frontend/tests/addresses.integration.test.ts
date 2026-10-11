import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { createAddress, deleteAddress, loadAddresses, updateAddress } from '../src/lib/addresses';
import { createSessionClient } from '../src/lib/session';
import { registerUser } from '../src/lib/user';

it('ticket 12: the real client persists its own book, enforces capacity and promotes the oldest remaining default', async () => {
  const baseUrl = process.env.MEDI_WISH_API_URL;
  if (!baseUrl) throw new Error('Set MEDI_WISH_API_URL to the running test backend before integration tests.');
  const customer = {
    username: `address.${randomBytes(4).toString('hex')}`,
    mobile: `018${randomInt(10_000_000, 100_000_000)}`,
    password: `Synthetic-${randomBytes(8).toString('hex')}`,
  };
  await registerUser(customer, { baseUrl });
  const session = createSessionClient({ baseUrl });
  await session.signIn(customer.username, customer.password);
  expect((await loadAddresses(session)).items).toEqual([]);
  const draft = {
    label: 'Home', recipientName: 'Synthetic Recipient', mobile: '01711000000',
    addressLine: 'House 12 Road 5', city: 'Dhaka', isDefault: false,
  };
  const firstId = randomUUID();
  const first = await createAddress(session, firstId, draft);
  expect(first.items).toEqual([{ ...draft, id: firstId, isDefault: true, version: 0 }]);
  expect(first.changeAllowance.remainingThisWeek).toBe(first.changeAllowance.perWeek - 1);
  const secondId = randomUUID();
  await createAddress(session, secondId, { ...draft, label: 'Office' });
  await createAddress(session, randomUUID(), { ...draft, label: 'Parents' });
  await expect(createAddress(session, randomUUID(), draft)).rejects.toMatchObject({
    status: 409, code: 'ADDRESS_BOOK_FULL',
  });
  const loaded = await loadAddresses(session);
  expect(loaded.items.map((item) => item.label)).toEqual(['Home', 'Office', 'Parents']);
  const home = loaded.items.find((item) => item.id === firstId)!;
  const edited = await updateAddress(session, home, { ...draft, city: 'Sylhet', isDefault: true });
  expect(edited.items[0]).toMatchObject({ id: firstId, city: 'Sylhet', version: 1 });
  await deleteAddress(session, edited.items[0]);
  const remaining = await loadAddresses(session);
  expect(remaining.items.map((item) => item.label)).toEqual(['Office', 'Parents']);
  expect(remaining.items.filter((item) => item.isDefault).map((item) => item.id)).toEqual([secondId]);
  expect(remaining.items[0].version).toBe(1);
  expect(remaining.changeAllowance.remainingThisWeek).toBe(remaining.changeAllowance.perWeek - 4);
});
