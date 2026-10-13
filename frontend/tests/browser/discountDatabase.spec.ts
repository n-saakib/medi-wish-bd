import { randomUUID } from 'node:crypto';
import {
  activeProduct, createCategory, equipmentDraft, expect, test, token, type ApiActor,
} from './catalogSupport';
import {
  allDiscounts, assertAwayFromDhakaMidnight, dateOffset, dhakaToday, discountApi, discountBody, discountDraft,
  expectDiscountError, expectDiscountJson, getDiscountProduct, publicPrice, type Discount,
} from './discountSupport';
import { checkedTarget, psql, rolledBackSql, tableFingerprints } from './testApi';

test.beforeEach(() => assertAwayFromDhakaMidnight());

function discountId(id: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error('Discount database probes accept only fixture UUIDs');
  }
  return id;
}

type DiscountAudit = {
  changeType: string; requestId: string | null; actor: string | null;
  snapshot: Record<string, unknown>;
};

function audit(id: string): DiscountAudit[] {
  const schema = checkedTarget('discount audit');
  return JSON.parse(psql(`SELECT coalesce(json_agg(row_to_json(c)), '[]') FROM (`
    + ` SELECT d.change_type AS "changeType", d.request_id AS "requestId", u.username AS actor, row_to_json(d) AS snapshot`
    + ` FROM ${schema}.discount_changes d LEFT JOIN ${schema}.users u ON u.id = d.actor_user_id`
    + ` WHERE discount_id = '${discountId(id)}' ORDER BY occurred_at, d.id) c;`));
}

async function fixture(admin: ApiActor) {
  const category = await createCategory(admin, `Discount schema ${token()}`);
  const product = await activeProduct(admin, equipmentDraft(category.id), '100.00', '150.00');
  const discounts = discountApi(admin);
  const draft = discountDraft('PRODUCT', product.id);
  const discount = await discounts.create(draft);
  return { category, product, discounts, draft, discount };
}

test('discount schema exposes only the planned tables, finite decimal types and named indexes', { tag: ['@t16', '@t16-T4'] }, async () => {
  const schema = checkedTarget('discount schema');
  const tables = psql(`SELECT table_name FROM information_schema.tables WHERE table_schema = '${schema}'`
    + " AND table_name IN ('discounts','discount_changes') ORDER BY table_name;").split(/\r?\n/);
  expect(tables).toEqual(['discount_changes', 'discounts']);
  const columns = JSON.parse(psql(`SELECT json_object_agg(column_name, row_to_json(c)) FROM (`
    + ` SELECT column_name, data_type, numeric_precision, numeric_scale, is_nullable`
    + ` FROM information_schema.columns WHERE table_schema = '${schema}' AND table_name = 'discounts') c;`));
  expect(Object.keys(columns).sort()).toEqual([
    'amount', 'category_id', 'created_at', 'created_by', 'ended_at', 'ends_on', 'id', 'kind', 'percent', 'product_id',
    'starts_on', 'target_type', 'updated_at', 'updated_by', 'version',
  ]);
  expect(columns.percent).toMatchObject({ data_type: 'numeric', numeric_precision: 4, numeric_scale: 2 });
  expect(columns.amount).toMatchObject({ data_type: 'numeric', numeric_precision: 9, numeric_scale: 2 });
  expect(columns.version).toMatchObject({ data_type: 'bigint', is_nullable: 'NO' });
  expect(columns.starts_on.data_type).toBe('date');
  expect(columns.ended_at.data_type).toBe('timestamp with time zone');
  const typeCheck = psql(`SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE connamespace = '${schema}'::regnamespace`
    + " AND conname = 'ck_discounts_target_type';");
  expect(typeCheck).toContain('PRODUCT');
  expect(typeCheck).toContain('CATEGORY');
  const indexes = psql(`SELECT indexname FROM pg_indexes WHERE schemaname = '${schema}'`
    + " AND tablename IN ('discounts','discount_changes') ORDER BY indexname;").split(/\r?\n/);
  for (const index of ['ix_discounts_product', 'ix_discounts_category', 'ix_discounts_starts', 'ix_discount_changes_discount']) {
    expect(indexes).toContain(index);
  }
  const definitions = psql(`SELECT indexname || ':' || indexdef FROM pg_indexes WHERE schemaname = '${schema}'`
    + " AND indexname IN ('ix_discounts_product','ix_discounts_category');");
  expect(definitions).toContain('WHERE (product_id IS NOT NULL)');
  expect(definitions).toContain('WHERE (category_id IS NOT NULL)');
  expect(psql(`SELECT count(*) FROM ${schema}.databasechangelog WHERE id = '016-discounts';`)).toBe('1');
});

