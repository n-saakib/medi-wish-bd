import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, rmSync } from 'node:fs';
import { once } from 'node:events';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** The locked test environment: the API origin the frontend is built against, and the frontend origin. */
export const apiUrl = 'http://127.0.0.1:18115';
export const frontendUrl = 'http://127.0.0.1:3115';
export const accessTokenLifetimeMs = 10_000;
/** The API's log for this run, which the privacy spec scans for secrets. */
export const apiLogPath = path.join(import.meta.dirname, '../../test-api.log');

/** Set by global setup to this run's schema (named after its role), so specs in the worker processes can reach it. */
export const testSchemaVariable = 'MEDI_WISH_TEST_SCHEMA';
/** The run-owned namespace directory exposed only to Playwright workers, never to the API. */
export const testStorageVariable = 'MEDI_WISH_TEST_STORAGE_DIR';
/**
 * The run-owned mail capture directory, exposed only to Playwright workers, never to the API. The API writes each
 * message it would send there (Ticket 05 plan O4), so the recovery specs can read verification and reset codes.
 */
export const testMailVariable = 'MEDI_WISH_TEST_MAIL_DIR';

const database = 'medi_wish_test';
const jarPath = path.join(import.meta.dirname, '../../../backend/target/medi-wish.jar');

/** Refuse an unset/default or remote cluster before any administrator SQL or setup allocation. */
function testDatabaseTarget(): { host: string; port: string } {
  const host = process.env.TEST_DB_HOST ?? '';
  const port = process.env.TEST_DB_PORT ?? '';
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) || !['55432', '55433'].includes(port)) {
    throw new Error('Browser tests require explicit loopback TEST_DB_HOST and TEST_DB_PORT 55432 or 55433');
  }
  return { host, port };
}

/** The `psql` command line for the test cluster's administrator on `medi_wish_test`. */
function psqlArguments(): string[] {
  const { host, port } = testDatabaseTarget();
  return [
    '-h', host, '-p', port,
    '-U', process.env.TEST_DB_ADMIN ?? 'postgres', '-d', database, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
  ];
}

/** Keep libpq from replacing the guarded command-line host with an inherited hostaddr or service entry. */
function psqlEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env)
    .filter(([name]) => !/^(PGHOSTADDR|PGSERVICE)$/i.test(name))) as NodeJS.ProcessEnv;
}

/**
 * Runs SQL as the test cluster's administrator; `PSQL`, `TEST_DB_ADMIN` and libpq's `PGPASSWORD` override defaults.
 * Exported for the SQL helpers in a ticket's own support file; those call `checkedTarget` before building any SQL.
 */
