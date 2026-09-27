# `ConcurrentMfaIT.java`

Source: [`src/test/java/bd/mediwish/auth/ConcurrentMfaIT.java`](../../../../../../../src/test/java/bd/mediwish/auth/ConcurrentMfaIT.java)

## Purpose

Own application (it restarts it) for concurrency, durability and query cost of staff MFA against PostgreSQL:

- the same code sent at once on two challenge sessions verifies exactly one (`200` and `400 MFA_CODE_INVALID`), because the User row lock serializes them and the accepted step is stored; both restricted sessions end revoked with `mfa-verified`;
- two simultaneous enrollment starts both answer `201` but leave one pending factor; the loser's ID is `409 MFA_ENROLLMENT_STALE` and the winner verifies;
- a pending enrollment survives an application restart and is then verified;
- `anAuthorizedRequestPreparesAFewIndexedStatements` (T7) enables Hibernate statistics at runtime and counts prepared statements per request: a Customer `GET /api/user/me` prepares 3, a verified staff `GET /api/user/me` 4 (the extra active-factor lookup) and `GET /api/staff/me` 5 (plus the `staff_bootstrap` lookup). It asserts the two +1 steps and prints the counts.

## Verification

4 tests.

Verified 2026-09-27 on the working tree over `bef3b76`: the targeted integration run passed (4 tests).