test('discount database named checks reject invalid targets, kinds, values, nonfinite numbers and dates', { tag: ['@t16', '@t16-T4'] }, async ({ actors }) => {
  const admin = await actors('admin');
  const { category, discount } = await fixture(admin);
  const cases = [
    ['ck_discounts_target_type', "target_type = 'ORDER'"],
    ['ck_discounts_target', `category_id = '${category.id}'`],
    ['ck_discounts_target', 'product_id = NULL'],
    ['ck_discounts_kind', "kind = 'COUPON'"],
    ['ck_discounts_value', 'amount = 1.00'],
    ['ck_discounts_value', 'percent = NULL'],
    ['ck_discounts_percent_range', 'percent = 0'],
    ['ck_discounts_percent_range', 'percent = 99.50'],
    ['ck_discounts_percent_range', 'percent = 1.50'],
    ['ck_discounts_percent_range', 'percent = 98.50'],
    ['ck_discounts_percent_range', "percent = 'NaN'"],
    ['ck_discounts_amount_range', "kind = 'FLAT', percent = NULL, amount = 0"],
    ['ck_discounts_amount_range', "kind = 'FLAT', percent = NULL, amount = -1"],
    ['ck_discounts_amount_range', "kind = 'FLAT', percent = NULL, amount = 'NaN'"],
    ['ck_discounts_dates', "ends_on = starts_on - 1"],
  ];
  for (const [constraint, change] of cases) {
    const outcome = rolledBackSql(`\\set VERBOSITY verbose\nUPDATE discounts SET ${change} WHERE id = '${discountId(discount.id)}';`);
    expect(outcome.error).toContain('23514');
    // An unknown target type also breaks the paired-target check; PostgreSQL may report that check first.
    if (constraint === 'ck_discounts_target_type') expect(outcome.error).toMatch(/ck_discounts_target(?:_type)?/);
    else expect(outcome.error).toContain(constraint);
  }
  for (const percent of [1, 99]) {
    const outcome = rolledBackSql(`UPDATE discounts SET percent = ${percent} WHERE id = '${discount.id}';`);
    expect(outcome.error).toBe('');
  }
  for (const change of ['percent = 100', "kind = 'FLAT', percent = NULL, amount = 10000000.00"]) {
    const outcome = rolledBackSql(`\\set VERBOSITY verbose\nUPDATE discounts SET ${change} WHERE id = '${discount.id}';`);
    expect(outcome.error).toContain('22003');
  }
  const invalidAudit = rolledBackSql(`\\set VERBOSITY verbose\nUPDATE discount_changes SET change_type = 'DELETED' WHERE discount_id = '${discount.id}';`);
  expect(invalidAudit.error).toContain('23514');
  expect(invalidAudit.error).toContain('ck_discount_changes_type');
  expect(audit(discount.id).map((entry) => entry.changeType)).toEqual(['CREATED']);
});

