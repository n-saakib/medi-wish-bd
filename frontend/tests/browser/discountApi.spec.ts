import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  activeProduct, createCategory, createProduct, equipmentDraft, expect, findCategory, listProducts, priceProduct, sendJson,
  test, token, updateCategory, updateProduct, type ActorKind, type ApiActor,
} from './catalogSupport';
import {
  allDiscounts, appliedDiscountKeys, assertAwayFromDhakaMidnight, dateOffset, dhakaToday, dhakaTomorrow,
  discountApi, discountBody, discountDraft, expectAppliedDiscountShape, expectDiscountError, expectDiscountJson, getDiscountProduct,
  historyDiscountKeys, publicPrice, type Discount, type DiscountDraft, type DiscountProduct, type PublicPrice,
} from './discountSupport';
import { ApiSession } from './apiSession';
import { accessTokenLifetimeMs, apiLogPath, checkedTarget, frontendUrl, psql, tableFingerprints } from './testApi';

test.beforeEach(() => assertAwayFromDhakaMidnight());

async function pricedFixture(admin: ApiActor, selling = '150.00', mrp: string | null = null) {
  const category = await createCategory(admin, `Discount category ${token()}`);
  const product = await activeProduct(admin, equipmentDraft(category.id, { name: `Discount product ${token()}` }), selling, mrp);
  return { category, product, discounts: discountApi(admin) };
}

function expectPrice(view: DiscountProduct, price: string, applied: Discount | null, saving = '0.00'): void {
  expect(view.effectivePrice).toBe(price);
  if (!applied) { expect(view.appliedDiscount).toBeNull(); return; }
  expect(Object.keys(view.appliedDiscount!).sort()).toEqual(appliedDiscountKeys);
  expect(view.appliedDiscount).toEqual({
    id: applied.id, targetType: applied.targetType, targetName: applied.targetName,
    kind: applied.kind, value: applied.value, saving,
  });
}

test('E2E-16-01 all discount routes require an MFA-verified Admin', { tag: ['@t16', '@t16-T4'] }, async ({ actors, api }) => {
  const admin = await actors('admin');
  const { product, discounts } = await pricedFixture(admin);
  const draft = discountDraft('PRODUCT', product.id);
  const discount = await discounts.create(draft);
  const commands = [
    { method: 'GET' as const, path: '/api/staff/discounts?status=ACTIVE' },
    { method: 'POST' as const, path: '/api/staff/discounts', body: { ...draft, id: randomUUID() } },
    { method: 'PUT' as const, path: `/api/staff/discounts/${discount.id}`, body: discountBody(discount, { value: '20' }) },
    { method: 'POST' as const, path: `/api/staff/discounts/${discount.id}/end`, body: { version: discount.version } },
  ];
  const before = tableFingerprints(['user_sessions', 'user_session_refresh_tokens']);
  for (const command of commands) {
    await expectDiscountError(await sendJson(api, command.method, command.path, command.body), 401, 'AUTHENTICATION_REQUIRED');
  }
  expect(tableFingerprints(['user_sessions', 'user_session_refresh_tokens'])).toEqual(before);
  for (const kind of ['customer', 'deliveryPerson', 'moderator', 'restrictedStaff'] as ActorKind[]) {
    const actor = await actors(kind);
    const unchanged = tableFingerprints(['user_sessions', 'user_session_refresh_tokens']);
    for (const command of commands) {
      await expectDiscountError(await actor.send(command.method, command.path, command.body), 403,
        kind === 'restrictedStaff' ? 'MFA_REQUIRED' : 'ACCESS_DENIED');
    }
    expect(tableFingerprints(['user_sessions', 'user_session_refresh_tokens'])).toEqual(unchanged);
  }
  const moderator = await actors('moderator');
  expectPrice(await getDiscountProduct(moderator, product.id), '135.00', discount, '15.00');
});

test('discount CORS preflights permit the frontend JSON command methods without credentials',
  { tag: ['@t16', '@t16-T4'] }, async ({ api }) => {
    const id = randomUUID();
    for (const [method, path] of [
      ['POST', '/api/staff/discounts'], ['PUT', `/api/staff/discounts/${id}`],
      ['POST', `/api/staff/discounts/${id}/end`],
    ]) {
      const response = await api.fetch(path, { method: 'OPTIONS', headers: {
        Origin: frontendUrl, 'Access-Control-Request-Method': method,
        'Access-Control-Request-Headers': 'authorization,content-type',
      } });
      expect(response.status()).toBe(200);
      expect(response.headers()['access-control-allow-origin']).toBe(frontendUrl);
      expect(response.headers()['access-control-allow-methods'].split(/\s*,\s*/)).toContain(method);
      const headers = response.headers()['access-control-allow-headers'].toLowerCase().split(/\s*,\s*/);
      expect(headers).toContain('authorization');
      expect(headers).toContain('content-type');
    }
  });

test('discount authorization and MFA are checked before oversized POST, PUT and end bodies',
  { tag: ['@t16', '@t16-T6'] }, async ({ actors, api }) => {
    const admin = await actors('admin');
    const moderator = await actors('moderator');
    const restricted = await actors('restrictedStaff');
    const { product, discounts } = await pricedFixture(admin);
    const discount = await discounts.create(discountDraft('PRODUCT', product.id));
    const oversized = { padding: 'x'.repeat(17 * 1024) };
    const commands = [
      ['POST' as const, '/api/staff/discounts'], ['PUT' as const, `/api/staff/discounts/${discount.id}`],
      ['POST' as const, `/api/staff/discounts/${discount.id}/end`],
    ] as const;
    const baseline = tableFingerprints(['user_sessions', 'user_session_refresh_tokens']);
    for (const [method, path] of commands) {
      await expectDiscountError(await sendJson(api, method, path, oversized), 401, 'AUTHENTICATION_REQUIRED');
      await expectDiscountError(await moderator.send(method, path, oversized), 403, 'ACCESS_DENIED');
      await expectDiscountError(await restricted.send(method, path, oversized), 403, 'MFA_REQUIRED');
      await expectDiscountError(await admin.send(method, path, oversized), 400, 'INVALID_REQUEST');
    }
    expect(tableFingerprints(['user_sessions', 'user_session_refresh_tokens'])).toEqual(baseline);
  });

