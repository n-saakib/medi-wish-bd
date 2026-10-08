import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import {
  ApiSession, apiCustomer, apiStaff, apiSuperAdmin, changeRole, clearRoleChangeActors, findUser, readUserRoles,
  roleChangeRows, signInAgain, storedRoles,
} from './apiSession';
import {
  enroll, register, registeredAdmin, registerThroughApi, signIn, signInWithCode, syntheticCustomer, verifiedAdmin,
  verifiedModerator, verifiedSuperAdmin, type Customer,
} from './support';
import { apiLogPath, apiUrl, grantRole, makeSuperAdmin, sessionStates } from './testApi';

/**
 * Ticket 08 in the browser: the Users and roles pages (`/admin/users`, `/admin/users/<id>`) and what a role change does
 * to the target's open browser. Every User holds exactly one role (DECISIONS S6), chosen with one radio group. Strings
 * come from the plan (§1, §4.6) and the fixed contract in plan §10. Tags: `@t08` plus the one sub-ticket whose
 * completion makes the test pass.
 */

const expiredMessage = 'Your session has expired. Please sign in again.';
const deniedMessage = 'Only Admins can manage users.';
const notFoundMessage = 'This user could not be found.';
const requestFailedMessage = 'The request could not be completed.';
const staleMessage = 'This record changed after you opened it. Reload and try again.';
const refusedMessage = 'This role change is not allowed.';
const adminNote = 'Only the Super Admin can change the Admin role.';
const selfNote = /^You can[’']t change your own role\.$/;
const superAdminNote = /^The Super Admin[’']s role can[’']t be changed\.$/;
const footerNote = 'Saving signs this person out everywhere. Staff roles need an authenticator before they work.';
/** Who made a change whose actor no longer exists (`actorUsername` null), in the Change history. */
const deletedActor = 'a deleted account';
/** The radios' accessible names, lowest role first. */
const optionNames = ['Customer', 'Delivery person', 'Moderator · requires authenticator', 'Admin · requires authenticator'];
type RoleOption = 'Customer' | 'Delivery person' | 'Moderator' | 'Admin';
const allOptions: RoleOption[] = ['Customer', 'Delivery person', 'Moderator', 'Admin'];

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A new prefix for synthetic usernames, so a search finds only this test's Users. */
function uniquePrefix(label: string): string {
  return `${label}.${randomBytes(4).toString('hex')}`;
}

/** A second browser for another person (a target who stays signed in, for example); close it when done. */
async function secondBrowser(browser: Browser): Promise<Page> {
  return (await browser.newContext()).newPage();
}

/** From `/staff`, follows the Admin-only link to the list. */
async function openUsersFromStaffHome(page: Page): Promise<void> {
  await page.goto('/staff');
  await page.getByRole('link', { name: 'Users and roles' }).click();
  await expect(page).toHaveURL('/admin/users');
  await expect(page.getByRole('heading', { level: 1, name: 'Users and roles' })).toBeVisible();
}

/** Types a username search and submits it with the Search button. */
async function search(page: Page, term: string): Promise<void> {
  await searchField(page).fill(term);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
}

function searchField(page: Page): Locator {
  return page.getByLabel('Search users', { exact: true });
}

function roleFilter(page: Page): Locator {
  return page.getByRole('combobox', { name: 'Role', exact: true });
}

function usersTable(page: Page): Locator {
  return page.getByRole('table', { name: 'Users' });
}

function userRow(page: Page, username: string): Locator {
  return usersTable(page).getByRole('row').filter({ has: page.getByText(username, { exact: true }) });
}

/** Searches for `username` on the list and opens its detail page. */
async function openUser(page: Page, username: string): Promise<void> {
  if (!page.url().endsWith('/admin/users')) await page.goto('/admin/users');
  await search(page, username);
  await usersTable(page).getByRole('link', { name: `Open ${username}`, exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/users\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1, name: username, exact: true })).toBeVisible();
}

/** The detail page's **Role** card. */
function roleCard(page: Page): Locator {
  return page.getByRole('region', { name: 'Role' });
}

function roleGroup(page: Page): Locator {
  return roleCard(page).getByRole('radiogroup', { name: 'Role' });
}

/** One radio of the **Role** radio group. */
function roleOption(page: Page, role: RoleOption): Locator {
  const name = role === 'Moderator' || role === 'Admin' ? `${role} · requires authenticator` : role;
  return roleGroup(page).getByRole('radio', { name, exact: true });
}

function saveButton(page: Page): Locator {
  return roleCard(page).getByRole('button', { name: 'Save role' });
}

function savedStatus(page: Page, username: string): Locator {
  return page.getByRole('status').filter({ hasText: `Role saved. ${username} has been signed out everywhere.` });
}

/** Selects `role`, presses Save role and waits for the focused success status. */
async function saveRole(page: Page, username: string, role: RoleOption): Promise<void> {
  await roleOption(page, role).check();
  await saveButton(page).click();
  await expect(savedStatus(page, username)).toBeFocused();
  await expect(roleOption(page, role)).toBeChecked();
}

/** Every radio and Save role are disabled. */
async function expectLocked(page: Page): Promise<void> {
  for (const role of allOptions) await expect(roleOption(page, role)).toBeDisabled();
  await expect(saveButton(page)).toBeDisabled();
}

function historyItems(page: Page): Locator {
  return page.getByRole('list', { name: 'Change history' }).getByRole('listitem');
}

/**
 * One Change history line: "Changed from Customer to Moderator by owner.admin · 27 Sep 2026, 9:02". A null actor (their
 * User no longer exists) reads "by a deleted account".
 */
function historyLine(from: RoleOption, to: RoleOption, actor: string | null): RegExp {
  return new RegExp(`^Changed from ${from} to ${to} by ${actor === null ? deletedActor : escapeRegExp(actor)}`
    + ' · \\d{1,2} [A-Z][a-z]{2} \\d{4}, \\d{1,2}:\\d{2}$');
}

