# User

Maps the shared account identity, verifier and profile in `users`, with one eagerly loaded role in `user_roles`. Registration generates an id and creation instant and assigns CUSTOMER. The retained element collection is private; the database primary key and deferred required-role triggers enforce exactly one committed assignment. `@BatchSize(50)` hydrates role rows in bounded batches for an admin search page.

JPA entity for a registered User in `users`: ID, immutable normalized username, mobile, optional email, Argon2 password verifier, mobile verification state and creation time. Ticket 11 adds optional full name and date of birth, profile version (default 0) and account state (default `ACTIVE`). The `roles` element collection remains eager.

The constructor owns the UUID and creation `Instant` and starts with the `CUSTOMER` role and an unverified mobile. `updateProfile` changes only name, email and DOB; `bumpProfileVersion` marks a real profile save; `activateMobile` applies a verified pending number without changing the profile version. Username remains immutable. Constraints belong to Liquibase. `UserProfile.from` remains the smaller session projection; `ProfileView` is the owner-only editing projection.
`role()` returns the one assignment; `roles()` preserves the existing read-only singleton projection for staff/profile callers. `replaceRole` replaces it and leaves a repeated assignment unchanged. `rolesVersion()` is the persisted command version; only an actual administrative assignment calls `bumpRolesVersion`. Provisioning and migration retain version zero. `hasStaffRole` delegates to the single role's MFA requirement, and `createdAt` supports the bounded admin projection. No password or contact details are added to the admin contract.

`UserTest` covers registration, replacement, repeat assignment, version increment and demotion. `StaffRoleMappingIT` pins delete/insert SQL and the deferred constraint permits both within one transaction.
