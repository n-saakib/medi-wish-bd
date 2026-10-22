import { defineConfig } from '@playwright/test';
import { apiUrl, frontendUrl } from './tests/browser/testApi';

/** Browser checks on the installed stable Chrome and Edge against the locked test environment. */
export default defineConfig({
  testDir: './tests/browser',
  globalSetup: './tests/browser/testApi.ts',
  workers: 1,
  forbidOnly: true,
  timeout: 120_000,
  reporter: 'list',
  use: { baseURL: frontendUrl, trace: 'off', video: 'off', screenshot: 'off' },
  projects: [
    { name: 'chrome', use: { channel: 'chrome' } },
    { name: 'msedge', use: { channel: 'msedge' } },
  ],
  webServer: {
    command: `npm run build && npm run start -- --hostname 127.0.0.1 --port ${new URL(frontendUrl).port}`,
    url: frontendUrl,
    reuseExistingServer: false,
    timeout: 300_000,
    env: {
      MEDI_WISH_SERVER_API_URL: apiUrl,
      MEDI_WISH_SITE_URL: frontendUrl,
      NEXT_PUBLIC_MEDI_WISH_API_URL: apiUrl,
    },
  },
});