/** The target's open browser: the next page load finds the session revoked and lands on sign-in. */
async function expectSignedOut(page: Page, path = '/account'): Promise<void> {
  await page.goto(path);
  await expect(page).toHaveURL('/sign-in');
  await expect(page.getByRole('status').filter({ hasText: expiredMessage })).toBeVisible();
}

/** The `/staff` summary line of roles: one role, such as "Moderator". */
async function expectStaffRole(page: Page, role: string): Promise<void> {
  await expect(page).toHaveURL('/staff');
  await expect(page.getByRole('region', { name: 'Staff access verified' }).getByText(role, { exact: true })).toBeVisible();
}

/** The detail page's id, taken from the URL after `openUser`. */
function detailId(page: Page): string {
  return new URL(page.url()).pathname.split('/').pop()!;
}

/**
 * Holds the next request that `matches` until the returned function is called; the request then continues, or fails
 * as a network error when `fail` is set.
 */
async function holdNext(page: Page, matches: (url: URL) => boolean): Promise<(fail?: boolean) => void> {
  let release!: (fail: boolean) => void;
  const released = new Promise<boolean>((resolve) => { release = resolve; });
  await page.route((url) => url.href.startsWith(apiUrl) && matches(url), async (route) => {
    await (await released ? route.abort() : route.continue());
  }, { times: 1 });
  return (fail = false) => release(fail);
}

/**
 * Lets the next matching non-preflight request reach the server, then fails it in the browser as a network error: the
 * server commits, the page never sees the response. `committed` resolves to the status the server answered; it is
 * wrapped so awaiting the route installation does not also wait for the request.
 */
async function loseNextResponse(page: Page, matches: (url: URL) => boolean): Promise<{ committed: Promise<number> }> {
  let lost = false;
  let answered!: (status: number) => void;
  const status = new Promise<number>((resolve) => { answered = resolve; });
  await page.route((url) => url.href.startsWith(apiUrl) && matches(url), async (route) => {
    if (lost || route.request().method() === 'OPTIONS') return route.continue();
    lost = true;
    answered((await route.fetch()).status());
    await route.abort();
  });
  return { committed: status };
}

/**
 * `text` with every percent-encoded run decoded and `+` read as a space, repeated so double encoding is undone too; a
 * malformed run is left as it is.
 */
function percentDecoded(text: string): string {
  let decoded = text;
  for (let round = 0; round < 3; round += 1) {
    const next = decoded.replace(/\+/g, ' ').replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => {
      try {
        return decodeURIComponent(run);
      } catch {
        return run;
      }
    });
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
}

/** Every role API request the page sends, as `METHOD path?query` (the search sends its filter in the body). */
function recordRoleRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.href.startsWith(apiUrl) && url.pathname.startsWith('/api/admin/') && request.method() !== 'OPTIONS') {
      seen.push(`${request.method()} ${url.pathname}${url.search}`);
    }
  });
  return seen;
}

// ---------------------------------------------------------------------------------------------------------------------
// T5: the pages on the joined backend
// ---------------------------------------------------------------------------------------------------------------------

test('E2E-08-29 StaffHome links Admins, and only Admins, to Users and roles', { tag: ['@t08', '@t08-T5'] },
  async ({ page, browser }) => {
    await verifiedAdmin(page);
    await openUsersFromStaffHome(page);

    const moderatorPage = await secondBrowser(browser);
    await verifiedModerator(moderatorPage);
    await expect(moderatorPage.getByRole('region', { name: 'Staff access verified' })).toBeVisible();
    await expect(moderatorPage.getByRole('link', { name: 'Users and roles' })).toHaveCount(0);
    await moderatorPage.context().close();
  });

test('E2E-08-30 an Admin sets Moderator; the target’s browser is signed out and must enroll (I1)',
  { tag: ['@t08', '@t08-T5'] }, async ({ page, browser }) => {
    test.setTimeout(180_000);
    const admin = await verifiedAdmin(page);
    const target = syntheticCustomer();
    const targetPage = await secondBrowser(browser);
    await register(targetPage, target);
    const requests = recordRoleRequests(page);

    await test.step('find the Customer and open their role', async () => {
      await openUsersFromStaffHome(page);
      const searched = page.waitForRequest((request) => request.method() === 'POST'
        && new URL(request.url()).pathname === '/api/admin/users/search');
      await search(page, target.username);
      // The username filter travels in the JSON body of the search, never in a URL.
      expect((await searched).postDataJSON()).toMatchObject({ username: target.username });
      const row = userRow(page, target.username);
      await expect(row).toHaveCount(1);
      await expect(row.getByText('Customer', { exact: true })).toBeVisible();
      await expect(row.getByText('Not required', { exact: true })).toBeVisible();
      await openUser(page, target.username);
      await expect(page.getByText(/^Joined [A-Z][a-z]{2} \d{4}$/)).toBeVisible();
      await expect(roleOption(page, 'Customer')).toBeChecked();
      // Nothing to save until another role is chosen.
      await expect(saveButton(page)).toBeDisabled();
      await expect(page.getByText('No role changes yet.')).toBeVisible();
    });

    await test.step('select Moderator and save: the success status, the history row and the exact request', async () => {
      const put = page.waitForRequest((request) => request.method() === 'PUT' && request.url().endsWith('/roles'));
      await saveRole(page, target.username, 'Moderator');
      expect((await put).postDataJSON()).toEqual({ role: 'MODERATOR', rolesVersion: 0 });
      await expect(roleOption(page, 'Customer')).not.toBeChecked();
      await expect(saveButton(page)).toBeDisabled();
      await expect(historyItems(page)).toHaveCount(1);
      await expect(historyItems(page).first()).toHaveText(historyLine('Customer', 'Moderator', admin.username));
    });

    await test.step('a reload shows the saved role', async () => {
      await page.reload();
      await expect(roleOption(page, 'Moderator')).toBeChecked();
      await expect(historyItems(page)).toHaveCount(1);
    });

    await test.step('the target’s next page load goes to sign-in; signing in asks for authenticator setup', async () => {
      await expectSignedOut(targetPage);
      await signIn(targetPage, target.username, target.password);
      await enroll(targetPage);
      await targetPage.getByRole('button', { name: 'I’ve saved them' }).click();
      await expectStaffRole(targetPage, 'Moderator');
    });

    expect(requests.filter((entry) => entry.startsWith('PUT '))).toHaveLength(1);
    // The search term is in no role API URL and not in the page URL.
    expect(requests.filter((entry) => entry.includes(target.username))).toEqual([]);
    expect(page.url()).not.toContain(target.username);
    await targetPage.context().close();
  });

