# `Ticket03RoleAuthorizationTestConfiguration.java`

Source: [`src/test/java/bd/mediwish/web/Ticket03RoleAuthorizationTestConfiguration.java`](../../../../../../src/test/java/bd/mediwish/web/Ticket03RoleAuthorizationTestConfiguration.java)

## Purpose and boundary

This test-only Spring configuration adds a higher-priority security chain for `GET /api/user/me` that requires `ROLE_ADMIN`. It wires the actual production Bearer filter and bounded `ApiErrors` handlers so `Ticket03AuthorizationIT` can distinguish anonymous/invalid identity (401) from an authenticated User lacking the required persisted role (403).

The configuration applies only when the dedicated integration-test launcher explicitly includes it. It adds no production bean, endpoint, route or authorization policy.

## Verification

Used by `Ticket03AuthorizationIT`, which passes against the guarded run-owned PostgreSQL fixture. It is not loaded by normal application startup or other integration suites.
