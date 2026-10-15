# UserProfileIT.java

Source: [UserProfileIT.java](../../../../../../../src/test/java/bd/mediwish/auth/UserProfileIT.java)

## Purpose

Real owner-only profile API journeys on a guarded PostgreSQL schema exercise normalization, stable session projection, staging and cancellation, old-version identical retries, stale/closing writes, ownership and restart durability. A seeded current verified contact signs in while its pending replacement cannot; the deterministic internal verifier activates only the pending ID without revoking the current session.

RequestMappingHandlerMapping must expose exactly the existing me route, four profile routes and the four Ticket 12 address routes. The separate assertion still permits only /api/user/me/mobile-change among all mapped mobile paths, so no mobile activation or OTP handler is exposed. A direct ProfileService read has at most two prepared statements. Captured logs must omit tracked profile values and credentials. The class owns its restarting application and schema.

The query-budget test records actual service GET and PUT prepared-statement counts, excluding the unchanged Bearer-authentication overhead. GET remains at most two statements; PUT includes the locked User/roles, pending lookup, email collision check and update. Only numeric counts are printed.