test('E2E-08-31 a verified Moderator sees the access-denied state on both pages and no user data',
  { tag: ['@t08', '@t08-T5'] }, async ({ page, request }) => {
    const customer = await registerThroughApi(request);
    const owner = await apiStaff(request, 'ADMIN');
    const customerId = (await findUser(owner.session, customer.username)).id;
    await owner.session.dispose();
    await verifiedModerator(page);

    for (const path of ['/admin/users', `/admin/users/${customerId}`]) {
      await page.goto(path);
      await expect(page).toHaveURL(path);
      await expect(page.getByRole('alert').filter({ hasText: deniedMessage })).toBeVisible();
      await expect(usersTable(page)).toHaveCount(0);
      await expect(roleCard(page)).toHaveCount(0);
      await expect(page.getByText(customer.username)).toHaveCount(0);
    }
  });

test('E2E-08-32 the pages send signed-out visitors to sign-in, Customers to their account and restricted staff to MFA',
  { tag: ['@t08', '@t08-T5'] }, async ({ page, browser }) => {
    const id = randomUUID();
    for (const path of ['/admin/users', `/admin/users/${id}`]) {
      await page.goto(path);
      await expect(page).toHaveURL('/sign-in');
    }

    await register(page, syntheticCustomer());
    for (const path of ['/admin/users', `/admin/users/${id}`]) {
      await page.goto(path);
      await expect(page).toHaveURL('/account');
    }

    const staffPage = await secondBrowser(browser);
    const admin = await registeredAdmin(staffPage);
    await signIn(staffPage, admin.username, admin.password);
    await expect(staffPage).toHaveURL('/staff/mfa/enroll');
    await staffPage.goto('/admin/users');
    await expect(staffPage).toHaveURL('/staff/mfa/enroll');
    await staffPage.context().close();
  });

test('E2E-08-33 the list searches by username prefix, filters by role, shows the empty state and pages by 20',
  { tag: ['@t08', '@t08-T5'] }, async ({ page, request }) => {
    test.setTimeout(180_000);
    const prefix = uniquePrefix('page');
    const users: Customer[] = [];
    for (let index = 0; index < 21; index++) {
      users.push(await registerThroughApi(request, syntheticCustomer(`${prefix}.${String(index).padStart(2, '0')}`)));
    }
    grantRole(users[3].username, 'MODERATOR');
    grantRole(users[4].username, 'DELIVERY_PERSON');
    await verifiedAdmin(page);
    await openUsersFromStaffHome(page);
    for (const header of ['User', 'Role', 'Staff MFA', 'Joined']) {
      await expect(usersTable(page).getByRole('columnheader', { name: header, exact: true })).toBeVisible();
    }

    await test.step('the first page of a prefix search, then Next and Previous', async () => {
      await search(page, prefix.toUpperCase());
      await expect(page.getByText('Showing 1–20 of 21', { exact: true })).toBeVisible();
      await expect(usersTable(page).getByRole('link', { name: /^Open / })).toHaveCount(20);
      await expect(page.getByRole('button', { name: 'Previous' })).toBeDisabled();
      await page.getByRole('button', { name: 'Next' }).click();
      await expect(page.getByText('Showing 21–21 of 21', { exact: true })).toBeVisible();
      await expect(userRow(page, users[20].username)).toHaveCount(1);
      await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled();
      await page.getByRole('button', { name: 'Previous' }).click();
      await expect(page.getByText('Showing 1–20 of 21', { exact: true })).toBeVisible();
    });

    await test.step('the role filter, submitted with Enter; each row shows its one role', async () => {
      await roleFilter(page).selectOption({ label: 'Moderator' });
      await searchField(page).press('Enter');
      await expect(usersTable(page).getByRole('link', { name: /^Open / })).toHaveCount(1);
      const moderatorRow = userRow(page, users[3].username);
      await expect(moderatorRow.getByText('Moderator', { exact: true })).toBeVisible();
      await expect(moderatorRow.getByText('Customer', { exact: true })).toHaveCount(0);
      await expect(moderatorRow.getByText('Setup pending', { exact: true })).toBeVisible();

      await roleFilter(page).selectOption({ label: 'Delivery person' });
      await page.getByRole('button', { name: 'Search', exact: true }).click();
      const deliveryRow = userRow(page, users[4].username);
      await expect(usersTable(page).getByRole('link', { name: /^Open / })).toHaveCount(1);
      await expect(deliveryRow.getByText('Delivery person', { exact: true })).toBeVisible();
      await expect(deliveryRow.getByText('Not required', { exact: true })).toBeVisible();

      // Customer matches the stored role only: the Moderator and the Delivery person are not listed.
      await roleFilter(page).selectOption({ label: 'Customer' });
      await page.getByRole('button', { name: 'Search', exact: true }).click();
      await expect(page.getByText('Showing 1–19 of 19', { exact: true })).toBeVisible();
    });

    await test.step('no match shows the empty state without a table', async () => {
      await roleFilter(page).selectOption({ label: 'Any role' });
      await search(page, uniquePrefix('nomatch'));
      await expect(page.getByText('No users match.', { exact: true })).toBeVisible();
      await expect(usersTable(page)).toHaveCount(0);
    });
    expect(page.url()).toBe(new URL('/admin/users', page.url()).href);
  });

