# `AuthIT.java`

Source: [`src/test/java/bd/mediwish/auth/AuthIT.java`](../../../../../../src/test/java/bd/mediwish/auth/AuthIT.java)

## Purpose

Exercises the password-session contract over real HTTP, PostgreSQL 18 and actual Liquibase migrations. Each test uses unique synthetic users, marks a mobile verified only through a direct update in the run-owned schema, and lets `TestDatabase` remove that schema during teardown.

## Covered journeys

| Scenario | Contract evidence |
| --- | --- |
| Identifier login | Username, verified mobile and optional email identifiers all produce safe Bearer sessions and the same current profile projection. Basic authentication is explicitly rejected. |
| Generic failures | Wrong-password and unknown-identifier login failures use the same bounded authentication error shape without candidate disclosure. |
| Rotation and replay | CSRF-protected refresh rotates the opaque cookie. Reusing the consumed value returns a generic failure, revokes the family in PostgreSQL and invalidates the newly issued access and refresh credentials. |
| Logout | CSRF-protected logout revokes the family, clears the scoped HttpOnly cookie, invalidates the old access and refresh credentials, and remains safe to repeat. |

## Test harness and privacy boundary

The suite uses Java `HttpClient`, the bounded CSRF bootstrap body, explicit `Cookie`/`X-XSRF-TOKEN`/`Origin` headers and response-cookie parsing. It asserts key sets, bounded body sizes, safe profile fields, status codes and cookie attributes; raw passwords, access tokens, refresh values, CSRF values and personal fixture values are not emitted as diagnostics.

## Verification

`test-compile` passes with the repository-local Maven cache. An earlier real startup was blocked by a `CHAR(64)` migration versus `VARCHAR(64)` JPA mapping mismatch; the migration owner corrected that schema type, and the constructor wiring fix plus raw double-submit CSRF boundary now allow the app to run. The current fresh-schema AuthIT/UserIT rerun passed all 5 tests. The exact offline `verify` command was also attempted from this tree, but the local cache lacks `maven-jar-plugin:3.5.1`, so Maven stops before test execution while offline plugin resolution is unavailable.
