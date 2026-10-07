# UserProfilePermissionIT.java

Source: [UserProfilePermissionIT.java](../../../../../../../src/test/java/bd/mediwish/auth/UserProfilePermissionIT.java)

## Purpose

Ticket 11 permissions are exercised over real HTTP through the application security chain on the guarded PostgreSQL schema shared by `AuthApi.Shared`.

- Each of GET/PUT `/api/user/me/profile` and POST/DELETE `/api/user/me/mobile-change` rejects missing, malformed and logged-out Bearer tokens with `401 AUTHENTICATION_REQUIRED`.
- A sole Admin and a sole Moderator each receive `403 MFA_REQUIRED` on all four routes while enrollment is required and while a fresh sign-in awaits the MFA challenge (the API calls this `VERIFICATION_REQUIRED`). Fixtures remove Customer before granting the staff role and assert exactly one persisted role.
- Each sole Customer, Delivery Person, MFA-verified Admin and MFA-verified Moderator can read and edit their own profile, stage a replacement mobile and cancel it. Reads assert the current mobile, verification, username and profile version remain consistent.
- Every denied request leaves complete User, role and pending-mobile rows unchanged for the caller and a separate seeded owner. Every successful request preserves the separate owner's complete rows. Row digests keep personal data out of assertion diagnostics.

`AuthApi` checks the bounded error response and omission of tracked contacts, profile values and credentials from response bodies/headers and captured logs; `TestApplication` checks request correlation and `Cache-Control: no-store`. All write payloads are valid so a validation failure cannot stand in for an authorization denial.

## Verification

Run from `backend/` with JDK 25 and the existing guarded PostgreSQL 18 test settings: `.\mvnw.cmd -o "-Dit.test=UserProfilePermissionIT" verify`. This selects the nine integration cases and also runs the unit suite. Actual execution evidence belongs in the ticket resolution; authoring this page does not claim a passing run.
