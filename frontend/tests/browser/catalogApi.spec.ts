import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  activeProduct, allCategories, apiMessages, catalogBody, categoryKeys, createCategory, createProduct, equipmentDraft,
  expect, expectApiError, expectJson, findCategory, getProduct, historyKeys, listCategories, listProducts, medicineDraft,
  pageKeys, priceProduct, productKeys, productSummaryKeys, sendJson, test, token, updateCategory, updateProduct,
  type Category, type Method, type Product,
} from './catalogSupport';
import { apiLogPath, frontendUrl, grantRole, removeRole, rolledBackSql } from './testApi';

/**
 * Ticket 14 API behaviour through the real routes of plan §4.2, as the staff pages and any other HTTP client reach
 * them: Bearer tokens of real sessions, the real test API and PostgreSQL 18. These pass once T4 wires the routes.
 */

const tag = { tag: ['@t14', '@t14-T4'] };
const someId = '6c1d9a0e-2b7f-4e11-8d3a-5f0e9b2c7a14';

/** Every catalog route, with a body that would be valid for an authorized caller. */
function routes(productId = someId, categoryId = someId): [Method, string, unknown][] {
  return [
    ['GET', '/api/staff/categories', undefined],
    ['POST', '/api/staff/categories', { id: randomUUID(), name: `Denied ${token()}` }],
    ['PUT', `/api/staff/categories/${categoryId}`, { name: `Denied ${token()}`, active: true, version: 0 }],
    ['GET', '/api/staff/products', undefined],
    ['GET', `/api/staff/products/${productId}`, undefined],
    ['POST', '/api/staff/products', medicineDraft(categoryId)],
    ['PUT', `/api/staff/products/${productId}`, catalogBody({ ...medicineDraft(categoryId), active: false, version: 0 } as
      unknown as Product)],
    ['PUT', `/api/staff/products/${productId}/pricing`, { sellingPrice: '11.50', mrp: '12.00', version: 0 }],
  ];
}

/** The stored money of a Product exactly as PostgreSQL prints it, read outside the API. */
function storedMoney(productId: string): string {
  const read = rolledBackSql(`SELECT coalesce(selling_price::text, 'null') || ' ' || coalesce(mrp::text, 'null')
    FROM products WHERE id = '${productId}';`);
  expect(read.error).toBe('');
  return read.output;
}

/** The stored roles of `username`, sorted: every User holds exactly one role (DECISIONS S6). */
function storedRoles(username: string): string[] {
  const read = rolledBackSql(`SELECT r.role FROM user_roles r JOIN users u ON u.id = r.user_id
    WHERE u.username = '${username}' ORDER BY r.role;`);
  expect(read.error).toBe('');
  return read.output === '' ? [] : read.output.split(/\r?\n/);
}

function historyCount(productId: string): number {
  const read = rolledBackSql(`SELECT count(*) FROM product_changes WHERE product_id = '${productId}';`);
  expect(read.error).toBe('');
  return Number(read.output);
}

test.describe('who may call the catalog routes', () => {
  test('E2E-14-07 an anonymous caller gets 401 on every catalog route, including pricing', tag, async ({ api }) => {
    for (const [method, path, body] of routes()) {
      const response = await sendJson(api, method, path, body);
      await expectApiError(response, 401, 'AUTHENTICATION_REQUIRED');
      expect(response.headers()['www-authenticate'], `${method} ${path}`).toBe('Bearer');
    }
  });

  test('E2E-14-08 Customers and DeliveryPersons get 403 ACCESS_DENIED and restricted staff 403 MFA_REQUIRED everywhere',
    tag, async ({ actors }) => {
      const admin = await actors('admin');
      const category = await createCategory(admin);
      const product = await createProduct(admin, medicineDraft(category.id));
      for (const kind of ['customer', 'deliveryPerson', 'restrictedStaff'] as const) {
        const actor = await actors(kind);
        for (const [method, path, body] of routes(product.id, category.id)) {
          await expectApiError(await actor.send(method, path, body), 403,
            kind === 'restrictedStaff' ? 'MFA_REQUIRED' : 'ACCESS_DENIED');
        }
      }
      // Nothing any of them sent changed the catalog.
      const after = await getProduct(admin, product.id);
      expect(after.version).toBe(0);
      expect(after.history.map(({ changeType }) => changeType)).toEqual(['CREATED']);
      expect((await findCategory(admin, category.id))?.version).toBe(0);
    });

  test('E2E-14-09 a verified Moderator gets 403 ACCESS_DENIED from pricing and nothing changes; an Admin prices',
    tag, async ({ actors }) => {
      const moderator = await actors('moderator');
      const admin = await actors('admin');
      const category = await createCategory(moderator);
      const product = await createProduct(moderator, medicineDraft(category.id));

      for (const body of [
        { sellingPrice: '11.50', mrp: '12.00', version: product.version },
        { sellingPrice: '11.50', mrp: null, version: product.version },
        // Even a malformed or stale pricing call is refused for the role first: nothing about pricing is revealed.
        { sellingPrice: 'x', mrp: null, version: 99 },
      ]) {
        const response = await moderator.put(`/api/staff/products/${product.id}/pricing`, body);
        await expectApiError(response, 403, 'ACCESS_DENIED');
        expect((await response.json() as { message: string }).message).toBe(apiMessages.ACCESS_DENIED);
      }
      const unchanged = await getProduct(moderator, product.id);
      expect(unchanged).toMatchObject({ sellingPrice: null, mrp: null, version: 0, status: 'NEEDS_PRICE' });
      expect(storedMoney(product.id)).toBe('null null');
      expect(historyCount(product.id)).toBe(1);

      const priced = await priceProduct(admin, unchanged, '11.50', '12.00');
      expect(priced).toMatchObject({ sellingPrice: '11.50', mrp: '12.00', status: 'INACTIVE', version: 1 });
    });

  test('E2E-14-10 roles are re-read on every request: replacing ADMIN in SQL stops pricing on the very next call',
    tag, async ({ actors }) => {
      // Scenario B of plan §8.2: the role is replaced as an operator would, with SQL; the session stays active. A User
      // holds exactly one role (DECISIONS S6), so this Admin never held MODERATOR.
      const admin = await actors('admin');
      const category = await createCategory(admin);
      const product = await priceProduct(admin, await createProduct(admin, medicineDraft(category.id)), '20.00');

      grantRole(admin.username, 'MODERATOR');
      expect(storedRoles(admin.username)).toEqual(['MODERATOR']);
      await expectApiError(await admin.put(`/api/staff/products/${product.id}/pricing`,
        { sellingPrice: '21.00', mrp: null, version: product.version }), 403, 'ACCESS_DENIED');
      // Now a Moderator, so the catalog routes still answer.
      expect((await getProduct(admin, product.id)).sellingPrice).toBe('20.00');

      // Demotion: the role becomes CUSTOMER, which has no catalog access.
      removeRole(admin.username, 'MODERATOR');
      expect(storedRoles(admin.username)).toEqual(['CUSTOMER']);
      await expectApiError(await admin.get(`/api/staff/products/${product.id}`), 403, 'ACCESS_DENIED');
      await expectApiError(await admin.get('/api/staff/categories'), 403, 'ACCESS_DENIED');

      grantRole(admin.username, 'ADMIN');
      const repriced = await priceProduct(admin, product, '21.00');
      expect(repriced.sellingPrice).toBe('21.00');
    });

  test('E2E-14-11 there is no delete: DELETE on products and categories changes nothing', tag, async ({ actors }) => {
    const admin = await actors('admin');
    const category = await createCategory(admin);
    const product = await createProduct(admin, equipmentDraft(category.id));
    for (const path of [`/api/staff/products/${product.id}`, `/api/staff/categories/${category.id}`]) {
      const status = (await admin.send('DELETE', path)).status();
      expect([401, 403, 404, 405], `DELETE ${path}`).toContain(status);
    }
    expect((await getProduct(admin, product.id)).version).toBe(0);
    expect(await findCategory(admin, category.id)).toBeDefined();
  });

  test('E2E-14-12 the frontend origin may send PUT: the CORS preflight for catalog and pricing routes allows it',
    tag, async ({ api }) => {
      for (const path of [`/api/staff/products/${someId}`, `/api/staff/products/${someId}/pricing`,
        `/api/staff/categories/${someId}`]) {
        const response = await api.fetch(path, {
          method: 'OPTIONS',
          headers: {
            Origin: frontendUrl,
            'Access-Control-Request-Method': 'PUT',
            'Access-Control-Request-Headers': 'authorization,content-type',
          },
        });
        expect(response.status(), path).toBe(200);
        expect(response.headers()['access-control-allow-origin']).toBe(frontendUrl);
        expect(response.headers()['access-control-allow-methods']).toMatch(/\bPUT\b/);
      }
    });
});