test('E2E-08-34 an ordinary Admin sees why options are disabled: the Admin option, another Admin, their own row, the Super Admin',
  { tag: ['@t08', '@t08-T5'] }, async ({ page, request }) => {
    const customer = await registerThroughApi(request);
    const otherAdmin = await registerThroughApi(request);
    grantRole(otherAdmin.username, 'ADMIN');
    const owner = await registerThroughApi(request);
    makeSuperAdmin(owner.username);
    const admin = await verifiedAdmin(page);

    await test.step('a Customer: four radios, lowest first; Admin disabled with the reason as text and description', async () => {
      await openUser(page, customer.username);
      await expect(roleGroup(page).getByRole('radio')).toHaveCount(4);
      for (const [index, name] of optionNames.entries()) {
        await expect(roleGroup(page).getByRole('radio').nth(index)).toHaveAccessibleName(name);
      }
      await expect(roleOption(page, 'Customer')).toBeChecked();
      for (const role of ['Customer', 'Delivery person', 'Moderator'] as const) {
        await expect(roleOption(page, role)).toBeEnabled();
      }
      await expect(roleOption(page, 'Admin')).toBeDisabled();
      await expect(roleOption(page, 'Admin')).toHaveAccessibleDescription(adminNote);
      await expect(roleCard(page).getByText(adminNote, { exact: true })).toBeVisible();
      await expect(roleCard(page).getByText(footerNote, { exact: true })).toBeVisible();
      await expect(page.getByText('Super Admin', { exact: true })).toHaveCount(0);
    });

    await test.step('another Admin: every option locked, with the same reason', async () => {
      await openUser(page, otherAdmin.username);
      await expect(roleOption(page, 'Admin')).toBeChecked();
      await expectLocked(page);
      await expect(roleCard(page).getByText(adminNote, { exact: true })).toBeVisible();
    });

    await test.step('their own row: every option and Save are disabled, with the self note', async () => {
      await openUser(page, admin.username);
      await expect(roleCard(page).getByText(selfNote)).toBeVisible();
      await expect(roleOption(page, 'Admin')).toBeChecked();
      await expectLocked(page);
    });

    await test.step('the Super Admin’s row: the Super Admin chip, locked, with its own note', async () => {
      await openUser(page, owner.username);
      await expect(page.getByText('Super Admin', { exact: true })).toBeVisible();
      await expect(roleOption(page, 'Admin')).toBeChecked();
      await expectLocked(page);
      await expect(roleCard(page).getByText(superAdminNote)).toBeVisible();
    });
  });

test('E2E-08-35 the Super Admin makes a Customer an Admin and back through the page', { tag: ['@t08', '@t08-T5'] },
  async ({ page, request }) => {
    const customer = await registerThroughApi(request);
    const owner = await verifiedSuperAdmin(page);

    await openUser(page, owner.username);
    await expect(page.getByText('Super Admin', { exact: true })).toBeVisible();
    await expect(roleCard(page).getByText(selfNote)).toBeVisible();
    await expectLocked(page);

    await openUser(page, customer.username);
    for (const role of allOptions) await expect(roleOption(page, role)).toBeEnabled();
    await expect(page.getByText(adminNote)).toHaveCount(0);
    await saveRole(page, customer.username, 'Admin');
    await expect(historyItems(page).first()).toHaveText(historyLine('Customer', 'Admin', owner.username));
    expect(storedRoles(customer.username)).toEqual(['ADMIN']);
    const promoted = await ApiSession.signIn(customer);
    expect(promoted.mfa).toBe('ENROLLMENT_REQUIRED');
    await promoted.dispose();

    await saveRole(page, customer.username, 'Customer');
    await expect(historyItems(page)).toHaveCount(2);
    await expect(historyItems(page).first()).toHaveText(historyLine('Admin', 'Customer', owner.username));
    await expect(roleOption(page, 'Admin')).not.toBeChecked();
    expect(storedRoles(customer.username)).toEqual(['CUSTOMER']);
  });

test('E2E-08-36 a stale page shows the stale alert with Reload, and saving after the reload works',
  { tag: ['@t08', '@t08-T5'] }, async ({ page, request }) => {
    const customer = await registerThroughApi(request);
    await verifiedAdmin(page);
    await openUser(page, customer.username);
    const id = detailId(page);

    const other = await apiStaff(request, 'ADMIN');
    await changeRole(other.session, id, 'DELIVERY_PERSON', 0);

    await roleOption(page, 'Moderator').check();
    await saveButton(page).click();
    const alert = page.getByRole('alert').filter({ hasText: staleMessage });
    await expect(alert).toBeFocused();
    await alert.getByRole('button', { name: 'Reload' }).click();
    await expect(page.getByRole('alert').filter({ hasText: staleMessage })).toHaveCount(0);
    await expect(roleOption(page, 'Delivery person')).toBeChecked();
    await expect(roleOption(page, 'Moderator')).not.toBeChecked();

    await saveRole(page, customer.username, 'Moderator');
    expect((await readUserRoles(other.session, id)).role).toBe('MODERATOR');
    await other.session.dispose();
  });

