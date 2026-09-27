# `User.java`

Source: [`src/main/java/bd/mediwish/user/User.java`](../../../../../../../src/main/java/bd/mediwish/user/User.java)

JPA entity for a registered User in `users`: ID, normalized `username` (non-updatable), `mobile`, optional `email`, `password_hash` (an Argon2 verifier only), `mobile_verified` and `created_at`, plus the eagerly loaded `roles` element collection in `user_roles`.

The public constructor owns the generated UUID and creation `Instant`, and assigns the `CUSTOMER` role; the schema does not duplicate those defaults. `mobileVerified` stays false while OTP work is deferred. `roles()` is read-only. `hasStaffRole()` is true when any role is staff (`ADMIN` or `MODERATOR`); sign-in, `StaffMfaFactorRepository.activeFactorIdOf` and `StaffMfaService` use it. `grantRole(role)` adds a role and keeps the existing ones; only `FirstAdminProvisioningService` calls it so far. Username and mobile uniqueness, the role foreign key and the unique case-insensitive email index are declared only in the Liquibase changelog; Hibernate validates the mapping. `UserProfile.from` is the safe projection returned to clients.