test('discount foreign keys restrict deletion independently of existing catalog references', { tag: ['@t16', '@t16-T4'] }, async ({ actors }) => {
  const admin = await actors('admin');
  const { product, discount, discounts } = await fixture(admin);
  // Remove Product audit rows only inside the rollback probe, otherwise their existing FK masks the new one.
  const productDelete = rolledBackSql('\\set VERBOSITY verbose\n'
    + `DELETE FROM product_changes WHERE product_id = '${product.id}'; DELETE FROM products WHERE id = '${product.id}';`);
  expect(productDelete.error).toContain('23001');
  expect(productDelete.error).toContain('discounts');
  const emptyCategory = await createCategory(admin);
  const categoryDiscount = await discounts.create(discountDraft('CATEGORY', emptyCategory.id));
  const categoryDelete = rolledBackSql(`\\set VERBOSITY verbose\nDELETE FROM product_categories WHERE id = '${emptyCategory.id}';`);
  expect(categoryDelete.error).toContain('23001');
  expect(categoryDelete.error).toContain('discounts');
  const afterRemoval = rolledBackSql(`DELETE FROM discount_changes WHERE discount_id = '${categoryDiscount.id}';`
    + ` DELETE FROM discounts WHERE id = '${categoryDiscount.id}'; DELETE FROM product_categories WHERE id = '${emptyCategory.id}';`);
  expect(afterRemoval.error).toBe('');
  const auditPinsDiscount = rolledBackSql(`\\set VERBOSITY verbose\nDELETE FROM discounts WHERE id = '${discount.id}';`);
  expect(auditPinsDiscount.error).toContain('23001');
  expect(auditPinsDiscount.error).toContain('discount_changes');
  expect((await getDiscountProduct(admin, product.id)).sellingPrice).toBe('100.00');
});

test('discount create/edit/end preserve full historical audit snapshots and write only discount tables', { tag: ['@t16', '@t16-T6'] }, async ({ actors }) => {
  const admin = await actors('admin');
  const category = await createCategory(admin);
  const product = await activeProduct(admin, equipmentDraft(category.id), '100.00', '150.00');
  const today = dhakaToday();
  const draft = discountDraft('PRODUCT', product.id, {
    startsOn: dateOffset(today, 1), endsOn: dateOffset(today, 3),
  });
  const schema = checkedTarget('discount writes');
  const productBefore = psql(`SELECT row_to_json(p) FROM ${schema}.products p WHERE id = '${product.id}';`);
  const unchanged = tableFingerprints(['discounts', 'discount_changes', 'user_sessions', 'user_session_refresh_tokens',
    'databasechangelog', 'databasechangeloglock']);
  const createResponse = await admin.post('/api/staff/discounts', draft);
  const discount = await expectDiscountJson<Discount>(createResponse, 201);
  const createdAudit = audit(discount.id);
  expect(createdAudit).toHaveLength(1);
  expect(createdAudit[0]).toMatchObject({ changeType: 'CREATED', actor: admin.username,
    requestId: createResponse.headers()['x-request-id'], snapshot: { discount_id: discount.id,
      kind: 'PERCENTAGE', percent: 10, amount: null, starts_on: draft.startsOn, ends_on: draft.endsOn } });

  const edit = discountBody(discount, { kind: 'FLAT', value: '25.35',
    startsOn: dateOffset(today, 2), endsOn: dateOffset(today, 4) });
  const updateResponse = await admin.put(`/api/staff/discounts/${discount.id}`, edit);
  const updated = await expectDiscountJson<Discount>(updateResponse, 200);
  const updatedAudit = audit(discount.id);
  expect(updatedAudit).toHaveLength(2);
  expect(updatedAudit.slice(0, 1)).toEqual(createdAudit);
  expect(updatedAudit[1]).toMatchObject({ changeType: 'UPDATED', actor: admin.username,
    requestId: updateResponse.headers()['x-request-id'], snapshot: { discount_id: discount.id,
      kind: 'FLAT', percent: null, amount: 25.35, starts_on: edit.startsOn, ends_on: edit.endsOn } });
  const beforeUpdateReplay = tableFingerprints(['user_sessions', 'user_session_refresh_tokens']);
  expect(await expectDiscountJson<Discount>(await admin.put(`/api/staff/discounts/${discount.id}`, edit), 200)).toEqual(updated);
  expect(audit(discount.id)).toEqual(updatedAudit);
  expect(tableFingerprints(['user_sessions', 'user_session_refresh_tokens'])).toEqual(beforeUpdateReplay);

  const endResponse = await admin.post(`/api/staff/discounts/${updated.id}/end`, { version: updated.version });
  const ended = await expectDiscountJson<Discount>(endResponse, 200);
  const endedAudit = audit(discount.id);
  expect(endedAudit).toHaveLength(3);
  expect(endedAudit.slice(0, 2)).toEqual(updatedAudit);
  expect(endedAudit[2]).toMatchObject({ changeType: 'ENDED', actor: admin.username,
    requestId: endResponse.headers()['x-request-id'], snapshot: { discount_id: discount.id,
      kind: 'FLAT', percent: null, amount: 25.35, starts_on: edit.startsOn, ends_on: edit.endsOn } });
  // PostgreSQL compares instants at the persisted TIMESTAMPTZ precision, independent of JSON spelling or timezone.
  for (const [changeType, view] of [['CREATED', discount], ['UPDATED', updated], ['ENDED', ended]] as const) {
    expect(view.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/);
    expect(psql(`SELECT count(*) FROM ${schema}.discount_changes WHERE discount_id = '${discountId(discount.id)}'`
      + ` AND change_type = '${changeType}' AND occurred_at = '${view.updatedAt}'::timestamptz;`)).toBe('1');
  }
  const beforeEndReplay = tableFingerprints(['user_sessions', 'user_session_refresh_tokens']);
  expect(await expectDiscountJson<Discount>(await admin.post(`/api/staff/discounts/${discount.id}/end`,
    { version: updated.version }), 200)).toEqual(ended);
  expect(audit(discount.id)).toEqual(endedAudit);
  expect(tableFingerprints(['user_sessions', 'user_session_refresh_tokens'])).toEqual(beforeEndReplay);
  expect(tableFingerprints(['discounts', 'discount_changes', 'user_sessions', 'user_session_refresh_tokens',
    'databasechangelog', 'databasechangeloglock'])).toEqual(unchanged);
  expect(psql(`SELECT row_to_json(p) FROM ${schema}.products p WHERE id = '${product.id}';`)).toBe(productBefore);
  expect(psql(`SELECT count(*) FROM ${schema}.product_changes WHERE product_id = '${product.id}'`
    + " AND change_type IN ('DISCOUNT_STARTED','DISCOUNT_ENDED');")).toBe('0');
});

