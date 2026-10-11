import { mkdirSync, mkdtempSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  AddressApi, addressCopy, addressDialog, addressEdit, addressesPath, assertAwayFromDhakaPeriodStart,
  expectAddressBook, storedAddresses, syntheticAddress, type AddressCreate,
} from './addressSupport';
import { expectError, setAccountState } from './profileSupport';
import { register, syntheticCustomer } from './support';
import { apiUrl, checkedTarget, psql, tableFingerprints } from './testApi';

// Only this optional evidence-producing demo skips. All acceptance specs run without an artifact directory.
test.skip(!process.env.MEDI_WISH_DEMO_DIR, 'Set MEDI_WISH_DEMO_DIR to record the Ticket 12 reviewer demo');
test.describe.configure({ mode: 'serial' });
test.beforeAll(() => assertAwayFromDhakaPeriodStart());

async function fillDialog(page: Page, address: AddressCreate) {
  const dialog = addressDialog(page);
  await dialog.getByLabel('Label', { exact: true }).fill(address.label ?? '');
  await dialog.getByLabel('Name', { exact: true }).fill(address.recipientName);
  await dialog.getByLabel('Mobile', { exact: true }).fill(address.mobile);
  await dialog.getByLabel('Address', { exact: true }).fill(address.addressLine);
  await dialog.getByLabel('City', { exact: true }).fill(address.city);
}

