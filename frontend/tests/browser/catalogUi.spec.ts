import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import {
  activeProduct, categoryManager, chooseWithArrowKeys, copy, createCategory, createProduct, equipmentDraft, expect,
  getProduct, literal, medicineDraft, openProduct, priceProduct, productEditor, productList, showCategory, staffContext,
  tabTo, test, token, updateCategory,
} from './catalogSupport';
import { register, registeredAdmin, signIn, syntheticCustomer, verifiedAdmin, verifiedModerator } from './support';
import { apiUrl, frontendUrl, removeRole } from './testApi';

/**
 * Ticket 14 staff catalog pages in the real browser against the real test API: `/staff/categories`,
 * `/staff/products`, `/staff/products/new` and `/staff/products/{id}`, with the copy of plan §10. Tests tagged T3 need
 * only the pages; the others need the pages and the API.
 */

const pages = ['/staff/products', '/staff/products/new', '/staff/categories', `/staff/products/${randomUUID()}`];

/** Every API request the page sends to a catalog route, as `METHOD path`. */
function catalogRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (request.url().startsWith(apiUrl) && /^\/api\/staff\/(products|categories)/.test(url.pathname)
      && request.method() !== 'OPTIONS') {
      seen.push(`${request.method()} ${url.pathname}`);
    }
  });
  return seen;
}

/** No horizontal scroll on the page itself; a wide table scrolls inside its own container. */
async function expectNoPageScroll(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
}

/**
 * Every visible input, select and textarea has a label, and every visible target is at least 44 × 44 px: buttons,
 * links, inputs and selects by their own box, checkboxes and radios by their label's hit area (the largest label box).
 */
async function expectLabelledTargets(page: Page): Promise<void> {
  const unlabelled = await page.locator('input, select, textarea').evaluateAll((fields) => fields
    .filter((field) => field.getClientRects().length > 0
      && (field as HTMLInputElement).labels?.length === 0 && !field.getAttribute('aria-label'))
    .map((field) => field.outerHTML));
  expect(unlabelled).toEqual([]);
  const small = await page.locator('button, a[href], input, select').evaluateAll((targets) => targets
    .filter((target) => target.getClientRects().length > 0)
    .map((target) => {
      const input = target as HTMLInputElement;
      const boxes = input.type === 'checkbox' || input.type === 'radio'
        ? [...(input.labels ?? [])].map((label) => label.getBoundingClientRect())
        : [target.getBoundingClientRect()];
      const width = Math.max(0, ...boxes.map((box) => box.width));
      const height = Math.max(0, ...boxes.map((box) => box.height));
      return { html: target.outerHTML, width, height };
    })
    .filter(({ width, height }) => width < 44 || height < 44)
    .map(({ html, width, height }) => `${Math.round(width)}×${Math.round(height)} ${html}`));
  expect(small).toEqual([]);
}

/**
 * The nearest ancestor of the page's table that scrolls sideways: its scroll and client widths. The table must scroll
 * inside this container, not the page.
 */
