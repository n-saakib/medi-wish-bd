# `SessionIT.java`

Source: [`src/test/java/bd/mediwish/auth/SessionIT.java`](../../../../../../../src/test/java/bd/mediwish/auth/SessionIT.java)

## Purpose

Refresh and logout through the production filter chain, on the shared context:

- refresh rotates both tokens and consumes the presented generation;
- no cookie with a valid CSRF token is a quiet 204 without Set-Cookie (A1); no cookie and no CSRF token is 403; a missing Origin is accepted with a valid CSRF token;
- an empty, oversized, guessed, altered, truncated or duplicated cookie gets one generic 401 that clears it without consuming the session;
- replaying a consumed generation revokes the family, including the new access and refresh tokens; the same test covers a retry after a lost refresh response, which the server cannot tell from a replay;
- an expired session, and a User who can no longer sign in, are rejected;
- a rotation that fails at commit leaves the presented cookie usable;
- logout is repeatable, clears the cookie even without one, revokes every session named by duplicated cookies, and after a commit failure leaves every session active and can be retried;
- `SessionService.revokeAllForUser` rejects all of a User's tokens;
- a missing or mismatched CSRF token and a disallowed origin are denied and change nothing; the allowed preflight permits credentials and the CSRF header.

## Verification

29 tests.

Verified 2026-09-27 on `b26f0c9` plus the Ticket 03.03 changes: `./mvnw.cmd -o verify` passed 171 unit and 109 integration tests (1 expected compatibility skip); `./mvnw.cmd -o -Pcompatibility verify` passed 171 and 109 with no skip.
