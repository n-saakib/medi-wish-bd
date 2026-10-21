# `tests/browser/testApi.ts`

Source: [`../../../tests/browser/testApi.ts`](../../../tests/browser/testApi.ts)

## Purpose

This is the Playwright global setup, and the documented way to start the test API in the locked test environment. It also exports `apiEnvironment`, the shared SQL helpers below, `testSchemaVariable` and the shared constants: `apiUrl` (`http://127.0.0.1:18115`), `frontendUrl` (`http://127.0.0.1:3115`), `accessTokenLifetimeMs` (10 000), `testStorageVariable` (`MEDI_WISH_TEST_STORAGE_DIR`) and `apiLogPath` (`frontend/test-api.log`).

## Behavior

1. Before probing a port, sending any administrator SQL or allocating resources, it requires explicit `TEST_DB_HOST` (`127.0.0.1`, `localhost` or `::1`) and `TEST_DB_PORT` (`55432` or `55433`). Missing values, the default cluster on 5432 and remote targets are refused. Both raw `psql` and rollback probes enforce the same target guard. It refuses to start if anything already listens on `127.0.0.1:18115`, before touching the database, because that process could answer the readiness check for this run's API. Through `psql` as the cluster administrator on `medi_wish_test`, it then refuses any server other than PostgreSQL 18.
2. It creates a run-owned role `mw_browser_<12 hex>` with a random password and no `SUPERUSER`, `CREATEDB` or `CREATEROLE`. It grants `CONNECT` and creates the schema of the same name owned by that role. Role, grant and schema allocation run in one explicit `BEGIN; … COMMIT;` transaction, so a later allocation statement failure rolls back all earlier allocation without leaking a role or grant. The default `"$user"` search path then puts every Liquibase and Hibernate table in that schema.
3. It starts `../backend/target/medi-wish.jar` with the inherited environment filtered by `apiEnvironment`. That drops every `SPRING_*` (or `spring.*`), `DB_*` and `APP_*` variable and `JAVA_TOOL_OPTIONS`, `JDK_JAVA_OPTIONS` and `_JAVA_OPTIONS`, ignoring case, so no inherited datasource, Liquibase, profile or configuration override can redirect the API. On top it sets:
   - the `test` profile, on `127.0.0.1:18115`;
   - that role's credentials;
   - a random 32-byte JWT secret;
   - a separate random 32-byte `APP_AUTH_MFA_SECRET_KEY` (Base64), set after the `APP_*` filtering so an inherited key never reaches the API; the API refuses to start without one;
   - non-Secure cookies, which the `test` profile allows;
   - `APP_AUTH_ACCESS_TOKEN_LIFETIME=PT10S`;
   - `APP_NOTIFICATION_SECURITY_ADAPTER=capture` (Ticket 09): staff-MFA replacement notices are recorded in memory and never sent, so a replacement with a verified mobile reports `contactNotice` `SENT`; the API refuses this adapter outside the `local` and `test` profiles;
   - CORS allowed only for `http://127.0.0.1:3115`;
   - `APP_STORAGE_PROVIDER=local`, an absolute `backend/target/test-object-storage` root, and a unique `test-browser-<12 hex>` namespace tied to the run role. It creates only that namespace, which is available to worker-side image assertions through `MEDI_WISH_TEST_STORAGE_DIR`. Inherited storage settings are filtered out.

   It writes the API's ECS log to `test-api.log` (ignored by the frontend `/*.log` rule), then waits up to 120 seconds for `/actuator/health/readiness`. Each HTTP attempt has a timer-backed abort signal capped at five seconds or the remaining startup deadline, whichever is shorter; the timer is cleared after the attempt, and retry pauses are bounded by the remaining deadline. A listener that withholds readiness headers therefore cannot prevent startup failure and owned-resource cleanup; a child exit during a stalled attempt is noticed after that request aborts. HTTP readiness is probed only after the fresh, run-owned Java log contains `Started MediWishApplication in `; a ready response is accepted only while that child has not exited. This prevents a foreign API taking the port after preflight from satisfying startup. It then requires Liquibase's `databasechangelog` table in the run's own schema, which, together with the owned startup log and live child, confirms this run's startup and migration. A failed startup or check, including a missing jar, stops the API and drops the role before rethrowing.
4. After starting the API it sets `MEDI_WISH_TEST_SCHEMA` (`testSchemaVariable`) in its own environment to the run's schema; Playwright workers inherit it, the API does not.
5. The returned teardown clears both worker variables, stops the API, then drops the role, its schema and its grant (`DROP OWNED BY … CASCADE`, `REVOKE ALL ON DATABASE …`, `DROP ROLE …`). A `finally` removes only the run namespace, including when startup, log allocation, spawn or database teardown fails. The shared storage root and other namespaces remain intact.

The SQL, including the password, reaches `psql` on standard input, not on its command line.

## `grantRole(username, role)`

Makes `ADMIN`, `MODERATOR` or `DELIVERY_PERSON` (`GrantableRole`) the only role of a registered User, replacing the previous one (a User holds exactly one role), by deleting and re-inserting the User's `<schema>.user_roles` row as the cluster administrator, the way an operator would. Deleting first lets it work both before and after Ticket 08's one-role constraints; both statements run in one `BEGIN; … COMMIT;` transaction, because psql commits each statement read from standard input on its own and Ticket 08's deferred check rejects a User left with no role. It needs the schema from `MEDI_WISH_TEST_SCHEMA` and accepts only `mw_browser_<12 hex>` schemas and synthetic usernames (`[a-z0-9._]{3,50}`), checked before they reach the SQL. It throws if no User has that username. The granted role applies from the User's next sign-in; a role granted this way does not make the User Super Admin.

## Shared SQL helpers

These SQL helpers are shared by Tickets 08, 11 and 14 and retain their existing contracts. Ticket 15 adds storage setup and cleanup to the harness while preserving those SQL helpers' SQL contracts and adding the shared database-target safety guard. They touch only tables that already exist on `dev`. A helper that reads a table a ticket adds lives in that ticket's own support file (for example `roleChangeRows` in `apiSession.ts`, `storedProfile` and `setAccountState` in `profileSupport.ts`), and it uses `psql` and `checkedTarget` from here.

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
| `TEST_DB_HOST` / `TEST_DB_PORT` | Required; no fallback | An explicit loopback PostgreSQL 18 test cluster on `55432` or `55433`. |
| `TEST_DB_ADMIN` | `postgres` | A role allowed to create roles and schemas in `medi_wish_test`; libpq's `PGPASSWORD` supplies its password when trust authentication is not used. |

## Running the other live checks

`npm run test:integration` and `npm run probe` use the same environment when this setup starts the API outside Playwright. From `frontend/`, with the settings above:

```bash
node --input-type=module -e "import { execSync } from 'node:child_process'; const { default: startTestApi, apiUrl } = await import('./tests/browser/testApi.ts'); const stop = await startTestApi(); try { execSync('npm run test:integration && npm run probe', { stdio: 'inherit', env: { ...process.env, MEDI_WISH_API_URL: apiUrl } }); } finally { await stop(); }"
```

Production defaults are unchanged: the lifetime, cookie and CORS overrides exist only in this process's environment.

Ticket 15 verification uses frontend port3115 because concurrent Ticket12 runs occupy3100. API port18115 isolates Ticket15 from concurrent Ticket16 runs using18080. Both origins are test-only; the frontend build and matching CORS configuration use these constants, with all loopback/test-database guards retained.