test('discount replay after a lost response never duplicates writes or audit after update/end', { tag: ['@t16', '@t16-T6'] }, async ({ actors }) => {
  const admin = await actors('admin');
  const { discount, draft, discounts } = await fixture(admin);
  const createReplay = await admin.post('/api/staff/discounts', draft);
  expect(await expectDiscountJson<Discount>(createReplay, 200)).toEqual(discount);
  expect(audit(discount.id).map((entry) => entry.changeType)).toEqual(['CREATED']);
  const updated = await discounts.update(discount, { kind: 'FLAT', value: '20.00' });
  const beforeUpdateReplay = tableFingerprints(['user_sessions', 'user_session_refresh_tokens']);
  expect(await expectDiscountJson<Discount>(await admin.put(`/api/staff/discounts/${discount.id}`,
    discountBody(discount, { kind: 'FLAT', value: '20.00' })), 200)).toEqual(updated);
  expect(tableFingerprints(['user_sessions', 'user_session_refresh_tokens'])).toEqual(beforeUpdateReplay);
  const ended = await discounts.end(updated);
  const beforeEndReplay = tableFingerprints(['user_sessions', 'user_session_refresh_tokens']);
  expect(await expectDiscountJson<Discount>(await admin.post(`/api/staff/discounts/${discount.id}/end`, { version: 0 }), 200)).toEqual(ended);
  expect(await expectDiscountJson<Discount>(await admin.put(`/api/staff/discounts/${discount.id}`, discountBody(updated)), 200)).toEqual(ended);
  expect(await expectDiscountJson<Discount>(await admin.post('/api/staff/discounts',
    { ...draft, kind: updated.kind, value: updated.value }), 200)).toEqual(ended);
  expect(tableFingerprints(['user_sessions', 'user_session_refresh_tokens'])).toEqual(beforeEndReplay);
  expect(audit(discount.id).map((entry) => entry.changeType)).toEqual(['CREATED', 'UPDATED', 'ENDED']);
});

