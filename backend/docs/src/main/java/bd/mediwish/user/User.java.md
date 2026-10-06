# User

Maps the shared account identity, verifier and profile in `users`, with one eagerly loaded role in `user_roles`. Registration generates an id and creation instant and assigns CUSTOMER. The retained element collection is private; the database primary key and deferred required-role triggers enforce exactly one committed assignment. `@BatchSize(50)` hydrates role rows in bounded batches for an admin search page.

`role()` returns the one assignment; `roles()` preserves the existing read-only singleton projection for staff/profile callers. `replaceRole` replaces it and leaves a repeated assignment unchanged. `rolesVersion()` is the persisted command version; only an actual administrative assignment calls `bumpRolesVersion`. Provisioning and migration retain version zero. `hasStaffRole` delegates to the single role's MFA requirement, and `createdAt` supports the bounded admin projection. No password or contact details are added to the admin contract.

`UserTest` covers registration, replacement, repeat assignment, version increment and demotion. `StaffRoleMappingIT` pins delete/insert SQL and the deferred constraint permits both within one transaction.
