# `tests/browser/apiSession.ts`

Source: [`../../../tests/browser/apiSession.ts`](../../../tests/browser/apiSession.ts)

## Purpose

A test-only API client for the Ticket 08 specs; this file is not a spec. It calls the test API directly, as a script or `curl` would, so the specs can check the role routes' HTTP contract and act as a second person while a browser page stays open.

## `ApiSession`

One signed-in User with their own cookie jar (the `MW_REFRESH` cookie) and the latest access token.

- `ApiSession.signIn(user)` signs in through `POST /api/auth/login` (expects `200`) and records the token and its `mfa` status.
- `refresh()` reads `GET /api/auth/csrf` and posts `/api/auth/refresh` with `X-XSRF-TOKEN`, as the browser does. A `200` replaces the token; the response is returned for the caller to check.
- `call(method, path, { data, headers, token })` sends one request with `Authorization: Bearer`. It refreshes first when the token is within 4 seconds of the test API's 10-second lifetime, unless `token` is given: a specific token is sent as it is, and `null` sends no `Authorization` header.
- `enroll()` sets up an authenticator for an `ENROLLMENT_REQUIRED` session through `/api/auth/mfa/enrollment` and `/verify`; the session becomes `VERIFIED` and the returned `Authenticator` records the accepted step.
- `verify(authenticator)` enters a [`freshCode`](support.ts.md) for a `VERIFICATION_REQUIRED` session.
- `tokenAgeMs()` and `dispose()`.

## Actors and role-API wrappers

- `ApiActor` is `{ user, session, authenticator? }`.
- `apiCustomer(request, username?)`, `apiStaff(request, role)` and `apiSuperAdmin(request)` register a synthetic User, replace their role (with [`grantRole`](testApi.ts.md) or [`makeSuperAdmin`](testApi.ts.md)) and sign in; ADMIN and MODERATOR enroll, so the session is `VERIFIED`, while DELIVERY_PERSON keeps `NOT_REQUIRED`.
- `signInAgain(actor)` replaces the actor's session with a new password sign-in and returns its MFA status.
- `listUsers`, `getUserRoles` and `putRole` send the three role routes of the Ticket 08 plan §4.2 and return the raw response. `listUsers` is the search, `POST /api/admin/users/search` with the filter (`username`, `role`, `page`, `size`) as the JSON body, so a username never travels in a URL; the filter is loosely typed so tests can send invalid values. `putRole` sends `{ role, rolesVersion }`, with `role` as any string. `findUser`, `readUserRoles` and `changeRole` expect `200` and return the parsed body; `readUserRoles` also expects `Cache-Control: no-store`.
- `roleOrder` lists the four roles lowest first (`CUSTOMER`, `DELIVERY_PERSON`, `MODERATOR`, `ADMIN`); a User holds exactly one (DECISIONS S6). `Role` is one of them and `StaffRole` any but `CUSTOMER`.
- The types `UserSummary` (with the single `role`), `UserRoles` (with `assignableRoles` and `roleChanges` of `{ occurredAt, actorUsername, oldRole, newRole }`, where `actorUsername` is `null` when the actor no longer exists) and `UserPage`, and the exact field lists `userSummaryFields`, `userRolesFields` and `roleChangeFields`, mirror the plan's response bodies; an extra field (such as a mobile or email) fails the specs.

## Assertions

- `expectError(response, status, code)` checks the bounded envelope: exactly `code`, `message` and `requestId`; the backend's message for the code (`errorMessages`, including `STALE_UPDATE` and `ROLE_CHANGE_REFUSED`); `requestId` equal to `X-Request-ID`; and `Cache-Control: no-store`.
- `expectRevoked(session, rejectedRefresh?)` proves revocation, not expiry: the current token is younger than the lifetime minus one second, `/api/user/me` with it answers `401 AUTHENTICATION_REQUIRED`, and a refresh with the session's cookie answers `401`. Callers refresh the target just before the change, so the token is fresh. When a racing refresh already returned 401, the optional response must carry the exact bounded error and clear its cookie; the subsequent cookie-less refresh must return 204. A successful racing refresh still leaves its new cookie to be rejected with 401.
- `expectActive(session)` expects `/api/user/me` to answer `200`.

Credentials, codes and tokens are held in memory only; nothing is logged, and assertion messages name the step, not the value.

## SQL helpers for Ticket 08's tables

They read or probe what Ticket 08 adds, so they live here rather than in the shared `testApi.ts`; each calls `checkedTarget` first and accepts only synthetic usernames and role-shaped values.

- `roleChangeRows(username)` returns the `user_role_changes` rows whose target is that User, oldest first, as `{ oldRole, newRole, actor, requestId }`: `actor` is the actor's username, and `actor` or `requestId` is `null` when the column is empty.
- `storedRoles(username)` returns the User's `user_roles` rows, sorted: exactly one once Ticket 08's constraint holds.
- `tryAddSecondRole(username, role)` and `tryAuditRow(username, oldRole, newRole)` run one `INSERT` through `rolledBackSql`, so nothing is kept, and return PostgreSQL's error text (empty when the row was accepted). They prove the one-role key and the audit `CHECK` constraints.
- `tryUserWithoutRole(username)`, `tryDeleteOnlyRole(username)`, `tryRoleDeletedThenIdChanged(username)` and `tryReplaceRole(username, role)` probe the deferred "every User has a role" constraint triggers, also inside `rolledBackSql`. Each ends with `SET CONSTRAINTS ALL IMMEDIATE`, which runs the deferred checks as a commit would (a rolled-back transaction never reaches them otherwise). The first inserts a copy of the User (new id, username and mobile, no email) with no role; the second deletes the User's only role; the third inserts such a copy with a CUSTOMER role (so no session pins its id), deletes the role and then changes the copy's `users.id`, which only a check on `id` updates catches; the fourth deletes the role and inserts `role` in the same transaction, which must be accepted. `roleRequiredError` (`user_role_required`) is the text the database raises.
- `clearRoleChangeActors(username)` sets `actor_user_id` to `NULL` on the audit rows whose target is that User, as `ON DELETE SET NULL` does when the actor's User row is deleted. Unlike the probes it is kept, so a spec uses it only on its own synthetic target.
