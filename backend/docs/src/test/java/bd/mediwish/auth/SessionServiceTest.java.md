# `SessionServiceTest.java`

Source: [`src/test/java/bd/mediwish/auth/SessionServiceTest.java`](../../../../../../../src/test/java/bd/mediwish/auth/SessionServiceTest.java)

## Purpose

Checks generation-zero creation with 32 random bytes; a session created with the 10-minute restricted lifetime and no MFA evidence; the MFA upgrade, which revokes the restricted session with `mfa-verified` and creates a new session with the full lifetime, evidence for the factor at now and its own generation-zero digest; refusal to upgrade a revoked or expired session without touching refresh tokens; one rotation that consumes the old generation and creates the next; replay revocation of the entire family; revocation of the families locked for a list of refresh values (without touching refresh-token rows); no query for an empty list; revocation of every active family of one User; and rejection when a valid active session belongs to a different User than the token identity. The persisted codes `logout`, `refresh-replay`, `user-unavailable` and `mfa-verified` are asserted as literals. Real PostgreSQL locking is covered by the integration tests.

## Verification

Verified 2026-09-27 on the working tree over `bef3b76`: `./mvnw.cmd -o test` passed all 238 unit tests.

Ticket 08 tests password creation through the User id: shared lock before session save, current staff role chooses the restricted lifetime, and a deleted User creates no session.


Ticket 05 supplies the required synthetic Recovery settings to direct AuthProperties construction; existing behavior and assertions stay unchanged.


## Ticket 05 recovery

The email-change regression checks that another active session is revoked with email-changed while the requesting session stays active; no refresh history is deleted.

## Ticket 05 integration

Password-session creation supplies the verified hash; the composed stale-proof regression lives in PasswordResetLoginRaceTest.
