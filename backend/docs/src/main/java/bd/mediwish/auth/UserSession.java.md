# `UserSession.java`

Source: [`src/main/java/bd/mediwish/auth/UserSession.java`](../../../../../../../src/main/java/bd/mediwish/auth/UserSession.java)

JPA mapping for one refresh-session family in `user_sessions`: ID, lazily loaded owning `User`, `created_at`, `expires_at`, `last_used_at`, nullable `revoked_at`/`revoked_reason`, and the nullable, non-updatable MFA evidence `mfa_factor_id`, `mfa_verified_at` and `mfa_replacing_factor_id`. The ID is the access token's `sid`.

`touch(at)` records use during rotation. `revoke(at, reason)` is package-private, like `RevocationReason`, and monotonic: only the first revocation is recorded, storing `RevocationReason.code`. `revoked()` reports whether `revoked_at` is set. `markMfaVerified(factorId, at)` is called by `SessionService.upgradeToMfa` or `replaceAllWithVerified` on a new family before it is first saved; evidence is never added to an existing session, and the columns are non-updatable. `mfaFactorId()` and `mfaVerifiedAt()` feed `StaffAccessPolicy`. Indexes, the foreign keys (the factor reference is `ON DELETE SET NULL`) and cascade rules are declared only in the Liquibase changelog; Hibernate validates the mapping. Covered through `SessionServiceTest`, the session integration tests and `StaffMfaIT`, which checks that only the new session carries evidence.

`markReplacing(factorId)` binds a newly created replacement family to the old active factor, refusing a verified family. `mfaReplacingFactorId()` feeds policy and service checks. Changeset 018 enforces that a replacement binding cannot coexist with `mfa_verified_at`; the replacement factor FK uses `ON DELETE SET NULL`.
