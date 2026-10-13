import type { APIRequestContext, APIResponse } from '@playwright/test';
import { describe, expect, it, vi } from 'vitest';
import type { ApiActor } from './browser/catalogSupport';
import {
  assertAwayFromDhakaMidnight, dateOffset, dhakaToday, dhakaTomorrow, discountApi, discountBody, discountDraft,
  expectAppliedDiscountShape, expectDiscountError, expectDiscountJson, expectDiscountShape, getDiscountProduct, publicPrice, type AppliedDiscount, type Discount,
} from './browser/discountSupport';

const productId = '00000000-0000-4000-8000-000000000016';
const view: Discount = {
  id: '00000000-0000-4000-8000-000000000017', targetType: 'PRODUCT', targetId: productId,
  targetName: 'Synthetic thermometer', productCount: null, kind: 'PERCENTAGE', value: '10',
  startsOn: '2030-01-15', endsOn: null, status: 'ACTIVE', version: 0,
  updatedAt: '2030-01-15T01:00:00Z', updatedByUsername: 'discount.admin',
};

function reply(body: unknown, status = 200, headers: Record<string, string> = {}): APIResponse {
  return {
    status: () => status,
    headers: () => ({ 'cache-control': 'no-store', 'content-type': 'application/json', 'x-request-id': 'fixture-16', ...headers }),
    json: async () => body,
  } as unknown as APIResponse;
}

describe('Ticket 16 test date fixtures', () => {
  it.each([
    ['2026-10-09T17:59:59Z', '2026-10-09', '2026-10-10'],
    ['2026-10-09T18:00:00Z', '2026-10-10', '2026-10-11'],
    ['2026-12-31T17:59:59Z', '2026-12-31', '2027-01-01'],
    ['2026-12-31T18:00:00Z', '2027-01-01', '2027-01-02'],
    ['2028-02-28T18:00:00Z', '2028-02-29', '2028-03-01'],
  ])('uses Dhaka dates at %s', (instant, today, tomorrow) => {
    const now = new Date(instant);
    expect(dhakaToday(now)).toBe(today);
    expect(dhakaTomorrow(now)).toBe(tomorrow);
  });

  it.each(['17:55:00', '17:56:00', '18:00:00', '18:04:00', '18:05:00'])(
    'refuses %s UTC near Dhaka midnight', (time) => {
      expect(() => assertAwayFromDhakaMidnight(new Date(`2026-10-09T${time}Z`))).toThrow(/17:55–18:05 UTC/);
    });

  it.each(['17:54:00', '18:06:00', '00:00:00', '23:59:59'])(
    'accepts %s UTC outside the guard', (time) => {
      expect(() => assertAwayFromDhakaMidnight(new Date(`2026-10-09T${time}Z`))).not.toThrow();
    });

  it('adds and subtracts calendar days across months and years', () => {
    expect(dateOffset('2028-02-28', 1)).toBe('2028-02-29');
    expect(dateOffset('2028-03-01', -1)).toBe('2028-02-29');
    expect(dateOffset('2026-12-31', 1)).toBe('2027-01-01');
    expect(dateOffset('2027-01-01', -1)).toBe('2026-12-31');
    expect(dateOffset('2026-10-09', 0)).toBe('2026-10-09');
  });
});

