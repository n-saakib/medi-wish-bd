import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { readBackupCodes, readManualKey, register, signIn, syntheticCustomer } from './support';
import { apiLogPath, apiUrl, grantRole } from './testApi';
import { totpCode, totpStep } from './totp';

/** Every URL the page loaded, navigated to or wrote to history, plus the console text, as seen by the browser. */
function recordSurfaces(page: Page) {
  const urls: string[] = [];
  const consoleText: string[] = [];
  page.on('request', (request) => urls.push(request.url()));
  page.on('framenavigated', (frame) => urls.push(frame.url()));
  page.on('console', (message) => consoleText.push(message.text()));
  return { urls, consoleText };
}

/** Local and session storage, IndexedDB database names and the current history entry of the page. */
function readStorage(page: Page): Promise<string> {
  return page.evaluate(async () => JSON.stringify({
    local: { ...localStorage },
    session: { ...sessionStorage },
    indexedDb: (await indexedDB.databases()).map(({ name }) => name),
    history: history.state,
    location: location.href,
  }));
}

test('credentials, tokens and contacts stay out of the log, console, storage, URLs and history', async ({ page }) => {
  const customer = syntheticCustomer();
  const issued = { access: new Set<string>(), refresh: new Set<string>(), csrf: new Set<string>() };
  const surfaces = recordSurfaces(page);
  const storage: string[] = [];

  // Collect every access token the browser presents and every refresh and CSRF value the API sets; the `XSRF-TOKEN`
  // cookie carries the CSRF bootstrap value. Headers stay readable after a navigation, unlike response bodies.
  const captured: Promise<void>[] = [];
  page.on('request', (request) => {
    const bearer = /^Bearer (.+)$/.exec(request.headers().authorization ?? '');
    if (request.url().startsWith(apiUrl) && bearer) issued.access.add(bearer[1]);
  });
  page.on('response', (response) => {
    if (!response.url().startsWith(apiUrl)) return;
    captured.push(response.headerValues('set-cookie').then((cookies) => {
      for (const cookie of cookies) {
        const [, name, value] = /^(MW_REFRESH|XSRF-TOKEN)=([^;]+)/.exec(cookie) ?? [];
        if (name) issued[name === 'MW_REFRESH' ? 'refresh' : 'csrf'].add(value);
      }
    }));
  });
  const snapshotStorage = async () => { storage.push(await readStorage(page)); };

  await register(page, customer);
  await expect(page.getByText(customer.mobile, { exact: true })).toBeVisible();
  await snapshotStorage();
  await page.reload();
  await expect(page.getByText(customer.mobile, { exact: true })).toBeVisible();
  await snapshotStorage();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByText('You have been signed out.')).toBeVisible();
  await snapshotStorage();
  await page.goto('/sign-in');
  await page.getByLabel('Mobile, email or username').fill(customer.email);
  await page.getByLabel('Password').fill(customer.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL('/account');
  await expect(page.getByText(customer.mobile, { exact: true })).toBeVisible();
  await snapshotStorage();

  await Promise.all(captured);
  // No IndexedDB database exists, so none can hold a secret.
  for (const snapshot of storage) expect(JSON.parse(snapshot).indexedDb).toEqual([]);
  for (const [kind, values] of Object.entries(issued)) expect(values.size, `${kind} values captured`).toBeGreaterThan(0);
  const secrets = [customer.password, customer.mobile, customer.email, ...Object.values(issued).flatMap((values) => [...values])];

  // The API logs each response status; finding those events proves the scan read the request log, not an empty file.
  const apiLog = readFileSync(apiLogPath, 'utf8');
  expect(apiLog).toContain('"message":"HTTP response status=');
  const surfacesByName = {
    'backend log': apiLog,
    console: surfaces.consoleText.join('\n'),
    'URLs and history': surfaces.urls.join('\n'),
    'storage and history state': storage.join('\n'),
  };
  for (const [surface, text] of Object.entries(surfacesByName)) {
    const leaked = secrets.filter((secret) => text.includes(secret)).length;
    expect(leaked, `tracked values found in the ${surface}`).toBe(0);
  }
});

