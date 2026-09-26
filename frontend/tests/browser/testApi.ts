import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { closeSync, openSync } from 'node:fs';
import { once } from 'node:events';
import path from 'node:path';

/** The locked test environment: the API origin the frontend is built against, and the frontend origin. */
export const apiUrl = 'http://127.0.0.1:18080';
export const frontendUrl = 'http://127.0.0.1:3100';
export const accessTokenLifetimeMs = 10_000;
/** The API's log for this run, which the privacy spec scans for secrets. */
export const apiLogPath = path.join(import.meta.dirname, '../../test-api.log');

const database = 'medi_wish_test';
const jarPath = path.join(import.meta.dirname, '../../../backend/target/medi-wish.jar');

/** Runs SQL as the test cluster's administrator; `PSQL`, `TEST_DB_ADMIN` and libpq's `PGPASSWORD` override defaults. */
function psql(sql: string): string {
  return execFileSync(process.env.PSQL ?? 'psql', [
    '-h', process.env.TEST_DB_HOST ?? '127.0.0.1', '-p', process.env.TEST_DB_PORT ?? '5432',
    '-U', process.env.TEST_DB_ADMIN ?? 'postgres', '-d', database, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
  ], { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'] }).trim();
}

async function waitUntilReady(exited: () => boolean): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (exited()) throw new Error(`The test API exited during startup; see ${apiLogPath}`);
    try {
      if ((await fetch(`${apiUrl}/actuator/health/readiness`)).ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('The test API was not ready within 120 seconds');
}

/**
 * Playwright global setup. Starts the built API jar on a run-owned PostgreSQL 18 role and schema of `medi_wish_test`,
 * with a random JWT secret and a 10-second access lifetime, and returns the teardown that stops it and drops both.
 */
export default async function startTestApi(): Promise<() => Promise<void>> {
  if (psql("SELECT current_setting('server_version_num')::int / 10000") !== '18') {
    throw new Error('Browser tests require PostgreSQL 18');
  }
  // The schema is named after the role, so the default `"$user"` search path puts every table in it.
  const role = `mw_browser_${randomBytes(6).toString('hex')}`;
  const password = randomBytes(24).toString('hex');
  psql(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '${password}';`
    + ` GRANT CONNECT ON DATABASE ${database} TO ${role}; CREATE SCHEMA ${role} AUTHORIZATION ${role};`);
  const dropDatabaseObjects = () => psql(
    `DROP OWNED BY ${role} CASCADE; REVOKE ALL ON DATABASE ${database} FROM ${role}; DROP ROLE ${role};`);

  const log = openSync(apiLogPath, 'w');
  const api = spawn('java', ['-jar', jarPath], {
    env: {
      ...process.env,
      SPRING_PROFILES_ACTIVE: 'test',
      SERVER_ADDRESS: '127.0.0.1',
      SERVER_PORT: new URL(apiUrl).port,
      DB_HOST: process.env.TEST_DB_HOST ?? '127.0.0.1',
      DB_PORT: process.env.TEST_DB_PORT ?? '5432',
      DB_NAME: database,
      DB_USERNAME: role,
      DB_PASSWORD: password,
      APP_AUTH_JWT_SECRET: randomBytes(32).toString('base64'),
      APP_AUTH_COOKIE_SECURE: 'false',
      APP_AUTH_ACCESS_TOKEN_LIFETIME: `PT${accessTokenLifetimeMs / 1000}S`,
      APP_CORS_ALLOWED_ORIGINS: frontendUrl,
    },
    stdio: ['ignore', log, log],
  });
  let exited = false;
  // A failed spawn (for example, no jar) emits `error` instead of `exit`; both mean the API is not running.
  const exit = once(api, 'exit').catch(() => undefined).then(() => { exited = true; });

  const stop = async () => {
    try {
      if (!exited) {
        api.kill();
        await exit;
      }
    } finally {
      closeSync(log);
      dropDatabaseObjects();
    }
  };

  try {
    await waitUntilReady(() => exited);
  } catch (reason) {
    await stop();
    throw reason;
  }
  return stop;
}