describe('Ticket 16 test wire helpers', () => {
  it.each([
    { kind: 'FLAT', value: '0.00' }, { kind: 'FLAT', value: '10000000.00' }, { kind: 'FLAT', value: '020.00' },
    { startsOn: '2031-02-29' }, { endsOn: '2030-02-30' }, { updatedAt: '2030-02-30T01:00:00Z' },
    { updatedAt: '2030-01-15T24:00:00Z' }, { updatedAt: '2030-01-15TgarbageZ' }, { updatedByUsername: false },
  ])('refuses invalid discount projections %j', (change) => {
    expect(() => expectDiscountShape({ ...view, ...change } as unknown as Discount)).toThrow();
  });

  it('bounds applied staff discount keys and rejects invalid nullable projections', () => {
    const applied: AppliedDiscount = { id: view.id, targetType: 'PRODUCT', targetName: view.targetName,
      kind: 'PERCENTAGE', value: '10', saving: '15.00' };
    expect(() => expectAppliedDiscountShape(null)).not.toThrow();
    expect(() => expectAppliedDiscountShape(applied)).not.toThrow();
    expect(() => expectAppliedDiscountShape({ ...applied, kind: 'FLAT', value: '20.00', saving: '20.00' })).not.toThrow();
    for (const invalid of [false, 0, '', undefined,
      { ...applied, actorUserId: view.id }, { ...applied, endedAt: view.updatedAt },
      { ...applied, id: '000000000-000-4000-8000-000000000017' },
      { ...applied, targetType: 'ORDER' }, { ...applied, kind: 'COUPON' },
      { ...applied, targetName: false }, { ...applied, targetName: '' },
      { ...applied, value: '10.00' }, { ...applied, kind: 'FLAT', value: '020.00' },
      { ...applied, kind: 'FLAT', value: '20.00' },
      { ...applied, saving: '0.00' }, { ...applied, saving: '01.00' }, { ...applied, saving: '10000000.00' },
    ]) expect(() => expectAppliedDiscountShape(invalid as AppliedDiscount | null)).toThrow();
  });

  it('refuses corrupt public price projections while accepting null and valid discounts', async () => {
    const body = { productId, sellingPrice: '150.00', mrp: null, price: '150.00', saving: '0.00', discount: null };
    const http = { get: vi.fn().mockResolvedValue(reply(body)) };
    const client = http as unknown as APIRequestContext;
    expect(await publicPrice(client, productId)).toEqual(body);
    const discount = { targetType: 'PRODUCT', kind: 'FLAT', value: '20.00' };
    http.get.mockResolvedValue(reply({ ...body, price: '130.00', saving: '20.00', mrp: '160.00', discount }));
    await publicPrice(client, productId);
    for (const change of [
      { productId: view.id }, { mrp: false }, { mrp: '10000000.00' }, { mrp: '0.00' },
      { price: '0.00' }, { sellingPrice: '01.00' }, { saving: '-1.00' }, { mrp: '149.99' },
      { price: '149.99', saving: '0.00' }, { price: '150.01', saving: '0.00' },
      { price: '135.00', saving: '15.00', discount: null },
      { discount }, { price: '135.00', saving: '14.99', discount },
      { price: '135.00', saving: '15.00', discount },
      ...[false, 0, '', undefined].map((discount) => ({ discount })),
      { discount: { ...discount, targetType: 'ORDER' } }, { discount: { ...discount, kind: 'COUPON' } },
      { discount: { ...discount, value: '0.00' } }, { discount: { ...discount, id: view.id } },
    ]) {
      http.get.mockResolvedValue(reply({ ...body, ...change }));
      await expect(publicPrice(client, productId)).rejects.toThrow();
    }
  });

  it('bounds staff Product and derived-history keys and requires stored-field nulls', async () => {
    const event = {
      actorUsername: null, changeType: 'DISCOUNT_STARTED', occurredAt: '2030-01-14T18:00:00Z',
      oldSellingPrice: null, newSellingPrice: null, oldMrp: null, newMrp: null,
      oldRequireValidation: null, newRequireValidation: null,
      discount: { targetType: 'PRODUCT', kind: 'PERCENTAGE', value: '10' },
    };
    const product = {
      id: productId, kind: 'EQUIPMENT', name: 'Synthetic thermometer', brandName: null, genericName: null,
      dosageForm: null, manufacturer: null, categoryId: view.id, categoryName: 'Synthetic equipment', saleUnit: 'Each',
      sellingPrice: '150.00', mrp: null, active: true, requireValidation: false, status: 'ACTIVE', description: null,
      version: 0, updatedAt: view.updatedAt, updatedByUsername: null, effectivePrice: '135.00',
      appliedDiscount: { id: view.id, targetType: 'PRODUCT', targetName: view.targetName,
        kind: 'PERCENTAGE', value: '10', saving: '15.00' },
      history: [event],
    };
    const actor = { get: vi.fn().mockResolvedValue(reply(product)) };
    await getDiscountProduct(actor as unknown as ApiActor, productId);
    for (const change of [
      { diagnostic: 'private' }, { id: view.id }, { effectivePrice: null }, { effectivePrice: '135.01' },
      { effectivePrice: '0.00' }, { sellingPrice: '150.0' }, { mrp: '149.99' }, { appliedDiscount: null },
      { sellingPrice: null }, { sellingPrice: null, effectivePrice: null },
      { appliedDiscount: { ...product.appliedDiscount, kind: 'FLAT', value: '20.00' } },
      { history: [{ ...event, changeType: 'COUPON_APPLIED', discount: null }] },
      ...['', null, {}, { length: 0 }, false, 0, undefined].map((history) => ({ history })),
      ...[false, 0, '', undefined].map((appliedDiscount) => ({ appliedDiscount })),
      { appliedDiscount: { id: view.id, targetType: 'PRODUCT', targetName: view.targetName,
        kind: 'PERCENTAGE', value: '10', saving: '15.00', actorUserId: view.id } }, { history: Array(21).fill(event) },
      { history: [{ ...event, discountId: view.id }] }, { history: [{ ...event, newMrp: '150.00' }] },
      { history: [{ ...event, oldRequireValidation: false }] }, { history: [{ ...event, discount: null }] },
      { history: [{ ...event, discount: { ...event.discount, value: '10.00' } }] },
      { history: [{ ...event, changeType: 'CREATED' }] },
    ]) {
      actor.get.mockResolvedValue(reply({ ...product, ...change }));
      await expect(getDiscountProduct(actor as unknown as ApiActor, productId)).rejects.toThrow();
    }
    for (const change of [
      { effectivePrice: '150.00', appliedDiscount: null },
      { effectivePrice: '130.00', appliedDiscount: { ...product.appliedDiscount, kind: 'FLAT', value: '20.00', saving: '20.00' } },
      { sellingPrice: null, effectivePrice: null, appliedDiscount: null },
      { history: [{ ...event, changeType: 'CREATED', discount: null }] },
      { history: [{ ...event, changeType: 'DISCOUNT_ENDED' }] }, { history: [] },
    ]) {
      actor.get.mockResolvedValue(reply({ ...product, ...change }));
      await getDiscountProduct(actor as unknown as ApiActor, productId);
    }
    actor.get.mockResolvedValue(reply({ ...product, sellingPrice: '0.05', effectivePrice: '0.02',
      appliedDiscount: { ...product.appliedDiscount, value: '50', saving: '0.03' } }));
    await getDiscountProduct(actor as unknown as ApiActor, productId);
  });

  it('rejects a malformed UUID with thirty-six characters and incorrect group lengths', () => {
    expect(() => expectDiscountShape(view)).not.toThrow();
    const malformed = '000000000-000-4000-8000-000000000017';
    expect(malformed).toHaveLength(36);
    expect(() => expectDiscountShape({ ...view, id: malformed })).toThrow();
    expect(() => expectDiscountShape({ ...view, targetId: malformed })).toThrow();
  });

  it('creates independent ids and keeps money and dates as strings', () => {
    const first = discountDraft('PRODUCT', productId);
    const second = discountDraft('PRODUCT', productId);
    expect(first.id).not.toBe(second.id);
    expect(first).toMatchObject({ targetType: 'PRODUCT', targetId: productId, kind: 'PERCENTAGE', value: '10', endsOn: null });
    expect(first.startsOn).toBe(dhakaToday());
    expect(discountDraft('CATEGORY', productId, { id: view.id, kind: 'FLAT', value: '12.34', startsOn: '2030-01-15' }))
      .toMatchObject({ id: view.id, kind: 'FLAT', value: '12.34', startsOn: '2030-01-15', targetType: 'CATEGORY' });
  });

  it('sends only editable fields and version, excluding target and server fields', () => {
    expect(discountBody(view, { value: '20', version: 2 })).toEqual({
      kind: 'PERCENTAGE', value: '20', startsOn: '2030-01-15', endsOn: null, version: 2,
    });
  });

  it('uses exact create/update/end routes and full update bodies', async () => {
    const updated = { ...view, value: '20', version: 1 } as Discount;
    const ended = { ...updated, status: 'ENDED', version: 2 } as Discount;
    const actor = {
      post: vi.fn().mockResolvedValueOnce(reply(view, 201)).mockResolvedValueOnce(reply(ended)),
      put: vi.fn().mockResolvedValue(reply(updated)),
    };
    const client = discountApi(actor as unknown as ApiActor);
    const draft = discountDraft('PRODUCT', productId, { id: view.id, startsOn: view.startsOn });
    expect(await client.create(draft)).toEqual(view);
    expect(actor.post).toHaveBeenNthCalledWith(1, '/api/staff/discounts', draft);
    expect(await client.update(view, { value: '20' })).toEqual(updated);
    expect(actor.put).toHaveBeenCalledWith(`/api/staff/discounts/${view.id}`, discountBody(view, { value: '20' }));
    expect(await client.end(updated)).toEqual(ended);
    expect(actor.post).toHaveBeenNthCalledWith(2, `/api/staff/discounts/${view.id}/end`, { version: 1 });
  });

  it('uses the plan page defaults and validates tab counts and exact page shape', async () => {
    const page = { items: [view], page: 0, size: 20, totalItems: 1, counts: { active: 1, scheduled: 0 } };
    const actor = { get: vi.fn().mockResolvedValue(reply(page)) };
    expect(await discountApi(actor as unknown as ApiActor).list('ACTIVE')).toEqual(page);
    expect(actor.get).toHaveBeenCalledWith('/api/staff/discounts?status=ACTIVE&page=0&size=20');
    actor.get.mockResolvedValue(reply({ ...page, page: 2, size: 50, items: [] }));
    await discountApi(actor as unknown as ApiActor).list('ACTIVE', 2, 50);
    expect(actor.get).toHaveBeenLastCalledWith('/api/staff/discounts?status=ACTIVE&page=2&size=50');
    const empty = { ...page, items: [], totalItems: 0, counts: { active: 0, scheduled: 0 } };
    actor.get.mockResolvedValue(reply(empty));
    expect(await discountApi(actor as unknown as ApiActor).list('ACTIVE')).toEqual(empty);
    for (const items of ['', null, {}, { length: 0 }, false, 0, undefined]) {
      actor.get.mockResolvedValue(reply({ ...empty, items }));
      await expect(discountApi(actor as unknown as ApiActor).list('ACTIVE')).rejects.toThrow();
    }
    actor.get.mockResolvedValue(reply({ ...page, counts: { active: -1, scheduled: 0 } }));
    await expect(discountApi(actor as unknown as ApiActor).list('ACTIVE')).rejects.toThrow();
    actor.get.mockResolvedValue(reply({ ...page, diagnostics: 'private' }));
    await expect(discountApi(actor as unknown as ApiActor).list('ACTIVE')).rejects.toThrow();
  });

  it('requires no-store and request correlation for successful responses', async () => {
    expect(await expectDiscountJson(reply(view), 200)).toEqual(view);
    await expect(expectDiscountJson(reply(view, 200, { 'cache-control': 'public' }), 200)).rejects.toThrow();
    await expect(expectDiscountJson(reply(view, 200, { 'x-request-id': '' }), 200)).rejects.toThrow();
  });

  it('holds 400 errors to exactly the same bounded envelope as other errors', async () => {
    const error = { code: 'INVALID_REQUEST', message: 'The request is invalid.', requestId: 'fixture-16' };
    await expectDiscountError(reply(error, 400), 400, 'INVALID_REQUEST');
    await expect(expectDiscountError(reply({ ...error, fields: ['value'] }, 400), 400, 'INVALID_REQUEST')).rejects.toThrow();
    await expect(expectDiscountError(reply({ ...error, requestId: 'wrong' }, 400), 400, 'INVALID_REQUEST')).rejects.toThrow();
  });
});
