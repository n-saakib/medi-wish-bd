# `tests/browser/testApi.ts`

Source: [`../../../tests/browser/testApi.ts`](../../../tests/browser/testApi.ts)

## Purpose

This is the Playwright global setup, and the documented way to start the test API in the locked test environment. It also exports `apiEnvironment`, the shared SQL helpers below, `testSchemaVariable` and the shared constants: `apiUrl` (`http://127.0.0.1:18080`), `frontendUrl` (`http://127.0.0.1:3100`), `accessTokenLifetimeMs` (10 000) and `apiLogPath` (`frontend/test-api.log`).

## Behavior

1. It refuses to start if anything already listens on `127.0.0.1:18080`, before touching the database, because that process could answer the readiness check for this run's API. Through `psql` as the cluster administrator on `medi_wish_test`, it then refuses any server other than PostgreSQL 18.
2. It creates a run-owned role `mw_browser_<12 hex>` with a random password and no `SUPERUSER`, `CREATEDB` or `CREATEROLE`. It grants `CONNECT` and creates the schema of the same name owned by that role. The default `"$user"` search path then puts every Liquibase and Hibernate table in that schema.
3. It starts `../backend/target/medi-wish.jar` with the inherited environment filtered by `apiEnvironment`. That drops every `SPRING_*` (or `spring.*`), `DB_*` and `APP_*` variable and `JAVA_TOOL_OPTIONS`, `JDK_JAVA_OPTIONS` and `_JAVA_OPTIONS`, ignoring case, so no inherited datasource, Liquibase, profile or configuration override can redirect the API. On top it sets:
   - the `test` profile, on `127.0.0.1:18080`;
   - that role's credentials;
   - a random 32-byte JWT secret;
   - a separate random 32-byte `APP_AUTH_MFA_SECRET_KEY` (Base64), set after the `APP_*` filtering so an inherited key never reaches the API; the API refuses to start without one;
   - non-Secure cookies, which the `test` profile allows;
   - `APP_AUTH_ACCESS_TOKEN_LIFETIME=PT10S`;
   - CORS allowed only for `http://127.0.0.1:3100`.

   It writes the API's ECS log to `test-api.log` (ignored by the frontend `/*.log` rule), then waits up to 120 seconds for `/actuator/health/readiness`. It then requires Liquibase's `databasechangelog` table in the run's own schema, which proves that the ready API is the one it started and that it migrated the run's database. A failed startup or check, including a missing jar, stops the API and drops the role before rethrowing.
4. After starting the API it sets `MEDI_WISH_TEST_SCHEMA` (`testSchemaVariable`) in its own environment to the run's schema; Playwright workers inherit it, the API does not.
5. The returned teardown clears that variable, stops the API, then drops the role, its schema and its grant (`DROP OWNED BY … CASCADE`, `REVOKE ALL ON DATABASE …`, `DROP ROLE …`).

The SQL, including the password, reaches `psql` on standard input, not on its command line.

## `grantRole(username, role)`

Makes `ADMIN`, `MODERATOR` or `DELIVERY_PERSON` (`GrantableRole`) the only role of a registered User, replacing the previous one (a User holds exactly one role), by deleting and re-inserting the User's `<schema>.user_roles` row as the cluster administrator, the way an operator would. Deleting first lets it work both before and after Ticket 08's one-role constraints; both statements run in one `BEGIN; … COMMIT;` transaction, because psql commits each statement read from standard input on its own and Ticket 08's deferred check rejects a User left with no role. It needs the schema from `MEDI_WISH_TEST_SCHEMA` and accepts only `mw_browser_<12 hex>` schemas and synthetic usernames (`[a-z0-9._]{3,50}`), checked before they reach the SQL. It throws if no User has that username. The granted role applies from the User's next sign-in; a role granted this way does not make the User Super Admin.

## Shared SQL helpers

These helpers are shared by Tickets 08, 11 and 14, and the file is kept byte-identical on their branches so that their merges do not conflict. They touch only tables that already exist on `dev`. A helper that reads a table a ticket adds lives in that ticket's own support file (for example `roleChangeRows` in `apiSession.ts`, `storedProfile` and `setAccountState` in `profileSupport.ts`), and it uses `psql` and `checkedTarget` from here.

- **`psql(sql)`** runs SQL as the cluster administrator on `medi_wish_test` and returns the trimmed output. Build SQL only after `checkedTarget` has checked the names in it.
- **`checkedTarget(helper, username?)`** returns this run's schema after checking it is `mw_browser_<12 hex>`, and that `username` (when given) is synthetic (`[a-z0-9._]{3,50}`). `helper` names the caller in the error, so `grantRole`'s messages are unchanged.
- **`removeRole(username, role)`** replaces the staff role `role` with `CUSTOMER` in `<schema>.user_roles` and throws if the User does not hold it. Sessions stay active, so the next API call shows whether the role is re-read on every request.
- **`makeSuperAdmin(username)`** makes ADMIN the User's only role and points the singleton `staff_bootstrap` row at the User, creating the row if needed, in one transaction. The browser run shares one schema in which earlier specs already granted ADMIN, so the real first-Admin provisioning command would refuse; the backend integration tests cover that command. Each call moves the Super Admin, so a spec that needs one makes its own.
- **`sessionStates(username)`** returns each of the User's sessions, oldest first, as its `revoked_reason` (for example `role-changed` or `mfa-verified`), or `active` when not revoked.
- **`markMobileVerified(username)`** is the seeded verified-contact fixture (TESTING.md): it marks the current mobile verified, which no route can do before Ticket 61.
- **`tableFingerprints(excluded)`** returns the row count and content hash of every base table in the run's schema except `excluded`, keyed by table name. Equal results before and after a call prove the call rewrote none of those tables.
- **`rolledBackSql(sql)`** runs SQL inside `BEGIN; SET LOCAL search_path TO <schema>; … ROLLBACK;` and returns `{ output, error }`: `error` is `psql`'s standard error when a statement fails (for example a constraint violation) and empty otherwise. Nothing it writes survives.

Every helper throws when no User matches. Unit tests for the new helpers' guards go in `tests/testApi.test.ts` with the first ticket that merges them.

## Settings

| Variable | Default | Use |
| --- | --- | --- |
| `PSQL` | `psql` | Path to `psql` (for example `C:\Program Files\PostgreSQL\18\bin\psql.exe`). |
| `TEST_DB_HOST` / `TEST_DB_PORT` | `127.0.0.1` / `5432` | The PostgreSQL 18 test cluster. |
| `TEST_DB_ADMIN` | `postgres` | A role allowed to create roles and schemas in `medi_wish_test`; libpq's `PGPASSWORD` supplies its password when trust authentication is not used. |

## Running the other live checks

`npm run test:integration` and `npm run probe` use the same environment when this setup starts the API outside Playwright. From `frontend/`, with the settings above:

```bash
node --input-type=module -e "import { execSync } from 'node:child_process'; const { default: startTestApi, apiUrl } = await import('./tests/browser/testApi.ts'); const stop = await startTestApi(); try { execSync('npm run test:integration && npm run probe', { stdio: 'inherit', env: { ...process.env, MEDI_WISH_API_URL: apiUrl } }); } finally { await stop(); }"
```

Production defaults are unchanged: the lifetime, cookie and CORS overrides exist only in this process's environment.