export function psql(sql: string): string {
  return execFileSync(process.env.PSQL ?? 'psql', psqlArguments(),
    { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'], env: psqlEnvironment() }).trim();
}

/** A staff role an operator can give a User (replacing their role) or take back with SQL in the browser tests. */
export type GrantableRole = 'ADMIN' | 'MODERATOR' | 'DELIVERY_PERSON';

/**
 * This run's schema, checked before it reaches SQL, after checking `username` (when given) is synthetic; `helper`
 * names the caller in errors. Every SQL helper, here or in a ticket's support file, calls it first.
 */
export function checkedTarget(helper: string, username?: string): string {
  const schema = process.env[testSchemaVariable] ?? '';
  if (!/^mw_browser_[0-9a-f]{12}$/.test(schema)) throw new Error(`${helper} needs the schema set by the test API setup`);
  if (username !== undefined && !/^[a-z0-9._]{3,50}$/.test(username)) {
    throw new Error(`${helper} accepts only synthetic usernames`);
  }
  return schema;
}

/**
 * SQL that makes `role` the only role of the User `username`: a User holds exactly one role (Ticket 08). It works
 * before and after Ticket 08's one-role constraints, because it deletes the old role before inserting the new one.
 * Callers wrap it in `BEGIN; … COMMIT;`: psql reads it from standard input and would otherwise commit the DELETE
 * alone, which Ticket 08's deferred "every User has a role" check rejects.
 */
function replaceRoleSql(schema: string, username: string, role: string): string {
  return `DELETE FROM ${schema}.user_roles WHERE user_id = (SELECT id FROM ${schema}.users`
    + ` WHERE username = '${username}'); INSERT INTO ${schema}.user_roles (user_id, role)`
    + ` SELECT id, '${role}' FROM ${schema}.users WHERE username = '${username}'`;
}

/**
 * Makes `role` the only role of the registered User `username` in this run's schema, as an operator would with SQL;
 * it replaces the User's previous role (normally `CUSTOMER`). Only for synthetic Users; the names are checked before
 * they reach the SQL.
 */
export function grantRole(username: string, role: GrantableRole): void {
  const schema = checkedTarget('grantRole', username);
  const granted = psql(`BEGIN; ${replaceRoleSql(schema, username, role)} RETURNING role; COMMIT;`);
  if (granted !== role) throw new Error(`No User ${username} to grant ${role} to`);
}

/**
 * Replaces the staff role `role` of the registered User `username` with `CUSTOMER` in this run's schema, as an
 * operator would with SQL. The User's sessions stay active, so the next request shows whether the API re-reads the role.
 */
export function removeRole(username: string, role: GrantableRole): void {
  const schema = checkedTarget('removeRole', username);
  const removed = psql(`UPDATE ${schema}.user_roles SET role = 'CUSTOMER' WHERE role = '${role}' AND user_id =`
    + ` (SELECT id FROM ${schema}.users WHERE username = '${username}') RETURNING role;`);
  if (removed !== 'CUSTOMER') throw new Error(`User ${username} does not hold ${role}`);
}

/**
 * Makes the registered User `username` the run's Super Admin, as the offline operator procedure would: makes ADMIN the
 * User's only role and points the singleton `staff_bootstrap` row at them. The browser run shares one schema in which earlier specs already
 * granted ADMIN, so the real first-Admin provisioning command would refuse (`ADMIN_EXISTS`); the backend ITs cover that
 * command. Each call moves the Super Admin to `username`, so a spec that needs one makes its own.
 */
export function makeSuperAdmin(username: string): void {
  const schema = checkedTarget('makeSuperAdmin', username);
  const moved = psql(`BEGIN; ${replaceRoleSql(schema, username, 'ADMIN')};`
    + ` INSERT INTO ${schema}.staff_bootstrap (id, super_admin_user_id, provisioned_at) SELECT 1, id, now()`
    + ` FROM ${schema}.users WHERE username = '${username}' ON CONFLICT (id) DO UPDATE`
    + ' SET super_admin_user_id = EXCLUDED.super_admin_user_id RETURNING super_admin_user_id IS NOT NULL; COMMIT;');
  if (moved !== 't') throw new Error(`No User ${username} to make Super Admin`);
}

/** The `revoked_reason` of each session of `username`, oldest first, with `active` for a session not revoked. */
export function sessionStates(username: string): string[] {
  const schema = checkedTarget('sessionStates', username);
  const lines = psql(`SELECT coalesce(s.revoked_reason, 'active') FROM ${schema}.user_sessions s`
    + ` JOIN ${schema}.users u ON u.id = s.user_id WHERE u.username = '${username}' ORDER BY s.created_at;`);
  return lines === '' ? [] : lines.split(/\r?\n/);
}

/**
 * The seeded verified-contact fixture (TESTING.md): marks a User's current mobile verified. Before Ticket 61 no route
 * verifies a mobile, so this is the only way a test gets a User who can sign in with their mobile.
 */
export function markMobileVerified(username: string): void {
  const schema = checkedTarget('markMobileVerified', username);
  const set = psql(`UPDATE ${schema}.users SET mobile_verified = true WHERE username = '${username}'`
    + ' RETURNING mobile_verified;');
  if (set !== 't') throw new Error(`No User ${username} to verify`);
}

/**
 * The row count and content hash of every table in this run's schema except `excluded`, keyed by table name. Equal
 * fingerprints before and after a call prove that the call rewrote none of those tables.
 */
export function tableFingerprints(excluded: readonly string[]): Record<string, string> {
  const schema = checkedTarget('tableFingerprints');
  const tables = psql(`SELECT table_name FROM information_schema.tables WHERE table_schema = '${schema}'`
    + " AND table_type = 'BASE TABLE' ORDER BY table_name;").split(/\r?\n/)
    .filter((name) => name !== '' && !excluded.includes(name));
  if (tables.length === 0) throw new Error('No tables to fingerprint');
  if (!tables.every((table) => /^[a-z_][a-z0-9_]*$/.test(table))) throw new Error('Unexpected table name');
  const counts = tables.map((table) => `SELECT '${table}' AS t, (SELECT count(*) || ':'`
    + ` || coalesce(md5(string_agg(x::text, '|' ORDER BY x::text)), '') FROM ${schema}.${table} x) AS v`);
  return JSON.parse(psql(`SELECT json_object_agg(t, v) FROM (${counts.join(' UNION ALL ')}) fingerprints;`)) as
    Record<string, string>;
}

/** What `rolledBackSql` printed, and the error text when PostgreSQL refused a statement (empty when it did not). */
export type SqlOutcome = { output: string; error: string };

/**
 * Runs test-written SQL in this run's schema inside a transaction that is always rolled back, so it can probe the
 * database's own guarantees (constraints, column types) without leaving data behind. The first refused statement
 * stops the script; its PostgreSQL error, including the constraint name, is returned instead of thrown.
 */
export function rolledBackSql(sql: string): SqlOutcome {
  const schema = checkedTarget('rolledBackSql');
  try {
    const output = execFileSync(process.env.PSQL ?? 'psql', psqlArguments(), {
      input: `BEGIN;\nSET LOCAL search_path TO ${schema};\n${sql}\nROLLBACK;\n`,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: psqlEnvironment(),
    });
    return { output: output.trim(), error: '' };
  } catch (reason) {
    const failed = reason as { stdout?: string; stderr?: string };
    const error = String(failed.stderr ?? '').trim();
    if (!error) throw reason;
    return { output: String(failed.stdout ?? '').trim(), error };
  }
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

async function waitUntilReady(exited: () => boolean, started: () => boolean): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (exited()) throw new Error(`The test API exited during startup; see ${apiLogPath}`);
    // A port may be claimed after preflight; wait for our own child to finish binding first.
    if (started()) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), Math.min(5_000, deadline - Date.now()));
      try {
        if ((await fetch(`${apiUrl}/actuator/health/readiness`, { signal: controller.signal })).ok && !exited()) return;
      } catch {
        // Not listening yet, or readiness did not send headers within this attempt's deadline.
      } finally {
        clearTimeout(timeout);
      }
    }
    const remaining = deadline - Date.now();
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(500, remaining)));
  }
  throw new Error('The test API was not ready within 120 seconds');
}