test('discount staff cookies and password-only enrolled Moderator sessions do not authorize commands',
  { tag: ['@t16', '@t16-T4'] }, async ({ actors, api }) => {
    const admin = await actors('admin');
    const moderator = await actors('moderator');
    const { product, discounts } = await pricedFixture(admin);
    const discount = await discounts.create(discountDraft('PRODUCT', product.id));
    const commands = [
      { method: 'GET' as const, path: '/api/staff/discounts?status=ACTIVE' },
      { method: 'POST' as const, path: '/api/staff/discounts', body: discountDraft('PRODUCT', product.id) },
      { method: 'PUT' as const, path: `/api/staff/discounts/${discount.id}`, body: discountBody(discount, { value: '20' }) },
      { method: 'POST' as const, path: `/api/staff/discounts/${discount.id}/end`, body: { version: discount.version } },
    ];
    const signedIn = await api.post('/api/auth/login', {
      data: { identifier: admin.username, password: admin.user.password },
    });
    expect(signedIn.status()).toBe(200);
    expect(signedIn.headers()['set-cookie']).toContain('MW_REFRESH=');
    const passwordSession = await ApiSession.signIn(moderator.user);
    try {
      expect(passwordSession.mfa).toBe('VERIFICATION_REQUIRED');
      const baseline = tableFingerprints(['user_sessions', 'user_session_refresh_tokens']);
      for (const command of commands) {
        // api owns a valid staff refresh cookie, but sends neither a bearer token nor a CSRF header.
        await expectDiscountError(await sendJson(api, command.method, command.path, command.body), 401, 'AUTHENTICATION_REQUIRED');
        await expectDiscountError(await passwordSession.call(command.method, command.path,
          { token: passwordSession.accessToken, data: command.body }), 403, 'MFA_REQUIRED');
      }
      expect(tableFingerprints(['user_sessions', 'user_session_refresh_tokens'])).toEqual(baseline);
    } finally {
      await passwordSession.dispose();
    }
  });

test('E2E-16-02 create/replay/conflict and list/detail share the Category price contract', { tag: ['@t16', '@t16-T4'] }, async ({ actors }) => {
  const admin = await actors('admin');
  const { category, product, discounts } = await pricedFixture(admin);
  const draft = discountDraft('CATEGORY', category.id);
  const discount = await discounts.create(draft);
  expect(discount).toMatchObject({ ...draft, targetName: category.name, productCount: 1, status: 'ACTIVE', version: 0,
    updatedByUsername: admin.username });
  expectPrice(await getDiscountProduct(admin, product.id), '135.00', discount, '15.00');
  const page = await listProducts(admin, { q: product.name });
  expect(page.items).toHaveLength(1);
  expectAppliedDiscountShape(page.items[0].appliedDiscount);
  expect(page.items[0]).toMatchObject({ effectivePrice: '135.00', appliedDiscount: {
    id: discount.id, targetType: 'CATEGORY', kind: 'PERCENTAGE', value: '10', saving: '15.00', targetName: category.name,
  } });
  expect(await expectDiscountJson<Discount>(await admin.post('/api/staff/discounts', draft), 200)).toEqual(discount);
  await expectDiscountError(await admin.post('/api/staff/discounts', { ...draft, value: '11' }), 409, 'ID_CONFLICT');
  expect((await allDiscounts(admin, 'ACTIVE')).find((item) => item.id === discount.id)).toEqual(discount);
});

test('E2E-16-03 greatest eligible saving applies exactly once across repeated reads', { tag: ['@t16', '@t16-T4'] }, async ({ actors, api }) => {
  const admin = await actors('admin');
  const { category, product, discounts } = await pricedFixture(admin, '150.00', '150.00');
  await discounts.create(discountDraft('PRODUCT', product.id));
  const categoryDiscount = await discounts.create(discountDraft('CATEGORY', category.id, { value: '15' }));
  for (let read = 0; read < 10; read += 1) {
    expectPrice(await getDiscountProduct(admin, product.id), '127.50', categoryDiscount, '22.50');
    expect((await publicPrice(api, product.id)).price).toBe('127.50');
  }
  const listed = (await listProducts(admin, { q: product.name })).items[0];
  expectAppliedDiscountShape(listed.appliedDiscount);
  expect(listed).toMatchObject({ effectivePrice: '127.50' });
  await discounts.update(categoryDiscount, { value: '10' });
  expect((await publicPrice(api, product.id)).price).toBe('135.00');
});

test('E2E-16-04 flat versus percentage uses saving and Product wins a target tie', { tag: ['@t16', '@t16-T4'] }, async ({ actors, api }) => {
  const admin = await actors('admin');
  const { category, product, discounts } = await pricedFixture(admin, '200.00');
  const suffix = randomUUID().slice(-12);
  const categoryFlat = await discounts.create(discountDraft('CATEGORY', category.id, {
    id: `00000000-0000-4000-8000-${suffix}`, kind: 'FLAT', value: '20.00',
  }));
  // The Category is inserted first and has the smaller UUID, so either shortcut breaks this tie.
  const productPercent = await discounts.create(discountDraft('PRODUCT', product.id, {
    id: `80000000-0000-4000-8000-${suffix}`, value: '10',
  }));
  expectPrice(await getDiscountProduct(admin, product.id), '180.00', productPercent, '20.00');
  const largerFlat = await discounts.update(categoryFlat, { value: '30.00' });
  expectPrice(await getDiscountProduct(admin, product.id), '170.00', largerFlat, '30.00');
  expect(await publicPrice(api, product.id)).toEqual({ productId: product.id, sellingPrice: '200.00', mrp: null,
    price: '170.00', saving: '30.00', discount: { targetType: 'CATEGORY', kind: 'FLAT', value: '30.00' } });
  await discounts.end(productPercent);
});

test('E2E-16-05 rejects invalid create shapes, money, dates, targets and oversized bodies', { tag: ['@t16', '@t16-T4'] }, async ({ actors }) => {
  const admin = await actors('admin');
  const { category, product } = await pricedFixture(admin);
  const inactive = await updateCategory(admin, await createCategory(admin), { active: false });
  const valid = discountDraft('PRODUCT', product.id);
  const mutations: [string, Record<string, unknown>][] = [
    ...['0', '100', '-5', 'abc', '0.01', '99.99', '01', '10.0', '10.00', '+10', ' 10', '1e1', 'NaN', 'Infinity', ''].map(
      (value): [string, Record<string, unknown>] => [`percentage ${JSON.stringify(value)}`, { value }]),
    ['numeric value', { value: 10 }], ['null value', { value: null }], ['oversized value', { value: '9'.repeat(10_000) }],
    ['unknown key', { coupon: 'NO-COUPONS' }], ['null id', { id: null }], ['malformed id', { id: 'bad' }],
    ['short UUID group', { id: '1-1-1-1-1' }],
    ['unknown target type', { targetType: 'ORDER' }], ['unknown kind', { kind: 'COUPON' }],
    ['missing Product', { targetId: randomUUID() }], ['malformed target', { targetId: 'bad' }],
    ['missing Category', { targetType: 'CATEGORY', targetId: randomUUID() }],
    ['inactive Category', { targetType: 'CATEGORY', targetId: inactive.id }],
    ['invalid leap date', { startsOn: '2031-02-29' }], ['invalid month', { startsOn: '2030-13-01' }],
    ['timestamp instead of date', { startsOn: `${valid.startsOn}T00:00:00Z` }],
    ['past start', { startsOn: dateOffset(dhakaToday(), -1) }],
    ['end before start', { endsOn: dateOffset(valid.startsOn, -1) }],
    ['invalid end date', { endsOn: '2030-02-30' }], ['numeric start', { startsOn: 20300101 }],
    ...['0', '0.00', '-1.00', '10000000.00', '1.001', '1e2', 'NaN', 'Infinity', '+1.00', ' 1.00'].map(
      (value): [string, Record<string, unknown>] => [`flat ${JSON.stringify(value)}`, { kind: 'FLAT', value }]),
  ];
  const beforeInvalid = tableFingerprints(['user_sessions', 'user_session_refresh_tokens']);
  for (const [name, change] of mutations) {
    await test.step(name, async () => {
      await expectDiscountError(await admin.post('/api/staff/discounts', { ...valid, id: randomUUID(), ...change }), 400, 'INVALID_REQUEST');
    });
  }
  for (const key of ['id', 'targetType', 'targetId', 'kind', 'value', 'startsOn']) {
    const missing: Record<string, unknown> = { ...valid };
    delete missing[key];
    await expectDiscountError(await admin.post('/api/staff/discounts', missing), 400, 'INVALID_REQUEST');
  }
  for (const body of ['{', 'null', '[]', '"not an object"', '{"padding":"' + 'x'.repeat(17_000) + '"}']) {
    await expectDiscountError(await admin.post('/api/staff/discounts', body), 400, 'INVALID_REQUEST');
  }
  for (const value of ['150.00', '151.00']) {
    await expectDiscountError(await admin.post('/api/staff/discounts', { ...valid, kind: 'FLAT', value }), 409, 'DISCOUNT_EXCEEDS_PRICE');
  }
  expect(tableFingerprints(['user_sessions', 'user_session_refresh_tokens'])).toEqual(beforeInvalid);
  // Null/absent end dates, endpoints 1%/99%, and a Category flat value above one Product's price are valid.
  const noEnd = { ...valid, id: randomUUID(), value: '1' } as Partial<DiscountDraft>;
  delete noEnd.endsOn;
  expect((await expectDiscountJson<Discount>(await admin.post('/api/staff/discounts', noEnd), 201)).endsOn).toBeNull();
  await discountApi(admin).create(discountDraft('PRODUCT', product.id, { value: '99' }));
  await discountApi(admin).create(discountDraft('CATEGORY', category.id, { kind: 'FLAT', value: '9999999.99' }));
  expect((await getDiscountProduct(admin, product.id)).effectivePrice).toBe('1.50');
});

