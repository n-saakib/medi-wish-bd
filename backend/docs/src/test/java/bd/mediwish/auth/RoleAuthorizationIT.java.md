# `RoleAuthorizationIT.java`

Source: [`src/test/java/bd/mediwish/auth/RoleAuthorizationIT.java`](../../../../../../../src/test/java/bd/mediwish/auth/RoleAuthorizationIT.java)

## Purpose

Own context with `AdminOnlyProfileTestConfiguration`, which requires `ADMIN` on the profile route. An issued access token follows the User's current roles: 403 as `CUSTOMER`, 200 once promoted to `ADMIN`, 403 again once demoted. The 401 challenge for an anonymous request or invalid token is covered by `ProfileIT` on the production chain.

## Verification

1 test; no production role route is added.

Verified 2026-09-26 on `45cbc7e` plus the uncommitted T4 worktree: `./mvnw.cmd -o verify` passed 168 unit and 105 integration tests (1 expected compatibility skip); `./mvnw.cmd -o -Pcompatibility verify` passed 168 and 105 with no skip.
