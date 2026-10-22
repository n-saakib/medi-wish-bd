import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { connect } from 'node:net';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './catalogSupport';
import { copyPattern, storefront, storefrontCopy, unknownId } from './storefrontSupport';

/**
 * Ticket 17 T6 API outage (plan T6, E3, V-5, V-9): a second `next start` from the same production build, pointed at a
 * closed API port, must answer the catalog pages with a 5xx error page (never not-found, never an empty state) and keep
 * the home page working without the category bar or the Categories section. Needs the `.next` build the main
 * webServer made; uses port 3116. A final case restarts that owned server against an ephemeral loopback API adapter
 * returning correlated NOT_FOUND, proving the category collection cannot become a successful empty directory.
 */
const t6 = { tag: ['@t17', '@t17-T6', '@t17-ui', '@regression'] };
const outagePort = 3116;
const outageOrigin = `http://127.0.0.1:${outagePort}`;
const frontendDirectory = path.join(import.meta.dirname, '../..');

test.describe.configure({ mode: 'serial' });

let server: ChildProcess | undefined;
let serverOutput = '';
let apiAdapter: Server | undefined;

/** Whether something accepts TCP connections on 127.0.0.1:`port`. */
function listening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.setTimeout(2_000);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
    socket.once('error', () => { socket.destroy(); resolve(false); });
  });
}

/** Whether the outage server answers HTTP at all yet. */
async function answers(): Promise<boolean> {
  try {
    await fetch(`${outageOrigin}/`, { redirect: 'manual', signal: AbortSignal.timeout(5_000) });
    return true;
  } catch {
    return false;
  }
}

async function startServer(apiOrigin = 'http://127.0.0.1:9') {
  if (await listening(outagePort)) {
    throw new Error(`Port ${outagePort} is already in use; another storefront outage run or process holds it`);
  }
  serverOutput = '';
  const child = spawn(process.execPath,
    ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(outagePort)], {
      cwd: frontendDirectory,
      env: { ...process.env, MEDI_WISH_SERVER_API_URL: apiOrigin, MEDI_WISH_SITE_URL: outageOrigin },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
  server = child;
  const collect = (chunk: Buffer) => { serverOutput = (serverOutput + chunk.toString('utf8')).slice(-8_192); };
  child.stdout?.on('data', collect);
  child.stderr?.on('data', collect);
  const exited = once(child, 'exit').then(([code]) => {
    throw new Error(`The outage server exited early (code ${String(code)}): ${serverOutput}`);
  });
  exited.catch(() => undefined);
  await Promise.race([
    expect.poll(answers, { message: `the outage server answers on ${outageOrigin}`, timeout: 60_000,
      intervals: [250, 500, 1_000] }).toBe(true),
    exited,
  ]);
}

async function stopServer() {
  const child = server;
  server = undefined;
  if (child?.pid !== undefined && child.exitCode === null && child.signalCode === null) {
    const stopped = once(child, 'exit');
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      process.kill(child.pid, 'SIGTERM');
    }
    await stopped;
  }
  await expect.poll(() => listening(outagePort), { message: `port ${outagePort} is free again`, timeout: 15_000 })
    .toBe(false);
}

test.beforeAll(async () => {
  test.setTimeout(90_000);
  await startServer();
});

test.afterAll(async () => {
  test.setTimeout(30_000);
  try {
    await stopServer();
  } finally {
    const adapter = apiAdapter;
    if (adapter) {
      await new Promise<void>((resolve, reject) => adapter.close((error) => error ? reject(error) : resolve()));
      apiAdapter = undefined;
    }
  }
});

/** Opens `pathname` on the outage server and returns the document status. */
async function openOutage(page: Page, pathname: string): Promise<number> {
  const response = await page.goto(`${outageOrigin}${pathname}`);
  expect(response, `a response for ${pathname}`).not.toBeNull();
  return response!.status();
}

for (const [label, pathname] of [
  ['/categories', () => '/categories'],
  ['a category page', () => `/categories/${unknownId()}`],
  ['a details page', () => `/products/${unknownId()}`],
] as const) {
  test(`E2E-17-21 ${label} answers 5xx with the error page while the API is down`, t6, async ({ page }) => {
    const view = storefront(page);
    expect(await openOutage(page, pathname()), 'an outage is a server error').toBeGreaterThanOrEqual(500);
    await expect(view.errorTitle).toBeVisible();
    await expect(view.main.getByText(copyPattern(storefrontCopy.errorText))).toBeVisible();
    await expect(view.tryAgain).toBeVisible();
    await expect(view.notFoundTitle).toHaveCount(0);
    await expect(view.emptyTitle).toHaveCount(0);
    await expect(view.main.getByText(storefrontCopy.noCategories, { exact: true })).toHaveCount(0);
    await expect(view.main).not.toContainText(/digest|ECONNREFUSED|fetch failed|127\.0\.0\.1:9/);
  });
}

test('E2E-17-21 the home page still answers 200 without the category bar or the Categories section', t6,
  async ({ page }) => {
    const view = storefront(page);
    expect(await openOutage(page, '/')).toBe(200);
    await expect(view.main).toBeVisible();
    await expect(view.categoryNav).toHaveCount(0);
    await expect(view.homeCategories).toHaveCount(0);
    await expect(view.errorTitle).toHaveCount(0);
  });

test('E2E-17-21 /categories answers 5xx when the API returns correlated NOT_FOUND', t6, async ({ page }) => {
  test.setTimeout(90_000);
  await stopServer();
  const requestId = '17000000-0000-4000-8000-000000000021';
  let categoryRequests = 0;
  apiAdapter = createServer((request, response) => {
    if (request.url === '/api/categories') categoryRequests += 1;
    response.writeHead(404, { 'Content-Type': 'application/json', 'X-Request-ID': requestId });
    response.end(JSON.stringify({ code: 'NOT_FOUND', message: 'The requested resource was not found.', requestId }));
  });
  apiAdapter.listen(0, '127.0.0.1');
  await once(apiAdapter, 'listening');
  const address = apiAdapter.address();
  if (!address || typeof address === 'string') throw new Error('The catalog API adapter did not bind a TCP port');
  await startServer(`http://127.0.0.1:${address.port}`);
  categoryRequests = 0;
  const view = storefront(page);
  expect(await openOutage(page, '/categories'), 'an absent category collection is a server error')
    .toBeGreaterThanOrEqual(500);
  expect(categoryRequests, 'the production page reached the controlled category API').toBeGreaterThan(0);
  await expect(view.errorTitle).toBeVisible();
  await expect(view.main.getByText(copyPattern(storefrontCopy.errorText))).toBeVisible();
  await expect(view.tryAgain).toBeVisible();
  await expect(view.notFoundTitle).toHaveCount(0);
  await expect(view.emptyTitle).toHaveCount(0);
  await expect(view.main.getByText(storefrontCopy.noCategories, { exact: true })).toHaveCount(0);
  await expect(view.main).not.toContainText(/digest|NOT_FOUND|Public category list|17000000-0000-4000-8000-000000000021/);
});