test('E2E-16-06 stale update, identical old-version retry, end and ended-edit ordering', { tag: ['@t16', '@t16-T4'] }, async ({ actors }) => {
  const admin = await actors('admin');
  const { product, discounts } = await pricedFixture(admin);
  const original = await discounts.create(discountDraft('PRODUCT', product.id));
  const changed = await discounts.update(original, { value: '20' });
  expect(changed.version).toBe(original.version + 1);
  expect((await getDiscountProduct(admin, product.id)).history.filter((entry) => entry.changeType === 'DISCOUNT_STARTED'))
    .toEqual([expect.objectContaining({ discount: { targetType: 'PRODUCT', kind: 'PERCENTAGE', value: '20' } })]);
  await expectDiscountError(await admin.put(`/api/staff/discounts/${original.id}`, discountBody(original, { value: '30' })), 409, 'STALE_UPDATE');
  expect(await expectDiscountJson<Discount>(await admin.put(`/api/staff/discounts/${original.id}`,
    discountBody(original, { value: '20' })), 200)).toEqual(changed);
  await expectDiscountError(await admin.post(`/api/staff/discounts/${original.id}/end`, { version: original.version }), 409, 'STALE_UPDATE');
  const ended = await discounts.end(changed);
  expect(ended).toMatchObject({ status: 'ENDED', version: changed.version + 1 });
  expectPrice(await getDiscountProduct(admin, product.id), '150.00', null);
  await expectDiscountError(await admin.put(`/api/staff/discounts/${original.id}`, discountBody(changed, { value: '30' })), 409, 'STALE_UPDATE');
  await expectDiscountError(await admin.put(`/api/staff/discounts/${original.id}`, discountBody(ended, { value: '30' })), 409, 'DISCOUNT_ENDED');
  expect(await expectDiscountJson<Discount>(await admin.put(`/api/staff/discounts/${original.id}`, discountBody(ended, { version: 0 })), 200)).toEqual(ended);
  expect(await expectDiscountJson<Discount>(await admin.post(`/api/staff/discounts/${original.id}/end`, { version: 0 }), 200)).toEqual(ended);
  expect((await allDiscounts(admin, 'ENDED')).find((item) => item.id === original.id)).toEqual(ended);
});

test('flat create and stale unchanged replay compare numeric values without audit writes',
  { tag: ['@t16', '@t16-T4'] }, async ({ actors }) => {
    const admin = await actors('admin');
    const { product, discounts } = await pricedFixture(admin);
    const draft = discountDraft('PRODUCT', product.id, { kind: 'FLAT', value: '20' });
    const original = await discounts.create(draft);
    expect(original.value).toBe('20.00');
    const baseline = tableFingerprints(['user_sessions', 'user_session_refresh_tokens']);
    expect(await expectDiscountJson<Discount>(await admin.post('/api/staff/discounts', { ...draft, value: '20.0' }), 200))
      .toEqual(original);
    expect(tableFingerprints(['user_sessions', 'user_session_refresh_tokens'])).toEqual(baseline);
    const changed = await discounts.update(original, { startsOn: dhakaToday(), endsOn: dhakaToday() });
    const afterEdit = tableFingerprints(['user_sessions', 'user_session_refresh_tokens']);
    expect(await expectDiscountJson<Discount>(await admin.put(`/api/staff/discounts/${original.id}`,
      discountBody(changed, { value: '020.00', version: original.version })), 200)).toEqual(changed);
    expect(tableFingerprints(['user_sessions', 'user_session_refresh_tokens'])).toEqual(afterEdit);
  });

test('E2E-16-07 scheduled discount is excluded, can reschedule/start today or end before applying', { tag: ['@t16', '@t16-T4'] }, async ({ actors, api }) => {
  const admin = await actors('admin');
  const { product, discounts } = await pricedFixture(admin);
  const scheduled = await discounts.create(discountDraft('PRODUCT', product.id, { value: '30', startsOn: dhakaTomorrow() }));
  expect(scheduled.status).toBe('SCHEDULED');
  expect((await allDiscounts(admin, 'SCHEDULED')).some((item) => item.id === scheduled.id)).toBe(true);
  expectPrice(await getDiscountProduct(admin, product.id), '150.00', null);
  expect((await publicPrice(api, product.id)).price).toBe('150.00');
  const beforePastStart = tableFingerprints(['user_sessions', 'user_session_refresh_tokens']);
  await expectDiscountError(await admin.put(`/api/staff/discounts/${scheduled.id}`,
    discountBody(scheduled, { startsOn: dateOffset(dhakaToday(), -1) })), 400, 'INVALID_REQUEST');
  expect(tableFingerprints(['user_sessions', 'user_session_refresh_tokens'])).toEqual(beforePastStart);
  const rescheduled = await discounts.update(scheduled, { startsOn: dateOffset(dhakaToday(), 2) });
  const started = await discounts.update(rescheduled, { startsOn: dhakaToday(), endsOn: dhakaToday() });
  expectPrice(await getDiscountProduct(admin, product.id), '105.00', started, '45.00');
  const beforeStartChanges = tableFingerprints(['user_sessions', 'user_session_refresh_tokens']);
  for (const changedStart of [dhakaTomorrow(), dateOffset(dhakaToday(), -1)]) {
    await test.step(`started date cannot change to ${changedStart}`, async () => {
      // Clear the end so end-before-start cannot conceal a missing started-start guard.
      await expectDiscountError(await admin.put(`/api/staff/discounts/${started.id}`,
        discountBody(started, { startsOn: changedStart, endsOn: null })), 400, 'INVALID_REQUEST');
      expect(tableFingerprints(['user_sessions', 'user_session_refresh_tokens'])).toEqual(beforeStartChanges);
      expect((await allDiscounts(admin, 'ACTIVE')).find((item) => item.id === started.id)).toEqual(started);
      expectPrice(await getDiscountProduct(admin, product.id), '105.00', started, '45.00');
      expect(await publicPrice(api, product.id)).toMatchObject({ sellingPrice: '150.00', price: '105.00', saving: '45.00',
        discount: { targetType: 'PRODUCT', kind: 'PERCENTAGE', value: '30' } });
    });
  }
  const neverStarted = await discounts.create(discountDraft('PRODUCT', product.id, { startsOn: dhakaTomorrow(), value: '50' }));
  await discounts.end(neverStarted);
  const history = (await getDiscountProduct(admin, product.id)).history.filter((entry) => entry.discount?.value === '50');
  expect(history).toEqual([]);
});