test('E2E-08-37 a refused change shows the refused alert: the Super Admin moved while the page was open',
  { tag: ['@t08', '@t08-T5'] }, async ({ page, request }) => {
    const customer = await registerThroughApi(request);
    await verifiedSuperAdmin(page);
    await openUser(page, customer.username);
    await expect(roleOption(page, 'Admin')).toBeEnabled();

    // The singleton moves to another User, so this Admin is now ordinary and rule 5 refuses the ADMIN change.
    makeSuperAdmin((await registerThroughApi(request)).username);
    await roleOption(page, 'Admin').check();
    await saveButton(page).click();
    await expect(page.getByRole('alert').filter({ hasText: refusedMessage })).toBeFocused();

    await page.reload();
    await expect(roleOption(page, 'Admin')).toBeDisabled();
    await expect(roleOption(page, 'Customer')).toBeChecked();
    await expect(page.getByText('No role changes yet.')).toBeVisible();
  });

test('E2E-08-38 an unknown or malformed User id shows the not-found state; a malformed one calls no API',
  { tag: ['@t08', '@t08-T5'] }, async ({ page }) => {
    await verifiedAdmin(page);
    const requests = recordRoleRequests(page);

    await page.goto(`/admin/users/${randomUUID()}`);
    await expect(page.getByRole('alert').filter({ hasText: notFoundMessage })).toBeVisible();
    await expect(roleCard(page)).toHaveCount(0);
    expect(requests).toHaveLength(1);

    requests.length = 0;
    await page.goto('/admin/users/not-a-uuid');
    await expect(page.getByRole('alert').filter({ hasText: notFoundMessage })).toBeVisible();
    expect(requests).toEqual([]);
  });

test('E2E-08-39 the admin pages are served with Cache-Control: no-store', { tag: ['@t08', '@t08-T5'] },
  async ({ page }) => {
    await verifiedAdmin(page);
    for (const path of ['/admin/users', `/admin/users/${randomUUID()}`]) {
      const response = await page.goto(path);
      // Observe the guarded page before starting the next full navigation.
      await expect(path === '/admin/users' ? usersTable(page)
        : page.getByRole('alert').filter({ hasText: notFoundMessage })).toBeVisible();
      expect(response?.headers()['cache-control'], path).toBe('no-store');
      expect((await page.request.get(path)).headers()['cache-control'], path).toBe('no-store');
    }
  });

test('E2E-08-40 Save role shows Saving… and a double click sends one request', { tag: ['@t08', '@t08-T5'] },
  async ({ page, request }) => {
    const customer = await registerThroughApi(request);
    await verifiedAdmin(page);
    await openUser(page, customer.username);
    const requests = recordRoleRequests(page);

    await roleOption(page, 'Delivery person').check();
    const release = await holdNext(page, (url) => url.pathname.endsWith('/roles'));
    await saveButton(page).dblclick();
    await expect(roleCard(page).getByRole('button', { name: 'Saving…' })).toBeDisabled();
    release();
    await expect(savedStatus(page, customer.username)).toBeFocused();
    expect(requests.filter((entry) => entry.startsWith('PUT '))).toHaveLength(1);
  });

test('E2E-08-41 a failed list or detail request shows the generic error alert; loading again recovers',
  { tag: ['@t08', '@t08-T5'] }, async ({ page, request }) => {
    const customer = await registerThroughApi(request);
    await verifiedAdmin(page);
    await page.goto('/admin/users');
    await expect(usersTable(page)).toBeVisible();

    await test.step('a failed search shows the alert; searching again lists the User', async () => {
      const release = await holdNext(page, (url) => url.pathname === '/api/admin/users/search');
      await search(page, customer.username);
      release(true);
      await expect(page.getByRole('alert').filter({ hasText: requestFailedMessage })).toBeFocused();
      await search(page, customer.username);
      await expect(userRow(page, customer.username)).toBeVisible();
      await expect(page.getByRole('alert').filter({ hasText: requestFailedMessage })).toHaveCount(0);
    });

    await test.step('a failed detail load shows the alert and no Role card; reloading shows the role', async () => {
      await openUser(page, customer.username);
      const id = detailId(page);
      const release = await holdNext(page, (url) => url.pathname === `/api/admin/users/${id}`);
      await page.reload();
      release(true);
      await expect(page.getByRole('alert').filter({ hasText: requestFailedMessage })).toBeFocused();
      await expect(roleCard(page)).toHaveCount(0);
      await page.reload();
      await expect(roleOption(page, 'Customer')).toBeChecked();
      await expect(page.getByRole('alert').filter({ hasText: requestFailedMessage })).toHaveCount(0);
    });
  });

test('E2E-08-54 a save that fails before reaching the server clears Saving…, and a retry applies it once',
  { tag: ['@t08', '@t08-T5'] }, async ({ page, request }) => {
    const target = await apiCustomer(request);
    const admin = await verifiedAdmin(page);
    await openUser(page, target.user.username);
    const requests = recordRoleRequests(page);

    await roleOption(page, 'Moderator').check();
    const release = await holdNext(page, (url) => url.pathname.endsWith('/roles'));
    await saveButton(page).click();
    await expect(roleCard(page).getByRole('button', { name: 'Saving…' })).toBeDisabled();
    release(true);
    await expect(page.getByRole('alert').filter({ hasText: requestFailedMessage })).toBeFocused();
    await expect(roleCard(page).getByRole('button', { name: 'Saving…' })).toHaveCount(0);
    expect(roleChangeRows(target.user.username), 'the failed request changed nothing').toEqual([]);
    expect(sessionStates(target.user.username)).toEqual(['active']);

    await saveRole(page, target.user.username, 'Moderator');
    await expect(historyItems(page)).toHaveCount(1);
    await expect(historyItems(page).first()).toHaveText(historyLine('Customer', 'Moderator', admin.username));
    expect(requests.filter((entry) => entry.startsWith('PUT '))).toHaveLength(2);
    expect(roleChangeRows(target.user.username).map(({ oldRole, newRole }) => `${oldRole} → ${newRole}`))
      .toEqual(['CUSTOMER → MODERATOR']);
    expect(sessionStates(target.user.username)).toEqual(['role-changed']);
    await target.session.dispose();
  });

