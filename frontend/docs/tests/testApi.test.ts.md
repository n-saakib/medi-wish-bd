# `tests/testApi.test.ts`

Source: [`tests/testApi.test.ts`](../../tests/testApi.test.ts)

## Purpose

Unit coverage for the browser-test setup in [`tests/browser/testApi.ts`](browser/testApi.ts.md). It lives outside `tests/browser/` so Playwright does not collect it. `psql` and the Java process are mocked (`node:child_process`), the log file is mocked (`node:fs`), and `fetch` is stubbed; socket connection outcomes are controlled with real Socket event objects. No database, API or reserved port is needed.

## Verification

- **`apiEnvironment`:** inherited `SPRING_DATASOURCE_*`, a lower-case `spring_liquibase_url`, a dotted `spring.datasource.password`, `SPRING_APPLICATION_JSON`, `SPRING_CONFIG_ADDITIONAL_LOCATION`, `DB_*`, `APP_*` and the three JVM option variables are dropped; `PATH`, `SystemRoot` and `JAVA_HOME` are kept.
- **Occupied port:** with a controlled successful socket connection to the configured host/port, setup rejects with "already in use" and never calls `psql` or starts Java.
- **Normal start:** the API gets the run-owned `mw_browser_<12 hex>` role, `medi_wish_test` and the `test` profile; `APP_AUTH_MFA_SECRET_KEY` is 32 bytes of Base64 and differs from the JWT secret; `MEDI_WISH_TEST_SCHEMA` holds the role in the setup's environment but not the API's; the last setup query is the Liquibase check on that role's schema; the teardown drops the role and clears the variable. An inherited MFA key is replaced by a fresh one.
- **Failed start:** when the API exits during startup, or is ready but has not migrated the run's schema, setup rejects with the matching message and drops the role.
- **`grantRole`:** sends, in one `BEGIN; … COMMIT;`, a `DELETE` of the named User's `user_roles` row followed by an `INSERT … RETURNING role` of the new role (one role per User); fails when no row is returned; refuses to call `psql` without a run schema, with a non-run schema such as `public`, or with a username that could change the SQL.
- **`checkedTarget`:** returns the run schema with or without a username; refuses, naming the calling helper, a missing schema, `public`, a run-like schema with upper-case hex, and usernames with a quote, upper case or fewer than 3 characters.
- **`removeRole`, `makeSuperAdmin`, `sessionStates`, `markMobileVerified`:** each sends exactly its documented SQL (`UPDATE … SET role = 'CUSTOMER' … RETURNING role`; the role replacement plus the `staff_bootstrap` upsert in one transaction; the sessions' `revoked_reason` oldest first; `mobile_verified = true … RETURNING`) and fails with its message when the expected value is not returned; `sessionStates` splits CRLF or LF lines and returns `[]` for no sessions.
- **`tableFingerprints`:** lists the schema's base tables, leaves out the excluded ones and sends one `json_object_agg` query with a count-and-`md5` select per table; fails with no table left, and refuses a table name that could change the SQL before sending the second query.
- **`rolledBackSql`:** wraps the SQL in `BEGIN; SET LOCAL search_path TO <run schema>; … ROLLBACK;` and returns trimmed output; returns PostgreSQL's error text and earlier output instead of throwing; rethrows a failure with no error text (for example a missing `psql`).
- **Guards:** every helper above refuses an unsafe username or a missing run schema without calling `psql`.