test('discount server rejects an active historical fixture end before today even when it follows start',
  { tag: ['@t16', '@t16-T4'] }, async ({ actors }) => {
    const admin = await actors('admin');
    const { product, discounts } = await pricedFixture(admin);
    const created = await discounts.create(discountDraft('PRODUCT', product.id));
    const schema = checkedTarget('discount API historical end-floor fixture');
    const start = dateOffset(dhakaToday(), -2);
    // Only this run's synthetic row is backdated; the production calendar is unchanged.
    psql(`UPDATE ${schema}.discounts SET starts_on = '${start}' WHERE id = '${created.id}';`);
    const historical = (await allDiscounts(admin, 'ACTIVE')).find((item) => item.id === created.id)!;
    expect(historical).toMatchObject({ startsOn: start, endsOn: null, status: 'ACTIVE', version: created.version });
    const before = tableFingerprints(['user_sessions', 'user_session_refresh_tokens']);
    await expectDiscountError(await admin.put(`/api/staff/discounts/${historical.id}`,
      discountBody(historical, { endsOn: dateOffset(dhakaToday(), -1) })), 400, 'INVALID_REQUEST');
    expect(tableFingerprints(['user_sessions', 'user_session_refresh_tokens'])).toEqual(before);
    const inclusive = await discounts.update(historical, { endsOn: dhakaToday() });
    expect(inclusive).toMatchObject({ startsOn: start, endsOn: dhakaToday(), status: 'ACTIVE', version: created.version + 1 });
    expect((await allDiscounts(admin, 'ACTIVE')).find((item) => item.id === created.id)).toEqual(inclusive);
    expectPrice(await getDiscountProduct(admin, product.id), '135.00', inclusive, '15.00');
  });

test('discount PUT accepts omitted optional end, clears the stored date and safely replays its old version',
  { tag: ['@t16', '@t16-T4'] }, async ({ actors }) => {
    const admin = await actors('admin');
    const { product, discounts } = await pricedFixture(admin);
    const created = await discounts.create(discountDraft('PRODUCT', product.id, { endsOn: dhakaTomorrow() }));
    const body: Record<string, unknown> = discountBody(created, { value: '20' });
    delete body.endsOn;
    const updated = await expectDiscountJson<Discount>(await admin.put(`/api/staff/discounts/${created.id}`, body), 200);
    expect(updated).toMatchObject({ id: created.id, value: '20', startsOn: created.startsOn,
      endsOn: null, status: 'ACTIVE', version: created.version + 1 });
    expect((await allDiscounts(admin, 'ACTIVE')).find((item) => item.id === created.id)).toEqual(updated);
    const schema = checkedTarget('discount API omitted end fixture');
    expect(psql(`SELECT count(*) FROM ${schema}.discounts WHERE id = '${created.id}' AND ends_on IS NULL`
      + ` AND version = ${created.version + 1};`)).toBe('1');
    expectPrice(await getDiscountProduct(admin, product.id), '120.00', updated, '30.00');
    const beforeRetry = tableFingerprints(['user_sessions', 'user_session_refresh_tokens']);
    expect(await expectDiscountJson<Discount>(await admin.put(`/api/staff/discounts/${created.id}`, body), 200)).toEqual(updated);
    expect(tableFingerprints(['user_sessions', 'user_session_refresh_tokens'])).toEqual(beforeRetry);
  });

