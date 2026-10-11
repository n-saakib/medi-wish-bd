import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page, type Request, type Response } from '@playwright/test';
import {
  AddressApi, addressEdit, addressesPath, assertAwayFromDhakaPeriodStart, expectAddressBook,
  openAddresses, storedAddressChanges, storedAddresses, storedAddressState, syntheticAddress,
  type AddressBook, type AddressCreate, type SavedAddress,
} from './addressSupport';
import {
  encodedForms, registerByApi, setAccountState, storedProfile, syntheticFullName, syntheticMobile,
  urlScanText,
} from './profileSupport';
import { register, signIn, syntheticCustomer, verifiedAdmin, verifiedModerator, type Customer } from './support';
import { apiLogPath, apiUrl, grantRole, tableFingerprints } from './testApi';

/** Real browser/API journeys; bounded route hooks also isolate client error and read-model projection states. */
const t5 = { tag: ['@t12', '@t12-T5'] };
const t6 = { tag: ['@t12', '@t12-T6', '@regression'] };
const t7 = { tag: ['@t12', '@t12-T7'] };
const text = {
  full: "You've saved 3 of 3 addresses; remove one to add another.",
  fullError: 'This address book is full. Remove an address to add another.',
  limit: "You've reached the address change limit for this week or month. You can still remove an address.",
  stale: 'This record changed after you opened it. Reload and try again.',
  closing: 'Your account is closing.',
  savedEarlier: 'Your earlier save went through. Check the address below.',
  generic: 'The request could not be completed.',
  notFound: 'This could not be found.',
  invalidResponse: 'The service returned an invalid response.',
};

function ui(page: Page) {
  const main = page.getByRole('main');
  const dialog = page.getByRole('dialog');
  return {
    main, dialog,
    heading: main.getByRole('heading', { level: 1, name: 'Addresses', exact: true }),
    cards: main.locator('.address-card'),
    add: main.getByRole('button', { name: 'Add address', exact: true }),
    label: dialog.getByLabel('Label', { exact: true }),
    name: dialog.getByLabel('Name', { exact: true }),
    mobile: dialog.getByLabel('Mobile', { exact: true }),
    address: dialog.getByLabel('Address', { exact: true }),
    city: dialog.getByLabel('City', { exact: true }),
    makeDefault: dialog.getByRole('checkbox', { name: 'Default address', exact: true }),
    save: dialog.getByRole('button', { name: 'Save', exact: true }),
    cancel: dialog.getByRole('button', { name: 'Cancel', exact: true }),
    remove: dialog.getByRole('button', { name: 'Remove', exact: true }),
    keep: dialog.getByRole('button', { name: 'Keep', exact: true }),
  };
}

function card(page: Page, label: string): Locator {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return ui(page).cards.filter({ has: page.locator('strong').filter({ hasText: new RegExp(`^${escapedLabel}$`) }) });
}

function addressResponse(page: Page, method: string): Promise<Response> {
  return page.waitForResponse((response) => response.url().startsWith(apiUrl)
    && new URL(response.url()).pathname.startsWith(addressesPath)
    && response.request().method() === method && response.status() !== 401);
}

/** Capture the unchanged backend body before reconciliation can retire Chrome's browser response. */
async function captureAddressJson<T>(page: Page, method: 'POST' | 'PUT' | 'DELETE', path: string, status: number) {
  const bodies: T[] = [];
  await page.route((url) => url.href === `${apiUrl}${path}`, async (route) => {
    if (route.request().method() !== method) return route.fallback();
    const response = await route.fetch();
    if (response.status() === 401) return route.fulfill({ response });
    if (response.status() === status) bodies.push(await response.json() as T);
    await route.fulfill({ response });
  });
  return () => {
    expect(bodies).toHaveLength(1);
    return bodies[0];
  };
}

async function fill(page: Page, value: AddressCreate | SavedAddress): Promise<void> {
  const view = ui(page);
  await view.label.fill(value.label ?? '');
  await view.name.fill(value.recipientName);
  await view.mobile.fill(value.mobile);
  await view.address.fill(value.addressLine);
  await view.city.fill(value.city);
  if (await view.makeDefault.isEnabled()) await view.makeDefault.setChecked(value.isDefault);
}

async function save(page: Page, method: 'POST' | 'PUT' = 'POST', status = method === 'POST' ? 201 : 200): Promise<Response> {
  const response = addressResponse(page, method);
  await ui(page).save.click();
  const result = await response;
  expect(result.status()).toBe(status);
  await expect(ui(page).dialog).toBeHidden();
  return result;
}

async function add(page: Page, value = syntheticAddress()): Promise<AddressCreate> {
  await ui(page).add.click();
  await fill(page, value);
  await save(page);
  await expect(card(page, value.label ?? value.city)).toBeVisible();
  return value;
}

async function edit(page: Page, label: string): Promise<void> {
  await card(page, label).getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(ui(page).dialog).toBeVisible();
}

async function remove(page: Page, label: string, status = 200): Promise<void> {
  await edit(page, label);
  await ui(page).remove.click();
  await expect(ui(page).dialog.getByText('Remove this address?', { exact: true })).toBeVisible();
  const response = addressResponse(page, 'DELETE');
  await ui(page).remove.click();
  expect((await response).status()).toBe(status);
  await expect(ui(page).dialog).toBeHidden();
  await expect(card(page, label)).toHaveCount(0);
}

async function seeded(request: Parameters<typeof AddressApi.register>[0], labels: string[]) {
  const api = await AddressApi.register(request);
  for (const label of labels) await expectAddressBook(await api.create(syntheticAddress({ label })), 201);
  return api;
}

function notice(book: AddressBook): string {
  const { perWeek, perMonth, remainingThisWeek, remainingThisMonth } = book.changeAllowance;
  return `Adding or editing uses one change: ${perWeek} per week (Mon–Sun) and ${perMonth} per calendar month, `
    + `Dhaka time. Removing is free. Left: ${remainingThisWeek} this week, ${remainingThisMonth} this month.`;
}

