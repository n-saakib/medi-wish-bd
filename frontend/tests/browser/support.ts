import { randomBytes, randomInt } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { apiUrl } from './testApi';

export type Customer = { username: string; mobile: string; email: string; password: string };

/** A new synthetic Customer, unique to one test run. */
export function syntheticCustomer(): Customer {
  const suffix = randomBytes(4).toString('hex');
  return {
    username: `journey.${suffix}`,
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