test('discount dates in stored fixtures enforce inclusive today and date-ended replay without persisted events', { tag: ['@t16', '@t16-T5'] }, async ({ actors, api }) => {
  const admin = await actors('admin');
  const { product, discounts } = await fixture(admin);
  const schema = checkedTarget('discount historical fixture');
  const inclusive = await discounts.create(discountDraft('PRODUCT', product.id, { value: '20', endsOn: dhakaToday() }));
  expect((await publicPrice(api, product.id)).price).toBe('80.00');
  await discounts.end(inclusive);
  const historical = await discounts.create(discountDraft('PRODUCT', product.id, { value: '30' }));
  expect((await publicPrice(api, product.id)).price).toBe('70.00');
  // This synthetic fixture is backdated directly; the production calendar is neither replaced nor advanced.
  const yesterday = dateOffset(dhakaToday(), -1);
  psql(`UPDATE ${schema}.discounts SET starts_on = '${yesterday}', ends_on = '${yesterday}' WHERE id = '${historical.id}';`);
  const storedBeforeRead = tableFingerprints(['user_sessions', 'user_session_refresh_tokens']);
  // The fixture's original active 10% remains; expired 30% must no longer win.
  expect((await publicPrice(api, product.id)).price).toBe('90.00');
  expect((await getDiscountProduct(admin, product.id)).effectivePrice).toBe('90.00');
  const ended = (await allDiscounts(admin, 'ENDED')).find((item) => item.id === historical.id)!;
  expect(ended).toMatchObject({ status: 'ENDED', version: historical.version });
  const history = (await getDiscountProduct(admin, product.id)).history.filter((entry) => entry.discount?.value === '30');
  expect(history).toEqual([
    expect.objectContaining({ changeType: 'DISCOUNT_ENDED', actorUsername: null,
      occurredAt: `${yesterday}T18:00:00Z`, discount: { targetType: 'PRODUCT', kind: 'PERCENTAGE', value: '30' } }),
    expect.objectContaining({ changeType: 'DISCOUNT_STARTED', actorUsername: null,
      occurredAt: `${dateOffset(yesterday, -1)}T18:00:00Z`, discount: { targetType: 'PRODUCT', kind: 'PERCENTAGE', value: '30' } }),
  ]);
  const pastDraft = discountDraft('PRODUCT', product.id, { id: historical.id, value: '30', startsOn: yesterday, endsOn: yesterday });
  expect(await expectDiscountJson<Discount>(await admin.post('/api/staff/discounts', pastDraft), 200)).toEqual(ended);
  await expectDiscountError(await admin.put(`/api/staff/discounts/${historical.id}`, discountBody(ended, { value: '40' })), 409, 'DISCOUNT_ENDED');
  expect(await expectDiscountJson<Discount>(await admin.post(`/api/staff/discounts/${historical.id}/end`, { version: 999 }), 200)).toEqual(ended);
  expect(tableFingerprints(['user_sessions', 'user_session_refresh_tokens'])).toEqual(storedBeforeRead);
  expect(audit(historical.id).map((entry) => entry.changeType)).toEqual(['CREATED']);
});

test('discount same-target ties prefer earlier start then UUID string order instead of signed UUID comparison', { tag: ['@t16', '@t16-T5'] }, async ({ actors }) => {
  const admin = await actors('admin');
  const { product, discounts } = await fixture(admin);
  const schema = checkedTarget('discount tie fixture');
  const suffix = randomUUID().slice(-12);
  const low = await discounts.create(discountDraft('PRODUCT', product.id, { id: `00000000-0000-4000-8000-${suffix}` }));
  const high = await discounts.create(discountDraft('PRODUCT', product.id, { id: `80000000-0000-4000-8000-${suffix}` }));
  expect((await getDiscountProduct(admin, product.id)).appliedDiscount?.id).toBe(low.id);
  psql(`UPDATE ${schema}.discounts SET starts_on = '${dateOffset(dhakaToday(), -1)}' WHERE id = '${high.id}';`);
  expect((await getDiscountProduct(admin, product.id)).appliedDiscount?.id).toBe(high.id);
});