test('the authenticator key, codes and backup codes stay out of storage, URLs, the console and the log', async ({ page }) => {
  const admin = syntheticCustomer();
  const surfaces = recordSurfaces(page);
  const storage: string[] = [];
  const staffDocuments: string[] = [];
  page.on('response', async (response) => {
    const { pathname } = new URL(response.url());
    if (response.request().resourceType() === 'document' && pathname.startsWith('/staff')) {
      staffDocuments.push(`${pathname} ${await response.headerValue('cache-control')}`);
    }
  });
  const snapshotStorage = async () => { storage.push(await readStorage(page)); };

  await register(page, admin);
  grantRole(admin.username, 'ADMIN');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL('/');
  await signIn(page, admin.username, admin.password);
  await expect(page).toHaveURL('/staff/mfa/enroll');
  // A full load of the setup page, so its document response is checked too.
  await page.reload();
  const key = await readManualKey(page);
  await snapshotStorage();
  const step = totpStep();
  const enrollmentCode = totpCode(key, step);
  await page.getByLabel('Enter the 6-digit code').fill(enrollmentCode);
  await page.getByRole('button', { name: 'Verify' }).click();
  const backupCodes = await readBackupCodes(page);
  await snapshotStorage();

  // Leaving and coming back never shows the codes again: the page drops them on `pagehide`, and the session is
  // verified now, so the setup page sends the visitor on to /staff.
  await page.goto('/');
  // Wait for the destination's cookie-session restore before leaving it. A document response alone
  // does not mean the React session provider has finished its refresh-cookie mutation.
  await expect(page.getByRole('link', { name: admin.username, exact: true })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL('/staff');
  await expect(page.getByRole('heading', { name: 'Staff access verified' })).toBeVisible();
  await expect(page.getByText(backupCodes[0])).toHaveCount(0);
  await expect(page.locator('details code')).toHaveCount(0);
  await snapshotStorage();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL('/sign-in');
  await signIn(page, admin.username, admin.password);
  await expect(page).toHaveURL('/staff/mfa');
  await page.reload();
  const challengeCode = totpCode(key, Math.max(step + 1, totpStep()));
  await page.getByLabel('Authenticator code').fill(challengeCode);
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('heading', { name: 'Staff access verified' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Staff access verified' })).toBeVisible();
  await snapshotStorage();

  for (const snapshot of storage) expect(JSON.parse(snapshot).indexedDb).toEqual([]);
  // The key and backup codes are distinctive enough to search for anywhere. A 6-digit code is matched only as a whole
  // token, and not in the backend log, whose timestamps and ids would give false matches.
  const distinctive = [key, ...backupCodes];
  const codes = [enrollmentCode, challengeCode].map((code) => new RegExp(`(?<![0-9A-Za-z])${code}(?![0-9A-Za-z])`));
  const surfacesByName = {
    'backend log': [readFileSync(apiLogPath, 'utf8'), false],
    console: [surfaces.consoleText.join('\n'), true],
    'URLs and history': [surfaces.urls.join('\n'), true],
    'storage and history state': [storage.join('\n'), true],
  } as const;
  for (const [surface, [text, checkCodes]] of Object.entries(surfacesByName)) {
    const leaked = distinctive.filter((secret) => text.includes(secret)).length
      + (checkCodes ? codes.filter((code) => code.test(text)).length : 0);
    expect(leaked, `MFA values found in the ${surface}`).toBe(0);
  }

  // Every staff document the browser loaded, and each staff route fetched directly, is marked no-store.
  expect(new Set(staffDocuments.map((entry) => entry.split(' ')[0]))).toEqual(new Set(['/staff', '/staff/mfa', '/staff/mfa/enroll']));
  for (const entry of staffDocuments) expect(entry).toMatch(/ no-store$/);
  for (const path of ['/staff', '/staff/mfa', '/staff/mfa/enroll']) {
    expect((await page.request.get(path)).headers()['cache-control'], path).toBe('no-store');
  }
});