test('E2E-08-42 demoting a verified Moderator to Customer signs them out; re-promotion asks for their kept authenticator (R7)',
  { tag: ['@t08', '@t08-T5'] }, async ({ page, browser }) => {
    test.setTimeout(180_000);
    const admin = await verifiedAdmin(page);
    const moderatorPage = await secondBrowser(browser);
    const moderator = await verifiedModerator(moderatorPage);

    await test.step('select Customer: the Moderator is signed out and comes back as a Customer', async () => {
      await openUser(page, moderator.username);
      await saveRole(page, moderator.username, 'Customer');
      await expect(historyItems(page).first()).toHaveText(historyLine('Moderator', 'Customer', admin.username));
      await expectSignedOut(moderatorPage, '/staff');
      await signIn(moderatorPage, moderator.username, moderator.password);
      await expect(moderatorPage).toHaveURL('/account');
      await moderatorPage.goto('/staff');
      await expect(moderatorPage).toHaveURL('/account');
    });

    await test.step('select Moderator again: signed out, then a code from the same authenticator opens /staff', async () => {
      await saveRole(page, moderator.username, 'Moderator');
      await expectSignedOut(moderatorPage);
      await signInWithCode(moderatorPage, moderator);
      await expectStaffRole(moderatorPage, 'Moderator');
    });

    await page.goto('/admin/users');
    await search(page, moderator.username);
    await expect(userRow(page, moderator.username).getByText('Enrolled', { exact: true })).toBeVisible();
    await moderatorPage.context().close();
  });

test('E2E-08-43 setting Delivery person signs the target out but adds no MFA and no staff access (AC4)',
  { tag: ['@t08', '@t08-T5'] }, async ({ page, browser }) => {
    await verifiedAdmin(page);
    const target = syntheticCustomer();
    const targetPage = await secondBrowser(browser);
    await register(targetPage, target);

    await openUser(page, target.username);
    await saveRole(page, target.username, 'Delivery person');
    await page.goto('/admin/users');
    await search(page, target.username);
    await expect(userRow(page, target.username).getByText('Delivery person', { exact: true })).toBeVisible();
    await expect(userRow(page, target.username).getByText('Not required', { exact: true })).toBeVisible();

    await expectSignedOut(targetPage);
    await signIn(targetPage, target.username, target.password);
    // A DeliveryPerson keeps every Customer permission (S6): the account page works; /staff does not.
    await expect(targetPage).toHaveURL('/account');
    await targetPage.goto('/staff');
    await expect(targetPage).toHaveURL('/account');
    await targetPage.context().close();
  });

// ---------------------------------------------------------------------------------------------------------------------
// T6: regression and privacy
// ---------------------------------------------------------------------------------------------------------------------

test('E2E-08-44 an Admin demoted to Customer while the detail page is open cannot save; the page sends them to sign-in',
  { tag: ['@t08', '@t08-T6'] }, async ({ page, request }) => {
    const owner = await apiSuperAdmin(request);
    const customer = await registerThroughApi(request);
    const admin = await verifiedAdmin(page);
    await openUser(page, customer.username);
    const customerId = detailId(page);

    await changeRole(owner.session, (await findUser(owner.session, admin.username)).id, 'CUSTOMER', 0);
    await roleOption(page, 'Moderator').check();
    await saveButton(page).click();
    await expect(page).toHaveURL('/sign-in');
    await expect(page.getByRole('status').filter({ hasText: expiredMessage })).toBeVisible();

    const unchanged = await readUserRoles(owner.session, customerId);
    expect({ role: unchanged.role, rolesVersion: unchanged.rolesVersion }).toEqual({ role: 'CUSTOMER', rolesVersion: 0 });
    await owner.session.dispose();
  });

test('E2E-08-55 a save whose response is lost after the commit is retried from the page as a no-op: one audit row, one revocation',
  { tag: ['@t08', '@t08-T6'] }, async ({ page, request }) => {
    const target = await apiCustomer(request);
    const admin = await verifiedAdmin(page);
    await openUser(page, target.user.username);
    const requests = recordRoleRequests(page);

    await roleOption(page, 'Moderator').check();
    const { committed } = await loseNextResponse(page, (url) => url.pathname.endsWith('/roles'));
    await saveButton(page).click();
    expect(await committed, 'the server applied the first save').toBe(200);
    await expect(page.getByRole('alert').filter({ hasText: requestFailedMessage })).toBeFocused();
    await expect(roleCard(page).getByRole('button', { name: 'Saving…' })).toHaveCount(0);
    expect(sessionStates(target.user.username)).toEqual(['role-changed']);
    // The target signs in again between the lost response and the retry: that session must survive the retry.
    expect(await signInAgain(target)).toBe('ENROLLMENT_REQUIRED');

    // The page still holds the loaded version 0, so the retry sends the same role and version: rule 2 (the current
    // role) comes before the version check and answers 200 with no change.
    const retried = page.waitForRequest((outgoing) => outgoing.method() === 'PUT'
      && new URL(outgoing.url()).pathname.endsWith('/roles'));
    await saveRole(page, target.user.username, 'Moderator');
    expect((await retried).postDataJSON()).toEqual({ role: 'MODERATOR', rolesVersion: 0 });
    await expect(historyItems(page)).toHaveCount(1);
    await expect(historyItems(page).first()).toHaveText(historyLine('Customer', 'Moderator', admin.username));
    expect(requests.filter((entry) => entry.startsWith('PUT '))).toHaveLength(2);
    expect(roleChangeRows(target.user.username)).toHaveLength(1);
    expect(sessionStates(target.user.username)).toEqual(['role-changed', 'active']);
    expect((await target.session.refresh()).status(), 'the session opened after the commit still refreshes').toBe(200);
    await target.session.dispose();
  });

