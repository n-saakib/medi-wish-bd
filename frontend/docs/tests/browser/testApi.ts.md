# `tests/browser/testApi.ts`

Source: [`../../../tests/browser/testApi.ts`](../../../tests/browser/testApi.ts)

## Purpose

This is the Playwright global setup, and the documented way to start the test API in the locked test environment. It also exports `apiEnvironment` and the shared constants: `apiUrl` (`http://127.0.0.1:18080`), `frontendUrl` (`http://127.0.0.1:3100`), `accessTokenLifetimeMs` (10 000) and `apiLogPath` (`frontend/test-api.log`).

## Behavior

1. It refuses to start if anything already listens on `127.0.0.1:18080`, before touching the database, because that process could answer the readiness check for this run's API. Through `psql` as the cluster administrator on `medi_wish_test`, it then refuses any server other than PostgreSQL 18.
2. It creates a run-owned role `mw_browser_<12 hex>` with a random password and no `SUPERUSER`, `CREATEDB` or `CREATEROLE`. It grants `CONNECT` and creates the schema of the same name owned by that role. The default `"$user"` search path then puts every Liquibase and Hibernate table in that schema.
3. It starts `../backend/target/medi-wish.jar` with the inherited environment filtered by `apiEnvironment`. That drops every `SPRING_*` (or `spring.*`), `DB_*` and `APP_*` variable and `JAVA_TOOL_OPTIONS`, `JDK_JAVA_OPTIONS` and `_JAVA_OPTIONS`, ignoring case, so no inherited datasource, Liquibase, profile or configuration override can redirect the API. On top it sets:
   - the `test` profile, on `127.0.0.1:18080`;
   - that role's credentials;
   - a random 32-byte JWT secret;
   - non-Secure cookies, which the `test` profile allows;
   - `APP_AUTH_ACCESS_TOKEN_LIFETIME=PT10S`;
   - CORS allowed only for `http://127.0.0.1:3100`.

   It writes the API's ECS log to `test-api.log` (ignored by the frontend `/*.log` rule), then waits up to 120 seconds for `/actuator/health/readiness`. It then requires Liquibase's `databasechangelog` table in the run's own schema, which proves that the ready API is the one it started and that it migrated the run's database. A failed startup or check, including a missing jar, stops the API and drops the role before rethrowing.
4. The returned teardown stops the API, then drops the role, its schema and its grant (`DROP OWNED BY … CASCADE`, `REVOKE ALL ON DATABASE …`, `DROP ROLE …`).

The SQL, including the password, reaches `psql` on standard input, not on its command line.

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