test('discount derived history stays capped at twenty and cannot be stored as Product changes', { tag: ['@t16', '@t16-T5'] }, async ({ actors }) => {
  const admin = await actors('admin');
  const { product, discounts } = await fixture(admin);
  const schema = checkedTarget('discount history bound');
  const stored = (await getDiscountProduct(admin, product.id)).history.filter((entry) => entry.discount === null);
  // The known catalog fixture creates exactly these stored rows; do not let a dropped-row response define the oracle.
  expect(stored.map((entry) => entry.changeType).sort()).toEqual(['ACTIVATED', 'CREATED', 'PRICE_CHANGED']);
  expect(stored.every((entry) => entry.actorUsername === admin.username)).toBe(true);
  expect(stored.find((entry) => entry.changeType === 'CREATED')).toMatchObject({
    oldSellingPrice: null, newSellingPrice: null, oldMrp: null, newMrp: null,
    oldRequireValidation: null, newRequireValidation: false,
  });
  expect(stored.find((entry) => entry.changeType === 'PRICE_CHANGED')).toMatchObject({
    oldSellingPrice: null, newSellingPrice: '100.00', oldMrp: null, newMrp: '150.00',
    oldRequireValidation: false, newRequireValidation: false,
  });
  expect(stored.find((entry) => entry.changeType === 'ACTIVATED')).toMatchObject({
    oldSellingPrice: '100.00', newSellingPrice: '100.00', oldMrp: '150.00', newMrp: '150.00',
    oldRequireValidation: false, newRequireValidation: false,
  });
  // Java Instant omits zero fractions; normalize that spelling without truncating nonzero fractions.
  const event = (entry: (typeof stored)[number]) => ({
    ...entry, occurredAt: entry.occurredAt.replace(/\.0+Z$/, 'Z'),
  });
  const expected = stored.map(event);
  const today = dhakaToday();
  const midnight = Date.parse(`${dateOffset(today, -1)}T18:00:00Z`);
  // Give the ended fixtures distinct instants after today's midnight but before the real catalog writes.
  // The date guard leaves at least five minutes on either side of midnight; starts are yesterday.
  for (let index = 0; index < 21; index += 1) {
    const value = String(index + 1);
    const discount = await discounts.create(discountDraft('PRODUCT', product.id, { value }));
    await discounts.end(discount);
    const endedAt = new Date(midnight + (index + 1) * 1000).toISOString();
    psql(`UPDATE ${schema}.discounts SET starts_on = '${dateOffset(today, -1)}', ended_at = '${endedAt}'`
      + ` WHERE id = '${discountId(discount.id)}';`);
    expected.push(event({ occurredAt: endedAt, actorUsername: admin.username, changeType: 'DISCOUNT_ENDED',
      discount: { targetType: 'PRODUCT', kind: 'PERCENTAGE', value },
      oldSellingPrice: null, newSellingPrice: null, oldMrp: null, newMrp: null,
      oldRequireValidation: null, newRequireValidation: null }));
  }
  const history = (await getDiscountProduct(admin, product.id)).history;
  expect(history.map(event)).toEqual(expected.sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt)).slice(0, 20));
  for (const changeType of ['DISCOUNT_STARTED', 'DISCOUNT_ENDED']) {
    const outcome = rolledBackSql(`\\set VERBOSITY verbose\nUPDATE product_changes SET change_type = '${changeType}' WHERE product_id = '${product.id}';`);
    expect(outcome.error).toContain('23514');
    expect(outcome.error).toContain('ck_product_changes_type');
  }
  expect(psql(`SELECT count(*) FROM ${schema}.product_changes WHERE product_id = '${product.id}'`
    + " AND change_type IN ('DISCOUNT_STARTED','DISCOUNT_ENDED');")).toBe('0');
});