test.describe('categories', () => {
  test('E2E-14-13 Admins and Moderators create, list, rename and deactivate categories; a create retry is idempotent',
    tag, async ({ actors }) => {
      for (const kind of ['admin', 'moderator'] as const) {
        const actor = await actors(kind);
        const id = randomUUID();
        const name = `Pain relief ${token()}`;
        const createdResponse = await actor.post('/api/staff/categories', { id, name });
        const created = await expectJson<Category>(createdResponse, 201);
        expect(createdResponse.headers()['cache-control']).toBe('no-store');
        expect(Object.keys(created).sort()).toEqual(categoryKeys);
        expect(created).toEqual({ id, name, active: true, productCount: 0, version: 0 });

        // A lost response is retried with the same id: the same category, 200, no second row.
        expect(await expectJson<Category>(await actor.post('/api/staff/categories', { id, name }), 200)).toEqual(created);

        expect((await allCategories(actor)).filter((category) => category.name === name)).toEqual([created]);
        // Sorted by name across pages: a later-created "… a" is listed before an earlier "… b".
        const pair = `Sorted ${token()}`;
        await createCategory(actor, `${pair} b`);
        await createCategory(actor, `${pair} a`);
        expect((await allCategories(actor)).map((category) => category.name)
          .filter((listedName) => listedName.startsWith(pair))).toEqual([`${pair} a`, `${pair} b`]);

        const renamed = await updateCategory(actor, created, { name: `${name} and fever` });
        expect(renamed).toMatchObject({ name: `${name} and fever`, active: true, version: 1 });
        const inactive = await updateCategory(actor, renamed, { active: false });
        expect(inactive).toMatchObject({ active: false, version: 2 });
        expect((await allCategories(actor, false)).some((category) => category.id === id)).toBe(false);
        expect(await findCategory(actor, id)).toEqual(inactive);
        const reactivated = await updateCategory(actor, inactive, { active: true });
        expect(reactivated).toMatchObject({ active: true, version: 3 });
      }
    });

  test('E2E-14-14 category names are unique ignoring case; stale and unknown category edits are refused', tag,
    async ({ actors }) => {
      const moderator = await actors('moderator');
      const admin = await actors('admin');
      const first = await createCategory(moderator, `Diabetes care ${token()}`);
      await expectApiError(await admin.post('/api/staff/categories', { id: randomUUID(), name: first.name.toUpperCase() }),
        409, 'CATEGORY_NAME_TAKEN');
      const second = await createCategory(admin);
      await expectApiError(await admin.put(`/api/staff/categories/${second.id}`,
        { name: first.name.toLowerCase(), active: true, version: second.version }), 409, 'CATEGORY_NAME_TAKEN');

      // Two editors loaded version 0; the second save is stale and changes nothing.
      const renamed = await updateCategory(moderator, first, { name: `${first.name} A` });
      const stale = await admin.put(`/api/staff/categories/${first.id}`,
        { name: `${first.name} B`, active: true, version: first.version });
      await expectApiError(stale, 409, 'STALE_UPDATE');
      expect((await stale.json() as { message: string }).message)
        .toBe('This record changed after you opened it. Reload and try again.');
      expect(await findCategory(admin, first.id)).toEqual(renamed);

      await expectApiError(await admin.put(`/api/staff/categories/${randomUUID()}`,
        { name: `Nobody ${token()}`, active: true, version: 0 }), 404, 'NOT_FOUND');
    });

  test('E2E-14-15 category input is validated: name 1–80 characters, strict fields, canonical ids', tag,
    async ({ actors }) => {
      const admin = await actors('admin');
      const suffix = token();
      const eighty = `Cat ${suffix} `.padEnd(80, 'x');
      expect((await createCategory(admin, eighty)).name).toBe(eighty);
      const invalid: unknown[] = [
        { id: randomUUID(), name: '' },
        { id: randomUUID(), name: '   ' },
        { id: randomUUID(), name: `${eighty}y` },
        { id: randomUUID() },
        { name: `No id ${suffix}` },
        { id: 'not-a-uuid', name: `Bad id ${suffix}` },
        { id: randomUUID(), name: `Extra ${suffix}`, active: false },
        { id: randomUUID(), name: `Extra ${suffix}`, version: 3 },
        [{ id: randomUUID(), name: `Bulk ${suffix}` }],
        '{"id":',
      ];
      for (const body of invalid) {
        await expectApiError(await admin.post('/api/staff/categories', body), 400, 'INVALID_REQUEST');
      }
      await expectApiError(await admin.put('/api/staff/categories/not-a-uuid',
        { name: `Bad ${suffix}`, active: true, version: 0 }), 400, 'INVALID_REQUEST');
      expect((await allCategories(admin)).filter(({ name }) => name.includes(suffix)).map(({ name }) => name))
        .toEqual([eighty]);
    });

  test('E2E-14-16 an inactive category cannot be chosen for a Product, but Products already in it keep it', tag,
    async ({ actors }) => {
      const admin = await actors('admin');
      const kept = await createCategory(admin);
      const other = await createCategory(admin);
      const product = await createProduct(admin, medicineDraft(kept.id));
      const current = (await findCategory(admin, kept.id))!;
      expect(current.productCount).toBe(1);
      const inactive = await updateCategory(admin, current, { active: false });
      expect(inactive.productCount).toBe(1);

      await expectApiError(await admin.post('/api/staff/products', medicineDraft(kept.id)), 400, 'INVALID_REQUEST');
      await expectApiError(await admin.post('/api/staff/products', medicineDraft(randomUUID())), 400, 'INVALID_REQUEST');
      const moved = await createProduct(admin, medicineDraft(other.id));
      await expectApiError(await admin.put(`/api/staff/products/${moved.id}`, catalogBody(moved, { categoryId: kept.id })),
        400, 'INVALID_REQUEST');

      // The Product in the inactive category keeps it and can still be edited without choosing another.
      const edited = await updateProduct(admin, product, { description: 'Kept in its category.' });
      expect(edited).toMatchObject({ categoryId: kept.id, categoryName: kept.name, version: 1 });
    });
});

