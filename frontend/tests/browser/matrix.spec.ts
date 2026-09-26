import { expect, test, type Page } from '@playwright/test';
import { register, syntheticCustomer } from './support';
import { apiUrl, frontendUrl } from './testApi';

const disallowedOrigin = frontendUrl.replace('127.0.0.1', 'localhost');

/**
 * Holds the next request to an API path until the returned function is called, to observe busy states; the request
 * then continues, or fails as a network error when `fail` is set.
 */
async function holdNext(page: Page, path: string): Promise<(fail?: boolean) => void> {
  let release!: (fail: boolean) => void;
  const released = new Promise<boolean>((resolve) => { release = resolve; });
  await page.route(`${apiUrl}${path}`, async (route) => {
    await (await released ? route.abort() : route.continue());
  }, { times: 1 });
  return (fail = false) => release(fail);
}

/**
 * No horizontal scroll, a label for every input, and, from a freshly loaded page, Tab visiting every visible control in
 * page order with a focus ring.
 */
async function expectAccessibleLayout(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  expect(await page.locator('input').evaluateAll((inputs) =>
    inputs.filter((input) => (input as HTMLInputElement).labels?.length === 0).length)).toBe(0);

  const controls = await page.locator('a[href], button:not([disabled]), input').evaluateAll((elements) =>
    elements.filter((element) => element.getClientRects().length > 0).map((element) => element.outerHTML));
  for (const control of controls) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => {
      const focused = document.activeElement as HTMLElement;
      const style = getComputedStyle(focused);
      return { control: focused.outerHTML, ring: style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0 };
    })).toEqual({ control, ring: true });
  }
}

for (const width of [320, 375, 768, 1280]) {
  test.describe(`${width} px`, () => {
    test.use({ viewport: { width, height: 800 } });

    test('pages keep their layout, keyboard order, labels, live regions and busy states', async ({ page }) => {
      const customer = syntheticCustomer();

      await page.goto('/');
      await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
      await expectAccessibleLayout(page);

      await page.goto('/register');
      await expect(page.getByRole('heading', { name: 'Create an account' })).toBeVisible();
      await expectAccessibleLayout(page);
      const registration = await holdNext(page, '/api/auth/register');
      const registered = register(page, customer);
      await expect(page.getByRole('button', { name: 'Creating account…' })).toBeDisabled();
      registration();
      await registered;

      const restore = await holdNext(page, '/api/auth/refresh');
      await page.reload();
      await expect(page.getByRole('status')).toHaveText('Checking your session…');
      restore();
      await expect(page.getByText(customer.mobile, { exact: true })).toBeVisible();
      await expectAccessibleLayout(page);

      const failedLogout = await holdNext(page, '/api/auth/logout');
      await page.getByRole('button', { name: 'Sign out' }).click();
      await expect(page.getByRole('button', { name: 'Signing out…' })).toBeDisabled();
      failedLogout(true);
      const signOutFailed = page.getByRole('alert').filter({ hasText: 'Sign-out could not be completed.' });
      await expect(signOutFailed).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
      const logout = await holdNext(page, '/api/auth/logout');
      await signOutFailed.getByRole('button', { name: 'Try again' }).click();
      await expect(signOutFailed.getByRole('button', { name: 'Signing out…' })).toBeDisabled();
      logout();
      await expect(page.getByRole('status')).toHaveText('You have been signed out.');

      await page.goto('/sign-in');
      await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
      await expectAccessibleLayout(page);
      await page.getByLabel('Mobile, email or username').fill(customer.username);
      await page.getByLabel('Password').fill(`${customer.password}-wrong`);
      const signIn = await holdNext(page, '/api/auth/login');
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(page.getByRole('button', { name: 'Signing in…' })).toBeDisabled();
      signIn();
      await expect(page.getByRole('alert').filter({ hasText: 'Those details don’t match an account.' })).toBeVisible();
    });
  });
}

test('the API answers an allowed preflight and rejects a disallowed origin, seen through DevTools', async ({ page, browser }) => {
  const cdp = await page.context().newCDPSession(page);
  const requests = new Map<string, { method: string; path: string; pageOrigin: string; status?: number; bytes?: number }>();
  // The page's origin, because Chromium adds the Origin header after this event.
  cdp.on('Network.requestWillBeSent', ({ requestId, request, documentURL }) => {
    if (request.url.startsWith(apiUrl)) {
      requests.set(requestId, { method: request.method, path: new URL(request.url).pathname, pageOrigin: new URL(documentURL).origin });
    }
  });
  const recordStatus = (requestId: string, status: number) => {
    const request = requests.get(requestId);
    if (request) request.status = status;
  };
  cdp.on('Network.responseReceived', ({ requestId, response }) => recordStatus(requestId, response.status));
  // The only status event for a response that CORS then blocks.
  cdp.on('Network.responseReceivedExtraInfo', ({ requestId, statusCode }) => recordStatus(requestId, statusCode));
  cdp.on('Network.loadingFinished', ({ requestId, encodedDataLength }) => {
    const request = requests.get(requestId);
    if (request) request.bytes = encodedDataLength;
  });
  await cdp.send('Network.enable');

  await register(page, syntheticCustomer());
  await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible();
  await expect.poll(() => [...requests.values()].filter(({ method }) => method === 'OPTIONS')
    .map(({ path, status }) => `${status} ${path}`)).toContain('200 /api/user/me');

  // The same frontend under a host name the API does not allow: its session check is answered with the bounded 403
  // before any handler runs. A real loopback server, because Chrome's local-network rules block a fulfilled page.
  await page.goto(disallowedOrigin);
  await expect.poll(() => [...requests.values()].some(({ pageOrigin, method, path, status }) =>
    pageOrigin === disallowedOrigin && `${status} ${method} ${path}` === '403 GET /api/auth/csrf')).toBe(true);

  console.log(JSON.stringify({
    channel: test.info().project.name,
    version: browser.version(),
    responses: [...requests.values()].map(({ method, path, status, bytes }) =>
      `${status} ${method} ${path} ${bytes === undefined ? 'size not reported' : `${bytes} B`}`),
  }));
});
