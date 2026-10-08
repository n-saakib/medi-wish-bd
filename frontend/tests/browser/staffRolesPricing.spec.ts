import { randomBytes, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import {
  apiStaff, apiSuperAdmin, changeRole, expectError, expectRevoked, findUser, signInAgain, type ApiActor,
} from './apiSession';

/**
 * Cross-ticket checks of Tickets 08 and 14 (Ticket 08 plan §8.2): the Moderator pricing refusal and the role-API
 * demotion case. Every User holds one role and pricing is Admin-only, so "demotion" means the Super Admin replacing an
 * Admin's role with a lower one: MODERATOR (still staff, but below pricing) or CUSTOMER (DECISIONS S6). Added by
 * Ticket 14 T6 under §8.2 scenario A (Ticket 08 merged first). It needs Ticket 08's `apiSession.ts` and role routes
 * and Ticket 14's catalog and pricing routes on the same revision; never add a placeholder pricing route to make it
 * pass. Run with `npm run test:browser -- --grep @cross-08-14`.
 */

type Product = { id: string; sellingPrice: string | null; mrp: string | null; version: number };

/** Creates a category and an unpriced MEDICINE Product through Ticket 14's staff catalog routes (Admin or Moderator). */
async function createProduct(staff: ApiActor): Promise<Product> {
  const suffix = randomBytes(4).toString('hex');
  const categoryId = randomUUID();
  const category = await staff.session.call('POST', '/api/staff/categories',
    { data: { id: categoryId, name: `Cross category ${suffix}` } });
  expect(category.status(), 'category create').toBe(201);
  const created = await staff.session.call('POST', '/api/staff/products', {
    data: {
      id: randomUUID(), kind: 'MEDICINE', name: `Cross ${suffix}`, brandName: 'Synthetic', genericName: 'Paracetamol',
      manufacturer: 'Synthetic Labs', dosageForm: 'Tablet 500 mg', saleUnit: 'Strip of 10 tablets', description: null,
      categoryId, requireValidation: false,
    },
  });
  expect(created.status(), 'product create').toBe(201);
  return await created.json() as Product;
}

function putPricing(staff: ApiActor, product: Product, version = product.version) {
  return staff.session.call('PUT', `/api/staff/products/${product.id}/pricing`,
    { data: { sellingPrice: '11.50', mrp: '12.00', version } });
}

test('E2E-X-01 a verified Moderator’s pricing change is refused with 403 ACCESS_DENIED and changes nothing',
  { tag: ['@cross-08-14'] }, async ({ request }) => {
    const moderator = await apiStaff(request, 'MODERATOR');
    const admin = await apiStaff(request, 'ADMIN');
    const product = await createProduct(moderator);

    await expectError(await putPricing(moderator, product), 403, 'ACCESS_DENIED');
    // The refusal changed nothing: an Admin prices the Product at the version the Moderator saw.
    const priced = await putPricing(admin, product);
    expect(priced.status()).toBe(200);
    expect(await priced.json()).toMatchObject({ sellingPrice: '11.50', mrp: '12.00', version: product.version + 1 });
    for (const actor of [moderator, admin]) await actor.session.dispose();
  });

for (const [id, lowerRole, signedInAgain] of [
  ['E2E-X-02', 'CUSTOMER', 'NOT_REQUIRED'],
  ['E2E-X-03', 'MODERATOR', 'VERIFICATION_REQUIRED'],
] as const) {
  test(`${id} the Super Admin demotes Admin B to ${lowerRole} through the role API: B’s next pricing call is 401, then 403`,
    { tag: ['@cross-08-14'] }, async ({ request }) => {
      const owner = await apiSuperAdmin(request);
      const adminB = await apiStaff(request, 'ADMIN');
      const product = await createProduct(adminB);
      const bId = (await findUser(owner.session, adminB.user.username)).id;

      // 1. The Super Admin replaces B's role through PUT /api/admin/users/{B}/roles.
      expect((await adminB.session.refresh()).status()).toBe(200);
      const token = adminB.session.accessToken;
      expect(await changeRole(owner.session, bId, lowerRole, 0)).toMatchObject({ role: lowerRole, rolesVersion: 1 });

      // 2. B's next pricing call with the old token → 401: the session was revoked, not expired.
      await expectError(await adminB.session.call('PUT', `/api/staff/products/${product.id}/pricing`,
        { token, data: { sellingPrice: '11.50', mrp: '12.00', version: product.version } }), 401, 'AUTHENTICATION_REQUIRED');
      await expectRevoked(adminB.session);

      // 3. B signs in again (a Moderator keeps the authenticator and enters a fresh code) → pricing → 403.
      expect(await signInAgain(adminB)).toBe(signedInAgain);
      if (signedInAgain === 'VERIFICATION_REQUIRED') await adminB.session.verify(adminB.authenticator!);
      await expectError(await putPricing(adminB, product), 403, 'ACCESS_DENIED');
      // A Customer loses the whole staff catalog; a Moderator still reads it.
      const catalog = await adminB.session.call('GET', '/api/staff/products');
      if (lowerRole === 'CUSTOMER') await expectError(catalog, 403, 'ACCESS_DENIED');
      else expect(catalog.status()).toBe(200);
      for (const actor of [owner, adminB]) await actor.session.dispose();
    });
}
