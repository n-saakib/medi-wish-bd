# `RoleAuthorizationIT.java`

Source: [`src/test/java/bd/mediwish/auth/RoleAuthorizationIT.java`](../../../../../../../src/test/java/bd/mediwish/auth/RoleAuthorizationIT.java)

## Purpose

Runs on the shared context (`AuthApi.Shared`); it no longer needs a test-only security rule, because `GET /api/staff/me` is a production role route. The fixture directly replaces the persisted role without invoking the production role command or its session revocation, isolating the per-request policy. Production role changes revoke old sessions instead. In this fixture, an issued access token follows the User's current role: as `CUSTOMER` the staff route is `403 ACCESS_DENIED`; once `ADMIN` is granted, with no authenticator, both the staff route and the profile are `403 MFA_REQUIRED`; once `ADMIN` is removed the profile is `200` again and the staff route `403 ACCESS_DENIED`. The 401 challenge for an anonymous request or invalid token is covered by `ProfileIT`.

## Verification

1 test.

Verified 2026-09-27 on the working tree over `bef3b76`: the targeted integration run passed.