async function tableContainer(page: Page): Promise<{ found: boolean; scrollWidth: number; clientWidth: number }> {
  return page.locator('table').first().evaluate((table) => {
    for (let element = table.parentElement; element; element = element.parentElement) {
      if (element === document.body) break;
      if (['auto', 'scroll'].includes(getComputedStyle(element).overflowX)) {
        return { found: true, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
      }
    }
    return { found: false, scrollWidth: 0, clientWidth: 0 };
  });
}

/** The focused control shows the amber focus ring. */
async function expectFocusRing(page: Page): Promise<void> {
  expect(await page.evaluate(() => {
    const style = getComputedStyle(document.activeElement as HTMLElement);
    return { style: style.outlineStyle, color: style.outlineColor, wide: parseFloat(style.outlineWidth) >= 2 };
  })).toEqual({ style: 'solid', color: 'rgb(227, 155, 46)', wide: true });
}

test.describe('pages without the catalog API', () => {
  test('E2E-14-04 the staff home links to Products and Categories for Admins and Moderators',
    { tag: ['@t14', '@t14-T3'] }, async ({ page, browser }) => {
      await verifiedAdmin(page);
      const expectLinks = async (staffPage: Page, expected: string[]) => {
        await expect(staffPage.getByRole('link', { name: 'Products', exact: true })).toHaveAttribute('href', '/staff/products');
        await expect(staffPage.getByRole('link', { name: 'Categories', exact: true }))
          .toHaveAttribute('href', '/staff/categories');
        // Plan §8.2 order: Users and roles (Admins only), then Products, then Categories.
        expect(await staffPage.locator('a[href="/admin/users"], a[href="/staff/products"], a[href="/staff/categories"]')
          .allInnerTexts()).toEqual(expected);
      };
      await expectLinks(page, ['Users and roles', 'Products', 'Categories']);
      await expect(page.getByRole('navigation', { name: 'Staff pages' })).toBeVisible();
      await page.getByRole('link', { name: 'Products', exact: true }).click();
      await expect(page).toHaveTitle('Products · Medi Wish');
      await page.getByRole('link', { name: 'New product' }).first().click();
      await expect(page).toHaveTitle('New product · Medi Wish');

      const moderator = await browser.newContext();
      try {
        const moderatorPage = await moderator.newPage();
        await verifiedModerator(moderatorPage);
        await expectLinks(moderatorPage, ['Products', 'Categories']);
        await moderatorPage.getByRole('link', { name: 'Categories', exact: true }).click();
        await expect(moderatorPage).toHaveURL('/staff/categories');
        await expect(moderatorPage.getByRole('heading', { level: 1, name: 'Categories' })).toBeVisible();
        await expect(moderatorPage).toHaveTitle('Categories · Medi Wish');
      } finally {
        await moderator.close();
      }
    });

  test('E2E-14-05 catalog pages send signed-out visitors, Customers and unverified staff away, and are never cached',
    { tag: ['@t14', '@t14-T3'] }, async ({ page, browser }) => {
      for (const path of pages) {
        await page.goto(path);
        await expect(page, path).toHaveURL('/sign-in');
        expect((await page.request.get(path)).headers()['cache-control'], path).toBe('no-store');
      }

      await register(page, syntheticCustomer());
      for (const path of pages) {
        await page.goto(path);
        await expect(page, path).toHaveURL('/account');
      }

      const staff = await browser.newContext();
      try {
        const staffPage = await staff.newPage();
        const admin = await registeredAdmin(staffPage);
        await signIn(staffPage, admin.username, admin.password);
        await expect(staffPage).toHaveURL('/staff/mfa/enroll');
        for (const path of pages) {
          await staffPage.goto(path);
          await expect(staffPage, path).toHaveURL('/staff/mfa/enroll');
        }
      } finally {
        await staff.close();
      }
    });

  test('E2E-14-06 a malformed product address shows "Product not found." without calling the API',
    { tag: ['@t14', '@t14-T3'] }, async ({ page }) => {
      await verifiedAdmin(page);
      const requests = catalogRequests(page);
      for (const id of ['not-a-uuid', '6C1D9A0E-2B7F-4E11-8D3A-5F0E9B2C7A14x', '1']) {
        await page.goto(`/staff/products/${id}`);
        await expect(page.getByText(copy.productNotFound)).toBeVisible();
        await expect(page).toHaveTitle('Edit product · Medi Wish');
      }
      expect(requests.filter((request) => request.includes('/api/staff/products/'))).toEqual([]);
    });
});

test.describe('categories page', () => {
  test('E2E-14-31 a Moderator adds, renames and deactivates a category inline; duplicates and blanks are explained',
    { tag: ['@t14', '@t14-T5'] }, async ({ page, actors }) => {
      await verifiedModerator(page);
      const admin = await actors('admin');
      const existing = await createCategory(admin, `Existing ${token()}`);
      await page.getByRole('link', { name: 'Categories', exact: true }).click();
      const categories = categoryManager(page);
      const name = `Pain relief ${token()}`;

      await categories.add.click();
      await categories.save.click();
      await expect(page.getByText(copy.categoryNameRequired)).toBeVisible();
      await expect(categories.name).toHaveAccessibleDescription(literal(copy.categoryNameRequired));
      await expect(categories.name).toBeFocused();

      await categories.name.fill(existing.name.toUpperCase());
      await categories.save.click();
      await expect(categories.name).toHaveAccessibleDescription(literal(copy.categoryNameTaken));
      // The server's refusal returns focus to the re-enabled name field, which announces the description.
      await expect(categories.name).toBeFocused();

      await categories.name.fill(name);
      await categories.save.click();
      await expect(page.getByRole('status').filter({ hasText: copy.categorySaved })).toBeFocused();
      // The run's schema is shared, so the new row may be on any page.
      const { row } = await showCategory(page, name);
      await expect(row.getByRole('cell', { name: '0', exact: true })).toBeVisible();
      await expect(row.getByText('Active', { exact: true })).toBeVisible();

      await row.getByRole('button', { name: 'Edit' }).click();
      await categories.name.fill(`${name} and fever`);
      await categories.save.click();
      await expect(page.getByRole('status').filter({ hasText: copy.categorySaved })).toBeVisible();
      const { row: renamed } = await showCategory(page, `${name} and fever`);

      await renamed.getByRole('button', { name: 'Edit' }).click();
      await categories.active.uncheck();
      await categories.save.click();
      await expect(renamed.getByText('Inactive', { exact: true })).toBeVisible();

      await page.reload();
      await expect((await showCategory(page, `${name} and fever`)).row.getByText('Inactive', { exact: true }))
        .toBeVisible();
      await expect(page.getByRole('button', { name: /delete|remove/i })).toHaveCount(0);
    });

  test('E2E-14-32 an Admin saving a category someone else changed sees the stale message and reloads',
    { tag: ['@t14', '@t14-T5'] }, async ({ page, actors }) => {
      await verifiedAdmin(page);
      const other = await actors('moderator');
      const category = await createCategory(other);
      await page.goto('/staff/categories');
      const categories = categoryManager(page);
      await (await showCategory(page, category.name)).row.getByRole('button', { name: 'Edit' }).click();

      const theirs = `${category.name} theirs`;
      expect((await other.put(`/api/staff/categories/${category.id}`,
        { name: theirs, active: true, version: category.version })).status()).toBe(200);
      await categories.name.fill(`${category.name} mine`);
      await categories.save.click();
      const stale = page.getByRole('alert').filter({ hasText: copy.categoryStale });
      await expect(stale).toBeVisible();
      await stale.getByRole('button', { name: 'Reload' }).click();
      await showCategory(page, theirs);
      await expect(categories.row(`${category.name} mine`)).toHaveCount(0);
    });
});

test.describe('product pages', () => {
  test('E2E-14-33 journey: a Moderator creates an unpriced Medicine that cannot go live; an Admin prices and activates it',
    { tag: ['@t14', '@t14-T5'] }, async ({ page, browser }) => {
      const moderator = await verifiedModerator(page);
      const categoryName = `Pain relief ${token()}`;
      const productName = `Napa 500 ${token()}`;
      const editor = productEditor(page);
      let productPath = '';

      await test.step('Categories → Add category', async () => {
        await page.getByRole('link', { name: 'Categories', exact: true }).click();
        const categories = categoryManager(page);
        await categories.add.click();
        await categories.name.fill(categoryName);
        await categories.save.click();
        await showCategory(page, categoryName);
      });

      await test.step('Products → New product → a Medicine is saved inactive with "Needs price"', async () => {
        await page.goto('/staff');
        await page.getByRole('link', { name: 'Products', exact: true }).click();
        await expect(page).toHaveURL('/staff/products');
        await expect(page.getByRole('heading', { level: 1, name: 'Products' })).toBeVisible();
        await page.getByRole('link', { name: 'New product' }).click();
        await expect(page).toHaveURL('/staff/products/new');
        await editor.medicine.check();
        await editor.name.fill(productName);
        await editor.brandName.fill('Napa');
        await editor.genericName.fill('Paracetamol');
        await editor.manufacturer.fill('Beximco');
        await editor.dosageForm.fill('Tablet 500 mg');
        await editor.saleUnit.fill('Strip of 10 tablets');
        await expect(editor.saleUnit).toHaveAccessibleDescription(literal(copy.saleUnitHint));
        await editor.category.selectOption({ label: categoryName });
        // Sale Unit explains what one quantity means; that label is not an inventory field (AC5).
        await expect(page.getByLabel(/^(?!Sale unit\b).*(stock|quantity|batch|expiry)/i)).toHaveCount(0);
        await editor.save.click();
        await expect(page).toHaveURL(/\/staff\/products\/[0-9a-f-]{36}$/);
        expect(new URL(page.url()).origin).toBe(frontendUrl);
        productPath = new URL(page.url()).pathname;
        await expect(page.getByRole('heading', { level: 1, name: productName })).toBeVisible();
        await expect(editor.statusChip('Needs price')).toBeVisible();
        await expect(page.getByText(`Last edited by ${moderator.username} · version 0`)).toBeVisible();
        await expect(editor.history.getByRole('listitem')).toHaveCount(1);
        await expect(editor.history).toContainText(`Created by ${moderator.username}`);
      });

      await test.step('the Moderator sees Pricing read-only with the note', async () => {
        await expect(editor.mrp).toBeDisabled();
        await expect(editor.sellingPrice).toBeDisabled();
        await expect(editor.pricing.getByText(copy.moderatorPricingNote)).toBeVisible();
        await expect(editor.savePricing).toHaveCount(0);
      });

      await test.step('Active → Save → the price-required message next to Active; nothing is saved', async () => {
        await editor.active.check();
        await editor.save.click();
        await expect(page.getByText(copy.priceRequiredModerator)).toBeVisible();
        await expect(editor.active).toHaveAccessibleDescription(literal(copy.priceRequiredModerator));
        await expect(editor.sellingPrice).toHaveAccessibleDescription(literal(copy.moderatorPricingNote));
        await page.reload();
        await expect(editor.statusChip('Needs price')).toBeVisible();
        await expect(editor.active).not.toBeChecked();
      });

      const admin = await staffContext(browser, 'admin');
      try {
        const adminEditor = productEditor(admin.page);
        await test.step('an Admin saves pricing, and the history names them', async () => {
          await admin.page.goto(productPath);
          await expect(admin.page.getByRole('heading', { level: 1, name: productName })).toBeVisible();
          await adminEditor.mrp.fill('12.00');
          await adminEditor.sellingPrice.fill('11.50');
          await adminEditor.savePricing.click();
          await expect(adminEditor.status(copy.pricingSaved)).toBeVisible();
          await expect(adminEditor.history).toContainText(`Price set to ৳11.50 (MRP ৳12.00) by ${admin.user.username}`);
          await expect(adminEditor.statusChip('Inactive')).toBeVisible();
        });

        await test.step('Active → Save uses the pricing version, so it is not stale', async () => {
          await adminEditor.active.check();
          await adminEditor.save.click();
          await expect(adminEditor.status(copy.productSaved)).toBeVisible();
          await expect(adminEditor.statusChip('Active')).toBeVisible();
        });

        await test.step('after a reload: Active, ৳11.50, and three history rows', async () => {
          await admin.page.reload();
          await expect(adminEditor.statusChip('Active')).toBeVisible();
          await expect(adminEditor.active).toBeChecked();
          await expect(adminEditor.sellingPrice).toHaveValue('11.50');
          await expect(adminEditor.mrp).toHaveValue('12.00');
          await expect(admin.page.getByText(`Last edited by ${admin.user.username} · version 2`)).toBeVisible();
          const rows = adminEditor.history.getByRole('listitem');
          await expect(rows).toHaveCount(3);
          await expect(rows.nth(0)).toContainText(`Activated by ${admin.user.username}`);
          await expect(rows.nth(1)).toContainText(`Price set to ৳11.50 (MRP ৳12.00) by ${admin.user.username}`);
          await expect(rows.nth(2)).toContainText(`Created by ${moderator.username}`);
        });

        await test.step('the Products list shows the priced, active row', async () => {
          await admin.page.goto('/staff/products');
          const list = productList(admin.page);
          await list.search.fill(productName);
          await list.apply.click();
          const row = list.row(productName);
          for (const text of ['Paracetamol', 'Beximco', categoryName, 'Strip of 10 tablets', '৳12.00', '৳11.50', 'Active']) {
            await expect(row, text).toContainText(text);
          }
          await row.getByRole('link', { name: 'Edit' }).click();
          await expect(admin.page).toHaveURL(productPath);
        });
      } finally {
        await admin.context.close();
      }

      await test.step('the Moderator reloads and sees the Admin’s prices, still read-only', async () => {
        await page.reload();
        await expect(editor.statusChip('Active')).toBeVisible();
        await expect(editor.sellingPrice).toHaveValue('11.50');
        await expect(editor.sellingPrice).toBeDisabled();
        await expect(editor.savePricing).toHaveCount(0);
      });
    });

  test('E2E-14-34 an Admin creates Equipment without MRP, activates it, deactivates it, and its history stays',
    { tag: ['@t14', '@t14-T5'] }, async ({ page, actors }) => {
      const admin = await verifiedAdmin(page);
      const category = await createCategory(await actors('moderator'));
      const name = `Digital thermometer ${token()}`;
      const editor = productEditor(page);

      await page.goto('/staff/products/new');
      await editor.equipment.check();
      // Equipment has no generic/salt name or dosage form.
      await expect(editor.genericName).toHaveCount(0);
      await expect(editor.dosageForm).toHaveCount(0);
      await editor.name.fill(name);
      await editor.saleUnit.fill('1 piece');
      await editor.category.selectOption({ label: category.name });
      await editor.save.click();
      await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
      // The new Product's page confirms the save and keeps keyboard focus on the confirmation.
      await expect(editor.status(copy.productSaved)).toBeFocused();
      // The kind is fixed once created.
      await expect(page.getByRole('radio')).toHaveCount(0);
      await expect(page.getByText('Equipment', { exact: true })).toBeVisible();

      await editor.sellingPrice.fill('450.00');
      await editor.savePricing.click();
      await expect(editor.history).toContainText(`Price set to ৳450.00 by ${admin.username}`);
      await editor.active.check();
      await editor.save.click();
      await expect(editor.statusChip('Active')).toBeVisible();

      await editor.active.uncheck();
      await editor.save.click();
      await expect(editor.status(copy.productSaved)).toBeVisible();
      await page.reload();
      await expect(editor.statusChip('Inactive')).toBeVisible();
      await expect(editor.sellingPrice).toHaveValue('450.00');
      await expect(editor.mrp).toHaveValue('');
      const rows = editor.history.getByRole('listitem');
      await expect(rows).toHaveCount(4);
      for (const [index, text] of ['Deactivated by', 'Activated by', 'Price set to ৳450.00 by', 'Created by'].entries()) {
        await expect(rows.nth(index)).toContainText(`${text} ${admin.username}`);
      }
    });

  test('E2E-14-35 the new-product form names each missing required field and keeps the draft unsaved',
    { tag: ['@t14', '@t14-T5'] }, async ({ page }) => {
      await verifiedAdmin(page);
      const editor = productEditor(page);
      const requests = catalogRequests(page);
      await page.goto('/staff/products/new');
      await editor.medicine.check();
      await editor.save.click();
      const required: [ReturnType<typeof productEditor>['name'], string][] = [
        [editor.name, copy.nameRequired], [editor.genericName, copy.genericRequired],
        [editor.dosageForm, copy.dosageRequired], [editor.saleUnit, copy.saleUnitRequired],
        [editor.category, copy.categoryRequired],
      ];
      for (const [field, message] of required) await expect(field).toHaveAccessibleDescription(literal(message));
      await expect(editor.name).toBeFocused();
      // Brand, manufacturer and description are optional.
      for (const optional of [editor.brandName, editor.manufacturer, editor.description]) {
        await expect(optional).not.toHaveAttribute('aria-invalid', 'true');
      }
      expect(requests.filter((request) => request.startsWith('POST'))).toEqual([]);
      await expect(page).toHaveURL('/staff/products/new');
    });

  test('E2E-14-36 the pricing form refuses malformed money and a price above the MRP, and sends no second request while one is pending',
    { tag: ['@t14', '@t14-T5'] }, async ({ page, actors }) => {
      await verifiedAdmin(page);
      const moderator = await actors('moderator');
      const product = await createProduct(moderator, equipmentDraft((await createCategory(moderator)).id));
      const editor = productEditor(page);
      const requests = catalogRequests(page);
      await openProduct(page, product);

      await editor.savePricing.click();
      await expect(editor.sellingPrice).toHaveAccessibleDescription(literal(copy.sellingPriceRequired));
      for (const value of ['1.005', '1,000', '-1', '1e3', 'abc']) {
        await editor.sellingPrice.fill(value);
        await editor.savePricing.click();
        await expect(editor.sellingPrice, value).toHaveAccessibleDescription(literal(copy.moneyFormat));
      }
      for (const value of ['0', '0.00', '10000000']) {
        await editor.sellingPrice.fill(value);
        await editor.savePricing.click();
        await expect(editor.sellingPrice, value).toHaveAccessibleDescription(literal(copy.moneyRange));
      }
      await editor.mrp.fill('12.00');
      await editor.sellingPrice.fill('12.01');
      await editor.savePricing.click();
      await expect(editor.sellingPrice).toHaveAccessibleDescription(literal(copy.priceAboveMrp));
      await page.reload();
      await expect(editor.sellingPrice).toHaveValue('');
      expect((await getProduct(moderator, product.id)).sellingPrice).toBeNull();

      // The first pricing PUT is held in flight, so the second submission is certain to come while it is pending.
      requests.length = 0;
      const pricingPuts = () => requests.filter((request) => request.endsWith('/pricing'));
      let release = () => {};
      const held = new Promise<void>((resolve) => { release = resolve; });
      const pricingRoute = `**/api/staff/products/${product.id}/pricing`;
      await page.route(pricingRoute, async (route) => {
        if (route.request().method() === 'PUT') await held;
        await route.continue();
      });
      await editor.mrp.fill('12.00');
      await editor.sellingPrice.fill('12.00');
      await editor.savePricing.click();
      await expect.poll(pricingPuts).toHaveLength(1);
      // Second attempts while pending: a forced click (a disabled button may refuse it) and Enter in the price field.
      if (await editor.savePricing.count() > 0) await editor.savePricing.click({ force: true });
      await editor.sellingPrice.press('Enter');
      expect(pricingPuts()).toHaveLength(1);
      release();
      await expect(editor.status(copy.pricingSaved)).toBeVisible();
      await page.unroute(pricingRoute);
      expect(pricingPuts()).toEqual([`PUT /api/staff/products/${product.id}/pricing`]);
      expect((await getProduct(moderator, product.id)).sellingPrice).toBe('12.00');
    });

  test('E2E-14-37 two tabs on one product: the second save shows the stale banner, and Reload shows the first save',
    { tag: ['@t14', '@t14-T5'] }, async ({ page, context, actors }) => {
      await verifiedAdmin(page);
      const moderator = await actors('moderator');
      const product = await createProduct(moderator, medicineDraft((await createCategory(moderator)).id));
      await openProduct(page, product);
      const second = await context.newPage();
      await openProduct(second, product);

      const firstEditor = productEditor(page);
      const renamed = `${product.name} renamed`;
      await firstEditor.name.fill(renamed);
      await firstEditor.save.click();
      await expect(firstEditor.status(copy.productSaved)).toBeVisible();

      const secondEditor = productEditor(second);
      await secondEditor.description.fill('Edited in the second tab.');
      await secondEditor.save.click();
      const stale = second.getByRole('alert').filter({ hasText: copy.productStale });
      await expect(stale).toBeVisible();
      await stale.getByRole('button', { name: 'Reload' }).click();
      await expect(second.getByRole('heading', { level: 1, name: renamed })).toBeVisible();
      await expect(secondEditor.description).toHaveValue('');
      await expect(stale).toHaveCount(0);

      await secondEditor.description.fill('Edited after reloading.');
      await secondEditor.save.click();
      await expect(secondEditor.status(copy.productSaved)).toBeVisible();
      expect(await getProduct(moderator, product.id)).toMatchObject({ name: renamed, description: 'Edited after reloading.',
        version: 2 });
    });

  test('E2E-14-38 a Moderator edits catalog fields and the review flag of a priced product but never its prices',
    { tag: ['@t14', '@t14-T5'] }, async ({ page, actors }) => {
      const moderator = await verifiedModerator(page);
      const admin = await actors('admin');
      const product = await activeProduct(admin, medicineDraft((await createCategory(admin)).id), '150.00', '150.00');
      const editor = productEditor(page);
      await openProduct(page, product);

      await expect(editor.sellingPrice).toHaveValue('150.00');
      await expect(editor.mrp).toHaveValue('150.00');
      await expect(editor.sellingPrice).toBeDisabled();
      await expect(editor.mrp).toBeDisabled();
      await expect(editor.pricing.getByText(copy.moderatorPricingNote)).toBeVisible();
      await expect(editor.savePricing).toHaveCount(0);
      await expect(editor.pricing.locator('input:not([disabled])')).toHaveCount(0);

      await editor.review.check();
      await editor.manufacturer.fill('Beximco Pharmaceuticals');
      await editor.save.click();
      await expect(editor.status(copy.productSaved)).toBeVisible();
      await expect(editor.history.getByRole('listitem').nth(0)).toContainText(`by ${moderator.username}`);
      await expect(editor.history).toContainText(`Review flag turned on by ${moderator.username}`);
      await expect(editor.history).toContainText(`Details edited by ${moderator.username}`);
      expect(await getProduct(admin, product.id)).toMatchObject({ requireValidation: true, sellingPrice: '150.00',
        mrp: '150.00', manufacturer: 'Beximco Pharmaceuticals' });
    });

  test('E2E-14-39 the Products list searches, filters by category, status and review, formats Taka and pages',
    { tag: ['@t14', '@t14-T5'] }, async ({ page, actors }) => {
      await verifiedAdmin(page);
      const admin = await actors('admin');
      const category = await createCategory(admin, `List care ${token()}`);
      const mark = token();
      const products = [];
      for (let index = 1; index <= 21; index += 1) {
        products.push(await createProduct(admin, medicineDraft(category.id,
          { name: `List ${mark} ${String(index).padStart(2, '0')}`, requireValidation: index === 2 })));
      }
      await activeProduct(admin, equipmentDraft(category.id, { name: `List ${mark} 00 glucometer` }), '1350.00', '1400.00');
      const priced = await priceProduct(admin, products[20], '9999999.99');
      expect(priced.status).toBe('INACTIVE');

      const list = productList(page);
      const consoleText: string[] = [];
      const pageUrls: string[] = [];
      page.on('console', (message) => consoleText.push(message.text()));
      page.on('framenavigated', (frame) => pageUrls.push(frame.url()));
      await page.goto('/staff/products');
      await list.search.fill(mark);
      await list.apply.click();
      await expect(page.getByText('Showing 1–20 of 22')).toBeVisible();
      await expect(list.rows).toHaveCount(20);
      const glucometer = list.row(`List ${mark} 00 glucometer`);
      for (const text of ['৳1,400.00', '৳1,350.00', 'Active', '1 piece']) await expect(glucometer).toContainText(text);
      await expect(list.row(`List ${mark} 01`)).toContainText('Needs price');
      await expect(glucometer.getByText('Active', { exact: true })).toHaveCSS('color', 'rgb(23, 122, 59)');
      await expect(list.row(`List ${mark} 01`).getByText('Needs price', { exact: true }))
        .toHaveCSS('color', 'rgb(154, 91, 0)');
      await expect(list.row(`List ${mark} 01`)).toContainText('Not set');
      await expect(list.row(`List ${mark} 02`).getByText('Review', { exact: true })).toBeVisible();
      await expect(list.row(`List ${mark} 02`).getByText('Review', { exact: true }))
        .toHaveCSS('color', 'rgb(29, 95, 191)');
      // Keyboard paging: the last page disables Next, so focus moves to Previous rather than the page body.
      await list.next.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByText('Showing 21–22 of 22')).toBeVisible();
      await expect(list.previous).toBeFocused();
      await expect(list.rows).toHaveCount(2);
      await expect(list.row(`List ${mark} 21`)).toContainText('৳9,999,999.99');
      await expect(list.row(`List ${mark} 21`)).toContainText('Inactive');
      await expect(list.row(`List ${mark} 21`).getByText('Inactive', { exact: true }))
        .toHaveCSS('color', 'rgb(90, 110, 103)');
      await list.previous.click();
      await expect(page.getByText('Showing 1–20 of 22')).toBeVisible();

      await list.status.selectOption({ label: 'Active' });
      await list.apply.click();
      await expect(list.rows).toHaveCount(1);
      await list.status.selectOption({ label: 'Inactive' });
      await list.apply.click();
      await expect(list.rows).toHaveCount(1);
      await list.status.selectOption({ label: 'Needs price (not purchasable)' });
      await list.apply.click();
      await expect(page.getByText('Showing 1–20 of 20')).toBeVisible();
      await list.reviewOnly.check();
      await list.apply.click();
      await expect(list.rows).toHaveCount(1);
      await expect(list.row(`List ${mark} 02`)).toBeVisible();

      await list.reviewOnly.uncheck();
      await list.status.selectOption({ label: 'Any status' });
      await list.search.fill('');
      await list.category.selectOption({ label: category.name });
      await list.apply.click();
      await expect(page.getByText('Showing 1–20 of 22')).toBeVisible();

      await list.search.fill(`Nothing ${token()}`);
      await list.apply.click();
      await expect(page.getByText(copy.noMatches)).toBeVisible();
      // No filter offers stock (AC5).
      await expect(page.getByLabel(/stock|availability/i)).toHaveCount(0);

      // Search terms and product names stay out of page URLs and the console.
      for (const text of [mark, 'Nothing']) {
        expect(pageUrls.filter((url) => url.includes(text)), text).toEqual([]);
        expect(consoleText.filter((line) => line.includes(text)), text).toEqual([]);
      }
    });

  test('E2E-14-40 an unknown product id shows "Product not found."', { tag: ['@t14', '@t14-T5'] }, async ({ page }) => {
    await verifiedAdmin(page);
    const requests = catalogRequests(page);
    const id = randomUUID();
    await page.goto(`/staff/products/${id}`);
    await expect(page.getByRole('heading', { name: copy.productNotFound })).toBeVisible();
    expect(requests).toContain(`GET /api/staff/products/${id}`);
    await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Products' }).click();
    await expect(page).toHaveURL('/staff/products');
  });

  test('E2E-14-41 keyboard only: an Admin creates, prices, activates and then edits Equipment; fields are labelled, targets 44 × 44 px',
    { tag: ['@t14', '@t14-T5'] }, async ({ page, actors }) => {
      await verifiedAdmin(page);
      const admin = await actors('admin');
      // A name sorting near the top keeps the arrow-key walk through the shared run's categories short.
      const category = await createCategory(admin, `0 Keyboard ${token()}`);
      const editor = productEditor(page);
      const name = `Keyboard scale ${token()}`;

      await page.goto('/staff/products/new');
      await tabTo(page, editor.medicine);
      await expectFocusRing(page);
      await page.keyboard.press('ArrowDown');
      await expect(editor.equipment).toBeChecked();
      await expectLabelledTargets(page);
      await tabTo(page, editor.name);
      await expectFocusRing(page);
      await page.keyboard.type(name);
      await tabTo(page, editor.category);
      await chooseWithArrowKeys(page, editor.category, category.name);
      await tabTo(page, editor.saleUnit);
      await page.keyboard.type('1 piece');
      await tabTo(page, editor.save);
      await expectFocusRing(page);
      await page.keyboard.press('Enter');
      await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();

      await expectLabelledTargets(page);
      await tabTo(page, editor.sellingPrice);
      await page.keyboard.type('999.00');
      await tabTo(page, editor.savePricing);
      await page.keyboard.press('Enter');
      await expect(editor.status(copy.pricingSaved)).toBeVisible();
      await tabTo(page, editor.active);
      await page.keyboard.press('Space');
      await tabTo(page, editor.save);
      await page.keyboard.press('Enter');
      await expect(editor.statusChip('Active')).toBeVisible();

      // Editing an existing Product by keyboard: a text field, then the price.
      const productId = new URL(page.url()).pathname.split('/').at(-1)!;
      await tabTo(page, editor.name);
      await page.keyboard.press('ControlOrMeta+A');
      await page.keyboard.type(`${name} v2`);
      await tabTo(page, editor.save);
      await page.keyboard.press('Enter');
      await expect(editor.status(copy.productSaved)).toBeVisible();
      await expect(page.getByRole('heading', { level: 1, name: `${name} v2` })).toBeVisible();
      await tabTo(page, editor.sellingPrice);
      await page.keyboard.press('ControlOrMeta+A');
      await page.keyboard.type('1000.00');
      await tabTo(page, editor.savePricing);
      await page.keyboard.press('Enter');
      await expect(editor.history).toContainText('Price set to ৳1,000.00');
      expect(await getProduct(admin, productId)).toMatchObject({ name: `${name} v2`, sellingPrice: '1000.00',
        status: 'ACTIVE' });

      // Each list has loaded (a row's Edit control and the pager show) before its targets are measured.
      await page.goto('/staff/products');
      await expect(productList(page).rows.first().getByRole('link', { name: 'Edit' })).toBeVisible();
      await expectLabelledTargets(page);
      await page.goto('/staff/categories');
      await expect(categoryManager(page).rows.first().getByRole('button', { name: 'Edit' })).toBeVisible();
      await expect(categoryManager(page).pager).toBeVisible();
      await expectLabelledTargets(page);
    });

  test('E2E-14-48 the Categories page pages 20 at a time; Next reaches a category beyond page 1 to rename and deactivate it',
    { tag: ['@t14', '@t14-T5'] }, async ({ page, actors }) => {
      await verifiedModerator(page);
      const admin = await actors('admin');
      const mark = token();
      // Names starting "0 Paged" sort before letters, and these 20 sort before the 21st, so the 21st is never on page 1.
      const created = [];
      for (let index = 1; index <= 21; index += 1) {
        created.push(await createCategory(admin, `0 Paged ${mark} ${String(index).padStart(2, '0')}`));
      }
      const beyond = created[20];
      const categories = categoryManager(page);

      await page.goto('/staff/categories');
      await expect(categories.pager).toHaveText(/^Showing 1–20 of \d+$/);
      await expect(categories.rows).toHaveCount(20);
      await expect(categories.previous).toBeDisabled();
      await expect(categories.row(beyond.name)).toHaveCount(0);

      const { row, pageIndex } = await showCategory(page, beyond.name);
      expect(pageIndex).toBeGreaterThan(0);
      await expect(categories.pager).toHaveText(new RegExp(`^Showing ${pageIndex * 20 + 1}–\\d+ of \\d+$`));
      await expect(categories.previous).toBeEnabled();
      // The page number is component state, never in the address.
      expect(new URL(page.url()).search).toBe('');

      // Rename it there: the save reloads the same page, where the renamed row still sorts.
      await row.getByRole('button', { name: 'Edit' }).click();
      const renamed = `${beyond.name} renamed`;
      await categories.name.fill(renamed);
      await categories.save.click();
      await expect(page.getByRole('status').filter({ hasText: copy.categorySaved })).toBeVisible();
      const renamedRow = categories.row(renamed);
      await expect(renamedRow).toBeVisible();

      await renamedRow.getByRole('button', { name: 'Edit' }).click();
      await categories.active.uncheck();
      await categories.save.click();
      await expect(renamedRow.getByText('Inactive', { exact: true })).toBeVisible();

      // A reload starts on page 1 again; the category is still found by paging, inactive.
      await page.reload();
      await expect(categories.pager).toHaveText(/^Showing 1–20 of \d+$/);
      await expect((await showCategory(page, renamed)).row.getByText('Inactive', { exact: true })).toBeVisible();
    });

  test('E2E-14-49 the new-product form has no Active control, Pricing or history and creates an inactive Product; the edit form shows them',
    { tag: ['@t14', '@t14-T5'] }, async ({ page, actors }) => {
      await verifiedAdmin(page);
      const category = await createCategory(await actors('moderator'));
      const editor = productEditor(page);
      const bodies: string[] = [];
      page.on('request', (request) => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/staff/products') {
          bodies.push(request.postData() ?? '');
        }
      });
      const name = `No active ${token()}`;

      await page.goto('/staff/products/new');
      for (const kind of [editor.medicine, editor.equipment]) {
        await kind.check();
        await expect(editor.active).toHaveCount(0);
        await expect(editor.review).toBeVisible();
        // Pricing needs a saved Product, so even an Admin sees no Pricing section, price field or history yet.
        await expect(editor.pricing).toHaveCount(0);
        await expect(page.getByLabel(/^(MRP|Selling price) \(৳\)$/)).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Save pricing' })).toHaveCount(0);
        await expect(editor.history).toHaveCount(0);
      }
      await editor.name.fill(name);
      await editor.saleUnit.fill('1 piece');
      await editor.category.selectOption({ label: category.name });
      await editor.save.click();
      await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();

      expect(bodies).toHaveLength(1);
      expect(Object.keys(JSON.parse(bodies[0]) as Record<string, unknown>)).not.toContain('active');
      await expect(editor.active).toBeVisible();
      await expect(editor.active).not.toBeChecked();
      await expect(editor.statusChip('Needs price')).toBeVisible();
      // Saved, the Product opens in the edit form, where the Admin's Pricing and the history appear.
      await expect(editor.sellingPrice).toBeEditable();
      await expect(editor.mrp).toBeEditable();
      await expect(editor.savePricing).toBeVisible();
      await expect(editor.history.getByRole('listitem')).toHaveCount(1);
    });

  test('E2E-14-51 a product whose category was deactivated keeps it: the editor shows it selected and saves another edit unchanged',
    { tag: ['@t14', '@t14-T5'] }, async ({ page, actors }) => {
      await verifiedModerator(page);
      const admin = await actors('admin');
      const category = await createCategory(admin, `Retired ${token()}`);
      const product = await createProduct(admin, medicineDraft(category.id));
      await updateCategory(admin, category, { active: false });
      const current = await createCategory(admin, `Current ${token()}`);
      const editor = productEditor(page);
      const chosenCategory = editor.category.locator('option:checked');
      const option = (name: string) => editor.category.locator('option').filter({ hasText: name });

      // A new product cannot choose the inactive category (C9). The active category must be listed first, so the
      // options have loaded before the absence is checked.
      await page.goto('/staff/products/new');
      await editor.medicine.check();
      await expect(option(current.name)).toHaveCount(1);
      await expect(option(category.name)).toHaveCount(0);

      // The existing product shows its own inactive category, marked as such, and a save keeps it.
      await openProduct(page, product);
      await expect(chosenCategory).toHaveText(`${category.name} (inactive)`);
      const brandName = `Brand ${token()}`;
      await editor.brandName.fill(brandName);
      await editor.save.click();
      await expect(editor.status(copy.productSaved)).toBeVisible();
      expect(await getProduct(admin, product.id)).toMatchObject({ brandName, categoryId: category.id, version: 1 });
      await page.reload();
      await expect(editor.brandName).toHaveValue(brandName);
      await expect(chosenCategory).toHaveText(`${category.name} (inactive)`);
    });

  test.describe('at 375 px', () => {
    test.use({ viewport: { width: 375, height: 800 } });

    test('E2E-14-42 the list, editor and categories pages never scroll sideways; the table scrolls in its container',
      { tag: ['@t14', '@t14-T5'] }, async ({ page, actors }) => {
        await verifiedAdmin(page);
        const admin = await actors('admin');
        const product = await activeProduct(admin,
          medicineDraft((await createCategory(admin, 'Category ' + token() + 'x'.repeat(63))).id,
            { saleUnit: 'Strip of 10 film-coated tablets' }), '1350.00', '1400.00');

        await page.goto('/staff/products');
        const list = productList(page);
        // A row's Edit link proves the products have loaded before the page width is checked.
        await expect(list.rows.first().getByRole('link', { name: 'Edit' })).toBeAttached();
        await expectNoPageScroll(page);
        // The table is wider than the phone, so its own container scrolls, and its last column can be brought into view.
        const container = await tableContainer(page);
        expect(container.found).toBe(true);
        expect(container.scrollWidth).toBeGreaterThan(container.clientWidth);
        const lastColumn = list.rows.first().locator('td').last();
        await lastColumn.scrollIntoViewIfNeeded();
        // Chromium can clip a fractional cell border; the complete interactive target must be in view.
        await expect(lastColumn).toBeInViewport({ ratio: 0.99 });
        await expect(lastColumn.getByRole('link', { name: 'Edit' })).toBeInViewport({ ratio: 1 });
        await expectNoPageScroll(page);
        await openProduct(page, product);
        await expectNoPageScroll(page);
        await page.goto('/staff/categories');
        // The categories table has loaded before the page width is checked.
        await expect(categoryManager(page).rows.first().getByRole('button', { name: 'Edit' })).toBeAttached();
        await expectNoPageScroll(page);
      });
  });

  test('E2E-14-43 @smoke an Admin creates, prices and activates Equipment; a Moderator sees its pricing read-only',
    { tag: ['@t14', '@t14-T5', '@smoke'] }, async ({ page, browser }) => {
      await verifiedAdmin(page);
      const categoryName = `Smoke ${token()}`;
      const name = `Smoke scale ${token()}`;
      await page.goto('/staff/categories');
      const categories = categoryManager(page);
      await categories.add.click();
      await categories.name.fill(categoryName);
      await categories.save.click();
      await showCategory(page, categoryName);

      const editor = productEditor(page);
      await page.goto('/staff/products/new');
      await editor.equipment.check();
      await editor.name.fill(name);
      await editor.saleUnit.fill('1 piece');
      await editor.category.selectOption({ label: categoryName });
      await editor.save.click();
      await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
      await editor.sellingPrice.fill('450.00');
      await editor.savePricing.click();
      await expect(editor.status(copy.pricingSaved)).toBeVisible();
      await editor.active.check();
      await editor.save.click();
      await expect(editor.statusChip('Active')).toBeVisible();
      const productPath = new URL(page.url()).pathname;

      const moderator = await staffContext(browser, 'moderator');
      try {
        await moderator.page.goto(productPath);
        const readOnly = productEditor(moderator.page);
        await expect(readOnly.sellingPrice).toHaveValue('450.00');
        await expect(readOnly.sellingPrice).toBeDisabled();
        await expect(readOnly.pricing.getByText(copy.moderatorPricingNote)).toBeVisible();
      } finally {
        await moderator.context.close();
      }
    });
});

test('E2E-14-44 an Admin page that loses its role mid-session is refused pricing, keeps the typed value, and changes nothing',
  { tag: ['@t14', '@t14-T5'] }, async ({ page, actors }) => {
    const admin = await verifiedAdmin(page);
    const moderator = await actors('moderator');
    const product = await createProduct(moderator, equipmentDraft((await createCategory(moderator)).id));
    const editor = productEditor(page);
    await openProduct(page, product);
    // The operator replaces ADMIN with CUSTOMER in SQL; the page's session stays active.
    removeRole(admin.username, 'ADMIN');
    await editor.sellingPrice.fill('75.00');
    await editor.savePricing.click();
    // Scope the shared access-denied alert to the editor, excluding Next.js's route announcer.
    await expect(page.getByRole('main').getByRole('alert')).toBeVisible();
    await expect(editor.status(copy.pricingSaved)).toHaveCount(0);
    await expect(editor.sellingPrice).toHaveValue('75.00');
    expect(await getProduct(moderator, product.id)).toMatchObject({ sellingPrice: null, version: 0 });
  });