/**
 * Playwright global setup. Starts the built API jar on a run-owned PostgreSQL 18 role and schema of `medi_wish_test`,
 * with random JWT, MFA and recovery-code secrets, a run-owned mail capture directory and a 10-second access lifetime,
 * and returns the teardown that stops it, drops both and removes the run's directories.
 */
export default async function startTestApi(): Promise<() => Promise<void>> {
  const { host, port } = testDatabaseTarget();
  // Otherwise another API already on the port could answer the readiness check for this run's API.
  if (await isListening(new URL(apiUrl))) throw new Error(`${apiUrl} is already in use; stop that process first`);
  if (psql("SELECT current_setting('server_version_num')::int / 10000") !== '18') {
    throw new Error('Browser tests require PostgreSQL 18');
  }
  // The schema is named after the role, so the default `"$user"` search path puts every table in it.
  const role = `mw_browser_${randomBytes(6).toString('hex')}`;
  const password = randomBytes(24).toString('hex');
  // psql commits each stdin statement separately unless allocation has an explicit transaction.
  psql(`BEGIN; CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '${password}';`
    + ` GRANT CONNECT ON DATABASE ${database} TO ${role}; CREATE SCHEMA ${role} AUTHORIZATION ${role}; COMMIT;`);
  const dropDatabaseObjects = () => psql(
    `DROP OWNED BY ${role} CASCADE; REVOKE ALL ON DATABASE ${database} FROM ${role}; DROP ROLE ${role};`);

  const storageRoot = path.resolve(import.meta.dirname, '../../../backend/target/test-object-storage');
  const namespace = `test-browser-${role.slice('mw_browser_'.length)}`;
  const storageDirectory = path.join(storageRoot, namespace);
  // Captured mail holds live codes, so it lives under the system temp directory and never outlives the run.
  const mailDirectory = path.join(tmpdir(), `medi-wish-mail-${role.slice('mw_browser_'.length)}`);
  // Each directory is removed even when removing the other throws.
  const removeDirectories = () => {
    try {
      rmSync(storageDirectory, { recursive: true, force: true });
    } finally {
      rmSync(mailDirectory, { recursive: true, force: true });
    }
  };
  let log: number | undefined;
  let api: ReturnType<typeof spawn>;
  try {
    mkdirSync(storageDirectory, { recursive: true });
    mkdirSync(mailDirectory, { recursive: true });
    log = openSync(apiLogPath, 'w');
    api = spawn('java', ['-jar', jarPath], {
      env: {
        ...apiEnvironment(process.env),
        SPRING_PROFILES_ACTIVE: 'test',
        SERVER_ADDRESS: '127.0.0.1',
        SERVER_PORT: new URL(apiUrl).port,
        DB_HOST: host,
        DB_PORT: port,
        DB_NAME: database,
        DB_USERNAME: role,
        DB_PASSWORD: password,
        APP_AUTH_JWT_SECRET: randomBytes(32).toString('base64'),
        // The API refuses to start without a Base64 key of exactly 32 bytes for authenticator seeds.
        APP_AUTH_MFA_SECRET_KEY: randomBytes(32).toString('base64'),
        // A separate 32-byte key for email-code HMACs (Ticket 05 plan O3); never the JWT or MFA key.
        APP_AUTH_RECOVERY_CODE_KEY: randomBytes(32).toString('base64'),
        // The test profile's capture transport (plan O4): each message becomes a JSON file in the run-owned directory.
        APP_MAIL_TRANSPORT: 'directory',
        APP_MAIL_CAPTURE_DIRECTORY: mailDirectory,
        APP_AUTH_COOKIE_SECURE: 'false',
        APP_AUTH_ACCESS_TOKEN_LIFETIME: `PT${accessTokenLifetimeMs / 1000}S`,
        APP_CORS_ALLOWED_ORIGINS: frontendUrl,
        APP_STORAGE_PROVIDER: 'local',
        APP_STORAGE_LOCAL_ROOT: storageRoot,
        APP_STORAGE_NAMESPACE: namespace,
        // Ticket 09: replacement notices are recorded in memory, never sent; the API refuses it outside local/test.
        APP_NOTIFICATION_SECURITY_ADAPTER: 'capture',
      },
      stdio: ['ignore', log, log],
    });
  } catch (reason) {
    try {
      if (log !== undefined) closeSync(log);
      dropDatabaseObjects();
    } finally {
      removeDirectories();
    }
    throw reason;
  }
  // Set after the spawn so the API never sees it; Playwright workers inherit it.
  process.env[testSchemaVariable] = role;
  process.env[testStorageVariable] = storageDirectory;
  process.env[testMailVariable] = mailDirectory;
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
      delete process.env[testStorageVariable];
      delete process.env[testMailVariable];
      try {
        if (log !== undefined) closeSync(log);
        dropDatabaseObjects();
      } finally {
        removeDirectories();
      }
    }
  };

  try {
    await waitUntilReady(() => exited, () => readFileSync(apiLogPath, 'utf8').includes('Started MediWishApplication in '));
    // The owned startup log and Liquibase table jointly establish startup and migration of this run's API.
    if (psql(`SELECT to_regclass('${role}.databasechangelog') IS NOT NULL`) !== 't') {
      throw new Error("The test API did not migrate this run's schema");
    }
  } catch (reason) {
    await stop();
    throw reason;
  }
  return stop;
}
