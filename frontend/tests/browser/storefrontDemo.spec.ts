import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import {
  activeProduct, createCategory, expect, findCategory, medicineDraft, test, token, updateCategory, updateProduct,
  type Product,
} from './catalogSupport';
import { assertAwayFromDhakaMidnight, discountApi, discountDraft } from './discountSupport';
import { validJpeg, validPng } from './imageFixtures';
import { uploadImage } from './productImageSupport';
import {
  aboutRows, canonical, firstCategories, normalizedText, openStorefront, pageTitle, publicCatalog, publicOrder,
  storefront, storefrontCopy, storefrontPageSize, taka,
} from './storefrontSupport';
import { frontendUrl } from './testApi';

/** The only opt-in test. Ordinary runs skip the file before its calendar guard or fixtures run. */
test.skip(!process.env.MEDI_WISH_DEMO_DIR, 'Set MEDI_WISH_DEMO_DIR to save the Ticket 17 storefront demonstration.');
test.beforeEach(() => assertAwayFromDhakaMidnight());

/** "Demo Med 01 {mark}" … "Demo Med 25 {mark}", with 03 and 04 in other letter cases (plan §1 demo step 1). */
function demoNames(mark: string): string[] {
  return Array.from({ length: 25 }, (_, index) => {
    const number = String(index + 1).padStart(2, '0');
    if (number === '03') return `demo med 03 ${mark}`;
    if (number === '04') return `DEMO MED 04 ${mark}`;
    return `Demo Med ${number} ${mark}`;
  });
}

