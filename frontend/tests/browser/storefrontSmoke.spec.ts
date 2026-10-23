import { expect, test } from './catalogSupport';
import { openStorefront, publicCatalog, seedCategory, storefront, taka, unknownId } from './storefrontSupport';

/**
 * Ticket 17 T7 smoke (E2E-17-18): the shortest guest path through the storefront on the real stack. Test-first: it fails
 * until T3/T4 land.
 */
test('E2E-17-18 a guest opens a category, one of its Products and an unknown Product',
  { tag: ['@t17', '@t17-T7', '@t17-ui', '@smoke'] }, async ({ actors, api, page }) => {
    const started = Date.now();
    const admin = await actors('admin');
    const { category, products: [product] } = await seedCategory(admin, 1);
    const current = (await publicCatalog(api).product(product.id)).price.price;
    const view = storefront(page);

    await openStorefront(page, `/categories/${category.id}`);
    await expect(view.cards).toHaveCount(1);
    await view.cardLink(product.name).click();
    await expect(page).toHaveURL(`/products/${product.id}`);
    await expect(view.heading).toHaveText(product.name);
    await expect(view.price).toHaveText([taka(current)]);

    await openStorefront(page, `/products/${unknownId()}`, 404);
    await expect(view.notFoundTitle).toBeVisible();
    expect(Date.now() - started, 'the smoke journey stays under 30 s (plan T7)').toBeLessThan(30_000);
  });