async function expectNotice(page: Page, book: AddressBook): Promise<void> {
  const message = notice(book);
  await expect(ui(page).dialog.getByText(message, { exact: true })).toBeVisible();
  await expect(ui(page).dialog).toHaveAccessibleDescription(new RegExp(message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  // The allowance is a plain announcement inside the dialog, not another page alert.
  await expect(ui(page).dialog.getByRole('alert').filter({ hasText: message })).toHaveCount(0);
}

/** Count dispatches as well as replies; a duplicate that is still pending cannot hide from this check. */
function watchCommands(page: Page) {
  const requests: { method: string; body: string | null; path: string }[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (request.url().startsWith(apiUrl) && path.startsWith(addressesPath)
      && ['POST', 'PUT', 'DELETE'].includes(request.method())) {
      requests.push({ method: request.method(), body: request.postData(), path });
    }
  });
  return requests;
}

/** Snapshot pending dispatches too; exclude only a proven 401 and validate its one identical retry. */
function watchCommandIntents(page: Page) {
  const requests: Request[] = [];
  const statuses = new Map<Request, number>();
  page.on('request', (request) => {
    if (request.url().startsWith(apiUrl) && new URL(request.url()).pathname.startsWith(addressesPath)
      && ['POST', 'PUT', 'DELETE'].includes(request.method())) requests.push(request);
  });
  // Callbacks record facts only. All assertions run at explicit test checkpoints, never in event handlers.
  page.on('response', (response) => { statuses.set(response.request(), response.status()); });
  return () => {
    const observed = [...requests];
    for (const [index, request] of observed.entries()) {
      if (statuses.get(request) !== 401) continue;
      const retry = observed[index + 1];
      // While refresh is pending, retain the original 401 as a counted dispatch until a retry actually arrives.
      if (!retry) continue;
      expect({ method: retry.method(), url: retry.url(), body: retry.postData() })
        .toEqual({ method: request.method(), url: request.url(), body: request.postData() });
      expect(statuses.get(retry), 'an authenticated command is retried only once').not.toBe(401);
    }
    // Unpaired 401s and all pending/network attempts remain visible; only an observed, validated retry collapses.
    return observed.filter((request, index) => statuses.get(request) !== 401 || !observed[index + 1])
      .map((request) => ({ method: request.method(), path: new URL(request.url()).pathname, body: request.postData() }));
  };
}

async function expectReadOnly(page: Page): Promise<void> {
  await expect(ui(page).main.getByRole('status').filter({ hasText: text.closing })).toBeVisible();
  for (const name of ['Add address', 'Edit', 'Remove']) {
    await expect(ui(page).main.getByRole('button', { name, exact: true })).toHaveCount(0);
  }
  await expect(ui(page).dialog).toBeHidden();
}

/** Keyboard navigation with a bound; never focus the requested control programmatically. */
async function tabTo(page: Page, target: Locator): Promise<void> {
  for (let step = 0; step < 30; step++) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  await expect(target, 'control must be reachable by keyboard within 30 Tab presses').toBeFocused();
}

test('E2E-12-01 Account links to the empty book; the first address becomes default and survives reload', t5, async ({ page }) => {
  const customer = syntheticCustomer();
  await register(page, customer);
  await page.getByRole('link', { name: 'Addresses', exact: true }).click();
  await expect(page).toHaveURL('/account/addresses');
  await expect(ui(page).heading).toBeVisible();
  await expect(ui(page).main.getByText('No saved addresses yet.', { exact: true })).toBeVisible();
  await expect(ui(page).main.getByText('0 of 3', { exact: true })).toBeVisible();
  await ui(page).add.click();
  await expect(ui(page).makeDefault).toBeChecked();
  await expect(ui(page).makeDefault).toBeDisabled();
  await expect(ui(page).dialog.getByText('Your first address is the default.', { exact: true })).toBeVisible();
  const value = syntheticAddress({ label: 'Home', isDefault: false });
  await fill(page, value);
  await save(page);
  await expect(card(page, 'Home').getByText('Default', { exact: true })).toBeVisible();
  const stored = storedAddresses(customer.username);
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({ ...addressEdit({ ...value, version: 0 }), isDefault: true });
  await page.reload();
  await expect(card(page, 'Home')).toContainText(value.recipientName);
  await expect(card(page, 'Home')).toContainText(value.addressLine);
  await expect(ui(page).main.getByText('1 of 3', { exact: true })).toBeVisible();
  expect(storedAddresses(customer.username)).toEqual(stored);
});

test('E2E-12-02 three addresses show the count and full note; removal restores Add address', t5, async ({ page }) => {
  const customer = await registerByApi(page.request);
  await openAddresses(page, customer);
  for (const label of ['Home', 'Office', 'Parents']) await add(page, syntheticAddress({ label }));
  await expect(ui(page).cards).toHaveCount(3);
  await expect(ui(page).main.getByText('3 of 3', { exact: true })).toBeVisible();
  await expect(ui(page).main.getByText(text.full, { exact: true })).toBeVisible();
  await expect(ui(page).add).toHaveCount(0);
  await remove(page, 'Parents');
  await expect(ui(page).add).toBeVisible();
  await expect(ui(page).main.getByText(text.full, { exact: true })).toHaveCount(0);
  await add(page, syntheticAddress({ label: 'Replacement' }));
  await page.reload();
  await expect(ui(page).cards).toHaveCount(3);
  expect(storedAddresses(customer.username).map(({ label }) => label)).toEqual(['Home', 'Office', 'Replacement']);
});

test('E2E-12-03 editing every address field preserves identity, normalizes spaces and persists on reload', t5, async ({ page, request }) => {
  const api = await seeded(request, ['Home', 'Office']);
  const before = (await api.book()).items;
  const initial = before[1];
  await openAddresses(page, api.user);
  await edit(page, 'Office');
  await expect(ui(page).label).toHaveValue(initial.label!);
  await expect(ui(page).name).toHaveValue(initial.recipientName);
  await expect(ui(page).mobile).toHaveValue(initial.mobile);
  await expect(ui(page).address).toHaveValue(initial.addressLine);
  await expect(ui(page).city).toHaveValue(initial.city);
  await expect(ui(page).makeDefault).not.toBeChecked();
  await expect(ui(page).makeDefault).toBeEnabled();
  const replacement = syntheticAddress({ label: '  New   Office  ', recipientName: '  New   Recipient  ',
    addressLine: '  Synthetic   House 77, Road 12  ', city: '  New   City  ' });
  await fill(page, replacement);
  await save(page, 'PUT');
  const stored = storedAddresses(api.user.username);
  expect(stored).toEqual([before[0], { id: initial.id, label: 'New Office', recipientName: 'New Recipient',
    mobile: replacement.mobile, addressLine: 'Synthetic House 77, Road 12', city: 'New City', isDefault: false,
    version: initial.version + 1 }]);
  expect(storedAddressChanges(api.user.username)).toHaveLength(3);
  await page.reload();
  await expect(card(page, 'New Office')).toContainText('New City');
  await expect(card(page, 'New Office')).toContainText(replacement.mobile);
  expect(storedAddresses(api.user.username)).toEqual(stored);
});

test('E2E-12-77 adding a default to a populated book preserves its neighbor and demotes the old default', t5,
  async ({ page, request }) => {
    const api = await seeded(request, ['Home', 'Office']);
    const before = (await api.book()).items;
    await openAddresses(page, api.user);
    const intents = watchCommandIntents(page);
    let commands = intents();
    const value = syntheticAddress({ label: 'Parents [east] (A)+?', isDefault: true });
    await ui(page).add.click();
    await expect(ui(page).makeDefault).toBeEnabled();
    await expect(ui(page).makeDefault).not.toBeChecked();
    await fill(page, value);
    await save(page);
    commands = intents();
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({ method: 'POST', path: addressesPath });
    const body = JSON.parse(commands[0].body!) as AddressCreate;
    expect(body.id).toMatch(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
    expect(before.map(({ id }) => id)).not.toContain(body.id);
    // Capture only the generated id; every submitted field/default comes from the independent fixture.
    expect(body).toEqual({ ...value, id: body.id });
    const expected = [{ ...before[0], isDefault: false, version: before[0].version + 1 }, before[1],
      { ...value, id: body.id, version: 0 }];
    expect(storedAddresses(api.user.username)).toEqual(expected);
    expect(storedAddressChanges(api.user.username)).toHaveLength(3);
    for (const reload of [false, true]) {
      if (reload) await page.reload();
      await expect(ui(page).cards).toHaveCount(3);
      await expect(ui(page).main.getByText('3 of 3', { exact: true })).toBeVisible();
      await expect(ui(page).cards.getByText('Default', { exact: true })).toHaveCount(1);
      await expect(card(page, value.label!).getByText('Default', { exact: true })).toBeVisible();
      for (const field of [value.recipientName, value.mobile, value.addressLine, value.city]) {
        await expect(card(page, value.label!)).toContainText(field);
      }
      expect(storedAddresses(api.user.username)).toEqual(expected);
    }
  });

test('E2E-12-04 moving the default changes one chip, bumps both versions, and cannot clear the current default', t5, async ({ page, request }) => {
  const api = await seeded(request, ['Home', 'Office']);
  await openAddresses(page, api.user);
  await edit(page, 'Home');
  await expect(ui(page).makeDefault).toBeChecked();
  await expect(ui(page).makeDefault).toBeDisabled();
  await expect(ui(page).dialog.getByText('To change the default, edit another address and tick Default.', { exact: true })).toBeVisible();
  await ui(page).cancel.click();
  await edit(page, 'Office');
  await expect(ui(page).makeDefault).not.toBeChecked();
  await expect(ui(page).makeDefault).toBeEnabled();
  await ui(page).makeDefault.check();
  await save(page, 'PUT');
  await expect(card(page, 'Office').getByText('Default', { exact: true })).toBeVisible();
  await expect(card(page, 'Home').getByText('Default', { exact: true })).toHaveCount(0);
  expect(storedAddresses(api.user.username).map(({ label, isDefault, version }) => ({ label, isDefault, version })))
    .toEqual([{ label: 'Home', isDefault: false, version: 1 }, { label: 'Office', isDefault: true, version: 1 }]);
  expect(storedAddressChanges(api.user.username)).toHaveLength(3);
  await page.reload();
  await expect(card(page, 'Office').getByText('Default', { exact: true })).toBeVisible();
});

const invalidDrafts = [
  { name: 'short mobile', field: 'mobile', value: '0171234567' },
  { name: 'blank city', field: 'city', value: '   ' },
  { name: 'blank name', field: 'name', value: '   ' },
  { name: 'blank address', field: 'address', value: '   ' },
  { name: 'control character in name', field: 'name', value: 'Test\u0085Name' },
  { name: 'control character in label', field: 'label', value: 'Home\u0085Label' },
  { name: 'control character in address', field: 'address', value: 'House\u0085Road' },
  { name: 'control character in city', field: 'city', value: 'Test\u0085City' },
  { name: 'line separator in name', field: 'name', value: 'Test\u2028Name' },
  { name: 'paragraph separator in address', field: 'address', value: 'House\u2029Road' },
  { name: 'blank mobile', field: 'mobile', value: '' },
  { name: 'Bengali mobile digits', field: 'mobile', value: '০১৭১২৩৪৫৬৭৮' },
  { name: 'nondigit mobile', field: 'mobile', value: '0171234567x' },
] as const;

for (const mode of ['Add', 'Edit'] as const) {
  for (const invalid of invalidDrafts) {
    test(`E2E-12-05 ${mode} rejects ${invalid.name} with a linked error, retained draft and zero commands`, t5,
      async ({ page, request }) => {
        const api = mode === 'Add' ? await AddressApi.register(request) : await seeded(request, ['Home']);
        const before = storedAddresses(api.user.username);
        const changes = storedAddressChanges(api.user.username);
        await openAddresses(page, api.user);
        if (mode === 'Add') await ui(page).add.click();
        else await edit(page, 'Home');
        const valid = mode === 'Add' ? syntheticAddress() : { ...before[0], city: 'Corrected City' };
        await fill(page, valid);
        const field = ui(page)[invalid.field];
        await field.fill(invalid.value);
        await expect(field).toHaveValue(invalid.value);
        const defaultChecked = await ui(page).makeDefault.isChecked();
        const draft = await Promise.all([ui(page).label, ui(page).name, ui(page).mobile,
          ui(page).address, ui(page).city].map((input) => input.inputValue()));
        const ids = (await field.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
        const hints = await Promise.all(ids.map(async (id) => {
          const element = page.locator(`[id="${id}"]`);
          return await element.isVisible() ? (await element.innerText()).trim() : '';
        }));
        const intents = watchCommandIntents(page);
        let commands = intents();
        await ui(page).save.click();
        await expect(ui(page).dialog).toBeVisible();
        await expect(field).toHaveAttribute('aria-invalid', 'true');
        const description = await field.getAttribute('aria-describedby');
        expect(description).toBeTruthy();
        const errors: string[] = [];
        for (const id of description!.split(/\s+/).filter(Boolean)) {
          const error = page.locator(`[id="${id}"]`);
          if (!await error.isVisible()) continue;
          const message = (await error.innerText()).trim();
          if (message && !hints.includes(message)) errors.push(message);
        }
        expect(errors, 'validation must link a new visible error, beyond the existing hint').not.toEqual([]);
        for (const message of errors) {
          await expect(field).toHaveAccessibleDescription(new RegExp(message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        }
        expect(await Promise.all([ui(page).label, ui(page).name, ui(page).mobile,
          ui(page).address, ui(page).city].map((input) => input.inputValue()))).toEqual(draft);
        expect(await ui(page).makeDefault.isChecked()).toBe(defaultChecked);
        commands = intents();
        expect(commands).toEqual([]);
        expect(storedAddresses(api.user.username)).toEqual(before);
        expect(storedAddressChanges(api.user.username)).toEqual(changes);
        await fill(page, valid);
        await save(page, mode === 'Add' ? 'POST' : 'PUT');
        commands = intents();
        expect(commands).toHaveLength(1);
        expect(commands[0].method).toBe(mode === 'Add' ? 'POST' : 'PUT');
        const body = JSON.parse(commands[0].body!) as AddressCreate;
        expect(commands[0].path).toBe(mode === 'Add' ? addressesPath : `${addressesPath}/${before[0].id}`);
        if (mode === 'Add') {
          expect(body.id).toMatch(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
          expect(body).toEqual({ ...valid, id: body.id, isDefault: true });
        } else {
          expect(body).toEqual(addressEdit({ ...valid, id: before[0].id, version: before[0].version }));
        }
        // Every submitted field comes from the independent corrected fixture; only Add's generated id is captured.
        const expected = mode === 'Add'
          ? { ...valid, id: body.id, isDefault: true, version: 0 } : { ...valid, version: 1 };
        expect(storedAddresses(api.user.username)).toEqual([expected]);
        expect(storedAddressChanges(api.user.username)).toHaveLength(changes.length + 1);
      });
  }
}

test('E2E-12-06 an outdated tab gets STALE_UPDATE; Reload restores current fields and version', t5, async ({ page, context, request }) => {
  const api = await seeded(request, ['Home']);
  await openAddresses(page, api.user);
  const other = await context.newPage();
  await other.goto('/account/addresses');
  await expect(card(other, 'Home')).toBeVisible();
  await edit(page, 'Home');
  await edit(other, 'Home');
  await ui(other).city.fill('Latest City');
  await save(other, 'PUT');
  await ui(page).city.fill('Stale City');
  const refusal = await captureAddressJson<{ code: string }>(page, 'PUT',
    `${addressesPath}/${storedAddresses(api.user.username)[0].id}`, 409);
  const refused = addressResponse(page, 'PUT');
  await ui(page).save.click();
  expect((await refused).status()).toBe(409);
  expect(refusal().code).toBe('STALE_UPDATE');
  await expect(ui(page).dialog.getByRole('alert').filter({ hasText: text.stale })).toBeVisible();
  await expect(ui(page).city).toHaveValue('Stale City');
  await ui(page).dialog.getByRole('button', { name: 'Reload', exact: true }).click();
  await expect(ui(page).city).toHaveValue('Latest City');
  await expect(ui(page).dialog.getByText(text.stale, { exact: true })).toHaveCount(0);
  await ui(page).city.fill('After Reload');
  await save(page, 'PUT');
  expect(storedAddresses(api.user.username)[0]).toMatchObject({ city: 'After Reload', version: 2 });
});

test('E2E-12-73 a failed stale-dialog Reload reports failure without writes; another Reload restores the current version', t6,
  async ({ page, request }) => {
    const api = await seeded(request, ['Home']);
    await openAddresses(page, api.user);
    await edit(page, 'Home');
    const original = (await api.book()).items[0];
    await expectAddressBook(await api.update(original.id, addressEdit(original, { city: 'Current City' })));
    const before = storedAddresses(api.user.username);
    const changes = storedAddressChanges(api.user.username);
    const intents = watchCommandIntents(page);
    let commands = intents();
    await ui(page).city.fill('Stale Draft');
    const refusal = await captureAddressJson<{ code: string }>(page, 'PUT', `${addressesPath}/${original.id}`, 409);
    const refused = addressResponse(page, 'PUT');
    await ui(page).save.click();
    expect((await refused).status()).toBe(409);
    expect(refusal().code).toBe('STALE_UPDATE');
    await expect(ui(page).dialog.getByRole('alert')).toHaveCount(1);
    await expect(ui(page).dialog.getByRole('alert')).toContainText(text.stale);
    await expect(ui(page).dialog.getByRole('alert')).toBeVisible();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let firstReadHeld = false;
    let firstRead = true;
    await page.route(`${apiUrl}${addressesPath}`, async (route) => {
      if (route.request().method() !== 'GET' || !firstRead) return route.fallback();
      firstRead = false;
      firstReadHeld = true;
      await gate;
      await route.fulfill({ status: 500, contentType: 'application/json',
        json: { code: 'INTERNAL_ERROR', message: 't12-private-reload-diagnostic', requestId: 'synthetic-reload-error' } });
    });
    try {
      const failedRead = page.waitForResponse((response) => response.url() === `${apiUrl}${addressesPath}`
        && response.request().method() === 'GET' && response.status() === 500);
      await ui(page).dialog.getByRole('button', { name: 'Reload', exact: true }).click();
      await expect.poll(() => firstReadHeld).toBe(true);
      if (await ui(page).dialog.isVisible()) {
        // Attempt Save while reconciliation is held without prescribing every button's disabled state.
        await ui(page).dialog.locator('button[type="submit"]').evaluate((button) => (button as HTMLButtonElement).click());
        await ui(page).dialog.locator('form').evaluate((form) => (form as HTMLFormElement).requestSubmit());
      }
      commands = intents();
      expect(commands).toHaveLength(1);
      expect(commands[0].method).toBe('PUT');
      expect(storedAddresses(api.user.username)).toEqual(before);
      expect(storedAddressChanges(api.user.username)).toEqual(changes);
      release();
      expect((await failedRead).status()).toBe(500);
      // Failure placement and draft retention are not specified for a failed reconciliation read.
      // Require honest bounded feedback and retry, whether the dialog survives or becomes a load error.
      await expect(page.getByRole('alert').filter({ hasText: text.generic })).toBeVisible();
      await expect(page.locator('body')).not.toContainText('t12-private-reload-diagnostic');
      commands = intents();
      expect(commands).toHaveLength(1);
      expect(storedAddresses(api.user.username)).toEqual(before);
      expect(storedAddressChanges(api.user.username)).toEqual(changes);
      const retry = page.getByRole('button', { name: 'Reload', exact: true });
      await expect(retry).toBeVisible();
      const reloaded = addressResponse(page, 'GET');
      await retry.click();
      expect((await reloaded).status()).toBe(200);
      // Wait for the successful render before choosing the accepted surviving/closed-dialog path.
      await expect(ui(page).main.getByRole('alert').or(ui(page).dialog.getByRole('alert'))).toHaveCount(0);
      if (!await ui(page).dialog.isVisible()) await edit(page, 'Home');
      await expect(ui(page).city).toHaveValue('Current City');
      commands = intents();
      expect(commands).toHaveLength(1);
      expect(storedAddresses(api.user.username)).toEqual(before);
      expect(storedAddressChanges(api.user.username)).toEqual(changes);
      await ui(page).city.fill('Saved After Retry');
      await save(page, 'PUT');
      commands = intents();
      expect(commands.map(({ method }) => method)).toEqual(['PUT', 'PUT']);
      expect(JSON.parse(commands[1].body!)).toMatchObject({ version: before[0].version, city: 'Saved After Retry' });
      expect(storedAddresses(api.user.username)).toEqual([{ ...before[0], city: 'Saved After Retry', version: 2 }]);
      expect(storedAddressChanges(api.user.username)).toHaveLength(changes.length + 1);
    } finally { release(); }
  });

test('E2E-12-07 removing the default names the oldest successor; removing the final address restores empty state', t5, async ({ page, request }) => {
  const api = await seeded(request, ['Home', 'Office', 'Parents']);
  await openAddresses(page, api.user);
  await remove(page, 'Home');
  await expect(ui(page).main.getByRole('status').filter({ hasText: 'Office is now your default address.' })).toBeVisible();
  await expect(ui(page).cards.getByText('Default', { exact: true })).toHaveCount(1);
  expect(storedAddresses(api.user.username).map(({ label, isDefault, version }) => ({ label, isDefault, version })))
    .toEqual([{ label: 'Office', isDefault: true, version: 1 }, { label: 'Parents', isDefault: false, version: 0 }]);
  await remove(page, 'Parents');
  await expect(card(page, 'Office').getByText('Default', { exact: true })).toBeVisible();
  await remove(page, 'Office');
  await expect(ui(page).main.getByText('No saved addresses yet.', { exact: true })).toBeVisible();
  await expect(ui(page).main.getByText('0 of 3', { exact: true })).toBeVisible();
  expect(storedAddresses(api.user.username)).toEqual([]);
  expect(storedAddressChanges(api.user.username)).toHaveLength(3);
});

test('E2E-12-08 a closing account retains a readable book and has no mutation actions', {
  tag: ['@t12', '@t12-T5', '@cross-11-12'],
}, async ({ page, request }) => {
  const api = await seeded(request, ['Home', 'Office']);
  const before = storedAddresses(api.user.username);
  await openAddresses(page, api.user);
  setAccountState(api.user.username, 'CLOSURE_REQUESTED');
  await page.reload();
  await expectReadOnly(page);
  await expect(ui(page).main.getByRole('status').filter({ hasText: text.closing })).not.toBeFocused();
  await expect(ui(page).cards).toHaveCount(2);
  await expect(card(page, 'Home')).toContainText(before[0].addressLine);
  expect((await api.book()).accountState).toBe('CLOSURE_REQUESTED');
  expect(storedAddresses(api.user.username)).toEqual(before);
});

test('E2E-12-14 browser add/edit/remove changes only the address book and counted-change tables', t6, async ({ page, request }) => {
  const api = await seeded(request, ['Seeded']);
  await openAddresses(page, api.user);
  const excluded = ['user_sessions', 'user_session_refresh_tokens', 'databasechangelog', 'databasechangeloglock'];
  const fingerprints = tableFingerprints(excluded);
  function expectUnrelatedUnchanged(command: string): void {
    const current = tableFingerprints(excluded);
    expect(Object.keys(current).sort()).toEqual(Object.keys(fingerprints).sort());
    for (const table of Object.keys(fingerprints)) {
      if (!['saved_addresses', 'saved_address_changes'].includes(table)) {
        expect(current[table], `${command}: unexpected write to ${table}`).toBe(fingerprints[table]);
      }
    }
  }
  const changeCount = storedAddressChanges(api.user.username).length;
  const added = await add(page, syntheticAddress({ label: 'Added' }));
  expectUnrelatedUnchanged('Add');
  await edit(page, 'Added');
  await ui(page).city.fill('Edited City');
  await save(page, 'PUT');
  expectUnrelatedUnchanged('Edit');
  await remove(page, 'Seeded');
  expectUnrelatedUnchanged('Delete');
  const after = tableFingerprints(excluded);
  expect(Object.keys(after).sort()).toEqual(Object.keys(fingerprints).sort());
  for (const table of Object.keys(fingerprints)) {
    if (['saved_addresses', 'saved_address_changes'].includes(table)) expect(after[table]).not.toBe(fingerprints[table]);
    else expect(after[table], `unexpected write to ${table}`).toBe(fingerprints[table]);
  }
  const stored = storedAddresses(api.user.username);
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({ label: added.label, recipientName: added.recipientName, mobile: added.mobile,
    addressLine: added.addressLine, city: 'Edited City', isDefault: true, version: 2 });
  expect(storedAddressChanges(api.user.username)).toHaveLength(changeCount + 2);
});

test('E2E-12-15 smoke: register, add, reload, and refuse an anonymous book read', {
  tag: ['@t12', '@t12-T7', '@t12-smoke', '@smoke'],
}, async ({ page, request }) => {
  test.setTimeout(30_000);
  const customer = syntheticCustomer();
  await register(page, customer);
  await page.getByRole('link', { name: 'Addresses', exact: true }).click();
  const value = await add(page, syntheticAddress({ label: 'Smoke Home' }));
  await page.reload();
  await expect(card(page, 'Smoke Home')).toContainText(value.addressLine);
  expect((await request.get(`${apiUrl}${addressesPath}`)).status()).toBe(401);
});

test('E2E-12-16 keyboard labels, modal trap, default promotion, removal confirmation and return focus', t7, async ({ page }) => {
  const customer = await registerByApi(page.request);
  await openAddresses(page, customer);
  await tabTo(page, ui(page).add);
  const focusAppearance = await ui(page).add.evaluate((element) => {
    const style = getComputedStyle(element);
    return { visible: element.matches(':focus-visible'), outline: style.outlineStyle,
      width: style.outlineWidth, colour: style.outlineColor };
  });
  expect(focusAppearance.visible).toBe(true);
  expect(focusAppearance.outline).not.toBe('none');
  expect(Number.parseFloat(focusAppearance.width)).toBeGreaterThanOrEqual(2);
  expect(focusAppearance.colour).toBe('rgb(227, 155, 46)');
  await page.keyboard.press('Enter');
  await expect(ui(page).dialog).toBeVisible();
  const addHeading = ui(page).dialog.getByRole('heading');
  await expect(addHeading).toHaveCount(1);
  await expect(addHeading).toBeVisible();
  const addTitle = (await addHeading.innerText()).trim();
  expect(addTitle).not.toBe('');
  await expect(ui(page).dialog).toHaveAccessibleName(addTitle);
  expect(await ui(page).dialog.evaluate((dialog) => dialog.contains(document.activeElement)), 'opening moves focus into the modal').toBe(true);
  const fields = [ui(page).label, ui(page).name, ui(page).mobile, ui(page).address, ui(page).city];
  const labels = ['Label', 'Name', 'Mobile', 'Address', 'City'];
  const value = syntheticAddress({ label: 'Keyboard Home' });
  const values = [value.label!, value.recipientName, value.mobile, value.addressLine, value.city];
  for (let index = 0; index < fields.length; index++) {
    const field = fields[index];
    await expect(field).toBeVisible();
    const expectedLabel = labels[index];
    expect(await field.evaluate((element, name) => Array.from((element as HTMLInputElement).labels ?? [])
      .some((label) => label.textContent?.trim() === name), expectedLabel), 'expected copy is associated with the input').toBe(true);
    await expect(ui(page).dialog.locator('label').filter({ hasText: new RegExp(`^\\s*${expectedLabel}\\s*$`) })).toBeVisible();
    await tabTo(page, field);
    await page.keyboard.type(values[index]);
  }
  for (const key of ['Tab', 'Shift+Tab']) {
    for (let step = 0; step < 12; step++) {
      await page.keyboard.press(key);
      expect(await ui(page).dialog.evaluate((dialog) => dialog.contains(document.activeElement)), `${key} focus stays in modal`).toBe(true);
    }
  }
  await tabTo(page, ui(page).save);
  const saved = addressResponse(page, 'POST');
  await page.keyboard.press('Enter');
  expect((await saved).status()).toBe(201);
  await expect(ui(page).add).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(ui(page).dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(ui(page).dialog).toBeHidden();
  await expect(ui(page).add).toBeFocused();
  await tabTo(page, card(page, 'Keyboard Home').getByRole('button', { name: 'Edit', exact: true }));
  await page.keyboard.press('Enter');
  await expect(ui(page).dialog).toBeVisible();
  const editHeading = ui(page).dialog.getByRole('heading');
  await expect(editHeading).toHaveCount(1);
  await expect(editHeading).toBeVisible();
  const editTitle = (await editHeading.innerText()).trim();
  expect(editTitle).not.toBe('');
  await expect(ui(page).dialog).toHaveAccessibleName(editTitle);
  await page.keyboard.press('Escape');
  await expect(card(page, 'Keyboard Home').getByRole('button', { name: 'Edit', exact: true })).toBeFocused();

  await tabTo(page, ui(page).add);
  await page.keyboard.press('Enter');
  const second = syntheticAddress({ label: 'Keyboard Office' });
  const secondValues = [second.label!, second.recipientName, second.mobile, second.addressLine, second.city];
  for (let index = 0; index < fields.length; index++) {
    await tabTo(page, fields[index]);
    await page.keyboard.type(secondValues[index]);
  }
  await expect(ui(page).makeDefault).toBeEnabled();
  await expect(ui(page).makeDefault).not.toBeChecked();
  await tabTo(page, ui(page).save);
  const created = addressResponse(page, 'POST');
  await page.keyboard.press('Enter');
  expect((await created).status()).toBe(201);
  await expect(ui(page).dialog).toBeHidden();
  await expect(ui(page).add).toBeFocused();

  const officeEdit = card(page, 'Keyboard Office').getByRole('button', { name: 'Edit', exact: true });
  await tabTo(page, officeEdit);
  await page.keyboard.press('Enter');
  await tabTo(page, ui(page).makeDefault);
  await page.keyboard.press('Space');
  await expect(ui(page).makeDefault).toBeChecked();
  await tabTo(page, ui(page).save);
  const promoted = addressResponse(page, 'PUT');
  await page.keyboard.press('Enter');
  expect((await promoted).status()).toBe(200);
  await expect(ui(page).dialog).toBeHidden();
  await expect(officeEdit).toBeFocused();
  await expect(card(page, 'Keyboard Office').getByText('Default', { exact: true })).toBeVisible();
  await expect(card(page, 'Keyboard Home').getByText('Default', { exact: true })).toHaveCount(0);

  const intents = watchCommandIntents(page);
  let commands = intents();
  await page.keyboard.press('Enter');
  await tabTo(page, ui(page).remove);
  await page.keyboard.press('Enter');
  await expect(ui(page).dialog.getByText('Remove this address?', { exact: true })).toBeVisible();
  await tabTo(page, ui(page).keep);
  await page.keyboard.press('Enter');
  await expect(ui(page).dialog.getByText('Remove this address?', { exact: true })).toHaveCount(0);
  await expect(ui(page).dialog).toBeVisible();
  commands = intents();
  expect(commands).toEqual([]);
  await tabTo(page, ui(page).remove);
  await page.keyboard.press('Enter');
  await expect(ui(page).dialog.getByText('Remove this address?', { exact: true })).toBeVisible();
  await tabTo(page, ui(page).remove);
  const deleted = addressResponse(page, 'DELETE');
  await page.keyboard.press('Enter');
  expect((await deleted).status()).toBe(200);
  await expect(ui(page).dialog).toBeHidden();
  await expect(card(page, 'Keyboard Office')).toHaveCount(0);
  await expect(card(page, 'Keyboard Home').getByText('Default', { exact: true })).toBeVisible();
  await page.keyboard.press('Tab');
  await tabTo(page, ui(page).add);
  commands = intents();
  expect(commands.map(({ method }) => method)).toEqual(['DELETE']);
  expect(storedAddresses(customer.username)).toHaveLength(1);
  expect(storedAddressChanges(customer.username)).toHaveLength(3);
});

test('E2E-12-17 addresses and dialogs fit 375px and 1280px with all action targets at least 44px', t7, async ({ page, request }) => {
  const api = await seeded(request, ['Home', 'Office']);
  await openAddresses(page, api.user);
  async function expectTarget(target: Locator): Promise<void> {
    await expect(target).toBeVisible();
    const box = await target.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  async function expectDialogTargets(): Promise<void> {
    const view = ui(page);
    for (const field of [view.label, view.name, view.mobile, view.address, view.city]) await expectTarget(field);
    for (const button of await view.dialog.getByRole('button').all()) await expectTarget(button);
    // The associated clickable label supplies the checkbox hit area; its small glyph need not be 44px.
    const defaultLabel = view.dialog.locator('label').filter({ hasText: /^\s*Default address\s*$/ });
    expect(await view.makeDefault.evaluate((element) => Array.from((element as HTMLInputElement).labels ?? [])
      .some((label) => label.textContent?.trim() === 'Default address'))).toBe(true);
    await expectTarget(defaultLabel);
  }
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.reload();
    await expect(ui(page).cards).toHaveCount(2);
    await expectTarget(ui(page).add);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const boxes = await ui(page).cards.evaluateAll((cards) => cards.map((element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    }));
    expect(boxes).toHaveLength(2);
    const addBox = (await ui(page).add.boundingBox())!;
    if (width === 375) {
      expect(boxes[0].x).toBe(boxes[1].x);
      expect(boxes[1].y).toBeGreaterThanOrEqual(boxes[0].y + boxes[0].height);
      expect(addBox.y).toBeGreaterThanOrEqual(boxes[1].y + boxes[1].height);
    } else {
      expect(boxes[0].y).toBe(boxes[1].y);
      expect(addBox.y).toBe(boxes[1].y);
    }
    for (const button of await ui(page).cards.getByRole('button', { name: 'Edit', exact: true }).all()) await expectTarget(button);
    await ui(page).add.click();
    await expectDialogTargets();
    await expect(ui(page).makeDefault).toBeEnabled();
    await ui(page).dialog.locator('label').filter({ hasText: /^\s*Default address\s*$/ }).click();
    await expect(ui(page).makeDefault).toBeChecked();
    await ui(page).cancel.click();
    await edit(page, 'Office');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expectDialogTargets();
    await ui(page).remove.click();
    await expect(ui(page).dialog.getByText('Remove this address?', { exact: true })).toBeVisible();
    await expectTarget(ui(page).keep);
    await expectTarget(ui(page).remove);
    await ui(page).keep.click();
    await ui(page).cancel.click();
  }
  expect(storedAddressChanges(api.user.username)).toHaveLength(2);
});

test('E2E-12-72 accepted maximum-length unbroken and Bengali text fits cards and edit dialogs at both widths', t7,
  async ({ page, request }) => {
    const api = await AddressApi.register(request);
    const value = syntheticAddress({ label: 'H'.repeat(40), recipientName: 'ক'.repeat(100),
      addressLine: `Road${'ব'.repeat(196)}`, city: 'C'.repeat(60) });
    await openAddresses(page, api.user);
    await add(page, value);
    for (const width of [375, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.reload();
      const savedCard = card(page, value.label!);
      await expect(savedCard).toContainText(value.recipientName);
      await expect(savedCard).toContainText(value.addressLine);
      await expect(savedCard).toContainText(value.city);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect(await savedCard.evaluate((element) => element.scrollWidth <= element.clientWidth), 'long values must fit their card').toBe(true);
      await edit(page, value.label!);
      const view = ui(page);
      for (const [field, expectedValue] of [[view.label, value.label!], [view.name, value.recipientName],
        [view.address, value.addressLine], [view.city, value.city]] as const) await expect(field).toHaveValue(expectedValue);
      expect(await view.dialog.evaluate((element) => element.scrollWidth <= element.clientWidth), 'dialog content must fit its width').toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await view.cancel.click();
    }
    expect(storedAddresses(api.user.username)[0]).toMatchObject({ label: value.label, recipientName: value.recipientName,
      addressLine: value.addressLine, city: value.city });
    expect(storedAddressChanges(api.user.username)).toHaveLength(1);
  });

test('E2E-12-18 profile edits and staged mobile changes leave the saved delivery address untouched', {
  tag: ['@t12', '@t12-T5', '@cross-11-12'],
}, async ({ page, request }) => {
  const api = await AddressApi.register(request);
  await expectAddressBook(await api.create(syntheticAddress({ label: 'Home', mobile: api.user.mobile })), 201);
  const before = storedAddresses(api.user.username);
  const changes = storedAddressChanges(api.user.username);
  await openAddresses(page, api.user);
  await page.goto('/account/profile');
  const fullName = syntheticFullName();
  const pending = syntheticMobile();
  await page.getByLabel('Full name').fill(fullName);
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Profile saved.' })).toBeVisible();
  await page.getByRole('button', { name: 'Change', exact: true }).click();
  await page.getByRole('dialog', { name: 'Change mobile' }).getByLabel('New mobile').fill(pending);
  await page.getByRole('button', { name: 'Save for verification', exact: true }).click();
  await expect(page.getByText(`New number ${pending} is waiting for verification.`, { exact: true })).toBeVisible();
  await page.goto('/account/addresses');
  await expect(card(page, 'Home')).toContainText(api.user.mobile);
  await expect(ui(page).main.getByText(pending, { exact: false })).toHaveCount(0);
  expect(storedAddresses(api.user.username)).toEqual(before);
  expect(storedAddressChanges(api.user.username)).toEqual(changes);
  expect(storedProfile(api.user.username)).toMatchObject({ fullName, mobile: api.user.mobile,
    pendingChanges: [{ newMobile: pending }] });
  await page.goto('/account/profile');
  await expect(page.getByLabel('Full name')).toHaveValue(fullName);
  await expect(page.getByText(`New number ${pending} is waiting for verification.`, { exact: true })).toBeVisible();
});

test('E2E-12-20 exhausted changes close the edit with one warning; removing is still allowed', t5, async ({ page, request }) => {
  assertAwayFromDhakaPeriodStart();
  const api = await seeded(request, ['Home', 'Office', 'Parents']);
  for (const city of ['Change Four', 'Change Five']) {
    const home = (await api.book()).items[0];
    await expectAddressBook(await api.update(home.id, addressEdit(home, { city })));
  }
  const before = storedAddresses(api.user.username);
  await openAddresses(page, api.user);
  await edit(page, 'Home');
  await expectNotice(page, await api.book());
  await expect(ui(page).save).toBeEnabled();
  await ui(page).city.fill('Refused City');
  const refusal = await captureAddressJson<{ code: string }>(page, 'PUT', `${addressesPath}/${before[0].id}`, 409);
  await save(page, 'PUT', 409);
  expect(refusal().code).toBe('ADDRESS_CHANGE_LIMIT_REACHED');
  const warning = ui(page).main.getByRole('status').filter({ hasText: text.limit });
  await expect(warning).toHaveCount(1);
  await expect(warning).toBeFocused();
  expect(storedAddresses(api.user.username)).toEqual(before);
  await expect(card(page, 'Home')).toContainText('Change Five');
  await expect(ui(page).cards.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(3);
  await remove(page, 'Parents');
  await expect(warning).toHaveCount(0);
  await expect(ui(page).add).toBeVisible();
  await page.reload();
  await expect(ui(page).cards).toHaveCount(2);
  expect(storedAddressChanges(api.user.username)).toHaveLength(5);
});

test('E2E-12-22 every Add and Edit announces server allowance before saving and reflects each counted change', t5, async ({ page, request }) => {
  assertAwayFromDhakaPeriodStart();
  const api = await AddressApi.register(request);
  await openAddresses(page, api.user);
  await ui(page).add.click();
  const empty = await api.book();
  expect(empty.changeAllowance).toEqual({ perWeek: 5, perMonth: 10, remainingThisWeek: 5, remainingThisMonth: 10 });
  await expectNotice(page, empty);
  await fill(page, syntheticAddress({ label: 'Home' }));
  await save(page);
  await ui(page).add.click();
  const afterCreate = await api.book();
  expect(afterCreate.changeAllowance).toMatchObject({ remainingThisWeek: 4, remainingThisMonth: 9 });
  await expectNotice(page, afterCreate);
  await ui(page).cancel.click();
  const home = afterCreate.items[0];
  await expectAddressBook(await api.update(home.id, addressEdit(home, { city: 'Updated City' })));
  await page.reload();
  const afterEdit = await api.book();
  expect(afterEdit.changeAllowance).toMatchObject({ remainingThisWeek: 3, remainingThisMonth: 8 });
  await ui(page).add.click();
  await expectNotice(page, afterEdit);
  await ui(page).cancel.click();
  await edit(page, 'Home');
  await expectNotice(page, afterEdit);
});

test('E2E-12-50 blank labels use the city, Bengali text persists, and field lengths match the accepted limits', t5, async ({ page }) => {
  const customer = await registerByApi(page.request);
  await openAddresses(page, customer);
  await ui(page).add.click();
  const view = ui(page);
  for (const [field, maximum] of [[view.label, 40], [view.name, 100], [view.mobile, 11], [view.address, 200], [view.city, 60]] as const) {
    await expect(field).toHaveAttribute('maxlength', String(maximum));
  }
  await expect(view.label).toHaveAttribute('placeholder', 'Home, Office…');
  await expect(view.address).toHaveAttribute('placeholder', 'House, road, area');
  await expect(view.mobile).toHaveAttribute('inputmode', 'numeric');
  await expect(view.dialog.getByText('+880', { exact: true })).toHaveCount(0);
  const value = syntheticAddress({ label: '   ', recipientName: 'রহিম উদ্দিন', addressLine: 'বাড়ি ১২, সড়ক ৫', city: 'ঢাকা' });
  await fill(page, value);
  await save(page);
  await expect(card(page, 'ঢাকা')).toContainText('রহিম উদ্দিন');
  expect(storedAddresses(customer.username)[0]).toMatchObject({ label: null, recipientName: value.recipientName,
    addressLine: value.addressLine, city: value.city });
  await page.reload();
  await expect(card(page, 'ঢাকা')).toContainText(value.addressLine);
});

test('E2E-12-51 Remove requires confirmation; Keep retains the draft and Cancel or Escape discards it without a command', t6, async ({ page, request }) => {
  const api = await seeded(request, ['Home', 'Office']);
  await openAddresses(page, api.user);
  const before = storedAddresses(api.user.username);
  const changes = storedAddressChanges(api.user.username);
  const commands = watchCommands(page);
  await edit(page, 'Office');
  const draft = syntheticAddress({ label: 'Unsaved [Office]', city: 'Unsaved City', isDefault: true });
  await fill(page, draft);
  await ui(page).remove.click();
  await expect(ui(page).dialog.getByText('Remove this address?', { exact: true })).toBeVisible();
  await ui(page).keep.click();
  await expect(ui(page).dialog.getByText('Remove this address?', { exact: true })).toHaveCount(0);
  for (const [field, value] of [[ui(page).label, draft.label!], [ui(page).name, draft.recipientName],
    [ui(page).mobile, draft.mobile], [ui(page).address, draft.addressLine], [ui(page).city, draft.city]] as const) {
    await expect(field).toHaveValue(value);
  }
  await expect(ui(page).makeDefault).toBeChecked();
  await ui(page).cancel.click();
  await edit(page, 'Office');
  for (const [field, value] of [[ui(page).label, before[1].label!], [ui(page).name, before[1].recipientName],
    [ui(page).mobile, before[1].mobile], [ui(page).address, before[1].addressLine],
    [ui(page).city, before[1].city]] as const) await expect(field).toHaveValue(value);
  await expect(ui(page).makeDefault).not.toBeChecked();
  await fill(page, draft);
  await page.keyboard.press('Escape');
  await expect(ui(page).dialog).toBeHidden();
  await edit(page, 'Office');
  for (const [field, value] of [[ui(page).label, before[1].label!], [ui(page).name, before[1].recipientName],
    [ui(page).mobile, before[1].mobile], [ui(page).address, before[1].addressLine],
    [ui(page).city, before[1].city]] as const) await expect(field).toHaveValue(value);
  await expect(ui(page).makeDefault).not.toBeChecked();
  await ui(page).cancel.click();
  expect(commands).toEqual([]);
  expect(storedAddresses(api.user.username)).toEqual(before);
  expect(storedAddressChanges(api.user.username)).toEqual(changes);
});

test('E2E-12-52 a stale Add sees ADDRESS_BOOK_FULL once, closes and reloads the three persisted cards', t6, async ({ page, request }) => {
  const api = await seeded(request, ['Home', 'Office']);
  await openAddresses(page, api.user);
  await ui(page).add.click();
  await fill(page, syntheticAddress({ label: 'Refused Fourth' }));
  await expectAddressBook(await api.create(syntheticAddress({ label: 'Other Tab' })), 201);
  await save(page, 'POST', 409);
  const alert = ui(page).main.getByRole('alert').filter({ hasText: text.fullError });
  await expect(alert).toHaveCount(1);
  await expect(ui(page).cards).toHaveCount(3);
  await expect(card(page, 'Other Tab')).toBeVisible();
  await expect(card(page, 'Refused Fourth')).toHaveCount(0);
  await expect(ui(page).add).toHaveCount(0);
  expect(storedAddresses(api.user.username).map(({ label }) => label)).toEqual(['Home', 'Office', 'Other Tab']);
  expect(storedAddressChanges(api.user.username)).toHaveLength(3);
});

for (const operation of ['add', 'edit', 'remove'] as const) {
  test(`E2E-12-53 ${operation} refused after closure begins closes the dialog and focuses the read-only warning`, {
    tag: ['@t12', '@t12-T6', '@cross-11-12'],
  }, async ({ page, request }) => {
    const api = await seeded(request, ['Home']);
    await openAddresses(page, api.user);
    const before = storedAddresses(api.user.username);
    const changes = storedAddressChanges(api.user.username);
    if (operation === 'add') {
      await ui(page).add.click();
      await fill(page, syntheticAddress({ label: 'New Home' }));
    } else {
      await edit(page, 'Home');
      if (operation === 'edit') await ui(page).city.fill('Refused City');
      else await ui(page).remove.click();
    }
    setAccountState(api.user.username, 'CLOSURE_REQUESTED');
    const method = operation === 'add' ? 'POST' : operation === 'edit' ? 'PUT' : 'DELETE';
    const path = operation === 'add' ? addressesPath
      : `${addressesPath}/${before[0].id}${operation === 'remove' ? `?version=${before[0].version}` : ''}`;
    const refusal = await captureAddressJson<{ code: string }>(page, method, path, 409);
    const response = addressResponse(page, method);
    if (operation === 'remove') await ui(page).remove.click();
    else await ui(page).save.click();
    const refused = await response;
    expect(refused.status()).toBe(409);
    expect(refusal().code).toBe('ACCOUNT_CLOSING');
    await expectReadOnly(page);
    await expect(ui(page).main.getByRole('status').filter({ hasText: text.closing })).toBeFocused();
    expect(storedAddresses(api.user.username)).toEqual(before);
    expect(storedAddressChanges(api.user.username)).toEqual(changes);
  });
}

for (const operation of ['edit', 'remove'] as const) {
  test(`E2E-12-54 ${operation} after another tab removes the row reloads the book; delete 404 is already removed`, t6,
    async ({ page, request }) => {
      const api = await seeded(request, ['Home', 'Office']);
      await openAddresses(page, api.user);
      await edit(page, 'Office');
      if (operation === 'edit') await ui(page).city.fill('Missing City');
      else await ui(page).remove.click();
      const office = (await api.book()).items[1];
      await expectAddressBook(await api.remove(office.id, office.version));
      if (operation === 'edit') await save(page, 'PUT', 404);
      else {
        const response = addressResponse(page, 'DELETE');
        await ui(page).remove.click();
        expect((await response).status()).toBe(404);
        await expect(ui(page).dialog).toBeHidden();
      }
      await expect(ui(page).cards).toHaveCount(1);
      await expect(card(page, 'Office')).toHaveCount(0);
      if (operation === 'edit') await expect(ui(page).main.getByText(text.notFound, { exact: true })).toBeVisible();
      else await expect(ui(page).main.getByRole('alert')).toHaveCount(0);
      expect(storedAddresses(api.user.username).map(({ label }) => label)).toEqual(['Home']);
      expect(storedAddressChanges(api.user.username)).toHaveLength(2);
    });
}

test('E2E-12-55 deletion from a stale dialog offers Reload and never removes a newer edit', t6, async ({ page, request }) => {
  const api = await seeded(request, ['Home']);
  await openAddresses(page, api.user);
  await edit(page, 'Home');
  const home = (await api.book()).items[0];
  await expectAddressBook(await api.update(home.id, addressEdit(home, { city: 'Newer City' })));
  await ui(page).remove.click();
  const refusal = await captureAddressJson<{ code: string }>(page, 'DELETE',
    `${addressesPath}/${home.id}?version=${home.version}`, 409);
  const response = addressResponse(page, 'DELETE');
  await ui(page).remove.click();
  const stale = await response;
  expect(stale.status()).toBe(409);
  expect(refusal().code).toBe('STALE_UPDATE');
  await expect(ui(page).dialog.getByRole('alert').filter({ hasText: text.stale })).toBeVisible();
  await ui(page).dialog.getByRole('button', { name: 'Reload', exact: true }).click();
  await expect(ui(page).city).toHaveValue('Newer City');
  await ui(page).remove.click();
  const removed = addressResponse(page, 'DELETE');
  await ui(page).remove.click();
  expect((await removed).status()).toBe(200);
  await expect(ui(page).dialog).toBeHidden();
  expect(storedAddresses(api.user.username)).toEqual([]);
});

test('E2E-12-56 promotion while another dialog is open yields STALE_UPDATE before the default guard', t6, async ({ page, request }) => {
  const api = await seeded(request, ['Home', 'Office']);
  await openAddresses(page, api.user);
  await edit(page, 'Office');
  await expect(ui(page).makeDefault).not.toBeChecked();
  const home = (await api.book()).items[0];
  await expectAddressBook(await api.remove(home.id, home.version));
  await ui(page).city.fill('Old Version City');
  const refusal = await captureAddressJson<{ code: string }>(page, 'PUT',
    `${addressesPath}/${storedAddresses(api.user.username)[0].id}`, 409);
  const response = addressResponse(page, 'PUT');
  await ui(page).save.click();
  const stale = await response;
  expect(stale.status()).toBe(409);
  expect(refusal().code).toBe('STALE_UPDATE');
  await ui(page).dialog.getByRole('button', { name: 'Reload', exact: true }).click();
  await expect(ui(page).makeDefault).toBeChecked();
  await expect(ui(page).makeDefault).toBeDisabled();
  await ui(page).city.fill('Current Version City');
  await save(page, 'PUT');
  expect(storedAddresses(api.user.username)[0]).toMatchObject({ city: 'Current Version City', isDefault: true, version: 2 });
});

/** Execute one real command, then lose its answer; the next attempt reaches the real API unchanged. */
async function loseFirstResponse(page: Page, method: 'POST' | 'PUT' | 'DELETE') {
  const attempts: { body: string | null; status: number; url: string }[] = [];
  let lost = false;
  await page.route(`${apiUrl}${addressesPath}**`, async (route) => {
    if (route.request().method() !== method) return route.fallback();
    const response = await route.fetch();
    if (response.status() === 401) return route.fulfill({ response });
    attempts.push({ body: route.request().postData(), status: response.status(), url: route.request().url() });
    if (!lost) { lost = true; await route.abort('failed'); }
    else await route.fulfill({ response });
  });
  return attempts;
}

test('E2E-12-57 lost create response retries the same id as 200; a later Add dialog gets a fresh id', t6, async ({ page, request }) => {
  const api = await AddressApi.register(request);
  await openAddresses(page, api.user);
  const attempts = await loseFirstResponse(page, 'POST');
  await ui(page).add.click();
  await fill(page, syntheticAddress({ label: 'Lost Home' }));
  await ui(page).save.click();
  await expect(ui(page).dialog.getByRole('alert').filter({ hasText: text.generic })).toBeVisible();
  expect(storedAddresses(api.user.username)).toHaveLength(1);
  await save(page, 'POST', 200);
  expect(attempts.map(({ status }) => status)).toEqual([201, 200]);
  expect(JSON.parse(attempts[0].body!)).toEqual(JSON.parse(attempts[1].body!));
  expect(storedAddressChanges(api.user.username)).toHaveLength(1);
  await add(page, syntheticAddress({ label: 'Next Home' }));
  expect(JSON.parse(attempts[2].body!).id).not.toBe(JSON.parse(attempts[0].body!).id);
  expect(storedAddresses(api.user.username)).toHaveLength(2);
  expect(storedAddressChanges(api.user.username)).toHaveLength(2);
});

test('E2E-12-58 editing a draft after a lost create reports ID_CONFLICT as the earlier save and reloads once', t6, async ({ page, request }) => {
  const api = await AddressApi.register(request);
  await openAddresses(page, api.user);
  const attempts = await loseFirstResponse(page, 'POST');
  await ui(page).add.click();
  await fill(page, syntheticAddress({ label: 'Saved Home', city: 'Saved City' }));
  await ui(page).save.click();
  await expect(ui(page).dialog.getByRole('alert').filter({ hasText: text.generic })).toBeVisible();
  await ui(page).city.fill('Unstored Draft');
  await save(page, 'POST', 409);
  await expect(ui(page).main.getByRole('status').filter({ hasText: text.savedEarlier })).toHaveCount(1);
  await expect(card(page, 'Saved Home')).toContainText('Saved City');
  await expect(card(page, 'Saved Home')).not.toContainText('Unstored Draft');
  expect(attempts.map(({ status }) => status)).toEqual([201, 409]);
  expect(JSON.parse(attempts[0].body!).id).toBe(JSON.parse(attempts[1].body!).id);
  expect(storedAddressChanges(api.user.username)).toHaveLength(1);
});

for (const close of ['Cancel', 'Escape'] as const) {
  for (const failure of ['network', '500', 'timeout'] as const) {
    test(`E2E-12-59 ${close} after a persisted create with ${failure} reloads the third row before another Add`, t6,
      async ({ page, request }) => {
        const api = await seeded(request, ['Home', 'Office']);
        await openAddresses(page, api.user);
        const before = storedAddresses(api.user.username);
        const intents = watchCommandIntents(page);
        let commands = intents();
        const value = syntheticAddress({ label: 'Lost Third' });
        let releaseRead: () => void = () => {};
        const readGate = new Promise<void>((resolve) => { releaseRead = resolve; });
        let heldRead = false;
        let release: () => void = () => {};
        const gate = new Promise<void>((resolve) => { release = resolve; });
        let persisted = false;
        let first = true;
        await page.route(`${apiUrl}${addressesPath}`, async (route) => {
          if (route.request().method() !== 'POST' || !first) return route.fallback();
          first = false;
          const response = await route.fetch();
          expect(response.status()).toBe(201);
          persisted = true;
          if (failure === 'network') return route.abort('failed');
          if (failure === '500') return route.fulfill({ status: 500, contentType: 'application/json',
            json: { code: 'INTERNAL_ERROR', message: 'Unused server diagnostic', requestId: 'synthetic-create-error' } });
          // Hold a real committed reply until the client's own ten-second operation timeout fires.
          await gate;
          try { await route.abort('timedout'); }
          catch (error) { if (!route.request().failure()) throw error; }
        });
        try {
          await ui(page).add.click();
          await fill(page, value);
          const timedOut = failure === 'timeout' ? page.waitForEvent('requestfailed', {
            predicate: (call) => call.method() === 'POST' && call.url() === `${apiUrl}${addressesPath}`,
          }) : undefined;
          await ui(page).save.click();
          await expect(ui(page).dialog.getByRole('alert').filter({ hasText: text.generic })).toBeVisible({ timeout: 15_000 });
          expect(persisted, 'the simulated failure must follow a real persisted create').toBe(true);
          if (timedOut) { await timedOut; release(); }
          expect(storedAddresses(api.user.username)).toHaveLength(3);
          // Install after the failure so only the close-triggered reconciliation read is held.
          await page.route(`${apiUrl}${addressesPath}`, async (route) => {
            if (route.request().method() !== 'GET') return route.fallback();
            heldRead = true;
            await readGate;
            await route.continue();
          });
          if (close === 'Cancel') await ui(page).cancel.click();
          else await page.keyboard.press('Escape');
          await expect(ui(page).dialog).toBeHidden();
          await expect.poll(() => heldRead).toBe(true);
          await expect(ui(page).main.getByRole('status').filter({ hasText: /Loading/ })).toBeVisible();
          await expect(ui(page).add).toHaveCount(0);
          commands = intents();
          expect(commands).toHaveLength(1);
          expect(commands[0].method).toBe('POST');
          expect(commands[0].path).toBe(addressesPath);
          const body = JSON.parse(commands[0].body!) as AddressCreate;
          expect(body.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
          expect(body).toEqual({ ...value, id: body.id });
          const expected = [...before, { ...value, id: body.id, isDefault: false, version: 0 }];
          expect(storedAddresses(api.user.username)).toEqual(expected);
          releaseRead();
          await expect(card(page, 'Lost Third')).toBeVisible();
          for (const field of [value.recipientName, value.mobile, value.addressLine, value.city]) {
            await expect(card(page, 'Lost Third')).toContainText(field);
          }
          await expect(ui(page).cards).toHaveCount(3);
          await expect(ui(page).add).toHaveCount(0);
          commands = intents();
          expect(commands).toHaveLength(1);
          expect(storedAddresses(api.user.username)).toEqual(expected);
          expect(storedAddressChanges(api.user.username)).toHaveLength(3);
        } finally { release(); releaseRead(); }
      });
  }
}

for (const close of ['Cancel', 'Escape'] as const) {
  test(`E2E-12-78 ${close} after a lost first create reconciles before a new Add gets a fresh id`, t6,
    async ({ page, request }) => {
      const api = await AddressApi.register(request);
      await openAddresses(page, api.user);
      const attempts = await loseFirstResponse(page, 'POST');
      const intents = watchCommandIntents(page);
      let commands = intents();
      const first = syntheticAddress({ label: 'Lost First' });
      const next = syntheticAddress({ label: 'Fresh Next' });
      await ui(page).add.click();
      await fill(page, first);
      await ui(page).save.click();
      await expect(ui(page).dialog.getByRole('alert').filter({ hasText: text.generic })).toBeVisible();
      const firstBody = JSON.parse(attempts[0].body!) as AddressCreate;
      expect(firstBody.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(firstBody).toEqual({ ...first, id: firstBody.id, isDefault: true });
      const firstStored = { ...first, id: firstBody.id, isDefault: true, version: 0 };
      expect(storedAddresses(api.user.username)).toEqual([firstStored]);
      expect(storedAddressChanges(api.user.username)).toHaveLength(1);
      if (close === 'Cancel') await ui(page).cancel.click();
      else await page.keyboard.press('Escape');
      await expect(ui(page).dialog).toBeHidden();
      await expect(card(page, 'Lost First')).toBeVisible();
      await expect(ui(page).cards).toHaveCount(1);
      await expect(ui(page).add).toBeVisible();
      await add(page, next);
      expect(attempts.map(({ status }) => status)).toEqual([201, 201]);
      const nextBody = JSON.parse(attempts[1].body!) as AddressCreate;
      expect(nextBody.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(nextBody.id).not.toBe(firstBody.id);
      expect(nextBody).toEqual({ ...next, id: nextBody.id });
      commands = intents();
      expect(commands.map(({ method, path }) => ({ method, path }))).toEqual([
        { method: 'POST', path: addressesPath }, { method: 'POST', path: addressesPath },
      ]);
      const expected = [firstStored, { ...next, id: nextBody.id, version: 0 }];
      for (const reload of [false, true]) {
        if (reload) await page.reload();
        await expect(ui(page).cards).toHaveCount(2);
        for (const value of expected) {
          for (const field of [value.recipientName, value.mobile, value.addressLine, value.city]) {
            await expect(card(page, value.label!)).toContainText(field);
          }
        }
        await expect(card(page, 'Lost First').getByText('Default', { exact: true })).toBeVisible();
        expect(storedAddresses(api.user.username)).toEqual(expected);
        expect(storedAddressChanges(api.user.username)).toHaveLength(2);
      }
      commands = intents();
      expect(commands).toHaveLength(2);
    });
}

test('E2E-12-60 lost edit and delete responses recover without extra changes or a missing default', t6, async ({ page, request }) => {
  const api = await seeded(request, ['Home', 'Office']);
  const [home, office] = storedAddresses(api.user.username);
  const edited = { ...office, city: 'Persisted City', version: office.version + 1 };
  const expectedEdit = [home, edited];
  await openAddresses(page, api.user);
  const intents = watchCommandIntents(page);
  let commands = intents();
  const edits = await loseFirstResponse(page, 'PUT');
  await edit(page, 'Office');
  await ui(page).city.fill('Persisted City');
  await ui(page).save.click();
  await expect(ui(page).dialog.getByRole('alert').filter({ hasText: text.generic })).toBeVisible();
  expect(storedAddresses(api.user.username)).toEqual(expectedEdit);
  expect(storedAddressChanges(api.user.username)).toHaveLength(3);
  await save(page, 'PUT');
  expect(edits.map(({ status }) => status)).toEqual([200, 200]);
  for (const attempt of edits) {
    expect(attempt.url).toBe(`${apiUrl}${addressesPath}/${office.id}`);
    expect(JSON.parse(attempt.body!)).toEqual(addressEdit(office, { city: 'Persisted City' }));
  }
  expect(storedAddresses(api.user.username)).toEqual(expectedEdit);
  expect(storedAddressChanges(api.user.username)).toHaveLength(3);
  const deletes = await loseFirstResponse(page, 'DELETE');
  await edit(page, 'Home');
  await ui(page).remove.click();
  await ui(page).remove.click();
  await expect(ui(page).dialog.getByRole('alert').filter({ hasText: text.generic })).toBeVisible();
  const expectedDelete = [{ ...edited, isDefault: true, version: edited.version + 1 }];
  expect(storedAddresses(api.user.username)).toEqual(expectedDelete);
  expect(storedAddressChanges(api.user.username)).toHaveLength(3);
  // The confirmation may remain open or reset after a transport error; either way the User confirms explicitly.
  if (!await ui(page).keep.isVisible()) await ui(page).remove.click();
  const retried = addressResponse(page, 'DELETE');
  await ui(page).remove.click();
  expect((await retried).status()).toBe(404);
  await expect(ui(page).dialog).toBeHidden();
  expect(deletes.map(({ status }) => status)).toEqual([200, 404]);
  for (const attempt of deletes) {
    expect(attempt.url).toBe(`${apiUrl}${addressesPath}/${home.id}?version=${home.version}`);
    expect(attempt.body).toBeNull();
  }
  commands = intents();
  expect(commands.map(({ method, path }) => ({ method, path }))).toEqual([
    { method: 'PUT', path: `${addressesPath}/${office.id}` },
    { method: 'PUT', path: `${addressesPath}/${office.id}` },
    { method: 'DELETE', path: `${addressesPath}/${home.id}` },
    { method: 'DELETE', path: `${addressesPath}/${home.id}` },
  ]);
  for (const reload of [false, true]) {
    if (reload) await page.reload();
    await expect(ui(page).cards).toHaveCount(1);
    await expect(card(page, 'Home')).toHaveCount(0);
    await expect(card(page, 'Office').getByText('Default', { exact: true })).toBeVisible();
    for (const field of [edited.recipientName, edited.mobile, edited.addressLine, edited.city]) {
      await expect(card(page, 'Office')).toContainText(field);
    }
    await expect(ui(page).main.getByRole('alert')).toHaveCount(0);
    expect(storedAddresses(api.user.username)).toEqual(expectedDelete);
    expect(storedAddressChanges(api.user.username)).toHaveLength(3);
  }
  commands = intents();
  expect(commands).toHaveLength(4);
});

for (const method of ['POST', 'PUT', 'DELETE'] as const) {
  test(`E2E-12-61 held ${method} blocks repeat submits, competing actions and close with exactly one command`, t6,
    async ({ page, request }) => {
      const api = method === 'POST' ? await AddressApi.register(request)
        : await seeded(request, method === 'DELETE' ? ['Home', 'Office'] : ['Home']);
      const before = storedAddresses(api.user.username);
      const changes = storedAddressChanges(api.user.username);
      const submitted = syntheticAddress({ city: 'One Flight' });
      await openAddresses(page, api.user);
      const intents = watchCommandIntents(page);
      let commands = intents();
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => { release = resolve; });
      let held = false;
      await page.route(method === 'POST' ? `${apiUrl}${addressesPath}` : `${apiUrl}${addressesPath}/**`, async (route) => {
        if (route.request().method() !== method) return route.fallback();
        held = true;
        await gate;
        await route.continue();
      });
      try {
        if (method === 'POST') { await ui(page).add.click(); await fill(page, submitted); }
        else { await edit(page, 'Home'); if (method === 'PUT') await ui(page).city.fill('One Flight'); }
        const response = addressResponse(page, method);
        if (method === 'DELETE') { await ui(page).remove.click(); await ui(page).remove.click(); }
        else await ui(page).city.press('Enter');
        await expect.poll(() => held).toBe(true);
        const buttons = ui(page).dialog.getByRole('button');
        expect(await buttons.count()).toBeGreaterThan(0);
        for (const button of await buttons.all()) await expect(button).toBeDisabled();
        await page.keyboard.press('Enter');
        await page.keyboard.press('Enter');
        // Native clicks on every disabled action exercise Save/Remove/Cancel/Keep where applicable.
        await buttons.evaluateAll((elements) => elements.forEach((element) => (element as HTMLButtonElement).click()));
        // Exercise the handler guard even when native disabled controls suppress repeated input Enter.
        await ui(page).dialog.locator('form').evaluate((form) => {
          (form as HTMLFormElement).requestSubmit();
          (form as HTMLFormElement).requestSubmit();
        });
        await page.keyboard.press('Escape');
        await expect(ui(page).dialog).toBeVisible();
        commands = intents();
        expect(commands).toHaveLength(1); // Count every mutation method, including competing DELETE/PUT/POST.
        expect(commands[0].method).toBe(method);
        const first = { ...commands[0] };
        const body = method === 'POST' ? JSON.parse(first.body!) as AddressCreate : undefined;
        if (body) {
          expect(body.id).toMatch(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
          expect(body).toEqual({ ...submitted, id: body.id, isDefault: true });
        }
        expect(storedAddresses(api.user.username)).toEqual(before);
        expect(storedAddressChanges(api.user.username)).toEqual(changes);
        release();
        expect((await response).status()).toBe(method === 'POST' ? 201 : 200);
        await expect(ui(page).dialog).toBeHidden();
        commands = intents();
        expect(commands).toEqual([first]);
        const expected = method === 'DELETE' ? [{ ...before[1], isDefault: true, version: 1 }]
          : method === 'PUT' ? [{ ...before[0], city: 'One Flight', version: 1 }]
            : [{ ...submitted, id: body!.id, isDefault: true, version: 0 }];
        expect(storedAddresses(api.user.username)).toEqual(expected);
        expect(storedAddressChanges(api.user.username)).toHaveLength(changes.length + (method === 'DELETE' ? 0 : 1));
      } finally { release(); }
    });
}

for (const failure of ['network', '500', '403', 'non-JSON'] as const) {
  test(`E2E-12-62 initial ${failure} read shows a focused bounded error with no mutation actions; Reload recovers`, t6,
    async ({ page, request }) => {
      const api = await seeded(request, ['Home']);
      const before = storedAddresses(api.user.username);
      const changes = storedAddressChanges(api.user.username);
      await signIn(page, api.user.username, api.user.password);
      await expect(page).toHaveURL('/account');
      const commands = watchCommands(page);
      const diagnostic = `t12-private-load-${failure}-diagnostic`;
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => { release = resolve; });
      let first = true;
      await page.route(`${apiUrl}${addressesPath}`, async (route) => {
        if (route.request().method() !== 'GET' || !first) return route.fallback();
        first = false;
        await gate;
        if (failure === 'network') return route.abort('failed');
        if (failure === 'non-JSON') return route.fulfill({ status: 500, contentType: 'text/html', body: `<html>${diagnostic}</html>` });
        await route.fulfill({ status: failure === '403' ? 403 : 500, contentType: 'application/json',
          json: { code: failure === '403' ? 'MFA_REQUIRED' : 'INTERNAL_ERROR', message: diagnostic, requestId: 'synthetic-load-error' } });
      });
      try {
        await page.goto('/account/addresses');
        await expect(ui(page).main.getByRole('status').filter({ hasText: /Loading/ })).toBeVisible();
        await expect(ui(page).cards).toHaveCount(0);
        await expect(ui(page).add).toHaveCount(0);
        release();
        const message = failure === '403' ? 'Authenticator verification is required.' : text.generic;
        const alert = ui(page).main.getByRole('alert');
        await expect(alert).toHaveCount(1);
        await expect(alert).toContainText(message); // The Alert may also contain its Reload action.
        await expect(alert).toBeFocused();
        await expect(page.locator('body')).not.toContainText(diagnostic);
        await expect(ui(page).cards).toHaveCount(0);
        for (const name of ['Add address', 'Edit', 'Remove']) {
          await expect(ui(page).main.getByRole('button', { name, exact: true })).toHaveCount(0);
        }
        await expect(ui(page).dialog).toBeHidden();
        expect(storedAddresses(api.user.username)).toEqual(before);
        expect(storedAddressChanges(api.user.username)).toEqual(changes);
        const reloaded = addressResponse(page, 'GET');
        await ui(page).main.getByRole('button', { name: 'Reload', exact: true }).click();
        expect((await reloaded).status()).toBe(200);
        await expect(card(page, 'Home')).toBeVisible();
        await expect(ui(page).cards).toHaveCount(1);
        await expect(ui(page).add).toBeVisible();
        await expect(card(page, 'Home').getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
        await expect(alert).toHaveCount(0);
        expect(commands).toEqual([]);
        expect(storedAddresses(api.user.username)).toEqual(before);
        expect(storedAddressChanges(api.user.username)).toEqual(changes);
      } finally { release(); }
    });
}

for (const failure of ['network', '500', '403', 'non-JSON'] as const) {
  test(`E2E-12-63 ${failure} on edit stays inside the dialog, retains the draft and lets a real retry succeed`, t6,
    async ({ page, request }) => {
      const api = await seeded(request, ['Home', 'Office']);
      await openAddresses(page, api.user);
      const before = storedAddresses(api.user.username);
      const state = storedAddressState(api.user.username);
      const intents = watchCommandIntents(page);
      const draft = syntheticAddress({ label: 'Retained [Office]', city: 'Retained Draft', isDefault: true });
      const diagnostic = `t12-private-${failure}-diagnostic`;
      let first = true;
      await page.route(`${apiUrl}${addressesPath}/**`, async (route) => {
        if (route.request().method() !== 'PUT' || !first) return route.fallback();
        first = false;
        if (failure === 'network') return route.abort('failed');
        if (failure === 'non-JSON') return route.fulfill({ status: 500, contentType: 'text/html', body: `<html>${diagnostic}</html>` });
        await route.fulfill({ status: failure === '403' ? 403 : 500, contentType: 'application/json',
          json: { code: failure === '403' ? 'MFA_REQUIRED' : 'INTERNAL_ERROR', message: diagnostic, requestId: 'synthetic-edit-error' } });
      });
      await edit(page, 'Office');
      await fill(page, draft);
      await ui(page).save.click();
      const message = failure === '403' ? 'Authenticator verification is required.' : text.generic;
      await expect(ui(page).dialog.getByRole('alert')).toHaveCount(1);
      await expect(ui(page).dialog.getByRole('alert')).toHaveText(message);
      await expect(ui(page).dialog.getByRole('alert')).toBeVisible();
      for (const [field, value] of [[ui(page).label, draft.label!], [ui(page).name, draft.recipientName],
        [ui(page).mobile, draft.mobile], [ui(page).address, draft.addressLine], [ui(page).city, draft.city]] as const) {
        await expect(field).toHaveValue(value);
      }
      await expect(ui(page).makeDefault).toBeChecked();
      // Scan the whole document, including dialog portals and diagnostic text appended to safe copy.
      await expect(page.locator('body')).not.toContainText(diagnostic);
      expect(storedAddresses(api.user.username)).toEqual(before);
      expect(storedAddressState(api.user.username)).toEqual(state);
      const expectedCommand = addressEdit({ ...before[1], ...draft, id: before[1].id });
      let commands = await intents();
      expect(commands).toHaveLength(1);
      expect(commands[0]).toMatchObject({ method: 'PUT', path: `${addressesPath}/${before[1].id}` });
      expect(JSON.parse(commands[0].body!)).toEqual(expectedCommand);
      await save(page, 'PUT');
      commands = await intents();
      expect(commands.map(({ method, path, body }) => ({ method, path, body: JSON.parse(body!) })))
        .toEqual(Array.from({ length: 2 }, () => ({ method: 'PUT', path: `${addressesPath}/${before[1].id}`,
          body: expectedCommand })));
      const expected = [{ ...before[0], isDefault: false, version: before[0].version + 1 },
        { ...draft, id: before[1].id, version: before[1].version + 1 }];
      expect(storedAddresses(api.user.username)).toEqual(expected);
      expect(storedAddressChanges(api.user.username)).toHaveLength(state.changes.length + 1);
      await page.reload();
      await expect(card(page, draft.label!)).toContainText(draft.addressLine);
      await expect(card(page, draft.label!).getByText('Default', { exact: true })).toBeVisible();
      expect(storedAddresses(api.user.username)).toEqual(expected);
    });
}

const invalidBooks: { name: string; corrupt: (book: AddressBook) => unknown }[] = [
  { name: 'null book', corrupt: () => null },
  { name: 'extra top-level key', corrupt: (book) => ({ ...book, unauthorizedPrivateField: 'Untrusted private field marker' }) },
  { name: 'extra item key', corrupt: (book) => ({ ...book,
    items: book.items.map((item) => ({ ...item, unauthorizedPrivateField: 'Untrusted private field marker' })) }) },
  { name: 'nonarray items', corrupt: (book) => ({ ...book, items: { ...book.items[0] } }) },
  { name: 'null item', corrupt: (book) => ({ ...book, items: [null] }) },
  { name: 'missing item key', corrupt: (book) => ({ ...book, items: book.items.map((item) => ({ ...item, city: undefined })) }) },
  { name: 'wrong item type', corrupt: (book) => ({ ...book, items: book.items.map((item) => ({ ...item, isDefault: 'true' })) }) },
  { name: 'numeric optional label', corrupt: (book) => ({ ...book,
    items: book.items.map((item) => ({ ...item, label: 42 })) }) },
  { name: 'numeric recipient name', corrupt: (book) => ({ ...book,
    items: book.items.map((item) => ({ ...item, recipientName: 42 })) }) },
  { name: 'numeric mobile', corrupt: (book) => ({ ...book,
    items: book.items.map((item) => ({ ...item, mobile: 1712345678 })) }) },
  { name: 'array address line', corrupt: (book) => ({ ...book,
    items: book.items.map((item) => ({ ...item, addressLine: [item.addressLine] })) }) },
  { name: 'null city', corrupt: (book) => ({ ...book,
    items: book.items.map((item) => ({ ...item, city: null })) }) },
  { name: 'negative item version', corrupt: (book) => ({ ...book, items: book.items.map((item) => ({ ...item, version: -1 })) }) },
  { name: 'fractional item version', corrupt: (book) => ({ ...book, items: book.items.map((item) => ({ ...item, version: 0.5 })) }) },
  { name: 'noncanonical id', corrupt: (book) => ({ ...book, items: book.items.map((item) => ({ ...item, id: item.id.replaceAll('-', '') })) }) },
  { name: 'zero book limit', corrupt: (book) => ({ ...book, limit: 0 }) },
  { name: 'string book limit', corrupt: (book) => ({ ...book, limit: String(book.limit) }) },
  { name: 'fractional book limit', corrupt: (book) => ({ ...book, limit: 3.5 }) },
  { name: 'invalid account state', corrupt: (book) => ({ ...book, accountState: 'UNKNOWN' }) },
  { name: 'items exceed limit', corrupt: (book) => ({ ...book,
    items: Array.from({ length: book.limit + 1 }, (_, index) => ({ ...book.items[0], id: syntheticAddress().id, isDefault: index === 0 })) }) },
  { name: 'missing allowance key', corrupt: (book) => ({ ...book,
    changeAllowance: { perWeek: book.changeAllowance.perWeek, perMonth: book.changeAllowance.perMonth,
      remainingThisWeek: book.changeAllowance.remainingThisWeek } }) },
  { name: 'null allowance', corrupt: (book) => ({ ...book, changeAllowance: null }) },
  { name: 'extra allowance key', corrupt: (book) => ({ ...book,
    changeAllowance: { ...book.changeAllowance, unauthorizedPrivateField: 'Untrusted private field marker' } }) },
  { name: 'zero weekly allowance', corrupt: (book) => ({ ...book, changeAllowance: { ...book.changeAllowance, perWeek: 0 } }) },
  { name: 'string weekly allowance', corrupt: (book) => ({ ...book,
    changeAllowance: { ...book.changeAllowance, perWeek: String(book.changeAllowance.perWeek) } }) },
  { name: 'fractional monthly allowance', corrupt: (book) => ({ ...book,
    changeAllowance: { ...book.changeAllowance, perMonth: 10.5 } }) },
  { name: 'string remaining allowance', corrupt: (book) => ({ ...book,
    changeAllowance: { ...book.changeAllowance, remainingThisWeek: String(book.changeAllowance.remainingThisWeek) } }) },
  { name: 'negative remaining allowance', corrupt: (book) => ({ ...book, changeAllowance: { ...book.changeAllowance, remainingThisWeek: -1 } }) },
  { name: 'fractional remaining allowance', corrupt: (book) => ({ ...book, changeAllowance: { ...book.changeAllowance, remainingThisMonth: 0.5 } }) },
  { name: 'remaining exceeds monthly limit', corrupt: (book) => ({ ...book,
    changeAllowance: { ...book.changeAllowance, remainingThisMonth: book.changeAllowance.perMonth + 1 } }) },
];

for (const invalid of invalidBooks) {
  test(`E2E-12-64 invalid GET success with ${invalid.name} is bounded to a load error`, t6,
    async ({ page, request }) => {
      const api = await seeded(request, ['Home']);
      const actual = await api.book();
      await signIn(page, api.user.username, api.user.password);
      await expect(page).toHaveURL('/account');
      let first = true;
      await page.route(`${apiUrl}${addressesPath}`, async (route) => {
        if (route.request().method() !== 'GET' || !first) return route.fallback();
        first = false;
        await route.fulfill({ status: 200, contentType: 'application/json', json: invalid.corrupt(actual) });
      });
      await page.goto('/account/addresses');
      await expect(ui(page).main.getByRole('alert').filter({ hasText: text.invalidResponse })).toBeVisible();
      await expect(ui(page).main.getByRole('alert').filter({ hasText: text.invalidResponse })).toBeFocused();
      await expect(ui(page).cards).toHaveCount(0);
      await expect(ui(page).add).toHaveCount(0);
      await expect(page.locator('body')).not.toContainText('Untrusted private field marker');
      await ui(page).main.getByRole('button', { name: 'Reload', exact: true }).click();
      await expect(card(page, 'Home')).toBeVisible();
      expect(storedAddresses(api.user.username)).toEqual(actual.items);
    });
}

test('E2E-12-64 a malformed committed create reply retains the dialog and same-id replay recovers without duplication', t6,
  async ({ page, request }) => {
    const api = await AddressApi.register(request);
    await openAddresses(page, api.user);
    const attempts: { body: string | null; status: number; url: string }[] = [];
    await page.route(`${apiUrl}${addressesPath}`, async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      const response = await route.fetch();
      if (response.status() === 401) return route.fulfill({ response });
      attempts.push({ body: route.request().postData(), status: response.status(), url: route.request().url() });
      if (attempts.length === 1) {
        expect(response.status()).toBe(201);
        const actual = await response.json() as AddressBook;
        return route.fulfill({ response, json: { ...actual, unauthorizedPrivateField: 'Untrusted private field marker' } });
      }
      await route.fulfill({ response });
    });
    await ui(page).add.click();
    await fill(page, syntheticAddress({ label: 'Malformed Reply Home' }));
    await ui(page).save.click();
    await expect(ui(page).dialog.getByRole('alert')).toHaveCount(1);
    await expect(ui(page).dialog.getByRole('alert')).toHaveText(text.invalidResponse);
    await expect(ui(page).dialog.getByRole('alert')).toBeVisible();
    await expect(ui(page).label).toHaveValue('Malformed Reply Home');
    await expect(ui(page).cards).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('Untrusted private field marker');
    expect(storedAddresses(api.user.username)).toHaveLength(1);
    expect(storedAddressChanges(api.user.username)).toHaveLength(1);
    await save(page, 'POST', 200);
    expect(attempts.map(({ status }) => status)).toEqual([201, 200]);
    expect(JSON.parse(attempts[1].body!)).toEqual(JSON.parse(attempts[0].body!));
    await page.reload();
    await expect(card(page, 'Malformed Reply Home')).toBeVisible();
    await expect(ui(page).cards).toHaveCount(1);
    expect(storedAddresses(api.user.username)).toHaveLength(1);
    expect(storedAddressChanges(api.user.username)).toHaveLength(1);
  });

for (const method of ['PUT', 'DELETE'] as const) {
  test(`E2E-12-76 malformed committed ${method} success rejects private item metadata and an explicit retry reconciles once`, t6,
    async ({ page, request }) => {
      assertAwayFromDhakaPeriodStart();
      const api = await seeded(request, ['Home', 'Office', 'Warehouse']);
      const before = await api.book();
      const changes = storedAddressChanges(api.user.username);
      expect(storedAddresses(api.user.username)).toEqual(before.items);
      const target = before.items[method === 'PUT' ? 1 : 0];
      const draft = syntheticAddress({ label: 'Edited Office', isDefault: false });
      const fields = { label: draft.label, recipientName: draft.recipientName, mobile: draft.mobile,
        addressLine: draft.addressLine, city: draft.city, isDefault: draft.isDefault };
      const expectedItems = method === 'PUT'
        ? before.items.map((item) => item.id === target.id ? { ...item, ...fields, version: item.version + 1 } : item)
        : before.items.slice(1).map((item, index) => index === 0
          ? { ...item, isDefault: true, version: item.version + 1 } : item);
      const expectedBook: AddressBook = { ...before, items: expectedItems,
        changeAllowance: { ...before.changeAllowance,
          remainingThisWeek: before.changeAllowance.remainingThisWeek - (method === 'PUT' ? 1 : 0),
          remainingThisMonth: before.changeAllowance.remainingThisMonth - (method === 'PUT' ? 1 : 0) } };
      const expectedPath = `${addressesPath}/${target.id}${method === 'DELETE' ? `?version=${target.version}` : ''}`;
      const marker = `t12-private-${method.toLowerCase()}-item-${syntheticAddress().id}`;
      await openAddresses(page, api.user);
      const intents = watchCommandIntents(page);
      let commands = intents();
      const attempts: { body: string | null; status: number; url: string }[] = [];
      await page.route(`${apiUrl}${addressesPath}/**`, async (route) => {
        if (route.request().method() !== method) return route.fallback();
        const response = await route.fetch();
        if (response.status() === 401) return route.fulfill({ response });
        attempts.push({ body: route.request().postData(), status: response.status(), url: route.request().url() });
        if (attempts.length === 1) {
          expect(response.status()).toBe(200);
          const actual = await response.json() as AddressBook;
          // The real write has committed; corrupt only its shared success projection.
          expect(actual).toEqual(expectedBook);
          return route.fulfill({ response, json: { ...actual,
            items: actual.items.map((item, index) => index === 0 ? { ...item, privateMetadata: marker } : item) } });
        }
        await route.fulfill({ response });
      });
      await edit(page, target.label!);
      if (method === 'PUT') { await fill(page, draft); await ui(page).save.click(); }
      else { await ui(page).remove.click(); await ui(page).remove.click(); }
      await expect(ui(page).dialog.getByRole('alert')).toHaveCount(1);
      await expect(ui(page).dialog.getByRole('alert')).toHaveText(text.invalidResponse);
      await expect(ui(page).dialog.getByRole('alert')).toBeVisible();
      await expect(ui(page).main.getByRole('alert').or(ui(page).dialog.getByRole('alert'))).toHaveCount(1);
      await expect(page.locator('body')).not.toContainText(marker);
      const retained = method === 'PUT' ? draft : target;
      for (const [control, value] of [
        [ui(page).label, retained.label ?? ''], [ui(page).name, retained.recipientName],
        [ui(page).mobile, retained.mobile], [ui(page).address, retained.addressLine], [ui(page).city, retained.city],
      ] as const) await expect(control).toHaveValue(value);
      expect(await ui(page).makeDefault.isChecked()).toBe(retained.isDefault);
      commands = intents();
      expect(commands).toEqual([{ method, body: method === 'PUT'
        ? attempts[0].body : null, path: `${addressesPath}/${target.id}` }]);
      if (method === 'PUT') expect(JSON.parse(commands[0].body!)).toEqual(addressEdit(target, fields));
      expect(attempts[0].url).toBe(`${apiUrl}${expectedPath}`);
      expect(storedAddresses(api.user.username)).toEqual(expectedItems);
      const committedChanges = storedAddressChanges(api.user.username);
      if (method === 'PUT') {
        expect(committedChanges).toHaveLength(changes.length + 1);
        expect(committedChanges.slice(0, changes.length)).toEqual(changes);
      } else expect(committedChanges).toEqual(changes);
      if (method === 'PUT') await save(page, 'PUT', 200);
      else {
        // A failed response may leave or reset confirmation; the User explicitly confirms again.
        if (!await ui(page).keep.isVisible()) await ui(page).remove.click();
        const retried = addressResponse(page, 'DELETE');
        await ui(page).remove.click();
        expect((await retried).status()).toBe(404);
        await expect(ui(page).dialog).toBeHidden();
      }
      expect(attempts.map(({ status }) => status)).toEqual([200, method === 'PUT' ? 200 : 404]);
      expect(attempts.map(({ url }) => url)).toEqual([`${apiUrl}${expectedPath}`, `${apiUrl}${expectedPath}`]);
      commands = intents();
      expect(commands.map(({ method: dispatchedMethod, path }) => ({ method: dispatchedMethod, path })))
        .toEqual([{ method, path: `${addressesPath}/${target.id}` }, { method, path: `${addressesPath}/${target.id}` }]);
      const expectedBody = method === 'PUT' ? addressEdit(target, fields) : null;
      for (const attempt of [...attempts, ...commands]) {
        expect(attempt.body === null ? null : JSON.parse(attempt.body)).toEqual(expectedBody);
      }
      await expect(ui(page).main.getByRole('alert')).toHaveCount(0);
      for (const state of ['retry', 'reload'] as const) {
        if (state === 'reload') await page.reload();
        await expect(ui(page).cards).toHaveCount(expectedItems.length);
        for (const item of expectedItems) {
          for (const value of [item.recipientName, item.mobile, item.addressLine, item.city]) {
            await expect(card(page, item.label!)).toContainText(value);
          }
        }
        await expect(card(page, expectedItems.find(({ isDefault }) => isDefault)!.label!)
          .getByText('Default', { exact: true })).toBeVisible();
        await expect(page.locator('body')).not.toContainText(marker);
        expect(storedAddresses(api.user.username)).toEqual(expectedItems);
        expect(storedAddressChanges(api.user.username)).toEqual(committedChanges);
      }
      expect(await api.book()).toEqual(expectedBook);
    });
}

test('E2E-12-74 an unauthorized create refreshes once and retries the identical command with one durable change', t6,
  async ({ page, request }) => {
    const api = await AddressApi.register(request);
    await openAddresses(page, api.user);
    const value = syntheticAddress({ label: 'Refreshed Home' });
    const commands = watchCommands(page);
    const intents = watchCommandIntents(page);
    const refreshRequests: Request[] = [];
    const refreshes: Response[] = [];
    page.on('request', (call) => {
      if (call.url() === `${apiUrl}/api/auth/refresh` && call.method() === 'POST') refreshRequests.push(call);
    });
    page.on('response', (response) => {
      if (response.url() === `${apiUrl}/api/auth/refresh` && response.request().method() === 'POST') refreshes.push(response);
    });
    let first = true;
    await page.route(`${apiUrl}${addressesPath}`, async (route) => {
      if (route.request().method() !== 'POST' || !first) return route.fallback();
      first = false;
      await route.fulfill({ status: 401, contentType: 'application/json',
        json: { code: 'AUTHENTICATION_REQUIRED', message: 't12-private-unauthorized-diagnostic', requestId: 'synthetic-unauthorized' } });
    });
    await ui(page).add.click();
    await fill(page, value);
    const unauthorized = page.waitForResponse((response) => response.url() === `${apiUrl}${addressesPath}`
      && response.request().method() === 'POST' && response.status() === 401);
    await save(page);
    expect((await unauthorized).status()).toBe(401);
    expect(refreshRequests).toHaveLength(1);
    expect(refreshes.map((response) => response.status())).toEqual([200]);
    expect(commands).toHaveLength(2);
    expect(commands[0].method).toBe('POST');
    expect(commands[0].path).toBe(addressesPath);
    expect(commands[1]).toEqual(commands[0]);
    expect(await intents()).toEqual([commands[1]]);
    const submitted = JSON.parse(commands[0].body!) as AddressCreate;
    expect(submitted.id).toMatch(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
    expect(submitted).toEqual({ ...value, id: submitted.id, isDefault: true });
    await expect(card(page, value.label!)).toBeVisible();
    await expect(ui(page).main.getByText('1 of 3', { exact: true })).toBeVisible();
    await expect(page.locator('body')).not.toContainText('t12-private-unauthorized-diagnostic');
    expect(storedAddresses(api.user.username)).toEqual([{ ...submitted, version: 0 }]);
    expect(storedAddressChanges(api.user.username)).toHaveLength(1);
    await page.reload();
    await expect(card(page, value.label!)).toContainText(value.addressLine);
    expect(storedAddresses(api.user.username)).toEqual([{ ...submitted, version: 0 }]);
    expect(storedAddressChanges(api.user.username)).toHaveLength(1);
  });

test('E2E-12-75 a revoked browser session rejects Save, announces expiry and clears its draft before another account', t6,
  async ({ page, request }) => {
    const previous = await AddressApi.register(request);
    const next = await registerByApi(request);
    await openAddresses(page, previous.user);
    const value = syntheticAddress({ label: 'Expired Private Draft', city: 'Expired Draft City' });
    await ui(page).add.click();
    await fill(page, value);
    // Revoke the browser's actual refresh-cookie session through the ordinary logout API,
    // while its page still holds the old access token and unsaved form in memory.
    const { csrfToken } = await (await page.request.get(`${apiUrl}/api/auth/csrf`)).json() as { csrfToken: string };
    expect((await page.request.post(`${apiUrl}/api/auth/logout`, { headers: { 'X-XSRF-TOKEN': csrfToken } })).status()).toBe(204);
    const commands = watchCommands(page);
    const refreshRequests: Request[] = [];
    const refreshes: Response[] = [];
    page.on('request', (call) => {
      if (call.url() === `${apiUrl}/api/auth/refresh` && call.method() === 'POST') refreshRequests.push(call);
    });
    page.on('response', (response) => {
      if (response.url() === `${apiUrl}/api/auth/refresh` && response.request().method() === 'POST') refreshes.push(response);
    });
    const unauthorized = page.waitForResponse((response) => response.url() === `${apiUrl}${addressesPath}`
      && response.request().method() === 'POST');
    await ui(page).save.click();
    expect((await unauthorized).status()).toBe(401);
    await expect(page).toHaveURL('/sign-in');
    await expect(page.getByRole('status').filter({ hasText: 'Your session has expired. Please sign in again.' })).toBeFocused();
    expect(refreshRequests).toHaveLength(1);
    expect(refreshes.map((response) => response.status())).toEqual([204]);
    expect(commands).toHaveLength(1);
    expect(commands[0].method).toBe('POST');
    expect(storedAddresses(previous.user.username)).toEqual([]);
    expect(storedAddressChanges(previous.user.username)).toEqual([]);
    await expect(ui(page).dialog).toBeHidden();
    // Sign in and navigate in the same document, so a full reload cannot hide stale client state.
    await page.getByLabel('Mobile, email or username', { exact: true }).fill(next.username);
    await page.getByLabel('Password', { exact: true }).fill(next.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL('/account');
    await page.getByRole('link', { name: 'Addresses', exact: true }).click();
    await expect(ui(page).main.getByText('No saved addresses yet.', { exact: true })).toBeVisible();
    await expect(ui(page).cards).toHaveCount(0);
    for (const privateValue of [value.label!, value.recipientName, value.mobile, value.addressLine, value.city]) {
      await expect(page.locator('body')).not.toContainText(privateValue);
    }
    await ui(page).add.click();
    for (const [field, oldValue] of [[ui(page).label, value.label!], [ui(page).name, value.recipientName],
      [ui(page).mobile, value.mobile], [ui(page).address, value.addressLine], [ui(page).city, value.city]] as const) {
      await expect(field).not.toHaveValue(oldValue);
    }
    await ui(page).cancel.click();
    expect(commands).toHaveLength(1);
    expect(storedAddresses(previous.user.username)).toEqual([]);
    expect(storedAddressChanges(previous.user.username)).toEqual([]);
    expect(storedAddresses(next.username)).toEqual([]);
    expect(storedAddressChanges(next.username)).toEqual([]);
  });

test('E2E-12-65 allowance can go stale in another tab; a refused Add refreshes it and never prevents removal', t5,
  async ({ page, request }) => {
    assertAwayFromDhakaPeriodStart();
    const api = await seeded(request, ['Home']);
    for (const city of ['Change Two', 'Change Three', 'Change Four']) {
      const home = (await api.book()).items[0];
      await expectAddressBook(await api.update(home.id, addressEdit(home, { city })));
    }
    await openAddresses(page, api.user);
    await ui(page).add.click();
    await expectNotice(page, await api.book());
    await fill(page, syntheticAddress({ label: 'Refused Add' }));
    const home = (await api.book()).items[0];
    await expectAddressBook(await api.update(home.id, addressEdit(home, { city: 'Change Five' })));
    const refusal = await captureAddressJson<{ code: string }>(page, 'POST', addressesPath, 409);
    await save(page, 'POST', 409);
    expect(refusal().code).toBe('ADDRESS_CHANGE_LIMIT_REACHED');
    await expect(ui(page).main.getByRole('status').filter({ hasText: text.limit })).toBeFocused();
    await expect(card(page, 'Home')).toContainText('Change Five');
    await expect(card(page, 'Refused Add')).toHaveCount(0);
    await ui(page).add.click();
    await expectNotice(page, await api.book());
    await expect(ui(page).save).toBeEnabled();
    await ui(page).cancel.click();
    await remove(page, 'Home');
    await expect(ui(page).main.getByText('No saved addresses yet.', { exact: true })).toBeVisible();
    expect(storedAddressChanges(api.user.username)).toHaveLength(5);
  });

for (const role of ['DELIVERY_PERSON', 'MODERATOR', 'ADMIN'] as const) {
  test(`E2E-12-66 ${role} manages their own address book through the real pages`, {
    tag: ['@t12', '@t12-T5', '@cross-08-12', '@cross-06-12'],
  }, async ({ page }) => {
    let member: Customer;
    if (role === 'ADMIN') member = await verifiedAdmin(page);
    else if (role === 'MODERATOR') member = await verifiedModerator(page);
    else {
      member = await registerByApi(page.request);
      grantRole(member.username, role);
      await signIn(page, member.username, member.password);
      await expect(page).toHaveURL('/account');
    }
    await page.goto('/account/addresses');
    await expect(ui(page).heading).toBeVisible();
    await add(page, syntheticAddress({ label: 'Staff Home' }));
    await edit(page, 'Staff Home');
    await ui(page).city.fill('Staff City');
    await save(page, 'PUT');
    await page.reload();
    await expect(card(page, 'Staff Home')).toContainText('Staff City');
    expect(storedAddresses(member.username)[0]).toMatchObject({ label: 'Staff Home', city: 'Staff City', version: 1 });
    await remove(page, 'Staff Home');
    expect(storedAddresses(member.username)).toEqual([]);
  });
}

test('E2E-12-67 address values never enter URLs, console, storage, history state or API logs', t6, async ({ page, request }) => {
  const api = await AddressApi.register(request);
  const value = syntheticAddress({ label: `Private Label ${api.user.username}`, city: `Private City ${api.user.username}` });
  const edited = syntheticAddress({ label: `Edited Label ${api.user.username}`, city: `Edited City ${api.user.username}` });
  const privateValues = [value, edited].flatMap((address) => [address.label!, address.recipientName,
    address.mobile, address.addressLine, address.city]);
  const urls: string[] = [];
  const consoleLines: string[] = [];
  const snapshots: string[] = [];
  page.on('request', (call) => urls.push(urlScanText(call.url())));
  page.on('framenavigated', (frame) => urls.push(urlScanText(frame.url())));
  page.on('console', (message) => consoleLines.push(message.text()));
  page.on('pageerror', (error) => consoleLines.push(error.message));
  const snapshot = async () => snapshots.push(...await page.evaluate(() => [JSON.stringify({ ...localStorage }),
    JSON.stringify({ ...sessionStorage }), JSON.stringify(history.state)]));
  await openAddresses(page, api.user);
  await ui(page).add.click();
  await fill(page, value);
  await snapshot(); // Capture unsaved Add data before a close/reload could clear leaked values.
  await save(page);
  await expect(card(page, value.label!)).toBeVisible();
  await snapshot();
  await edit(page, value.label!);
  await fill(page, edited);
  await snapshot(); // Scan every exact edited value while the draft is open.
  await save(page, 'PUT');
  await expect(card(page, edited.label!)).toBeVisible();
  await snapshot();
  await page.reload();
  await expect(card(page, edited.label!)).toBeVisible();
  await snapshot();
  const surfaces = { URLs: urls.join('\n'), console: consoleLines.join('\n'), storage: snapshots.join('\n'),
    'API log': readFileSync(apiLogPath, 'utf8') };
  for (const [surface, content] of Object.entries(surfaces)) {
    expect(privateValues.flatMap(encodedForms).filter((privateValue) => content.includes(privateValue)), `private address values in ${surface}`).toEqual([]);
  }
});

test('E2E-12-68 signing out and entering a different account never shows the previous account book', t6, async ({ page, request }) => {
  const previous = await seeded(request, ['Previous Home']);
  const next = await registerByApi(request);
  await openAddresses(page, previous.user);
  const old = storedAddresses(previous.user.username);
  await page.goto('/account');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL('/');
  await page.goto('/account/addresses');
  await expect(page).toHaveURL(/\/sign-in/);
  await signIn(page, next.username, next.password);
  await expect(page).toHaveURL('/account');
  await page.goto('/account/addresses');
  await expect(ui(page).main.getByText('No saved addresses yet.', { exact: true })).toBeVisible();
  await expect(card(page, 'Previous Home')).toHaveCount(0);
  await expect(ui(page).main.getByText(old[0].mobile, { exact: false })).toHaveCount(0);
  expect(storedAddresses(previous.user.username)).toEqual(old);
  expect(storedAddresses(next.username)).toEqual([]);
});

test('E2E-12-69 navigation away and session switch isolate a held previous-account read', t6, async ({ page, request }) => {
  const previous = await seeded(request, ['Old Session Home']);
  const next = await registerByApi(request);
  await signIn(page, previous.user.username, previous.user.password);
  await expect(page).toHaveURL('/account');
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let captured = false;
  let first = true;
  let heldRequest: Request | undefined;
  let finish: () => void = () => {};
  const terminal = new Promise<void>((resolve) => { finish = resolve; });
  const observeTerminal = (call: Request) => { if (call === heldRequest) finish(); };
  // Subscribe before the old component can unmount and abort its exact intercepted request.
  page.on('requestfinished', observeTerminal);
  page.on('requestfailed', observeTerminal);
  await page.route(`${apiUrl}${addressesPath}`, async (route) => {
    if (route.request().method() !== 'GET' || !first) return route.fallback();
    first = false;
    heldRequest = route.request();
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    captured = true;
    await gate;
    try { await route.fulfill({ response }); }
    catch (error) { if (!route.request().failure()) throw error; }
  });
  try {
    await page.getByRole('link', { name: 'Addresses', exact: true }).click();
    await expect.poll(() => captured).toBe(true);
    await page.getByRole('banner').getByRole('link', { name: previous.user.username, exact: true }).click();
    await expect(page).toHaveURL('/account');
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL('/');
    // Keep the document/session provider; navigating away has already unmounted the old AddressBook.
    // This checks route/session isolation. T3's controlled component test must separately prove
    // the generation guard by resolving an old reply after sign-out while the component stays mounted.
    await page.getByRole('banner').getByRole('link', { name: 'Sign in', exact: true }).click();
    await page.getByLabel('Mobile, email or username', { exact: true }).fill(next.username);
    await page.getByLabel('Password', { exact: true }).fill(next.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL('/account');
    await page.getByRole('link', { name: 'Addresses', exact: true }).click();
    await expect(ui(page).main.getByText('No saved addresses yet.', { exact: true })).toBeVisible();
    release();
    // Successful completion and cancellation on unmount are both safe; observe the old request only.
    await terminal;
    // Observe after the exact request terminates and its continuation has a render opportunity.
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(card(page, 'Old Session Home')).toHaveCount(0);
    await expect(ui(page).main.getByText('No saved addresses yet.', { exact: true })).toBeVisible();
    expect(storedAddresses(next.username)).toEqual([]);
  } finally {
    release();
    page.off('requestfinished', observeTerminal);
    page.off('requestfailed', observeTerminal);
  }
});

test('E2E-12-70 count, full note and change notices use the returned numbers instead of constants', t5, async ({ page, request }) => {
  const api = await seeded(request, ['Home', 'Office']);
  const actual = await api.book();
  const projected: AddressBook = { ...actual, limit: 2,
    changeAllowance: { perWeek: 7, perMonth: 12, remainingThisWeek: 2, remainingThisMonth: 6 } };
  await signIn(page, api.user.username, api.user.password);
  await expect(page).toHaveURL('/account');
  await page.route(`${apiUrl}${addressesPath}`, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    // A valid read-model variant isolates display mapping; real configuration enforcement lives in fixed-calendar ITs.
    await route.fulfill({ status: 200, contentType: 'application/json', json: projected });
  });
  await page.goto('/account/addresses');
  await expect(ui(page).main.getByText('2 of 2', { exact: true })).toBeVisible();
  await expect(ui(page).main.getByText("You've saved 2 of 2 addresses; remove one to add another.", { exact: true })).toBeVisible();
  await expect(ui(page).add).toHaveCount(0);
  await edit(page, 'Home');
  await expectNotice(page, projected);
  expect(storedAddresses(api.user.username)).toEqual(actual.items);
});

test('E2E-12-70 Add and Edit announce nondefault allowances and use successful reply numbers without a page reload', t5,
  async ({ page, request }) => {
    const api = await seeded(request, ['Home']);
    const actual = await api.book();
    let projected: AddressBook = { ...actual, limit: 4,
      changeAllowance: { perWeek: 7, perMonth: 12, remainingThisWeek: 2, remainingThisMonth: 6 } };
    const returned: AddressBook[] = [];
    await signIn(page, api.user.username, api.user.password);
    await expect(page).toHaveURL('/account');
    await page.route(`${apiUrl}${addressesPath}**`, async (route) => {
      const method = route.request().method();
      if (method === 'GET') {
        return route.fulfill({ status: 200, contentType: 'application/json', json: projected });
      }
      if (method !== 'POST' && method !== 'PUT') return route.fallback();
      // Commit the real browser command; substitute only valid advisory/display metadata in its success reply.
      const response = await route.fetch();
      if (response.status() === 401) return route.fulfill({ response });
      expect(response.status()).toBe(method === 'POST' ? 201 : 200);
      const book = await response.json() as AddressBook;
      const displayed: AddressBook = { ...book, limit: projected.limit,
        changeAllowance: { perWeek: 7, perMonth: 12,
          remainingThisWeek: method === 'POST' ? 1 : 0, remainingThisMonth: method === 'POST' ? 5 : 0 } };
      projected = displayed; // A permitted automatic reread must see the same current server projection.
      returned.push(displayed);
      await route.fulfill({ response, json: displayed });
    });
    await page.goto('/account/addresses');
    await expect(ui(page).main.getByText('1 of 4', { exact: true })).toBeVisible();
    await expect(ui(page).main).not.toContainText(notice(projected));
    for (let opening = 0; opening < 2; opening++) {
      await ui(page).add.click();
      await expectNotice(page, projected);
      await ui(page).cancel.click();
    }
    await edit(page, 'Home');
    await expectNotice(page, projected);
    await ui(page).cancel.click();
    const value = syntheticAddress({ label: 'Projected Office' });
    const intents = watchCommandIntents(page);
    let commands = intents();
    await ui(page).add.click();
    await fill(page, value);
    await save(page);
    expect(returned).toHaveLength(1);
    await expect(ui(page).main.getByText('2 of 4', { exact: true })).toBeVisible();
    await expect(ui(page).main).not.toContainText(notice(returned[0]));
    await ui(page).add.click();
    await expectNotice(page, returned[0]);
    await ui(page).cancel.click();
    await edit(page, 'Home');
    await expectNotice(page, returned[0]);
    await ui(page).city.fill('Projected Edit City');
    await save(page, 'PUT');
    expect(returned).toHaveLength(2);
    await ui(page).add.click();
    await expectNotice(page, returned[1]);
    await expect(ui(page).save).toBeEnabled();
    await ui(page).cancel.click();
    await edit(page, 'Home');
    await expectNotice(page, returned[1]);
    await expect(ui(page).save).toBeEnabled();
    commands = intents();
    expect(commands.map(({ method }) => method)).toEqual(['POST', 'PUT']);
    expect(storedAddresses(api.user.username)).toEqual(returned[1].items);
    expect(storedAddressChanges(api.user.username)).toHaveLength(3);
  });

test('E2E-12-71 accepted HTML-looking address text renders literally and never creates executable elements', t6,
  async ({ page, request }) => {
    const api = await AddressApi.register(request);
    const value = syntheticAddress({ label: 'Literal Home',
      recipientName: '<img src=x id=t12-address-image onerror="window.alert(1)">',
      addressLine: '<script id="t12-address-script">document.documentElement.setAttribute("data-t12-injected","yes")</script>',
    });
    const dialogs: string[] = [];
    // Dismiss safely if a regression executes the injected event handler, then fail on the recorded invocation.
    page.on('dialog', async (dialog) => { dialogs.push(dialog.type()); await dialog.dismiss(); });
    await openAddresses(page, api.user);
    await add(page, value);
    for (const reloaded of [false, true]) {
      if (reloaded) await page.reload();
      const saved = card(page, 'Literal Home');
      await expect(saved).toContainText(value.recipientName);
      await expect(saved).toContainText(value.addressLine);
      await expect(saved.locator('#t12-address-image, #t12-address-script')).toHaveCount(0);
      await expect(page.locator('html')).not.toHaveAttribute('data-t12-injected', 'yes');
      expect(dialogs, 'address text must never execute an alert handler').toEqual([]);
    }
    expect(storedAddresses(api.user.username)[0]).toMatchObject({ recipientName: value.recipientName,
      addressLine: value.addressLine });
  });

for (const label of ['Shared Home', null] as const) {
  test(`E2E-12-93 duplicate ${label === null ? 'city fallback' : 'label'} headings retain distinct edit and removal identities`, t6,
    async ({ page, request }) => {
      const api = await AddressApi.register(request);
      const first = syntheticAddress({ label, city: 'Dhaka', addressLine: 'Synthetic First House, Road 93' });
      const second = syntheticAddress({ label, city: 'Dhaka', addressLine: 'Synthetic Second House, Road 93' });
      expect(second.mobile).not.toBe(first.mobile);
      await expectAddressBook(await api.create(first), 201);
      const initial = await expectAddressBook(await api.create(second), 201);
      const before = [{ ...first, isDefault: true, version: 0 }, { ...second, version: 0 }];
      expect(initial.items).toEqual(before);
      await openAddresses(page, api.user);
      const heading = label ?? 'Dhaka';
      await expect(card(page, heading)).toHaveCount(2);
      // Labels and fallback cities are display text; independent address/mobile fields select each row.
      const selected = () => ui(page).cards.filter({ hasText: second.mobile }).filter({ hasText: second.addressLine });
      await expect(selected()).toHaveCount(1);
      const intents = watchCommandIntents(page);
      await selected().getByRole('button', { name: 'Edit', exact: true }).click();
      await expect(ui(page).mobile).toHaveValue(second.mobile);
      await expect(ui(page).address).toHaveValue(second.addressLine);
      await expect(ui(page).label).toHaveValue(label ?? '');
      await ui(page).makeDefault.check();
      await save(page, 'PUT');
      let commands = await intents();
      expect(commands).toHaveLength(1);
      expect(commands[0]).toMatchObject({ method: 'PUT', path: `${addressesPath}/${second.id}` });
      const promotion = JSON.parse(commands[0].body!) as ReturnType<typeof addressEdit>;
      if (label === null) expect([null, '']).toContain(promotion.label);
      expect({ ...promotion, label: label === null ? null : promotion.label })
        .toEqual(addressEdit(before[1], { isDefault: true }));
      let expected: SavedAddress[] = [{ ...before[0], isDefault: false, version: 1 },
        { ...before[1], isDefault: true, version: 1 }];
      expect(storedAddresses(api.user.username)).toEqual(expected);
      await expect(card(page, heading)).toHaveCount(2);
      await expect(selected().getByText('Default', { exact: true })).toBeVisible();
      // Clearing an existing label must store null, update the fallback heading, and reopen as a blank input.
      let currentCity = second.city;
      if (label !== null) {
        await selected().getByRole('button', { name: 'Edit', exact: true }).click();
        await ui(page).label.fill('');
        currentCity = 'Cleared Label City';
        await ui(page).city.fill(currentCity);
        await save(page, 'PUT');
        commands = await intents();
        expect(commands).toHaveLength(2);
        expect(commands[1]).toMatchObject({ method: 'PUT', path: `${addressesPath}/${second.id}` });
        const submitted = JSON.parse(commands[1].body!) as ReturnType<typeof addressEdit>;
        // Both accepted null and blank-string command forms normalize to the same durable null label.
        expect([null, '']).toContain(submitted.label);
        expect({ ...submitted, label: null }).toEqual(addressEdit(expected[1], { label: null, city: currentCity }));
        expected = [expected[0], { ...expected[1], label: null, city: currentCity, version: 2 }];
        expect(storedAddresses(api.user.username)).toEqual(expected);
        await expect(card(page, heading)).toHaveCount(1);
        await expect(card(page, currentCity)).toHaveCount(1);
      }
      await page.reload();
      await expect(ui(page).cards).toHaveCount(2);
      await expect(ui(page).cards.nth(0)).toContainText(first.mobile);
      await expect(ui(page).cards.nth(1)).toContainText(second.mobile);
      await expect(selected()).toHaveCount(1);
      await expect(selected().locator('strong')).toHaveText(label === null ? heading : currentCity);
      await selected().getByRole('button', { name: 'Edit', exact: true }).click();
      await expect(ui(page).label).toHaveValue('');
      await expect(ui(page).city).toHaveValue(currentCity);
      await expect(ui(page).makeDefault).toBeChecked();
      await expect(ui(page).makeDefault).toBeDisabled();
      await ui(page).remove.click();
      const removed = addressResponse(page, 'DELETE');
      await ui(page).remove.click();
      const response = await removed;
      expect(response.status()).toBe(200);
      expect(response.request().url()).toBe(`${apiUrl}${addressesPath}/${second.id}?version=${expected[1].version}`);
      expect(response.request().postData()).toBeNull();
      await expect(ui(page).dialog).toBeHidden();
      commands = await intents();
      expect(commands.map(({ method }) => method)).toEqual(label === null ? ['PUT', 'DELETE'] : ['PUT', 'PUT', 'DELETE']);
      expect(commands.at(-1)).toEqual({ method: 'DELETE', path: `${addressesPath}/${second.id}`, body: null });
      await expect(selected()).toHaveCount(0);
      await expect(ui(page).cards).toHaveCount(1);
      await expect(ui(page).cards).toContainText(first.mobile);
      await expect(ui(page).cards.getByText('Default', { exact: true })).toHaveCount(1);
      await expect(ui(page).main.getByRole('status').filter({ hasText: `${heading} is now your default address.` })).toBeVisible();
      const final = [{ ...expected[0], isDefault: true, version: expected[0].version + 1 }];
      expect(storedAddresses(api.user.username)).toEqual(final);
      expect(storedAddressChanges(api.user.username)).toHaveLength(label === null ? 3 : 4);
      await page.reload();
      await expect(ui(page).cards).toHaveCount(1);
      await expect(ui(page).cards).toContainText(first.addressLine);
      expect(storedAddresses(api.user.username)).toEqual(final);
    });
}

test('E2E-12-94 unchanged browser Save at zero weekly allowance succeeds without any durable write', t5,
  async ({ page, request }) => {
    assertAwayFromDhakaPeriodStart();
    const api = await seeded(request, ['Home', 'Office']);
    for (const city of ['Third Change City', 'Fourth Change City', 'Fifth Change City']) {
      const home = (await api.book()).items[0];
      await expectAddressBook(await api.update(home.id, addressEdit(home, { city })));
    }
    const before = await api.book();
    expect(before.changeAllowance.remainingThisWeek).toBe(0);
    const state = storedAddressState(api.user.username);
    await openAddresses(page, api.user);
    const intents = watchCommandIntents(page);
    await edit(page, 'Home');
    await expectNotice(page, before);
    await expect(ui(page).save).toBeEnabled();
    const saved = await captureAddressJson<AddressBook>(page, 'PUT', `${addressesPath}/${before.items[0].id}`, 200);
    await save(page, 'PUT');
    expect(saved()).toEqual(before);
    const commands = await intents();
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({ method: 'PUT', path: `${addressesPath}/${before.items[0].id}` });
    expect(JSON.parse(commands[0].body!)).toEqual(addressEdit(before.items[0]));
    await expect(ui(page).main.getByRole('status').filter({ hasText: text.limit })).toHaveCount(0);
    await expect(ui(page).cards).toHaveCount(2);
    await expect(ui(page).cards.nth(0)).toContainText('Fifth Change City');
    expect(storedAddressState(api.user.username)).toEqual(state);
    await page.reload();
    await expect(card(page, 'Home')).toContainText('Fifth Change City');
    await edit(page, 'Home');
    await expectNotice(page, before);
    await expect(ui(page).save).toBeEnabled();
    await ui(page).cancel.click();
    expect(await intents()).toHaveLength(1);
    expect(storedAddressState(api.user.username)).toEqual(state);
  });
