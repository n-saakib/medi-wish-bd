# `ConcurrentSessionIT.java`

Source: [`src/test/java/bd/mediwish/auth/ConcurrentSessionIT.java`](../../../../../../../src/test/java/bd/mediwish/auth/ConcurrentSessionIT.java)

## Purpose

Races on one session that only PostgreSQL row locks serialize, on the shared context. For concurrent refresh, a separate transaction holds `SELECT ... FOR UPDATE` on the refresh-token row; the test polls `pg_locks` until both requests wait ungranted, then releases it. The result is exactly one 200 and one replay 401 that clears the cookie, generation `0` consumed and `1` fresh, and the winner's tokens revoked. A logout racing a refresh always ends with the family revoked, one session row and at most one new generation. Logouts naming two sessions in opposite orders both succeed without deadlock. A logout presenting two generations of one family returns `204` while a separate transaction holds `FOR UPDATE` on the newer generation, as a refresh in flight would; the family ends revoked by logout and the newer value is then rejected. On the previous token-locking logout this test failed, because the logout waited on the held token.

## Verification

4 tests.

Verified 2026-09-27 on `b26f0c9` plus the Ticket 03.03 changes: `./mvnw.cmd -o verify` passed 171 unit and 109 integration tests (1 expected compatibility skip); `./mvnw.cmd -o -Pcompatibility verify` passed 171 and 109 with no skip.