test('E2E-08-45 usernames, contacts, passwords and searches stay out of every URL, storage, the console and the API log',
  { tag: ['@t08', '@t08-T6'] }, async ({ page, request }) => {
    const prefix = uniquePrefix('privacy');
    const users = [await registerThroughApi(request, syntheticCustomer(`${prefix}.one`)),
      await registerThroughApi(request, syntheticCustomer(`${prefix}.two`))];
    const pageUrls: string[] = [];
    const requestUrls: string[] = [];
    const consoleText: string[] = [];
    page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) pageUrls.push(frame.url()); });
    // Every outgoing request of the page, to any host: documents, scripts, data and API calls.
    page.on('request', (outgoing) => requestUrls.push(outgoing.url()));
    page.on('console', (message) => consoleText.push(message.text()));
    const admin = await verifiedAdmin(page);

    await openUsersFromStaffHome(page);
    await search(page, prefix);
    await expect(usersTable(page).getByRole('link', { name: /^Open / })).toHaveCount(2);
    await openUser(page, users[0].username);
    await page.goBack();
    await expect(page).toHaveURL('/admin/users');

    const listText = await page.locator('body').innerText();
    await page.goForward();
    await expect(roleCard(page)).toBeVisible();
    const detailText = await page.locator('body').innerText();
    const storage = await page.evaluate(() => JSON.stringify({
      local: Object.entries(localStorage), session: Object.entries(sessionStorage), history: history.state,
    }));

    // Every secret of both target Users and of the acting Admin (including their authenticator key), and the search
    // term, checked against every surface where it must not appear. The pages show usernames by design (the list rows,
    // the detail heading and the history), so page text is checked for the others.
    const people = [...users.map((user) => ['target', user] as const), ['Admin', admin] as const];
    const secrets: (readonly [string, string])[] = people.flatMap(([who, user]) => [[`${who} username`, user.username],
      [`${who} mobile`, user.mobile], [`${who} email`, user.email], [`${who} password`, user.password]] as const);
    secrets.push(['Admin authenticator key', admin.authenticator.key]);
    const surfaces: Record<string, string> = {
      'request URLs': requestUrls.join('\n'), 'page URLs': pageUrls.join('\n'), storage, console: consoleText.join('\n'),
      'API log': readFileSync(apiLogPath, 'utf8'),
    };
    expect(requestUrls.length, 'requests were recorded').toBeGreaterThan(0);
    for (const [surface, text] of Object.entries(surfaces)) {
      // Raw and percent-decoded: an encoded value (`%40` for `@`, `+` for a space) must not slip past the check.
      const forms = `${text}\n${percentDecoded(text)}`;
      for (const [kind, value] of [...secrets, ['search term', prefix] as const]) {
        expect(forms.includes(value), `the ${kind} in the ${surface}`).toBe(false);
      }
    }
    for (const [kind, value] of secrets.filter(([kind]) => !kind.endsWith('username'))) {
      expect(`${listText}\n${detailText}`.includes(value), `the ${kind} in the page text`).toBe(false);
    }
  });

test('E2E-08-53 a change whose actor no longer exists shows in the history as made by a deleted account',
  { tag: ['@t08', '@t08-T5'] }, async ({ page, request }) => {
    const customer = await registerThroughApi(request);
    const other = await apiStaff(request, 'ADMIN');
    const id = (await findUser(other.session, customer.username)).id;
    await changeRole(other.session, id, 'DELIVERY_PERSON', 0);
    // What ON DELETE SET NULL leaves once the actor's User row is gone (plan §4.5).
    clearRoleChangeActors(customer.username);
    expect((await readUserRoles(other.session, id)).roleChanges.map(({ actorUsername }) => actorUsername)).toEqual([null]);
    await other.session.dispose();

    await verifiedAdmin(page);
    await openUser(page, customer.username);
    await expect(roleOption(page, 'Delivery person')).toBeChecked();
    await expect(historyItems(page)).toHaveCount(1);
    await expect(historyItems(page).first()).toHaveText(historyLine('Customer', 'Delivery person', null));
  });

// ---------------------------------------------------------------------------------------------------------------------
// T7: smoke and accessibility
// ---------------------------------------------------------------------------------------------------------------------

test('E2E-08-46 an Admin sets Moderator from the Users and roles page, and a Customer is kept out',
  { tag: ['@t08', '@t08-T7', '@smoke'] }, async ({ page, browser, request }) => {
    const customer = await registerThroughApi(request);
    await verifiedAdmin(page);
    await openUsersFromStaffHome(page);
    await openUser(page, customer.username);
    await saveRole(page, customer.username, 'Moderator');

    const customerPage = await secondBrowser(browser);
    await register(customerPage, syntheticCustomer());
    await customerPage.goto('/admin/users');
    await expect(customerPage).toHaveURL('/account');
    await customerPage.context().close();
  });

/**
 * From a ready page, deliberately reloaded and awaited again: no horizontal scroll; every input and select labelled;
 * every control in `main` a target of at least 44 px (a radio through its label row); and Tab visiting each tab stop
 * in page order with a focus ring. A radio group is one tab stop: its checked radio.
 */
async function expectAccessiblePage(page: Page, ready: Locator): Promise<void> {
  // Let session restoration finish before deliberately replacing the document.
  await expect(ready).toBeVisible();
  await page.reload();
  await expect(ready).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  expect(await page.locator('input, select').evaluateAll((inputs) =>
    inputs.filter((input) => (input as HTMLInputElement).labels?.length === 0).length)).toBe(0);
  const small = await page.locator('main').evaluate((main) => [...main.querySelectorAll('a[href], button, input, select')]
    .filter((element) => element.getClientRects().length > 0)
    .map((element) => {
      const target = element instanceof HTMLInputElement && element.type === 'radio' ? element.closest('label') ?? element : element;
      const box = target.getBoundingClientRect();
      return { control: element.outerHTML.slice(0, 80), height: box.height, width: box.width };
    })
    .filter(({ height, width }) => height < 44 || width < 44));
  expect(small).toEqual([]);

  const controls = await page.locator('a[href], button:not([disabled]), input:not([disabled]):not([type="radio"]),'
    + ' input[type="radio"]:checked:not([disabled]), select').evaluateAll(
    (elements) => elements.filter((element) => element.getClientRects().length > 0).map((element) => element.outerHTML));
  for (const control of controls) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => {
      const focused = document.activeElement as HTMLElement;
      const style = getComputedStyle(focused);
      return { control: focused.outerHTML, ring: style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0 };
    })).toEqual({ control, ring: true });
  }
}

