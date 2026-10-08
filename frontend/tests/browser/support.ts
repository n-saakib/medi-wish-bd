import { randomBytes, randomInt } from 'node:crypto';
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { apiUrl, grantRole, makeSuperAdmin } from './testApi';
import { totpCode, totpStep } from './totp';

export type Customer = { username: string; mobile: string; email: string; password: string };

/** A new synthetic Customer, unique to one test run; `username` replaces the generated one when a test needs a pattern. */
export function syntheticCustomer(username?: string): Customer {
  const suffix = randomBytes(4).toString('hex');
  return {
    username: username ?? `journey.${suffix}`,
    mobile: `017${randomInt(10_000_000, 100_000_000)}`,
    email: `journey.${suffix}@example.test`,
    password: `Synthetic-${randomBytes(8).toString('hex')}`,
  };
}

/** Registers through the form; registration signs the Customer in and opens `/account`. */
export async function register(page: Page, customer: Customer): Promise<void> {
  await page.goto('/register');
  await page.getByLabel('Username').fill(customer.username);
  await page.getByLabel('Mobile').fill(customer.mobile);
  await page.getByLabel('Email').fill(customer.email);
  await page.getByLabel('Password').fill(customer.password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL('/account');
}

/** The console line Chromium writes for a request the API answered with 401 (the API sends no reason phrase). */
export function unauthorizedLine(path: string): string {
  return `${path} Failed to load resource: the server responded with a status of 401 ()`;
}

/**
 * Records what a page writes to the developer console and what it is answered: console errors as `path text`, and as
 * `status METHOD path` every API response (CORS preflights left out) plus any other response with status 400 or
 * higher. `expectSeen` waits until exactly the expected entries were recorded, then clears them for the next step.
 */
export function watchPage(page: Page) {
  const consoleErrors: string[] = [];
  const responses: string[] = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const { url } = message.location();
    consoleErrors.push(`${url ? new URL(url).pathname : ''} ${message.text()}`.trim());
  });
  page.on('response', (response) => {
    const method = response.request().method();
    if (method === 'OPTIONS' || (!response.url().startsWith(apiUrl) && response.status() < 400)) return;
    responses.push(`${response.status()} ${method} ${new URL(response.url()).pathname}`);
  });
  return {
    async expectSeen(expected: { consoleErrors: string[]; responses: string[] }): Promise<void> {
      await expect.poll(() => ({ consoleErrors, responses })).toEqual(expected);
      consoleErrors.length = 0;
      responses.length = 0;
    },
  };
}

/** Signs in through the sign-in form; the caller checks where the session lands. */
export async function signIn(page: Page, identifier: string, password: string): Promise<void> {
  await page.goto('/sign-in');
  await page.getByLabel('Mobile, email or username').fill(identifier);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/** The setup page's manual key, read the way a person would: open `Can’t scan?` and copy the grouped key. */
export async function readManualKey(page: Page): Promise<string> {
  await page.getByText('Can’t scan?').click();
  const key = (await page.locator('details code').innerText()).replace(/\s+/g, '');
  expect(key).toMatch(/^[A-Z2-7]{32}$/);
  return key;
}

/** The backup codes shown once after setup, in page order. */
export async function readBackupCodes(page: Page): Promise<string[]> {
  const items = page.getByRole('list', { name: 'Backup codes' }).getByRole('listitem');
  await expect(items).toHaveCount(10);
  const codes = (await items.allInnerTexts()).map((code) => code.trim());
  for (const code of codes) expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  return codes;
}

/** A staff authenticator as a test holds it: the Base32 key and the last time step whose code the API accepted. */
export type Authenticator = { key: string; step: number };

/** A registered User whose authenticator is enrolled. */
export type StaffMember = Customer & { authenticator: Authenticator };

/** Registers through the API, as the shortest way to an existing User; registration opens no session. */
export async function registerThroughApi(request: APIRequestContext, customer = syntheticCustomer()): Promise<Customer> {
  const { username, mobile, email, password } = customer;
  expect((await request.post(`${apiUrl}/api/auth/register`, { data: { username, mobile, email, password } })).status())
    .toBe(201);
  return customer;
}

/** Registers through the API and grants ADMIN as an operator would; the Admin has no authenticator yet. */
export async function registeredAdmin(page: Page): Promise<Customer> {
  const admin = await registerThroughApi(page.request);
  grantRole(admin.username, 'ADMIN');
  return admin;
}

/** On the setup page: reads the manual key, verifies the current code and waits for the backup codes. */
export async function enroll(page: Page): Promise<Authenticator> {
  await expect(page).toHaveURL('/staff/mfa/enroll');
  const key = await readManualKey(page);
  const step = totpStep();
  await page.getByLabel('Enter the 6-digit code').fill(totpCode(key, step));
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('heading', { name: 'Backup codes (shown once)' })).toBeFocused();
  return { key, step };
}

/** Signs in with the password, enrolls, saves the backup codes and waits for the verified staff page. */
export async function signInAndEnroll(page: Page, member: Customer): Promise<StaffMember> {
  await signIn(page, member.username, member.password);
  const authenticator = await enroll(page);
  await page.getByRole('button', { name: 'I’ve saved them' }).click();
  await expect(page).toHaveURL('/staff');
  await expect(page.getByRole('heading', { name: 'Staff access verified' })).toBeVisible();
  return { ...member, authenticator };
}

/** A Moderator granted in SQL who enrolled through the pages; `page` ends on `/staff`. */
export async function verifiedModerator(page: Page): Promise<StaffMember> {
  const moderator = await registerThroughApi(page.request);
  grantRole(moderator.username, 'MODERATOR');
  return signInAndEnroll(page, moderator);
}

/** An ordinary Admin (not the Super Admin) granted in SQL who enrolled through the pages; `page` ends on `/staff`. */
export async function verifiedAdmin(page: Page): Promise<StaffMember> {
  return signInAndEnroll(page, await registeredAdmin(page));
}

/**
 * A new Super Admin who enrolled through the pages; `page` ends on `/staff`. `makeSuperAdmin` moves the run's single
 * Super Admin to this User, so any earlier one becomes an ordinary Admin.
 */
export async function verifiedSuperAdmin(page: Page): Promise<StaffMember> {
  const owner = await registerThroughApi(page.request);
  makeSuperAdmin(owner.username);
  return signInAndEnroll(page, owner);
}

/**
 * The next code the API accepts: a later time step than the last accepted one, waiting while that step is still ahead
 * of the API's one-step window. It records the step, so a later call never replays it.
 */
export async function freshCode(authenticator: Authenticator): Promise<string> {
  const step = Math.max(authenticator.step + 1, totpStep());
  while (step > totpStep() + 1) await new Promise((resolve) => setTimeout(resolve, 1_000));
  authenticator.step = step;
  return totpCode(authenticator.key, step);
}

/** Signs in a staff member whose session asks for a code, enters a fresh one and waits for `/staff`. */
export async function signInWithCode(page: Page, member: StaffMember): Promise<void> {
  await signIn(page, member.username, member.password);
  await expect(page).toHaveURL('/staff/mfa');
  await page.getByLabel('Authenticator code').fill(await freshCode(member.authenticator));
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).toHaveURL('/staff');
}