test('E2E-17-22 Ticket 17 storefront demonstration: categories, paging, details, not-found states and server HTML',
  { tag: ['@t17', '@t17-demo'] }, async ({ page, request, actors, api }, testInfo) => {
    test.setTimeout(300_000);
    const output = join(process.env.MEDI_WISH_DEMO_DIR!, testInfo.project.name);
    await mkdir(output, { recursive: true });
    const screenshot = async (target: Page, name: string) => {
      const path = join(output, `${name}.png`);
      await target.screenshot({ path, fullPage: true });
      await testInfo.attach(name, { path, contentType: 'image/png' });
    };
    const admin = await actors('admin');
    const view = storefront(page);
    const mark = token();

    const fever = await createCategory(admin, `Demo Fever ${mark}`);
    const names = demoNames(mark);
    const created: Product[] = [];
    for (const name of names) {
      const featured = name === `Demo Med 05 ${mark}`;
      created.push(await activeProduct(admin, medicineDraft(fever.id, { name, requireValidation: featured }),
        featured ? '150.00' : '120.00', featured ? '180.00' : null));
    }
    const products = publicOrder(created);
    const featured = products.find((product) => product.name === `Demo Med 05 ${mark}`)!;
    const empty = await createCategory(admin, `Demo Empty ${mark}`);
    const hidden = await createCategory(admin, `Demo Hidden ${mark}`);
    const hiddenProduct = await activeProduct(admin, medicineDraft(hidden.id, { name: `Demo Hidden Med ${mark}` }), '99.00');

    await test.step('1: 25 medicines, one reviewed with MRP and two images, 10% Category Discount today', async () => {
      for (const file of [
        { bytes: validPng(), name: 'front.png', mimeType: 'image/png' },
        { bytes: validJpeg(), name: 'back.jpg', mimeType: 'image/jpeg' },
      ]) {
        const uploaded = await uploadImage(api, admin, featured.id, file.bytes, { name: file.name, mimeType: file.mimeType });
        expect(uploaded.status()).toBe(201);
      }
      await discountApi(admin).create(discountDraft('CATEGORY', fever.id));
      expect(products.map((product) => product.name)).toEqual(names);
    });

    await test.step('2: Demo Empty stays active with no Products; Demo Hidden is deactivated', async () => {
      await updateCategory(admin, (await findCategory(admin, hidden.id))!, { active: false });
    });

    await test.step('3: the home Categories grid and the header bar list Demo Fever only', async () => {
      const listed = await publicCatalog(api).categories();
      const first = firstCategories(listed);
      expect(first.map((category) => category.id), 'run the demo alone so Demo Fever is among the first 8')
        .toContain(fever.id);
      expect(listed.map((category) => category.id)).not.toContain(empty.id);
      expect(listed.map((category) => category.id)).not.toContain(hidden.id);
      await openStorefront(page, '/');
      await expect(view.categoryNavLinks).toHaveText([...first.map((category) => category.name), storefrontCopy.allCategories]);
      await expect(view.tiles).toHaveText(first.map((category) => category.name));
      for (const absent of [empty.name, hidden.name]) {
        await expect(page.getByRole('link', { name: absent, exact: true })).toHaveCount(0);
      }
      await screenshot(page, '03-home-categories');
    });

    await test.step('4: Demo Fever shows 24 discounted cards in name order; Next shows the 25th', async () => {
      await view.homeCategories.getByRole('link', { name: fever.name, exact: true }).click();
      await expect(page).toHaveURL(`${frontendUrl}/categories/${fever.id}`);
      await expect(view.cards).toHaveCount(storefrontPageSize);
      const cardNames = (await view.main.locator('article a[href^="/products/"]').allInnerTexts())
        .map(normalizedText).filter((name) => name.length > 0);
      expect(cardNames).toEqual(names.slice(0, storefrontPageSize));
      await expect(view.badge).toHaveText(Array(storefrontPageSize).fill('10% OFF'));
      await expect(view.wasPrice).toHaveCount(storefrontPageSize);
      await expect(view.card(names[0]).locator('.price')).toHaveText(taka('108.00'));
      await expect(view.card(names[0]).locator('s.price-was')).toContainText(taka('120.00'));
      await expect(view.card(featured.name).locator('.price')).toHaveText(taka('135.00'));
      await screenshot(page, '04-category-page-1');
      await view.next.click();
      await expect(page).toHaveURL(`${frontendUrl}/categories/${fever.id}?page=2`);
      await expect(view.cards).toHaveCount(1);
      await expect(view.cardLink(names[24])).toBeVisible();
      await screenshot(page, '04-category-page-2');
    });

    await test.step('5: the reviewed Product shows breadcrumb, gallery, price, MRP, review note and About, also after reload',
      async () => {
        await view.previous.click();
        await expect(page).toHaveURL(`${frontendUrl}/categories/${fever.id}`);
        await view.cardLink(featured.name).click();
        await expect(page).toHaveURL(`${frontendUrl}/products/${featured.id}`);
        const expectDetails = async () => {
          await expect(view.heading).toHaveText(featured.name);
          await expect(view.breadcrumbLinks).toHaveText([storefrontCopy.home, fever.name]);
          await expect(view.thumbnails).toHaveCount(2);
          await expect(view.price.first()).toHaveText(taka('135.00'));
          await expect(view.wasPrice.first()).toContainText(taka('150.00'));
          await expect(view.badge.first()).toHaveText('10% OFF');
          await expect(view.mrpLabel).toHaveText(`MRP ${taka('180.00')}`);
          await expect(view.reviewNote).toBeVisible();
          await expect(view.about).toBeVisible();
          await expect.poll(() => aboutRows(view.about)).toContainEqual([storefrontCopy.saleUnit, featured.saleUnit]);
        };
        await expectDetails();
        expect((await page.reload())?.status()).toBe(200);
        await expectDetails();
        await screenshot(page, '05-product-details');
      });

    await test.step('6: hidden-category Product, hidden and empty categories, and a page past the end', async () => {
      await openStorefront(page, `/products/${hiddenProduct.id}`);
      await expect(view.heading).toHaveText(hiddenProduct.name);
      await expect(view.breadcrumbLinks).toHaveText([storefrontCopy.home]);
      await screenshot(page, '06-hidden-category-product');
      await openStorefront(page, `/categories/${hidden.id}`, 404);
      await expect(view.notFoundTitle).toBeVisible();
      await screenshot(page, '06-hidden-category-404');
      await openStorefront(page, `/categories/${empty.id}`);
      await expect(view.emptyTitle).toBeVisible();
      await expect(view.pagination).toHaveCount(0);
      await screenshot(page, '06-empty-category');
      await openStorefront(page, `/categories/${fever.id}?page=3`, 404);
      await expect(view.notFoundTitle).toBeVisible();
    });

    await test.step('7: deactivating a listed Product makes its details page 404 on reload', async () => {
      const listed = products[0];
      await openStorefront(page, `/products/${listed.id}`);
      await expect(view.heading).toHaveText(listed.name);
      await updateProduct(admin, listed, { active: false });
      expect((await page.reload())?.status()).toBe(404);
      await expect(view.notFoundTitle).toBeVisible();
      await screenshot(page, '07-deactivated-product-404');
    });

    await test.step('8: the details HTML without JavaScript holds the title, canonical and price', async () => {
      const response = await request.get(`/products/${featured.id}`);
      expect(response.status()).toBe(200);
      const html = await response.text();
      expect(html).toContain(`<title>${pageTitle(featured.name)}</title>`);
      const link = /<link\b[^>]*\brel="canonical"[^>]*>/.exec(html)?.[0] ?? '';
      expect(/\bhref="([^"]+)"/.exec(link)?.[1]).toBe(canonical(`/products/${featured.id}`));
      expect(html).toContain(taka('135.00'));
    });
  });