test('E2E-12-DEMO ten-step address-book reviewer journey with screenshots and private-data-free step log',
  { tag: ['@t12', '@t12-demo'] }, async ({ page, request }, testInfo) => {
    test.setTimeout(240_000);
    const artifactRoot = process.env.MEDI_WISH_DEMO_DIR!;
    expect(path.isAbsolute(artifactRoot), 'MEDI_WISH_DEMO_DIR must be an absolute path').toBe(true);
    const projectDirectory = path.join(artifactRoot, testInfo.project.name);
    mkdirSync(projectDirectory, { recursive: true });
    const directory = mkdtempSync(path.join(projectDirectory, 'run-'));
    const log = path.join(directory, 'steps.txt');
    const record = async (step: number, result: string) => {
      await page.screenshot({ path: path.join(directory, `${String(step).padStart(2, '0')}.png`), fullPage: true });
      appendFileSync(log, `${step}: ${result}\n`, 'utf8');
    };
    const card = (label: string) => page.locator('.address-card').filter({ has: page.getByText(label, { exact: true }) });
    const add = async (address: AddressCreate) => {
      await page.getByRole('button', { name: 'Add address', exact: true }).click();
      await fillDialog(page, address);
      await addressDialog(page).getByRole('button', { name: 'Save', exact: true }).click();
      await expect(addressDialog(page)).not.toBeVisible();
      await expect(card(address.label!)).toBeVisible();
    };
    const customer = syntheticCustomer();
    await register(page, customer);
    await page.getByRole('link', { name: 'Addresses', exact: true }).click();
    await expect(page.getByText('No saved addresses yet.', { exact: true })).toBeVisible();
    await record(1, 'Registration and Account-to-Addresses navigation show the empty book.');

    const owner = AddressApi.forUser(request, customer);
    const home = syntheticAddress({ label: 'Home' });
    await page.getByRole('button', { name: 'Add address', exact: true }).click();
    await expect(addressDialog(page)).toHaveAccessibleDescription(/5 per week.*10 per calendar month.*5 this week.*10 this month/);
    await fillDialog(page, home);
    await addressDialog(page).getByRole('button', { name: 'Save', exact: true }).click();
    await expect(addressDialog(page)).not.toBeVisible();
    await page.reload();
    await expect(card('Home').getByText('Default', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Add address', exact: true }).click();
    await expect(addressDialog(page)).toHaveAccessibleDescription(/4 this week.*9 this month/);
    await addressDialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
    await record(2, 'The first add becomes default and persists; the next notice reports updated allowance.');

    await add(syntheticAddress({ label: 'Office' }));
    await add(syntheticAddress({ label: 'Parents' }));
    await expect(page.getByText('3 of 3', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add address', exact: true })).toHaveCount(0);
    await expect(page.getByText("You've saved 3 of 3 addresses; remove one to add another.", { exact: true })).toBeVisible();
    await record(3, 'Three saved cards fill the book and replace the Add tile with the full-book note.');

    const race = await AddressApi.register(request);
    await expectAddressBook(await race.create(syntheticAddress()), 201);
    await expectAddressBook(await race.create(syntheticAddress()), 201);
    await race.bearer();
    const replies = await Promise.all(Array.from({ length: 6 }, () => race.create(syntheticAddress())));
    expect(replies.filter((response) => response.status() === 201)).toHaveLength(1);
    for (const response of replies.filter((response) => response.status() !== 201)) {
      await expectError(response, 409, 'ADDRESS_BOOK_FULL', addressCopy.ADDRESS_BOOK_FULL);
    }
    expect(storedAddresses(race.user.username)).toHaveLength(3);
    expect(storedAddresses(race.user.username).filter((address) => address.isDefault)).toHaveLength(1);
    await record(4, 'Six concurrent adds into one free slot produce one insertion and five bounded capacity refusals.');

    await card('Office').getByRole('button', { name: 'Edit', exact: true }).click();
    await addressDialog(page).getByLabel('Default address', { exact: true }).check();
    await addressDialog(page).getByRole('button', { name: 'Save', exact: true }).click();
    await expect(addressDialog(page)).not.toBeVisible();
    await expect(card('Office').getByText('Default', { exact: true })).toBeVisible();
    await expect(card('Home').getByText('Default', { exact: true })).toHaveCount(0);
    await record(5, 'Editing moves the single default to another saved card.');

    await card('Office').getByRole('button', { name: 'Edit', exact: true }).click();
    await addressDialog(page).getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(addressDialog(page).getByText('Remove this address?', { exact: true })).toBeVisible();
    await addressDialog(page).getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(addressDialog(page)).not.toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Home is now your default address.' })).toBeVisible();
    expect(storedAddresses(customer.username).filter((address) => address.isDefault)).toHaveLength(1);
    await record(6, 'Removing the default promotes the oldest remaining address and announces the successor.');

    await card('Home').getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(addressDialog(page)).toHaveAccessibleDescription(/1 this week/);
    await addressDialog(page).getByLabel('City', { exact: true }).fill('Sylhet');
    await addressDialog(page).getByRole('button', { name: 'Save', exact: true }).click();
    await expect(addressDialog(page)).not.toBeVisible();
    const atLimit = storedAddresses(customer.username);
    await card('Home').getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(addressDialog(page)).toHaveAccessibleDescription(/0 this week/);
    await addressDialog(page).getByLabel('City', { exact: true }).fill('Khulna');
    await addressDialog(page).getByRole('button', { name: 'Save', exact: true }).click();
    await expect(addressDialog(page)).not.toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: addressCopy.ADDRESS_CHANGE_LIMIT_REACHED })).toBeVisible();
    await page.reload();
    expect(storedAddresses(customer.username)).toEqual(atLimit);
    await expect(card('Home')).toContainText('Sylhet');
    await record(7, 'The fifth weekly change persists; the sixth changes nothing. Fixed-calendar ITs own monthly and rollover proof.');

    setAccountState(customer.username, 'CLOSURE_REQUESTED');
    await page.reload();
    await expect(page.getByText('Your account is closing.', { exact: true })).toBeVisible();
    await expect(page.locator('.address-card')).toHaveCount(2);
    for (const name of ['Add address', 'Edit', 'Remove']) {
      await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
    }
    expect((await owner.book()).accountState).toBe('CLOSURE_REQUESTED');
    await expectError(await owner.create(syntheticAddress()), 409, 'ACCOUNT_CLOSING', addressCopy.ACCOUNT_CLOSING);
    await record(8, 'Closure leaves cards readable and refuses both browser actions and direct API mutation.');

    const boundary = await AddressApi.register(request);
    await boundary.bearer();
    const excluded = ['saved_addresses', 'saved_address_changes', 'user_sessions', 'user_session_refresh_tokens',
      'databasechangelog', 'databasechangeloglock'];
    const before = tableFingerprints(excluded);
    let book = await expectAddressBook(await boundary.create(syntheticAddress()), 201);
    expect(tableFingerprints(excluded), 'Create leaves unrelated tables unchanged').toEqual(before);
    book = await expectAddressBook(await boundary.update(book.items[0].id, addressEdit(book.items[0], { city: 'Khulna' })));
    expect(tableFingerprints(excluded), 'Edit leaves unrelated tables unchanged').toEqual(before);
    await expectAddressBook(await boundary.remove(book.items[0].id, book.items[0].version));
    expect(tableFingerprints(excluded), 'Delete leaves unrelated tables unchanged').toEqual(before);
    const schema = checkedTarget('demo snapshot boundary');
    expect(psql(`SELECT count(*) FROM pg_constraint c JOIN pg_class t ON t.oid = c.confrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace WHERE c.contype = 'f'
      AND n.nspname = '${schema}' AND t.relname = 'saved_addresses';`)).toBe('0');
    await record(9, 'Address-only writes and absence of incoming address foreign keys protect the Ticket 25 boundary; Order journeys remain deferred.');

    const other = await AddressApi.register(request);
    const target = (await owner.book()).items[0];
    expect((await other.book()).items).toEqual([]);
    await expectError(await other.update(target.id, addressEdit(target)), 404, 'NOT_FOUND', addressCopy.NOT_FOUND);
    await expectError(await other.remove(target.id, target.version), 404, 'NOT_FOUND', addressCopy.NOT_FOUND);
    expect(storedAddresses(customer.username)).toEqual(atLimit);
    await expectError(await request.get(`${apiUrl}${addressesPath}`), 401, 'AUTHENTICATION_REQUIRED');
    await record(10, 'Another Customer cannot list or mutate the owner’s addresses; anonymous reads require authentication.');
  });
