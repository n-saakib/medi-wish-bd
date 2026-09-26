import { expect, request, test } from '@playwright/test';
import { register, syntheticCustomer, unauthorizedLine, watchPage } from './support';
import { accessTokenLifetimeMs, apiUrl } from './testApi';

const restored = ['200 GET /api/auth/csrf', '200 POST /api/auth/refresh'];
const signedOutLoad = ['200 GET /api/auth/csrf', '204 POST /api/auth/refresh'];

test('a Customer registers, keeps, renews, ends and restarts a password session', async ({ page, context }) => {
  const customer = syntheticCustomer();
  const watch = watchPage(page);
  const header = page.getByRole('navigation', { name: 'Account' });

  await test.step('the console listener catches a 401 line (positive control)', async () => {
    await page.goto('/');
    await expect(header.getByRole('link', { name: 'Sign in' })).toBeVisible();
    await page.evaluate((url) => fetch(url).then(() => undefined), `${apiUrl}/api/user/me`);
    await watch.expectSeen({
      consoleErrors: [unauthorizedLine('/api/user/me')],
      responses: [...signedOutLoad, '401 GET /api/user/me'],
    });
  });

  await test.step('1–2. registration signs in and /account shows the profile from /api/user/me', async () => {
    await register(page, customer);
    await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible();
    for (const value of [customer.username, customer.mobile, customer.email]) {
      await expect(page.getByText(value, { exact: true }).last()).toBeVisible();
    }
    await watch.expectSeen({
      consoleErrors: [],
      responses: [...signedOutLoad, '201 POST /api/auth/register', '200 POST /api/auth/login', '200 GET /api/user/me'],
    });
  });

  await test.step('3. a reload restores the session', async () => {
    await page.reload();
    await expect(page.getByText(customer.mobile, { exact: true })).toBeVisible();
    await watch.expectSeen({ consoleErrors: [], responses: [...restored, '200 GET /api/user/me'] });
  });

  await test.step('4. after the access token expires, /account refreshes once and retries once', async () => {
    await page.getByRole('link', { name: 'Medi Wish' }).click();
    await expect(page).toHaveURL('/');
    await page.waitForTimeout(accessTokenLifetimeMs + 2_000);
    await header.getByRole('link', { name: customer.username }).click();
    await expect(page.getByText(customer.mobile, { exact: true })).toBeVisible();
    await watch.expectSeen({
      consoleErrors: [unauthorizedLine('/api/user/me')],
      responses: ['401 GET /api/user/me', ...restored, '200 GET /api/user/me'],
    });
  });

  await test.step('5. signing out is announced on home', async () => {
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('status').filter({ hasText: 'You have been signed out.' })).toBeFocused();
    await watch.expectSeen({ consoleErrors: [], responses: ['200 GET /api/auth/csrf', '204 POST /api/auth/logout'] });
  });

  await test.step('6. a signed-out reload is quiet', async () => {
    await page.reload();
    await expect(header.getByRole('link', { name: 'Sign in' })).toBeVisible();
    await watch.expectSeen({ consoleErrors: [], responses: signedOutLoad });
  });

  await test.step('7. a wrong password shows the generic alert and focuses the identifier', async () => {
    await header.getByRole('link', { name: 'Sign in' }).click();
    await page.getByLabel('Mobile, email or username').fill(customer.username);
    await page.getByLabel('Password').fill(`${customer.password}-wrong`);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Those details don’t match an account.' })).toBeVisible();
    await expect(page.getByLabel('Mobile, email or username')).toBeFocused();
    await watch.expectSeen({
      consoleErrors: [unauthorizedLine('/api/auth/login')],
      responses: ['401 POST /api/auth/login'],
    });
  });

  await test.step('8. a correct password opens /account', async () => {
    await page.getByLabel('Password').fill(customer.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL('/account');
    await expect(page.getByText(customer.mobile, { exact: true })).toBeVisible();
    await watch.expectSeen({ consoleErrors: [], responses: ['200 POST /api/auth/login', '200 GET /api/user/me'] });
  });

  await test.step('9. a refresh cookie replayed elsewhere expires the session once', async () => {
    // Another client rotates the browser's cookie, so the browser's next refresh presents a consumed token.
    const other = await request.newContext({
      baseURL: apiUrl,
      storageState: { cookies: (await context.cookies(`${apiUrl}/api/auth/refresh`)).filter(({ name }) => name === 'MW_REFRESH'), origins: [] },
    });
    const { csrfToken } = await (await other.get('/api/auth/csrf')).json() as { csrfToken: string };
    expect((await other.post('/api/auth/refresh', { headers: { 'X-XSRF-TOKEN': csrfToken } })).status()).toBe(200);
    await other.dispose();

    await page.goto('/sign-in');
    await expect(page.getByRole('status').filter({ hasText: 'Your session has expired. Please sign in again.' }))
      .toBeFocused();
    await watch.expectSeen({
      consoleErrors: [unauthorizedLine('/api/auth/refresh')],
      responses: ['200 GET /api/auth/csrf', '401 POST /api/auth/refresh'],
    });

    await page.reload();
    await watch.expectSeen({ consoleErrors: [], responses: signedOutLoad });
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByText('Your session has expired.')).toHaveCount(0);
  });

  await test.step('10. guests are sent from /account to sign-in', async () => {
    await page.goto('/account');
    await expect(page).toHaveURL('/sign-in');
    await watch.expectSeen({ consoleErrors: [], responses: signedOutLoad });
  });
});