test('E2E-16-08 public price is anonymous, private-field-free and indistinguishable 404', { tag: ['@t16', '@t16-T4'] }, async ({ actors, api }) => {
  const admin = await actors('admin');
  const { product, discounts } = await pricedFixture(admin, '150.00', '160.00');
  await discounts.create(discountDraft('PRODUCT', product.id));
  const body = await publicPrice(api, product.id);
  expect(body).toEqual({ productId: product.id, sellingPrice: '150.00', mrp: '160.00', price: '135.00', saving: '15.00',
    discount: { targetType: 'PRODUCT', kind: 'PERCENTAGE', value: '10' } });
  // Malformed bearer headers are ignored here; genuine expiry is exercised by the security test below.
  for (const authorization of ['Bearer invalid', 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjB9.invalid']) {
    expect(await expectDiscountJson<PublicPrice>(await api.get(`/api/products/${product.id}/price`,
      { headers: { Authorization: authorization } }), 200)).toEqual(body);
  }
  expect(await expectDiscountJson<PublicPrice>(await admin.get(`/api/products/${product.id}/price`), 200)).toEqual(body);
  const unpriced = await createProduct(admin, equipmentDraft(product.categoryId));
  const inactive = await priceProduct(admin, await createProduct(admin, equipmentDraft(product.categoryId)), '100.00');
  for (const id of [randomUUID(), inactive.id, unpriced.id, 'bad-id', 'ffffffff-ffff-ffff-ffff-ffffffffffff']) {
    await expectDiscountError(await api.get(`/api/products/${id}/price`), 404, 'NOT_FOUND');
  }
});

test('E2E-16-14 a stored selling-price edit recomputes and Discount writes never rewrite Product history', { tag: ['@t16', '@t16-T6'] }, async ({ actors, api }) => {
  const admin = await actors('admin');
  const { product, discounts } = await pricedFixture(admin, '100.00', '200.00');
  const discount = await discounts.create(discountDraft('PRODUCT', product.id));
  const snapshot = await publicPrice(api, product.id);
  const current = await getDiscountProduct(admin, product.id);
  const changed = await priceProduct(admin, current, '200.00', '200.00');
  expectPrice(await getDiscountProduct(admin, product.id), '180.00', discount, '20.00');
  const priceEvent = changed.history.find((entry) => entry.changeType === 'PRICE_CHANGED');
  expect(priceEvent).toMatchObject({ oldSellingPrice: '100.00', newSellingPrice: '200.00', oldMrp: '200.00', newMrp: '200.00', discount: null });
  const before = tableFingerprints(['discounts', 'discount_changes', 'user_sessions', 'user_session_refresh_tokens']);
  const edited = await discounts.update(discount, { value: '20' });
  expect((await publicPrice(api, product.id)).price).toBe('160.00');
  await discounts.end(edited);
  expect((await publicPrice(api, product.id)).price).toBe('200.00');
  expect(snapshot).toMatchObject({ price: '90.00', saving: '10.00', discount: { value: '10' } });
  expect(tableFingerprints(['discounts', 'discount_changes', 'user_sessions', 'user_session_refresh_tokens'])).toEqual(before);
});

test('discount API percentage HALF_UP rounding and eligibility boundaries', { tag: ['@t16', '@t16-T4'] }, async ({ actors, api }) => {
  const admin = await actors('admin');
  const cases = [
    ['123.45', '10', '111.10', '12.35', true], ['123.44', '10', '111.10', '12.34', true],
    ['0.05', '50', '0.02', '0.03', true], ['0.01', '99', '0.01', '0.00', false],
    ['0.40', '1', '0.40', '0.00', false], ['9999999.99', '99', '100000.00', '9899999.99', true],
  ] as const;
  for (const [selling, percentage, expected, saving, eligible] of cases) {
    await test.step(`${selling} with ${percentage}%`, async () => {
      const { product, discounts } = await pricedFixture(admin, selling);
      const discount = await discounts.create(discountDraft('PRODUCT', product.id, { value: percentage }));
      expectPrice(await getDiscountProduct(admin, product.id), expected, eligible ? discount : null, saving);
      expect(await publicPrice(api, product.id)).toMatchObject({ price: expected, saving,
        discount: eligible ? { targetType: 'PRODUCT', kind: 'PERCENTAGE', value: percentage } : null });
    });
  }
});

test('discount flat twenty beats Category ten percent and kind edits preserve stored MRP guards',
  { tag: ['@t16', '@t16-T4'] }, async ({ actors, api }) => {
    const admin = await actors('admin');
    const { category, product, discounts } = await pricedFixture(admin, '150.00', '150.00');
    const categoryPercent = await discounts.create(discountDraft('CATEGORY', category.id));
    const productFlat = await discounts.create(discountDraft('PRODUCT', product.id, { kind: 'FLAT', value: '20.00' }));
    expectPrice(await getDiscountProduct(admin, product.id), '130.00', productFlat, '20.00');
    expect((await publicPrice(api, product.id)).price).toBe('130.00');
    const productPercent = await discounts.update(productFlat, { kind: 'PERCENTAGE', value: '5' });
    expectPrice(await getDiscountProduct(admin, product.id), '135.00', categoryPercent, '15.00');
    const changedBack = await discounts.update(productPercent, { kind: 'FLAT', value: '20.00' });
    expectPrice(await getDiscountProduct(admin, product.id), '130.00', changedBack, '20.00');
    const current = await getDiscountProduct(admin, product.id);
    const beforeInvalidPricing = tableFingerprints(['user_sessions', 'user_session_refresh_tokens']);
    await expectDiscountError(await admin.put(`/api/staff/products/${product.id}/pricing`,
      { sellingPrice: '150.01', mrp: '150.00', version: current.version }), 400, 'INVALID_REQUEST');
    expect(tableFingerprints(['user_sessions', 'user_session_refresh_tokens'])).toEqual(beforeInvalidPricing);
    expectPrice(await getDiscountProduct(admin, product.id), '130.00', changedBack, '20.00');
    expect((await getDiscountProduct(admin, product.id)).sellingPrice).toBe('150.00');
  });

test('discount greatest of three candidates ignores unrelated Product and Category promotions',
  { tag: ['@t16', '@t16-T4'] }, async ({ actors, api }) => {
    const admin = await actors('admin');
    const { product, discounts } = await pricedFixture(admin, '100.00');
    const suffix = randomUUID().slice(-12);
    await discounts.create(discountDraft('PRODUCT', product.id, { id: `10000000-0000-4000-8000-${suffix}`, value: '10' }));
    const greatest = await discounts.create(discountDraft('PRODUCT', product.id,
      { id: `40000000-0000-4000-8000-${suffix}`, kind: 'FLAT', value: '30.00' }));
    await discounts.create(discountDraft('PRODUCT', product.id,
      { id: `70000000-0000-4000-8000-${suffix}`, kind: 'FLAT', value: '20.00' }));
    const unrelated = await pricedFixture(admin, '1000.00');
    await discounts.create(discountDraft('PRODUCT', unrelated.product.id, { value: '99' }));
    await discounts.create(discountDraft('CATEGORY', unrelated.category.id, { kind: 'FLAT', value: '500.00' }));
    expectPrice(await getDiscountProduct(admin, product.id), '70.00', greatest, '30.00');
    expect((await publicPrice(api, product.id)).price).toBe('70.00');
    const listed = (await listProducts(admin, { q: product.name })).items[0];
    expectAppliedDiscountShape(listed.appliedDiscount);
    expect(listed).toMatchObject({ effectivePrice: '70.00',
      appliedDiscount: { id: greatest.id, saving: '30.00' } });
  });

test('Category discount productCount includes inactive, unpriced and ineligible members and follows moves',
  { tag: ['@t16', '@t16-T4'] }, async ({ actors }) => {
    const admin = await actors('admin');
    const { category, product, discounts } = await pricedFixture(admin, '100.00');
    const inactive = await priceProduct(admin, await createProduct(admin, equipmentDraft(category.id)), '80.00');
    const unpriced = await createProduct(admin, equipmentDraft(category.id));
    const belowFlat = await activeProduct(admin, equipmentDraft(category.id), '10.00');
    const destination = await createCategory(admin, `Discount mixed members ${token()}`);
    const categoryDiscount = await discounts.create(discountDraft('CATEGORY', category.id, { kind: 'FLAT', value: '20.00' }));
    const destinationDiscount = await discounts.create(discountDraft('CATEGORY', destination.id, { kind: 'FLAT', value: '20.00' }));
    async function expectCounts(source: number, target: number): Promise<void> {
      const listed = await allDiscounts(admin, 'ACTIVE');
      for (const [discount, expected] of [[categoryDiscount, source], [destinationDiscount, target]] as const) {
        const currentCategory = await findCategory(admin, discount.targetId);
        expect(currentCategory?.productCount).toBe(expected);
        expect(listed.find((item) => item.id === discount.id)?.productCount).toBe(expected);
      }
    }
    await expectCounts(4, 0);
    expectPrice(await getDiscountProduct(admin, product.id), '80.00', categoryDiscount, '20.00');
    expectPrice(await getDiscountProduct(admin, belowFlat.id), '10.00', null);
    expect((await getDiscountProduct(admin, unpriced.id)).effectivePrice).toBeNull();
    const beforeMoves = tableFingerprints(['user_sessions', 'user_session_refresh_tokens']);
    const moved = await updateProduct(admin, inactive, { categoryId: destination.id });
    await expectCounts(3, 1);
    await updateProduct(admin, moved, { categoryId: category.id });
    await expectCounts(4, 0);
    const afterMoves = tableFingerprints(['user_sessions', 'user_session_refresh_tokens']);
    expect(afterMoves.discounts).toBe(beforeMoves.discounts);
    expect(afterMoves.discount_changes).toBe(beforeMoves.discount_changes);
  });

test('discount eligibility follows selling price and unpriced/inactive targets are permitted', { tag: ['@t16', '@t16-T4'] }, async ({ actors, api }) => {
  const admin = await actors('admin');
  const { category, product, discounts } = await pricedFixture(admin, '100.00');
  const flat = await discounts.create(discountDraft('PRODUCT', product.id, { kind: 'FLAT', value: '99.99' }));
  expectPrice(await getDiscountProduct(admin, product.id), '0.01', flat, '99.99');
  const lowered = await priceProduct(admin, await getDiscountProduct(admin, product.id), '99.99');
  expectPrice(await getDiscountProduct(admin, product.id), '99.99', null);
  // Create replay bypasses the changed save-time price check.
  const originalDraft: DiscountDraft = { id: flat.id, targetType: flat.targetType, targetId: flat.targetId,
    kind: flat.kind, value: flat.value, startsOn: flat.startsOn, endsOn: flat.endsOn };
  expect(await expectDiscountJson<Discount>(await admin.post('/api/staff/discounts', originalDraft), 200)).toEqual(flat);
  await expectDiscountError(await admin.put(`/api/staff/discounts/${flat.id}`, discountBody(flat, { value: '100.00' })), 409, 'DISCOUNT_EXCEEDS_PRICE');
  await priceProduct(admin, lowered, '150.00');
  expectPrice(await getDiscountProduct(admin, product.id), '50.01', flat, '99.99');
  const unpriced = await createProduct(admin, equipmentDraft(category.id));
  await discounts.create(discountDraft('PRODUCT', unpriced.id, { kind: 'FLAT', value: '20.00' }));
  const unreadable = await getDiscountProduct(admin, unpriced.id);
  expect(unreadable).toMatchObject({ effectivePrice: null, appliedDiscount: null });
  await expectDiscountError(await api.get(`/api/products/${unpriced.id}/price`), 404, 'NOT_FOUND');
  const priced = await priceProduct(admin, unpriced, '30.00');
  expect((await getDiscountProduct(admin, priced.id)).effectivePrice).toBe('10.00');
});

test('discount current Category moves, deactivation, counts and derived history', { tag: ['@t16', '@t16-T5'] }, async ({ actors, api }) => {
  const admin = await actors('admin');
  const moderator = await actors('moderator');
  const { category, product, discounts } = await pricedFixture(admin, '100.00');
  const destination = await createCategory(admin);
  const draft = discountDraft('CATEGORY', destination.id);
  const categoryDiscount = await discounts.create(draft);
  const scheduled = await discounts.create(discountDraft('PRODUCT', product.id, { startsOn: dhakaTomorrow() }));
  const initialCounts = (await discounts.list('ACTIVE')).counts;
  const beforeCatalogEdits = tableFingerprints([]);
  for (const status of ['ACTIVE', 'SCHEDULED', 'ENDED'] as const) expect((await discounts.list(status)).counts).toEqual(initialCounts);
  expectPrice(await getDiscountProduct(admin, product.id), '100.00', null);
  const moved = await updateProduct(moderator, await getDiscountProduct(moderator, product.id), { categoryId: destination.id });
  expectPrice(await getDiscountProduct(moderator, product.id), '90.00', categoryDiscount, '10.00');
  expect((await publicPrice(api, product.id)).price).toBe('90.00');
  const starts = (await getDiscountProduct(admin, product.id)).history.filter((entry) => entry.changeType === 'DISCOUNT_STARTED');
  expect(starts).toHaveLength(1);
  expect(starts[0]).toMatchObject({ actorUsername: null, occurredAt: `${dateOffset(dhakaToday(), -1)}T18:00:00Z`,
    discount: { targetType: 'CATEGORY', kind: 'PERCENTAGE', value: '10' }, oldSellingPrice: null, newSellingPrice: null });
  expect(Object.keys(starts[0].discount!).sort()).toEqual(historyDiscountKeys);
  const back = await updateProduct(moderator, moved, { categoryId: category.id });
  expectPrice(await getDiscountProduct(admin, product.id), '100.00', null);
  expect((await getDiscountProduct(admin, product.id)).history.some((entry) => entry.changeType === 'DISCOUNT_STARTED')).toBe(false);
  await updateProduct(moderator, back, { categoryId: destination.id });
  await updateCategory(moderator, destination, { active: false });
  expect(tableFingerprints([])).toMatchObject({ discounts: beforeCatalogEdits.discounts,
    discount_changes: beforeCatalogEdits.discount_changes });
  expectPrice(await getDiscountProduct(admin, product.id), '90.00', categoryDiscount, '10.00');
  expect(await expectDiscountJson<Discount>(await admin.post('/api/staff/discounts', draft), 200)).toMatchObject({ id: categoryDiscount.id, status: 'ACTIVE' });
  const listed = (await allDiscounts(admin, 'ACTIVE')).find((item) => item.id === categoryDiscount.id)!;
  expect(listed.productCount).toBe(1);
  const ended = await discounts.end(categoryDiscount);
  const counts = { active: initialCounts.active - 1, scheduled: initialCounts.scheduled };
  for (const status of ['ACTIVE', 'SCHEDULED', 'ENDED'] as const) expect((await discounts.list(status)).counts).toEqual(counts);
  const history = (await getDiscountProduct(admin, product.id)).history;
  expect(history.filter((entry) => entry.changeType === 'DISCOUNT_ENDED')).toEqual([
    expect.objectContaining({ actorUsername: admin.username, occurredAt: ended.updatedAt,
      discount: { targetType: 'CATEGORY', kind: 'PERCENTAGE', value: '10' } }),
  ]);
  expect(history.every((entry) => entry.changeType.startsWith('DISCOUNT_') || entry.discount === null)).toBe(true);
  expect(history.length).toBeLessThanOrEqual(20);
  expect((await allDiscounts(admin, 'SCHEDULED')).some((item) => item.id === scheduled.id)).toBe(true);
});

test('discount update/end and list validators reject malformed paths, versions and queries', { tag: ['@t16', '@t16-T4'] }, async ({ actors }) => {
  const admin = await actors('admin');
  const { product, discounts } = await pricedFixture(admin);
  const discount = await discounts.create(discountDraft('PRODUCT', product.id));
  const unchanged = tableFingerprints(['user_sessions', 'user_session_refresh_tokens']);
  for (const version of [-1, 1.5, '0', null, true, 9223372036854775808]) {
    await expectDiscountError(await admin.put(`/api/staff/discounts/${discount.id}`, { ...discountBody(discount), version }), 400, 'INVALID_REQUEST');
    await expectDiscountError(await admin.post(`/api/staff/discounts/${discount.id}/end`, { version }), 400, 'INVALID_REQUEST');
  }
  for (const body of [{}, { version: 0, extra: true }, 'null', '[]']) {
    await expectDiscountError(await admin.post(`/api/staff/discounts/${discount.id}/end`, body), 400, 'INVALID_REQUEST');
  }
  for (const change of [{ targetType: 'CATEGORY' }, { targetId: randomUUID() }, { id: randomUUID() }, { value: '100' },
    { endsOn: dateOffset(dhakaToday(), -1) }, { kind: 'FLAT', value: '150.00' }]) {
    await expectDiscountError(await admin.put(`/api/staff/discounts/${discount.id}`, { ...discountBody(discount), ...change }),
      'kind' in change ? 409 : 400, 'kind' in change ? 'DISCOUNT_EXCEEDS_PRICE' : 'INVALID_REQUEST');
  }
  const nonexistent = randomUUID();
  await expectDiscountError(await admin.put(`/api/staff/discounts/${nonexistent}`, discountBody(discount)), 404, 'NOT_FOUND');
  await expectDiscountError(await admin.post(`/api/staff/discounts/${nonexistent}/end`, { version: 0 }), 404, 'NOT_FOUND');
  for (const id of ['bad-id', '1-1-1-1-1', '000000000-000-4000-8000-000000000017']) {
    await expectDiscountError(await admin.put(`/api/staff/discounts/${id}`, discountBody(discount)), 400, 'INVALID_REQUEST');
    await expectDiscountError(await admin.post(`/api/staff/discounts/${id}/end`, { version: 0 }), 400, 'INVALID_REQUEST');
  }
  for (const key of ['kind', 'value', 'startsOn', 'version']) {
    const missing: Record<string, unknown> = { ...discountBody(discount) };
    delete missing[key];
    await expectDiscountError(await admin.put(`/api/staff/discounts/${discount.id}`, missing), 400, 'INVALID_REQUEST');
  }
  for (const body of ['{', 'null', '[]', '"not an object"']) {
    await expectDiscountError(await admin.put(`/api/staff/discounts/${discount.id}`, body), 400, 'INVALID_REQUEST');
  }
  for (const query of ['', 'status=active', 'status=UNKNOWN', 'status=ACTIVE&page=-1', 'status=ACTIVE&page=abc',
    'status=ACTIVE&size=0', 'status=ACTIVE&size=51', 'status=ACTIVE&size=1.5']) {
    await expectDiscountError(await admin.get(`/api/staff/discounts?${query}`), 400, 'INVALID_REQUEST');
  }
  expect((await discounts.list('ACTIVE', 100000, 1)).items).toEqual([]);
  expect(tableFingerprints(['user_sessions', 'user_session_refresh_tokens'])).toEqual(unchanged);
});

test('discount stable paging, tab counts and response bound hold with 50 long target names', { tag: ['@t16', '@t16-T5'] }, async ({ actors }) => {
  test.setTimeout(240_000);
  const admin = await actors('admin');
  const { product, discounts } = await pricedFixture(admin);
  await updateProduct(admin, product, { name: `Discount ${token()} `.padEnd(160, 'X') });
  const suffix = randomUUID().slice(-12);
  const drafts = Array.from({ length: 51 }, (_, index) => discountDraft('PRODUCT', product.id, {
    id: `${(51 - index).toString(16).padStart(8, '0')}-0000-4000-8000-${suffix}`,
    startsOn: dateOffset(dhakaToday(), Math.floor(index / 2) + 1), value: String(index % 99 + 1),
  }));
  for (const draft of drafts) await discounts.create(draft);
  const all = await allDiscounts(admin, 'SCHEDULED');
  const own = all.filter((item) => item.targetId === product.id);
  expect(own.map((item) => item.id)).toEqual([...drafts].sort((a, b) =>
    a.startsOn.localeCompare(b.startsOn) || a.id.localeCompare(b.id)).map((item) => item.id));
  expect(new Set(all.map((item) => item.id)).size).toBe(all.length);
  expect(all.map((item) => `${item.startsOn}:${item.id}`)).toEqual(all.map((item) => `${item.startsOn}:${item.id}`).sort());
  const response = await admin.get('/api/staff/discounts?status=SCHEDULED&size=50');
  await expectDiscountJson(response, 200);
  expect(Buffer.byteLength(await response.body())).toBeLessThan(64 * 1024);
  expect((await discounts.list('SCHEDULED', 0, 1)).counts).toEqual((await discounts.list('ENDED', 0, 50)).counts);
});

test('Active and Ended pages sort descending dates with ascending UUID ties across pages',
  { tag: ['@t16', '@t16-T5'] }, async ({ actors }) => {
    test.setTimeout(120_000);
    const admin = await actors('admin');
    const { product, discounts } = await pricedFixture(admin);
    const suffix = randomUUID().slice(-12);
    const own: Discount[] = [];
    for (const prefix of ['00000003', '00000002', '00000001']) {
      own.push(await discounts.create(discountDraft('PRODUCT', product.id, {
        id: `${prefix}-0000-4000-8000-${suffix}`,
      })));
    }
    const schema = checkedTarget('discount paging');
    // One old start defeats an ascending primary sort; the same-day rows defeat insertion-order ties.
    psql(`UPDATE ${schema}.discounts SET starts_on = '${dateOffset(dhakaToday(), -1)}' WHERE id = '${own[0].id}';`);
    for (const status of ['ACTIVE', 'ENDED'] as const) {
      if (status === 'ENDED') {
        for (const item of own) await discounts.end(item);
        // Run-owned fixtures have exact timestamps; no wall-clock precision or command timing assumption.
        psql(`UPDATE ${schema}.discounts SET updated_at = CASE WHEN id = '${own[0].id}'
          THEN '2000-01-01T00:00:00Z'::timestamptz ELSE '2000-01-02T00:00:00Z'::timestamptz END
          WHERE id IN (${own.map((item) => `'${item.id}'`).join(',')});`);
      }
      const all = await allDiscounts(admin, status);
      expect(new Set(all.map((item) => item.id)).size).toBe(all.length);
      const byDate = (item: Discount) => status === 'ACTIVE' ? item.startsOn
        : `${item.updatedAt.slice(0, 19)}.${(item.updatedAt.split('.')[1]?.slice(0, -1) ?? '').padEnd(9, '0')}`;
      expect(all.map((item) => item.id)).toEqual([...all].sort((a, b) =>
        byDate(b).localeCompare(byDate(a)) || a.id.localeCompare(b.id)).map((item) => item.id));
      const ordered = all.filter((item) => item.targetId === product.id);
      expect(ordered.map((item) => item.id)).toEqual([own[2].id, own[1].id, own[0].id]);
      // Fetch each fixture's one-row page so both the primary and secondary sort cross real page boundaries.
      for (const item of ordered) {
        const page = all.findIndex((entry) => entry.id === item.id);
        expect((await discounts.list(status, page, 1)).items.map((entry) => entry.id)).toEqual([item.id]);
      }
    }
  });

test('discount concurrent creates, updates, update/end and price reads preserve replay/version contracts', { tag: ['@t16', '@t16-T6'] }, async ({ actors, api }) => {
  const admin = await actors('admin');
  const { product, discounts } = await pricedFixture(admin, '100.00');
  const draft = discountDraft('PRODUCT', product.id);
  const createdResponses = await Promise.all([admin.post('/api/staff/discounts', draft), admin.post('/api/staff/discounts', draft)]);
  expect(createdResponses.map((response) => response.status()).sort()).toEqual([200, 201]);
  const created = await expectDiscountJson<Discount>(createdResponses[0], createdResponses[0].status());
  expect(await expectDiscountJson<Discount>(createdResponses[1], createdResponses[1].status())).toEqual(created);
  const updates = await Promise.all(['20', '30'].map((value) => admin.put(`/api/staff/discounts/${created.id}`, discountBody(created, { value }))));
  expect(updates.map((response) => response.status()).sort()).toEqual([200, 409]);
  await expectDiscountError(updates.find((response) => response.status() === 409)!, 409, 'STALE_UPDATE');
  const updated = await expectDiscountJson<Discount>(updates.find((response) => response.status() === 200)!, 200);
  const readings = Array.from({ length: 8 }, () => publicPrice(api, product.id));
  const changedPromise = discounts.update(updated, { value: '40' });
  const [readPrices, changed] = await Promise.all([Promise.all(readings), changedPromise]);
  const oldPrice = updated.value === '20' ? '80.00' : '70.00';
  for (const price of readPrices) {
    expect([oldPrice, '60.00']).toContain(price.price);
    expect(price).toMatchObject(price.price === '60.00'
      ? { price: '60.00', saving: '40.00', discount: { value: '40' } }
      : { price: oldPrice, saving: `${updated.value}.00`, discount: { value: updated.value } });
  }
  const ending = await Promise.all([
    admin.post(`/api/staff/discounts/${changed.id}/end`, { version: changed.version }),
    admin.put(`/api/staff/discounts/${changed.id}`, discountBody(changed, { value: '50' })),
  ]);
  expect(ending.map((response) => response.status()).sort()).toEqual([200, 409]);
  await expectDiscountError(ending.find((response) => response.status() === 409)!, 409, 'STALE_UPDATE');
  const winner = await expectDiscountJson<Discount>(ending.find((response) => response.status() === 200)!, 200);
  expect(winner.version).toBe(changed.version + 1);
});

test('discount current-role checks and revoked/expired bearer tokens fail without Discount writes', { tag: ['@t16', '@t16-T6'] }, async ({ actors, api }) => {
  const admin = await actors('admin');
  const { product, discounts } = await pricedFixture(admin);
  const discount = await discounts.create(discountDraft('PRODUCT', product.id));
  const authorization = await admin.authorization();
  const schema = checkedTarget('discount security', admin.username);
  const baseline = tableFingerprints(['user_roles', 'user_sessions', 'user_session_refresh_tokens']);
  psql(`UPDATE ${schema}.user_roles SET role = 'MODERATOR' WHERE user_id = (SELECT id FROM ${schema}.users WHERE username = '${admin.username}');`);
  await expectDiscountError(await sendJson(api, 'GET', '/api/staff/discounts?status=ACTIVE', undefined, authorization), 403, 'ACCESS_DENIED');
  expect(tableFingerprints(['user_roles', 'user_sessions', 'user_session_refresh_tokens'])).toEqual(baseline);
  const invalid = { Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjB9.invalid' };
  await expectDiscountError(await sendJson(api, 'GET', '/api/staff/discounts?status=ACTIVE', undefined, invalid), 401, 'AUTHENTICATION_REQUIRED');
  const revocable = await actors('admin');
  const bearer = await revocable.authorization();
  psql(`UPDATE ${schema}.user_sessions SET revoked_at = now(), revoked_reason = 'LOGOUT' WHERE user_id = (SELECT id FROM ${schema}.users WHERE username = '${revocable.username}');`);
  const beforeRevoked = tableFingerprints(['user_sessions', 'user_session_refresh_tokens']);
  await expectDiscountError(await sendJson(api, 'POST', `/api/staff/discounts/${discount.id}/end`, { version: discount.version }, bearer), 401, 'AUTHENTICATION_REQUIRED');
  expect(tableFingerprints(['user_sessions', 'user_session_refresh_tokens'])).toEqual(beforeRevoked);
  expect(await expectDiscountJson<PublicPrice>(await api.get(`/api/products/${product.id}/price`, { headers: bearer }), 200))
    .toEqual(await publicPrice(api, product.id));
  const expiring = await actors('admin');
  const fixedBearer = await expiring.authorization();
  const beforeExpired = tableFingerprints(['user_sessions', 'user_session_refresh_tokens']);
  expect((await sendJson(api, 'GET', '/api/staff/discounts?status=ACTIVE', undefined, fixedBearer)).status()).toBe(200);
  // Observe expiry of a genuine signed token; never manufacture an invalid signature and call that expiry.
  await expect.poll(async () => (await sendJson(api, 'GET', '/api/staff/discounts?status=ACTIVE', undefined, fixedBearer)).status(),
    { timeout: accessTokenLifetimeMs + 5000 }).toBe(401);
  await expectDiscountError(await sendJson(api, 'GET', '/api/staff/discounts?status=ACTIVE', undefined, fixedBearer), 401, 'AUTHENTICATION_REQUIRED');
  expect(await expectDiscountJson<PublicPrice>(await api.get(`/api/products/${product.id}/price`,
    { headers: fixedBearer }), 200)).toEqual(await publicPrice(api, product.id));
  expect(tableFingerprints(['user_sessions', 'user_session_refresh_tokens'])).toEqual(beforeExpired);
});

test('discount commands, errors and public reads omit names, values and credentials from logs', { tag: ['@t16', '@t16-T6'] }, async ({ actors, api }) => {
  const admin = await actors('admin');
  const marker = `DiscountPrivacy${token()}`;
  const category = await createCategory(admin, `${marker} Category`);
  const product = await activeProduct(admin, equipmentDraft(category.id, { name: `${marker} Product` }), '9876.53', '9987.64');
  const bearer = await admin.authorization();
  const discount = await expectDiscountJson<Discount>(await sendJson(api, 'POST', '/api/staff/discounts',
    discountDraft('PRODUCT', product.id, { kind: 'FLAT', value: '4321.87' }), bearer), 201);
  const changed = await expectDiscountJson<Discount>(await sendJson(api, 'PUT', `/api/staff/discounts/${discount.id}`,
    discountBody(discount, { value: '3210.76' }), bearer), 200);
  await publicPrice(api, product.id);
  await expectDiscountJson(await sendJson(api, 'POST', `/api/staff/discounts/${changed.id}/end`,
    { version: changed.version }, bearer), 200);
  await expectDiscountError(await sendJson(api, 'POST', '/api/staff/discounts', discountDraft('PRODUCT', product.id,
    { kind: 'FLAT', value: '9876.54' }), bearer), 409, 'DISCOUNT_EXCEEDS_PRICE');
  const log = readFileSync(apiLogPath, 'utf8');
  expect(log).toContain('HTTP response status=201');
  for (const secret of [marker, '9876.53', '9987.64', '4321.87', '3210.76', '9876.54', admin.user.password,
    bearer.Authorization.slice('Bearer '.length)]) {
    expect(log.includes(secret), 'private fixture value in API log').toBe(false);
  }
});
