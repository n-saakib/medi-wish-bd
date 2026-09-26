# `UserSessionRefreshToken.java`

Source: [`src/main/java/bd/mediwish/auth/UserSessionRefreshToken.java`](../../../../../../../src/main/java/bd/mediwish/auth/UserSessionRefreshToken.java)

JPA mapping for one refresh generation in `user_session_refresh_tokens`: ID, lazily loaded `UserSession`, `generation`, the 64-character SHA-256 `token_hash`, `issued_at`, `expires_at` and nullable `consumed_at`. The raw refresh value is never stored.

`consume(at)` marks the generation used; `consumed()` lets `SessionService` detect replay (there is no `consumed_at` accessor), so consumed rows are kept. Uniqueness of the digest and of `(session_id, generation)`, the session/expiry index and the foreign key are declared only in the Liquibase changelog; Hibernate validates the mapping. Covered through `SessionServiceTest`, `SessionIT` and `ConcurrentSessionIT`.