for (const [id, width] of [['47', 375], ['48', 1280]] as const) {
  test(`E2E-08-${id} at ${width} px the pages work by keyboard, with labels, text reasons, focus rings and 44 px targets`,
    { tag: ['@t08', '@t08-T7'] }, async ({ page, request }) => {
      await page.setViewportSize({ width, height: 800 });
      const customer = await registerThroughApi(request);
      await verifiedAdmin(page);

      await page.goto('/admin/users');
      await expectAccessiblePage(page, usersTable(page));

      await test.step('keyboard only: search, open, choose with the arrow keys and save', async () => {
        await searchField(page).focus();
        await page.keyboard.type(customer.username);
        await page.keyboard.press('Enter');
        const open = usersTable(page).getByRole('link', { name: `Open ${customer.username}`, exact: true });
        await open.focus();
        await page.keyboard.press('Enter');
        await expect(page.getByRole('heading', { level: 1, name: customer.username })).toBeVisible();
        await expectAccessiblePage(page, roleCard(page));
        await expect(roleOption(page, 'Admin')).toHaveAccessibleDescription(adminNote);
        // The checked radio is the group's tab stop; the arrow keys move through the enabled options in order.
        await roleOption(page, 'Customer').focus();
        await page.keyboard.press('ArrowDown');
        await expect(roleOption(page, 'Delivery person')).toBeChecked();
        await page.keyboard.press('ArrowDown');
        await expect(roleOption(page, 'Moderator')).toBeChecked();
        await saveButton(page).focus();
        await page.keyboard.press('Enter');
        await expect(savedStatus(page, customer.username)).toBeFocused();
      });
    });
}

// ---------------------------------------------------------------------------------------------------------------------
// T8: the §1 demo script, end to end
// ---------------------------------------------------------------------------------------------------------------------

test('E2E-08-49 the §1 demo script runs end to end in two browsers', { tag: ['@t08', '@t08-T8'] },
  async ({ page, browser, request }) => {
    test.setTimeout(300_000);
    const owner = await verifiedSuperAdmin(page);
    const demo = syntheticCustomer(uniquePrefix('demo.mod'));
    const demoPage = await secondBrowser(browser);
    await register(demoPage, demo);

    await test.step('the Super Admin sets Moderator from Users and roles', async () => {
      await openUsersFromStaffHome(page);
      await openUser(page, demo.username);
      await saveRole(page, demo.username, 'Moderator');
      await expect(historyItems(page).first()).toHaveText(historyLine('Customer', 'Moderator', owner.username));
    });

    await test.step('the second browser is signed out, then enrolls and reaches /staff as a Moderator', async () => {
      await expectSignedOut(demoPage);
      await signIn(demoPage, demo.username, demo.password);
      await enroll(demoPage);
      await demoPage.getByRole('button', { name: 'I’ve saved them' }).click();
      await expectStaffRole(demoPage, 'Moderator');
    });

    await test.step('selecting Customer signs them out again; they come back as a Customer', async () => {
      await saveRole(page, demo.username, 'Customer');
      await expectSignedOut(demoPage, '/staff');
      await signIn(demoPage, demo.username, demo.password);
      await expect(demoPage).toHaveURL('/account');
      await demoPage.goto('/staff');
      await expect(demoPage).toHaveURL('/account');
    });

    const second = await registerThroughApi(request);
    grantRole(second.username, 'ADMIN');
    await test.step('own row is locked; the Super Admin may replace a second Admin’s role', async () => {
      await openUser(page, owner.username);
      await expect(roleCard(page).getByText(selfNote)).toBeVisible();
      await expectLocked(page);
      await openUser(page, second.username);
      await expect(roleOption(page, 'Admin')).toBeChecked();
      for (const role of allOptions) await expect(roleOption(page, role)).toBeEnabled();
    });

    await test.step('as the second Admin, Admin is disabled and the Super Admin row is locked and labelled', async () => {
      const secondPage = await secondBrowser(browser);
      await signIn(secondPage, second.username, second.password);
      await enroll(secondPage);
      await secondPage.getByRole('button', { name: 'I’ve saved them' }).click();
      await openUsersFromStaffHome(secondPage);
      await openUser(secondPage, demo.username);
      await expect(roleOption(secondPage, 'Admin')).toBeDisabled();
      await expect(roleCard(secondPage).getByText(adminNote, { exact: true })).toBeVisible();
      await openUser(secondPage, owner.username);
      await expect(secondPage.getByText('Super Admin', { exact: true })).toBeVisible();
      await expectLocked(secondPage);
      await expect(roleCard(secondPage).getByText(superAdminNote)).toBeVisible();
      await secondPage.context().close();
    });

    await test.step('API failure: a Moderator’s PUT is refused with 403 ACCESS_DENIED', async () => {
      const moderator = await apiStaff(request, 'MODERATOR');
      const response = await moderator.session.call('PUT', `/api/admin/users/${detailId(page)}/roles`,
        { data: { role: 'MODERATOR', rolesVersion: 0 } });
      expect(response.status()).toBe(403);
      expect((await response.json() as { code: string }).code).toBe('ACCESS_DENIED');
      await moderator.session.dispose();
    });
    await demoPage.context().close();
  });
