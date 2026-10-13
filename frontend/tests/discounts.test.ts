import { describe, expect, it } from 'vitest';
import { createDiscountClient, dhakaToday, projectDiscount, projectDiscountPage } from '../src/lib/discounts';

const discount = { id: '11111111-1111-4111-8111-111111111111', targetType: 'CATEGORY',
  targetId: '22222222-2222-4222-8222-222222222222', targetName: 'Antibiotics', productCount: 38,
  kind: 'PERCENTAGE', value: '10', startsOn: '2026-10-10', endsOn: null, status: 'SCHEDULED',
  version: 0, updatedAt: '2026-10-08T09:15:02.123456Z', updatedByUsername: 'admin_demo' };
const page = { items: [discount], page: 0, size: 20, totalItems: 1, counts: { active: 6, scheduled: 2 } };
describe('discount response boundary', () => {
  it('accepts the documented view and counts, projecting only public fields', () => {
    expect(projectDiscount({ ...discount, privateField: 'ignored' })).toEqual(discount);
    expect(projectDiscountPage(page)).toEqual(page);
  });
  it.each([
    { id: 'invalid' }, { status: 'UNKNOWN' }, { value: 10 }, { startsOn: '2026-02-30' },
    { targetType: 'PRODUCT', productCount: 1 }, { kind: 'PERCENTAGE', value: '01' },
    { kind: 'FLAT', value: '1.5' }, { endsOn: '2026-13-01' },
  ])('rejects malformed projections %j', (change) => {
    expect(projectDiscount({ ...discount, ...change })).toBeUndefined();
  });
  it.each([undefined, { active: -1, scheduled: 0 }, { active: 0.5, scheduled: 0 }])(
    'rejects absent or invalid counts %j', (counts) => {
      expect(projectDiscountPage({ ...page, counts })).toBeUndefined();
    },
  );
  it('keeps the Dhaka calendar boundary independent of the browser timezone', () => {
    expect(dhakaToday(new Date('2026-10-09T17:59:59Z'))).toBe('2026-10-09');
    expect(dhakaToday(new Date('2026-10-09T18:00:00Z'))).toBe('2026-10-10');
  });
});
describe('discount client', () => {
  it('sends list, create, update and end through exact bounded contracts', async () => {
    const seen: { path: string; init: RequestInit }[] = [];
    const authenticatedFetch = async <T>(path: string, init: RequestInit, read: (response: Response) => Promise<T>) => {
      seen.push({ path, init });
      return read(Response.json(init.method === 'GET' ? page : discount));
    };
    const client = createDiscountClient({ authenticatedFetch });
    const draft = { id: discount.id, targetType: 'CATEGORY' as const, targetId: discount.targetId,
      kind: 'PERCENTAGE' as const, value: '10', startsOn: discount.startsOn, endsOn: null };
    await client.listDiscounts('ACTIVE', 1);
    await client.createDiscount(draft);
    const update = { kind: draft.kind, value: draft.value, startsOn: draft.startsOn, endsOn: null, version: 0 };
    await client.updateDiscount(discount.id, update);
    await client.endDiscount(discount.id, 0);
    expect(seen.map(({ path, init }) => [path, init.method, init.body && JSON.parse(String(init.body))])).toEqual([
      ['/api/staff/discounts?status=ACTIVE&page=1&size=20', 'GET', undefined],
      ['/api/staff/discounts', 'POST', draft],
      [`/api/staff/discounts/${discount.id}`, 'PUT', update],
      [`/api/staff/discounts/${discount.id}/end`, 'POST', { version: 0 }],
    ]);
  });
  it('reads a full Bengali page above the ordinary JSON cap and refuses oversized replies', async () => {
    const large = { ...page, items: Array(50).fill({ ...discount, targetName: 'ক'.repeat(160) }), size: 50, totalItems: 50 };
    const authenticatedFetch = async <T>(_: string, _init: RequestInit, read: (response: Response) => Promise<T>) => read(Response.json(large));
    await expect(createDiscountClient({ authenticatedFetch }).listDiscounts('ACTIVE')).resolves.toEqual(large);
    const oversized = async <T>(_: string, _init: RequestInit, read: (response: Response) => Promise<T>) => read(Response.json({ junk: 'a'.repeat(256 * 1024) }));
    await expect(createDiscountClient({ authenticatedFetch: oversized }).listDiscounts('ACTIVE')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('preserves bounded API errors without exposing remote message text', async () => {
    const authenticatedFetch = async <T>(_: string, _init: RequestInit, read: (response: Response) => Promise<T>) =>
      read(Response.json({ code: 'DISCOUNT_ENDED', message: 'private' }, { status: 409 }));
    await expect(createDiscountClient({ authenticatedFetch }).listDiscounts('ENDED')).rejects.toMatchObject({ code: 'DISCOUNT_ENDED', status: 409, message: '' });
  });
});
