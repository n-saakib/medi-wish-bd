# `UserSession.java`

Source: [`src/main/java/bd/mediwish/auth/UserSession.java`](../../../../../../../src/main/java/bd/mediwish/auth/UserSession.java)

JPA mapping for one refresh-session family in `user_sessions`: ID, lazily loaded owning `User`, `created_at`, `expires_at`, `last_used_at` and nullable `revoked_at`/`revoked_reason`. The ID is the access token's `sid`.

`touch(at)` records use during rotation. `revoke(at, reason)` is package-private, like `RevocationReason`, and monotonic: only the first revocation is recorded, storing `RevocationReason.code`. `revoked()` reports whether `revoked_at` is set. Indexes, the foreign key and cascade rules are declared only in the Liquibase changelog; Hibernate validates the mapping. Covered through `SessionServiceTest` and the session integration tests.
