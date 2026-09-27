import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { closeSync, openSync } from 'node:fs';
import { once } from 'node:events';
import { connect } from 'node:net';
import path from 'node:path';

/** The locked test environment: the API origin the frontend is built against, and the frontend origin. */
export const apiUrl = 'http://127.0.0.1:18080';
export const frontendUrl = 'http://127.0.0.1:3100';
export const accessTokenLifetimeMs = 10_000;
/** The API's log for this run, which the privacy spec scans for secrets. */
export const apiLogPath = path.join(import.meta.dirname, '../../test-api.log');

/** Set by global setup to this run's schema (named after its role), so specs in the worker processes can reach it. */
export const testSchemaVariable = 'MEDI_WISH_TEST_SCHEMA';

const database = 'medi_wish_test';
const jarPath = path.join(import.meta.dirname, '../../../backend/target/medi-wish.jar');

/** Runs SQL as the test cluster's administrator; `PSQL`, `TEST_DB_ADMIN` and libpq's `PGPASSWORD` override defaults. */
function psql(sql: string): string {
  return execFileSync(process.env.PSQL ?? 'psql', [
    '-h', process.env.TEST_DB_HOST ?? '127.0.0.1', '-p', process.env.TEST_DB_PORT ?? '5432',
    '-U', process.env.TEST_DB_ADMIN ?? 'postgres', '-d', database, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
  ], { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'] }).trim();
}

/**
 * Grants `role` to the registered User `username` in this run's schema, as an operator would with SQL. Only for
 * synthetic Users; the names are checked before they reach the SQL.
 */
export function grantRole(username: string, role: 'ADMIN' | 'MODERATOR'): void {
  const schema = process.env[testSchemaVariable] ?? '';
  if (!/^mw_browser_[0-9a-f]{12}$/.test(schema)) throw new Error('grantRole needs the schema set by the test API setup');
  if (!/^[a-z0-9._]{3,50}$/.test(username)) throw new Error('grantRole accepts only synthetic usernames');
  const granted = psql(`INSERT INTO ${schema}.user_roles (user_id, role) SELECT id, '${role}' FROM ${schema}.users`
    + ` WHERE username = '${username}' RETURNING role;`);
  if (granted !== role) throw new Error(`No User ${username} to grant ${role} to`);
}

// Settings that could point the API at another database, profile or configuration than the ones set here.
const redirectingSetting = /^(SPRING[._]|DB_|APP_|JAVA_TOOL_OPTIONS$|JDK_JAVA_OPTIONS$|_JAVA_OPTIONS$)/i;

/** The inherited environment without any setting that could redirect the API; the run's own settings go on top. */
export function apiEnvironment(inherited: Record<string, string | undefined>): NodeJS.ProcessEnv {
  // The filter keeps NODE_ENV whenever it is inherited, as Next.js's `ProcessEnv` type expects.
  return Object.fromEntries(Object.entries(inherited).filter(([name]) => !redirectingSetting.test(name))) as NodeJS.ProcessEnv;
}

async function isListening(url: URL): Promise<boolean> {
  const socket = connect(Number(url.port), url.hostname);
  try {
    await once(socket, 'connect');
    return true;
  } catch {
    return false;
  } finally {
    socket.destroy();
  }
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
 * with random JWT and MFA secrets and a 10-second access lifetime, and returns the teardown that stops it and drops both.
 */
export default async function startTestApi(): Promise<() => Promise<void>> {
  // Otherwise another API already on the port could answer the readiness check for this run's API.
  if (await isListening(new URL(apiUrl))) throw new Error(`${apiUrl} is already in use; stop that process first`);
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
      ...apiEnvironment(process.env),
      SPRING_PROFILES_ACTIVE: 'test',
      SERVER_ADDRESS: '127.0.0.1',
      SERVER_PORT: new URL(apiUrl).port,
      DB_HOST: process.env.TEST_DB_HOST ?? '127.0.0.1',
      DB_PORT: process.env.TEST_DB_PORT ?? '5432',
      DB_NAME: database,
      DB_USERNAME: role,
      DB_PASSWORD: password,
      APP_AUTH_JWT_SECRET: randomBytes(32).toString('base64'),
      // The API refuses to start without a Base64 key of exactly 32 bytes for authenticator seeds.
      APP_AUTH_MFA_SECRET_KEY: randomBytes(32).toString('base64'),
      APP_AUTH_COOKIE_SECURE: 'false',
      APP_AUTH_ACCESS_TOKEN_LIFETIME: `PT${accessTokenLifetimeMs / 1000}S`,
      APP_CORS_ALLOWED_ORIGINS: frontendUrl,
    },
    stdio: ['ignore', log, log],
  });
  // Set after the spawn so the API never sees it; Playwright workers inherit it.
  process.env[testSchemaVariable] = role;
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
      delete process.env[testSchemaVariable];
      closeSync(log);
      dropDatabaseObjects();
    }
  };

  try {
    await waitUntilReady(() => exited);
    // Liquibase's table in this run's schema proves the ready API is ours and migrated the run's own database.
    if (psql(`SELECT to_regclass('${role}.databasechangelog') IS NOT NULL`) !== 't') {
      throw new Error("The test API did not migrate this run's schema");
    }
  } catch (reason) {
    await stop();
    throw reason;
  }
  return stop;
}