test.describe('Products', () => {
  test('E2E-14-17 a Moderator creates a Medicine: inactive, unpriced, NEEDS_PRICE, one CREATED row; a retry is idempotent',
    tag, async ({ actors }) => {
      const moderator = await actors('moderator');
      const category = await createCategory(moderator);
      const draft = medicineDraft(category.id, { description: 'Line one.\nLine two.' });
      const response = await moderator.post('/api/staff/products', draft);
      const product = await expectJson<Product>(response, 201);
      expect(response.headers()['cache-control']).toBe('no-store');
      expect(Object.keys(product).sort()).toEqual(productKeys);
      expect(product).toMatchObject({
        ...draft, categoryName: category.name, sellingPrice: null, mrp: null, active: false, status: 'NEEDS_PRICE',
        version: 0, updatedByUsername: moderator.username,
      });
      expect(product.history).toHaveLength(1);
      expect(Object.keys(product.history[0]).sort()).toEqual(historyKeys);
      expect(product.history[0]).toMatchObject({
        changeType: 'CREATED', actorUsername: moderator.username, oldSellingPrice: null, newSellingPrice: null,
        oldMrp: null, newMrp: null,
      });
      expect(Number.isNaN(Date.parse(product.history[0].occurredAt))).toBe(false);

      const retried = await expectJson<Product>(await moderator.post('/api/staff/products', draft), 200);
      expect(retried).toEqual(product);
      expect(historyCount(product.id)).toBe(1);
      expect(await getProduct(moderator, product.id)).toEqual(product);
    });

  test('E2E-14-18 Equipment has no generic/salt name or dosage form; each kind requires its own fields', tag,
    async ({ actors }) => {
      const admin = await actors('admin');
      const category = await createCategory(admin);
      const equipment = await createProduct(admin, equipmentDraft(category.id));
      expect(equipment).toMatchObject({ kind: 'EQUIPMENT', genericName: null, dosageForm: null, saleUnit: '1 piece' });
      // Blank optional text is stored as null, and text is trimmed.
      const trimmed = await createProduct(admin, medicineDraft(category.id,
        { name: '  Napa Extra  ', brandName: '   ', manufacturer: '', description: '' }));
      expect(trimmed).toMatchObject({ name: 'Napa Extra', brandName: null, manufacturer: null, description: null });
      const minimal = await createProduct(admin, medicineDraft(category.id,
        { brandName: null, manufacturer: null, description: null }));
      expect(minimal.status).toBe('NEEDS_PRICE');

      const refused: [string, Record<string, unknown>][] = [
        ['Medicine without generic', medicineDraft(category.id, { genericName: null })],
        ['Medicine with blank generic', medicineDraft(category.id, { genericName: '  ' })],
        ['Medicine without dosage form', medicineDraft(category.id, { dosageForm: null })],
        ['Equipment with generic', equipmentDraft(category.id, { genericName: 'Paracetamol' })],
        ['Equipment with dosage form', equipmentDraft(category.id, { dosageForm: 'Tablet 500 mg' })],
        ['no name', medicineDraft(category.id, { name: '   ' })],
        ['no Sale Unit', medicineDraft(category.id, { saleUnit: '' })],
        ['no category', medicineDraft(category.id, { categoryId: null })],
        ['a malformed category id', medicineDraft(category.id, { categoryId: 'pain-relief' })],
        ['an unknown kind', medicineDraft(category.id, { kind: 'SERVICE' })],
        ['no kind', { ...medicineDraft(category.id), kind: undefined }],
        ['no requireValidation', { ...medicineDraft(category.id), requireValidation: undefined }],
        ['a non-boolean requireValidation', medicineDraft(category.id, { requireValidation: 'yes' })],
        ['a malformed product id', medicineDraft(category.id, { id: '123' })],
      ];
      for (const [name, body] of refused) {
        const response = await admin.post('/api/staff/products', body);
        expect(response.status(), name).toBe(400);
        await expectApiError(response, 400, 'INVALID_REQUEST');
        if (typeof body.id === 'string' && /^[0-9a-f-]{36}$/.test(body.id)) {
          await expectApiError(await admin.get(`/api/staff/products/${body.id}`), 404, 'NOT_FOUND');
        }
      }
    });

  test('E2E-14-19 catalog text limits are enforced at their exact boundaries', tag, async ({ actors }) => {
    const admin = await actors('admin');
    const category = await createCategory(admin);
    const limits: [string, number][] = [
      ['name', 160], ['brandName', 120], ['genericName', 200], ['manufacturer', 120], ['dosageForm', 120],
      ['saleUnit', 80], ['description', 4000],
    ];
    for (const [field, max] of limits) {
      const atLimit = `${field} ${token()} `.padEnd(max, 'x');
      expect((await createProduct(admin, medicineDraft(category.id, { [field]: atLimit })))[field as keyof Product], field)
        .toBe(atLimit);
      await expectApiError(await admin.post('/api/staff/products', medicineDraft(category.id, { [field]: `${atLimit}x` })),
        400, 'INVALID_REQUEST');
    }
    // Line breaks are allowed only in the description; other control characters nowhere.
    expect((await createProduct(admin, medicineDraft(category.id, { description: 'Take after food.\nKeep dry.' })))
      .description).toBe('Take after food.\nKeep dry.');
    for (const [field, value] of [['name', 'Napa\n500'], ['name', 'Napa\u0000'], ['description', 'Bell\u0007']]) {
      await expectApiError(await admin.post('/api/staff/products', medicineDraft(category.id, { [field]: value })), 400,
        'INVALID_REQUEST');
    }
  });

  test('E2E-14-20 create and catalog edits refuse money, activation, kind and every other unexpected field', tag,
    async ({ actors }) => {
      const admin = await actors('admin');
      const category = await createCategory(admin);
      for (const extra of [{ active: true }, { active: false }, { sellingPrice: '1.00' }, { mrp: '2.00' },
        { version: 0 }, { createdBy: randomUUID() }, { status: 'ACTIVE' }, { discount: '10' }]) {
        const draft = medicineDraft(category.id, extra);
        await expectApiError(await admin.post('/api/staff/products', draft), 400, 'INVALID_REQUEST');
        await expectApiError(await admin.get(`/api/staff/products/${draft.id}`), 404, 'NOT_FOUND');
      }

      const product = await priceProduct(admin, await createProduct(admin, medicineDraft(category.id)), '10.00', '12.00');
      for (const extra of [{ sellingPrice: '1.00' }, { mrp: '1.00' }, { price: '1.00' }, { discount: '10' },
        { kind: 'EQUIPMENT' }, { id: randomUUID() }, { createdBy: randomUUID() }, { updatedBy: randomUUID() },
        { status: 'ACTIVE' }, { history: [] }]) {
        await expectApiError(await admin.put(`/api/staff/products/${product.id}`,
          catalogBody(product, { name: `Mass ${token()}`, ...extra })), 400, 'INVALID_REQUEST');
      }
      // Bulk-like bodies are refused as a whole.
      await expectApiError(await admin.post('/api/staff/products', [medicineDraft(category.id)]), 400, 'INVALID_REQUEST');
      await expectApiError(await admin.put(`/api/staff/products/${product.id}`, [catalogBody(product)]), 400,
        'INVALID_REQUEST');
      await expectApiError(await admin.put(`/api/staff/products/${product.id}/pricing`,
        [{ sellingPrice: '1.00', mrp: null, version: product.version }]), 400, 'INVALID_REQUEST');
      // A pricing body carries exactly sellingPrice, mrp and version.
      for (const extra of [{ active: true }, { discount: '5' }, { name: 'Renamed' }, { requireValidation: true }]) {
        await expectApiError(await admin.put(`/api/staff/products/${product.id}/pricing`,
          { sellingPrice: '9.00', mrp: '12.00', version: product.version, ...extra }), 400, 'INVALID_REQUEST');
      }
      await expectApiError(await admin.put(`/api/staff/products/${product.id}/pricing`, { sellingPrice: '9.00', mrp: null }),
        400, 'INVALID_REQUEST');
      // A body over 16 KiB and malformed JSON are refused before any handler.
      await expectApiError(await admin.put(`/api/staff/products/${product.id}`,
        catalogBody(product, { description: 'x'.repeat(17 * 1024) })), 400, 'INVALID_REQUEST');
      await expectApiError(await admin.put(`/api/staff/products/${product.id}`, '{"name":'), 400, 'INVALID_REQUEST');
      await expectApiError(await admin.put('/api/staff/products/not-a-uuid', catalogBody(product)), 400, 'INVALID_REQUEST');
      await expectApiError(await admin.get('/api/staff/products/not-a-uuid'), 400, 'INVALID_REQUEST');

      expect(await getProduct(admin, product.id)).toEqual(product);
      expect(storedMoney(product.id)).toBe('10.00 12.00');
    });

  test('E2E-14-21 a catalog edit bumps the version and records CATALOG_UPDATED; an identical save changes nothing',
    tag, async ({ actors }) => {
      const moderator = await actors('moderator');
      const category = await createCategory(moderator);
      const otherCategory = await createCategory(moderator);
      const product = await createProduct(moderator, medicineDraft(category.id));
      const edited = await updateProduct(moderator, product, {
        name: `Napa Extend ${token()}`, brandName: 'Napa Extend', manufacturer: 'Beximco Pharma',
        dosageForm: 'Tablet 665 mg', saleUnit: 'Strip of 8 tablets', description: 'Extended release.',
        categoryId: otherCategory.id,
      });
      expect(edited).toMatchObject({ version: 1, categoryName: otherCategory.name, updatedByUsername: moderator.username,
        kind: 'MEDICINE', status: 'NEEDS_PRICE' });
      expect(edited.history.map(({ changeType }) => changeType)).toEqual(['CATALOG_UPDATED', 'CREATED']);
      // Only price and flag values are audited, never catalog text.
      expect(edited.history[0]).toMatchObject({ oldSellingPrice: null, newSellingPrice: null, oldMrp: null, newMrp: null });

      const identical = await updateProduct(moderator, edited, {});
      expect(identical).toEqual(edited);
      expect(historyCount(product.id)).toBe(2);

      await expectApiError(await moderator.put(`/api/staff/products/${randomUUID()}`, catalogBody(edited)), 404,
        'NOT_FOUND');
      await expectApiError(await moderator.get(`/api/staff/products/${randomUUID()}`), 404, 'NOT_FOUND');
    });

  test('E2E-14-22 an unpriced Product cannot be activated: 409 PRICE_REQUIRED for Moderator and Admin alike', tag,
    async ({ actors }) => {
      const moderator = await actors('moderator');
      const admin = await actors('admin');
      const category = await createCategory(moderator);
      const product = await createProduct(moderator, medicineDraft(category.id));
      for (const actor of [moderator, admin]) {
        const response = await actor.put(`/api/staff/products/${product.id}`, catalogBody(product, { active: true }));
        await expectApiError(response, 409, 'PRICE_REQUIRED');
        expect((await response.json() as { message: string }).message).toBe('Add a price before activating this product.');
      }
      // The refusal also holds when the same save changes other fields, and nothing of it is kept.
      await expectApiError(await moderator.put(`/api/staff/products/${product.id}`,
        catalogBody(product, { active: true, requireValidation: true, name: `Other ${token()}` })), 409, 'PRICE_REQUIRED');
      expect(await getProduct(moderator, product.id)).toEqual(product);
      expect(historyCount(product.id)).toBe(1);
    });

  test('E2E-14-23 an Admin prices, a Moderator activates, and deactivation keeps the id and every history row', tag,
    async ({ actors }) => {
      const moderator = await actors('moderator');
      const admin = await actors('admin');
      const category = await createCategory(moderator);
      const created = await createProduct(moderator, medicineDraft(category.id));

      const priced = await priceProduct(admin, created, '11.50', '12.00');
      expect(priced).toMatchObject({ sellingPrice: '11.50', mrp: '12.00', active: false, status: 'INACTIVE', version: 1,
        updatedByUsername: admin.username });
      expect(priced.history[0]).toMatchObject({ changeType: 'PRICE_CHANGED', actorUsername: admin.username,
        oldSellingPrice: null, newSellingPrice: '11.50', oldMrp: null, newMrp: '12.00' });
      expect(storedMoney(created.id)).toBe('11.50 12.00');

      // The Moderator saves with the version from the pricing response.
      const active = await updateProduct(moderator, priced, { active: true });
      expect(active).toMatchObject({ active: true, status: 'ACTIVE', version: 2 });
      expect(active.history[0]).toMatchObject({ changeType: 'ACTIVATED', actorUsername: moderator.username });

      const repriced = await priceProduct(admin, active, '11.00', '12.00');
      expect(repriced.history[0]).toMatchObject({ changeType: 'PRICE_CHANGED', oldSellingPrice: '11.50',
        newSellingPrice: '11.00', oldMrp: '12.00', newMrp: '12.00' });
      expect(repriced.status).toBe('ACTIVE');
      // A price can be changed but never cleared; to stop selling, deactivate.
      await expectApiError(await admin.put(`/api/staff/products/${created.id}/pricing`,
        { sellingPrice: null, mrp: null, version: repriced.version }), 400, 'INVALID_REQUEST');

      const before = rolledBackSql(`SELECT string_agg(id::text || change_type, ',' ORDER BY occurred_at, id)
        FROM product_changes WHERE product_id = '${created.id}';`).output;
      const inactive = await updateProduct(moderator, repriced, { active: false });
      expect(inactive).toMatchObject({ id: created.id, active: false, status: 'INACTIVE', sellingPrice: '11.00' });
      expect(inactive.history.map(({ changeType }) => changeType))
        .toEqual(['DEACTIVATED', 'PRICE_CHANGED', 'ACTIVATED', 'PRICE_CHANGED', 'CREATED']);
      const after = rolledBackSql(`SELECT string_agg(id::text || change_type, ',' ORDER BY occurred_at, id)
        FROM product_changes WHERE product_id = '${created.id}';`).output;
      expect(after.startsWith(before)).toBe(true);
      expect(await getProduct(admin, created.id)).toEqual(inactive);
      expect((await listProducts(admin, { categoryId: category.id, status: 'INACTIVE' })).items.map(({ id }) => id))
        .toEqual([created.id]);
    });

  test('E2E-14-24 MRP is optional for every kind; when set, the selling price may equal it but never exceed it', tag,
    async ({ actors }) => {
      const admin = await actors('admin');
      const category = await createCategory(admin);
      const medicine = await createProduct(admin, medicineDraft(category.id));
      const equipment = await createProduct(admin, equipmentDraft(category.id));

      expect((await priceProduct(admin, medicine, '11.50')).mrp).toBeNull();
      const equal = await priceProduct(admin, equipment, '450.00', '450.00');
      expect(equal).toMatchObject({ sellingPrice: '450.00', mrp: '450.00' });

      const above = await admin.put(`/api/staff/products/${equipment.id}/pricing`,
        { sellingPrice: '450.01', mrp: '450.00', version: equal.version });
      await expectApiError(above, 400, 'INVALID_REQUEST');
      expect(storedMoney(equipment.id)).toBe('450.00 450.00');

      const cleared = await priceProduct(admin, equal, '460.00', null);
      expect(cleared).toMatchObject({ sellingPrice: '460.00', mrp: null });
      expect(cleared.history[0]).toMatchObject({ oldSellingPrice: '450.00', newSellingPrice: '460.00', oldMrp: '450.00',
        newMrp: null });
      expect(await activeProduct(admin, equipmentDraft(category.id), '450.00')).toMatchObject({ status: 'ACTIVE',
        mrp: null });
    });

  test('E2E-14-25 money is exact BDT: decimal strings from 0.01 to 9999999.99, never rounded or coerced', tag,
    async ({ actors }) => {
      const admin = await actors('admin');
      const category = await createCategory(admin);
      let product = await createProduct(admin, equipmentDraft(category.id));
      const accepted: [string, string | null, string, string | null][] = [
        ['0.01', null, '0.01', null],
        ['9999999.99', '9999999.99', '9999999.99', '9999999.99'],
        ['125.5', '130', '125.50', '130.00'],
        ['7', null, '7.00', null],
        ['1000.00', '1000.00', '1000.00', '1000.00'],
      ];
      for (const [sellingPrice, mrp, shownPrice, shownMrp] of accepted) {
        product = await priceProduct(admin, product, sellingPrice, mrp);
        expect(product, sellingPrice).toMatchObject({ sellingPrice: shownPrice, mrp: shownMrp });
        expect(storedMoney(product.id)).toBe(`${shownPrice} ${shownMrp ?? 'null'}`);
      }

      const refused: unknown[] = ['0', '0.00', '-1', '-1.00', '1.005', '1e3', '1,000', ' 1.00', '1.00 ', '10000000',
        '10000000.00', '+1', '', '.50', '1.', '১০০', 'NaN', 11.5, 1, true, ['1.00'], { amount: '1.00' }];
      for (const sellingPrice of refused) {
        const response = await admin.put(`/api/staff/products/${product.id}/pricing`,
          { sellingPrice, mrp: null, version: product.version });
        expect(response.status(), JSON.stringify(sellingPrice)).toBe(400);
        await expectApiError(response, 400, 'INVALID_REQUEST');
        const asMrp = await admin.put(`/api/staff/products/${product.id}/pricing`,
          { sellingPrice: '1.00', mrp: sellingPrice, version: product.version });
        expect(asMrp.status(), `mrp ${JSON.stringify(sellingPrice)}`).toBe(400);
      }
      expect(await getProduct(admin, product.id)).toEqual(product);
    });

  test('E2E-14-26 stale saves get 409 STALE_UPDATE; a lost-response retry of the same save is a harmless no-op', tag,
    async ({ actors }) => {
      const moderator = await actors('moderator');
      const admin = await actors('admin');
      const category = await createCategory(admin);
      const loaded = await createProduct(admin, medicineDraft(category.id));

      const first = await updateProduct(moderator, loaded, { description: 'Saved first.' });
      const second = await admin.put(`/api/staff/products/${loaded.id}`, catalogBody(loaded, { description: 'Saved second.' }));
      await expectApiError(second, 409, 'STALE_UPDATE');
      expect((await second.json() as { message: string }).message)
        .toBe('This record changed after you opened it. Reload and try again.');
      await expectApiError(await admin.put(`/api/staff/products/${loaded.id}/pricing`,
        { sellingPrice: '5.00', mrp: null, version: loaded.version }), 409, 'STALE_UPDATE');
      expect(await getProduct(admin, loaded.id)).toEqual(first);

      // Two forms, one version: after pricing, the catalog save must use the pricing response's version.
      const priced = await priceProduct(admin, first, '5.00');
      await expectApiError(await moderator.put(`/api/staff/products/${loaded.id}`,
        catalogBody(first, { requireValidation: true })), 409, 'STALE_UPDATE');
      // The pricing response was lost; the retry with the old version and the same values changes nothing.
      const retried = await expectJson<Product>(await admin.put(`/api/staff/products/${loaded.id}/pricing`,
        { sellingPrice: '5.00', mrp: null, version: first.version }), 200);
      expect(retried).toEqual(priced);
      // The same holds for a retried catalog save.
      expect(await updateProduct(moderator, { ...priced, version: first.version }, { description: 'Saved first.' }))
        .toEqual(priced);
      expect(historyCount(loaded.id)).toBe(3);
    });

  test('E2E-14-27 concurrent saves: one wins and the other is stale; concurrent creates make one Product and one row',
    tag, async ({ actors }) => {
      // An outcome check only: two requests sent together over HTTP may not overlap inside the API, so this test proves
      // the results, not the interleaving. The deterministic proof is the backend `ConcurrentCatalogIT` (plan T6), which
      // holds the row lock on a second connection until both requests wait on it.
      const moderator = await actors('moderator');
      const admin = await actors('admin');
      const category = await createCategory(admin);
      const product = await priceProduct(admin, await createProduct(admin, medicineDraft(category.id)), '9.00');

      const statuses = (await Promise.all([
        moderator.put(`/api/staff/products/${product.id}`, catalogBody(product, { description: 'Moderator.' })),
        admin.put(`/api/staff/products/${product.id}`, catalogBody(product, { description: 'Admin.' })),
      ])).map((response) => response.status()).sort();
      expect(statuses).toEqual([200, 409]);

      // A pricing save racing an activation from the same version: one wins, and the result is still valid.
      const current = await getProduct(admin, product.id);
      const raced = (await Promise.all([
        admin.put(`/api/staff/products/${product.id}/pricing`, { sellingPrice: '8.00', mrp: null, version: current.version }),
        moderator.put(`/api/staff/products/${product.id}`, catalogBody(current, { active: true })),
      ])).map((response) => response.status()).sort();
      expect(raced).toEqual([200, 409]);
      const settled = await getProduct(admin, product.id);
      expect(settled.sellingPrice).not.toBeNull();

      const draft = medicineDraft(category.id);
      const creates = (await Promise.all([admin.post('/api/staff/products', draft), moderator.post('/api/staff/products', draft)]))
        .map((response) => response.status()).sort();
      expect(creates).toEqual([200, 201]);
      expect(historyCount(String(draft.id))).toBe(1);

      const name = `Twin ${token()}`;
      const twins = (await Promise.all([
        admin.post('/api/staff/categories', { id: randomUUID(), name }),
        moderator.post('/api/staff/categories', { id: randomUUID(), name: name.toUpperCase() }),
      ])).map((response) => response.status()).sort();
      expect(twins).toEqual([201, 409]);
    });

  test('E2E-14-28 requireValidation, activation and price changes are audited with old and new values, newest first, 20 at most',
    tag, async ({ actors }) => {
      const moderator = await actors('moderator');
      const admin = await actors('admin');
      const category = await createCategory(admin);
      let product = await priceProduct(admin, await createProduct(moderator, medicineDraft(category.id)), '30.00', '35.00');

      product = await updateProduct(moderator, product, { requireValidation: true });
      expect(product.requireValidation).toBe(true);
      expect(product.history[0]).toMatchObject({ changeType: 'REQUIRE_VALIDATION_CHANGED', actorUsername: moderator.username,
        oldRequireValidation: false, newRequireValidation: true });

      // One save that changes the flag and activates writes two rows.
      product = await updateProduct(moderator, product, { requireValidation: false, active: true });
      expect(product.history.slice(0, 2).map(({ changeType }) => changeType).sort())
        .toEqual(['ACTIVATED', 'REQUIRE_VALIDATION_CHANGED']);
      expect(product.version).toBe(3);

      for (let toggle = 0; toggle < 18; toggle += 1) {
        product = await updateProduct(moderator, product, { requireValidation: !product.requireValidation });
      }
      expect(historyCount(product.id)).toBe(23);
      expect(product.history).toHaveLength(20);
      const times = product.history.map(({ occurredAt }) => Date.parse(occurredAt));
      expect(times).toEqual([...times].sort((a, b) => b - a));
      expect(product.history.some(({ changeType }) => changeType === 'CREATED')).toBe(false);
    });

  test('E2E-14-29 the staff list searches name, brand and generic, filters by category, status and review, and pages',
    tag, async ({ actors }) => {
      const admin = await actors('admin');
      const category = await createCategory(admin);
      const otherCategory = await createCategory(admin);
      const mark = token();
      const needsPrice = await createProduct(admin, medicineDraft(category.id, { name: `Alpha ${mark}` }));
      const inactive = await priceProduct(admin, await createProduct(admin,
        medicineDraft(category.id, { name: `Bravo ${mark}`, requireValidation: true })), '10.00');
      const active = await activeProduct(admin, equipmentDraft(category.id, { name: `Charlie ${mark}` }), '20.00');
      const byBrand = await createProduct(admin, medicineDraft(otherCategory.id, { name: `Delta`, brandName: `Brand${mark}` }));
      const byGeneric = await createProduct(admin, medicineDraft(otherCategory.id, { name: `Echo`, genericName: `Gen${mark}` }));
      const percent = await createProduct(admin, medicineDraft(otherCategory.id, { name: `Foxtrot 100%_${mark}` }));

      const ids = async (query: Record<string, string | number | boolean>) =>
        (await listProducts(admin, query)).items.map(({ id }) => id);
      expect(await ids({ q: mark.toUpperCase() })).toEqual(
        [needsPrice, inactive, active, byBrand, byGeneric, percent].map(({ id }) => id));
      expect(await ids({ categoryId: category.id })).toEqual([needsPrice.id, inactive.id, active.id]);
      expect(await ids({ categoryId: category.id, status: 'NEEDS_PRICE' })).toEqual([needsPrice.id]);
      expect(await ids({ categoryId: category.id, status: 'INACTIVE' })).toEqual([inactive.id]);
      expect(await ids({ categoryId: category.id, status: 'ACTIVE' })).toEqual([active.id]);
      expect(await ids({ categoryId: category.id, reviewRequired: true })).toEqual([inactive.id]);
      // `%` and `_` are matched literally, not as LIKE wildcards.
      expect(await ids({ q: `100%_${mark}` })).toEqual([percent.id]);
      expect(await ids({ q: `0%${mark}` })).toEqual([]);
      expect(await ids({ q: `a_pha ${mark}` })).toEqual([]);

      const firstPage = await listProducts(admin, { q: mark, size: 4, page: 0 });
      expect(firstPage).toMatchObject({ page: 0, size: 4, totalItems: 6 });
      expect(firstPage.items).toHaveLength(4);
      for (const item of firstPage.items) expect(Object.keys(item).sort()).toEqual(productSummaryKeys);
      expect(firstPage.items[1]).toMatchObject({ status: 'INACTIVE', sellingPrice: '10.00', mrp: null,
        categoryName: category.name, requireValidation: true });
      const secondPage = await listProducts(admin, { q: mark, size: 4, page: 1 });
      expect(secondPage.items.map(({ id }) => id)).toEqual([byGeneric.id, percent.id]);
      expect((await listProducts(admin, { q: mark, size: 50 })).items).toHaveLength(6);

      // No stock-derived filter exists (AC5): a stock parameter filters nothing.
      expect(await ids({ q: mark, inStock: true })).toEqual(await ids({ q: mark }));
      for (const query of ['size=51', 'size=0', 'page=-1', `q=${'x'.repeat(101)}`, 'status=PURCHASABLE',
        'categoryId=pain-relief', 'reviewRequired=maybe']) {
        await expectApiError(await admin.get(`/api/staff/products?${query}`), 400, 'INVALID_REQUEST');
      }
      expect((await listProducts(admin, { q: 'x'.repeat(100), categoryId: category.id })).items).toEqual([]);
    });

  test('E2E-14-30 the API log keeps product text, search terms and prices out while recording each response', tag,
    async ({ actors }) => {
      const admin = await actors('admin');
      const category = await createCategory(admin, `Logcat ${token()}`);
      const marker = `Zq${token()}Log`;
      const product = await createProduct(admin, medicineDraft(category.id,
        { name: `${marker} name`, genericName: `${marker} generic`, description: `${marker} description` }));
      await priceProduct(admin, product, '7654321.98', '7654321.99');
      await listProducts(admin, { q: `${marker} search` });
      await expectApiError(await admin.put(`/api/staff/products/${product.id}/pricing`,
        { sellingPrice: '8765432.10', mrp: '1.00', version: 1 }), 400, 'INVALID_REQUEST');

      const log = readFileSync(apiLogPath, 'utf8');
      expect(log).toContain('"message":"HTTP response status=201');
      for (const secret of [marker, category.name, '7654321.98', '7654321.99', '8765432.10']) {
        expect(log.includes(secret), `${secret} in the API log`).toBe(false);
      }
    });

  test('E2E-14-45 one role per User, higher roles inherit lower ones: an Admin who never held MODERATOR manages the catalog; only an Admin prices',
    tag, async ({ actors }) => {
      const admin = await actors('admin');
      const moderator = await actors('moderator');
      const deliveryPerson = await actors('deliveryPerson');
      const customer = await actors('customer');
      for (const [actor, role] of [[admin, 'ADMIN'], [moderator, 'MODERATOR'], [deliveryPerson, 'DELIVERY_PERSON'],
        [customer, 'CUSTOMER']] as const) {
        expect(storedRoles(actor.username), actor.kind).toEqual([role]);
      }

      // The Admin runs every Moderator command, then prices, activates and deactivates.
      const category = await updateCategory(admin, await createCategory(admin), { name: `Renamed ${token()}` });
      const created = await createProduct(admin, medicineDraft(category.id));
      const edited = await updateProduct(admin, created, { name: `Edited ${token()}`, requireValidation: true });
      const priced = await priceProduct(admin, edited, '30.00', '32.00');
      const active = await updateProduct(admin, priced, { active: true });
      expect(active).toMatchObject({ status: 'ACTIVE', sellingPrice: '30.00', mrp: '32.00' });
      const inactive = await updateProduct(admin, active, { active: false });

      // The Moderator edits the catalog but is refused pricing.
      const moderated = await updateProduct(moderator, inactive, { brandName: `Brand ${token()}` });
      await expectApiError(await moderator.put(`/api/staff/products/${created.id}/pricing`,
        { sellingPrice: '31.00', mrp: '32.00', version: moderated.version }), 403, 'ACCESS_DENIED');

      // A DeliveryPerson, just below Moderator, and a Customer are refused catalog management and pricing.
      for (const actor of [deliveryPerson, customer]) {
        for (const [method, path, body] of routes(created.id, category.id)) {
          await expectApiError(await actor.send(method, path, body), 403, 'ACCESS_DENIED');
        }
      }

      const after = await getProduct(admin, created.id);
      expect(after).toMatchObject({ sellingPrice: '30.00', mrp: '32.00', version: moderated.version });
      expect(storedMoney(created.id)).toBe('30.00 32.00');
    });

  test('E2E-14-46 a create retried with the same id returns the stored record only when the payload is the same',
    tag, async ({ actors }) => {
      const moderator = await actors('moderator');
      const admin = await actors('admin');

      // Categories: the same name after trimming is the same create; any other name, even in another case, conflicts.
      const id = randomUUID();
      const name = `Retry ${token()}`;
      const category = await expectJson<Category>(await moderator.post('/api/staff/categories', { id, name }), 201);
      expect(await expectJson<Category>(await admin.post('/api/staff/categories', { id, name: `  ${name} ` }), 200))
        .toEqual(category);
      for (const other of [`${name} x`, name.toUpperCase(), `Other ${token()}`]) {
        await expectApiError(await moderator.post('/api/staff/categories', { id, name: other }), 409, 'ID_CONFLICT');
      }
      expect(await findCategory(admin, id)).toEqual(category);
      const otherCategory = await createCategory(admin);

      // Products: normalized fields equal → 200 with no second CREATED row; any compared field different → 409.
      const draft = medicineDraft(category.id, { description: 'Take after food.' });
      const product = await createProduct(moderator, draft);
      const sameAfterNormalizing = { ...draft, name: `  ${String(draft.name)}  `, description: 'Take after food. ' };
      expect(await expectJson<Product>(await admin.post('/api/staff/products', sameAfterNormalizing), 200))
        .toEqual(product);
      const different: [string, Record<string, unknown>][] = [
        ['name', { name: `Other ${token()}` }],
        ['brandName', { brandName: 'Ace' }],
        ['genericName', { genericName: 'Ibuprofen' }],
        ['manufacturer', { manufacturer: null }],
        ['dosageForm', { dosageForm: 'Tablet 650 mg' }],
        ['saleUnit', { saleUnit: 'Strip of 8 tablets' }],
        ['description', { description: null }],
        ['categoryId', { categoryId: otherCategory.id }],
        ['requireValidation', { requireValidation: true }],
        ['kind', { kind: 'EQUIPMENT', genericName: null, dosageForm: null }],
      ];
      for (const [field, change] of different) {
        const response = await moderator.post('/api/staff/products', { ...draft, ...change });
        expect(response.status(), field).toBe(409);
        await expectApiError(response, 409, 'ID_CONFLICT');
      }
      expect(await getProduct(admin, product.id)).toEqual(product);
      expect(historyCount(product.id)).toBe(1);
    });

  test('E2E-14-50 a create retried after later changes is compared with the stored record: catalog edits conflict, pricing, activation and category deactivation do not',
    tag, async ({ actors }) => {
      const moderator = await actors('moderator');
      const admin = await actors('admin');

      // Category: deactivation is not a compared field, so the original retry still matches; a rename conflicts.
      const categoryCreate = { id: randomUUID(), name: `Retry later ${token()}` };
      const created = await expectJson<Category>(await moderator.post('/api/staff/categories', categoryCreate), 201);
      const deactivated = await updateCategory(admin, created, { active: false });
      expect(await expectJson<Category>(await moderator.post('/api/staff/categories', categoryCreate), 200))
        .toEqual(deactivated);
      const renamed = await updateCategory(admin, deactivated, { name: `${categoryCreate.name} renamed` });
      await expectApiError(await moderator.post('/api/staff/categories', categoryCreate), 409, 'ID_CONFLICT');
      expect(await findCategory(admin, created.id)).toEqual(renamed);

      // Product: each retry of the original body after pricing, activation and its category's deactivation returns
      // 200 with the stored record as it is now, and writes no history.
      const category = await createCategory(admin);
      const draft = medicineDraft(category.id);
      const product = await createProduct(moderator, draft);
      const retryMatches = async (label: string): Promise<Product> => {
        const before = historyCount(product.id);
        const stored = await getProduct(admin, product.id);
        const response = await moderator.post('/api/staff/products', draft);
        expect(response.status(), label).toBe(200);
        expect(await expectJson<Product>(response, 200)).toEqual(stored);
        expect(historyCount(product.id), label).toBe(before);
        return stored;
      };
      await priceProduct(admin, product, '11.50', '12.00');
      await retryMatches('after pricing');
      await updateProduct(admin, await getProduct(admin, product.id), { active: true });
      await retryMatches('after activation');
      await updateCategory(admin, category, { active: false });
      const beforeEdit = await retryMatches('after the category was deactivated');
      expect(beforeEdit).toMatchObject({ status: 'ACTIVE', categoryId: category.id, sellingPrice: '11.50' });

      // A catalog edit (keeping the unchanged inactive category) makes the original body a different payload: 409.
      const edited = await updateProduct(moderator, beforeEdit, { brandName: `Brand ${token()}` });
      const historyAfterEdit = historyCount(product.id);
      await expectApiError(await moderator.post('/api/staff/products', draft), 409, 'ID_CONFLICT');
      expect(await getProduct(admin, product.id)).toEqual(edited);
      expect(historyCount(product.id)).toBe(historyAfterEdit);
    });

  test('E2E-14-47 the category list is paged in a stable order, and a category beyond the first page can be renamed and deactivated',
    tag, async ({ actors }) => {
      const admin = await actors('admin');
      const mark = token();
      // Names starting "0 Paged" sort before letters, and these 20 sort before the 21st, so at least 20 categories come
      // before it: with the default size of 20 it is never on the first page.
      const created: Category[] = [];
      for (let index = 1; index <= 21; index += 1) {
        created.push(await createCategory(admin, `0 Paged ${mark} ${String(index).padStart(2, '0')}`));
      }
      const beyond = created[20];

      const first = await listCategories(admin);
      expect(Object.keys(first).sort()).toEqual(pageKeys);
      expect(first).toMatchObject({ page: 0, size: 20 });
      expect(first.items).toHaveLength(20);
      for (const item of first.items) expect(Object.keys(item).sort()).toEqual(categoryKeys);
      expect(first.items.some(({ id }) => id === beyond.id)).toBe(false);

      // Walking every page at an odd size: pages never overlap, together they hold totalItems, and this run's
      // categories come in name order.
      const walked: Category[] = [];
      let totalItems = 0;
      for (let page = 0; page === 0 || page * 7 < totalItems; page += 1) {
        const listed = await listCategories(admin, { page, size: 7 });
        expect(listed).toMatchObject({ page, size: 7 });
        totalItems = listed.totalItems;
        walked.push(...listed.items);
      }
      expect(walked).toHaveLength(totalItems);
      expect(new Set(walked.map(({ id }) => id)).size).toBe(totalItems);
      expect(walked.filter(({ name }) => name.includes(mark)).map(({ id }) => id)).toEqual(created.map(({ id }) => id));
      const pastEnd = await listCategories(admin, { page: Math.ceil(totalItems / 50) + 1, size: 50 });
      expect(pastEnd).toMatchObject({ items: [], totalItems });
      expect((await listCategories(admin, { size: 50 })).items).toHaveLength(Math.min(50, totalItems));

      // The category beyond the first page is renamed and deactivated like any other.
      const pageOf = (id: string) => walked.findIndex((category) => category.id === id);
      expect(Math.floor(pageOf(beyond.id) / 20)).toBeGreaterThan(0);
      const renamed = await updateCategory(admin, beyond, { name: `${beyond.name} renamed` });
      const inactive = await updateCategory(admin, renamed, { active: false });
      expect(await findCategory(admin, beyond.id)).toEqual(inactive);
      expect((await allCategories(admin, false)).some(({ id }) => id === beyond.id)).toBe(false);

      for (const query of ['page=-1', 'page=x', 'size=0', 'size=51', 'size=x', 'includeInactive=maybe']) {
        await expectApiError(await admin.get(`/api/staff/categories?${query}`), 400, 'INVALID_REQUEST');
      }
    });
});
