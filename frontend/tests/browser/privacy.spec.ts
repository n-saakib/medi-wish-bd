import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { register, syntheticCustomer } from './support';
import { apiLogPath, apiUrl } from './testApi';

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
