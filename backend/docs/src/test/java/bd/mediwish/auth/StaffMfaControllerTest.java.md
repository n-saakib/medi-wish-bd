# `StaffMfaControllerTest.java`

Source: [`src/test/java/bd/mediwish/auth/StaffMfaControllerTest.java`](../../../../../../../src/test/java/bd/mediwish/auth/StaffMfaControllerTest.java)

## Purpose and boundaries

Eight focused controller cases preserve the existing challenge/enrollment mappings while testing new backup-code routes. Mocked services isolate request validation and response/cookie behavior; security is tested through StaffMfaSecurityTest and persistence through later PostgreSQL/API checks.

The cases cover malformed typed TOTP/enrollment IDs; exact-key new-route bodies across nonobjects, missing/extra fields, wrong types and malformed/oversize values; recovery normalization and a 600-second replacement cookie; spaced TOTP regeneration with no cookie; replacement-only verification dispatch and notice outcome; first-enrollment omission of contactNotice; redacted secret-bearing responses; and MVC malformed-JSON/415 bounded envelopes. Invalid bodies never call either service or set a cookie.

## Verification

Focused tests use actual controller calls/MVC and the installed security chain; compile-red for missing route methods is distinguished from actual behavioral fault checks.

T4 verification on 2026-10-19, working tree over `13968d1`: `.\mvnw.cmd -o test -Dtest=StaffMfaControllerTest,StaffMfaSecurityTest,SecurityConfigurationTest` passed 39 focused tests; `.\mvnw.cmd -o test` passed all 1,033 backend units with zero failures/errors/skips at 15:00:14 +06:00. Before security wiring, the production-chain/matcher gate had 10 expected failures in 31 tests. A separate controlled controller mutation had 2 expected failures in 8 tests for relaxed exact-key validation and null contactNotice serialization. Exact original controller bytes were restored before the full gate. These targeted faults are distinguished from missing-method compile-red; real HTTP/PostgreSQL/API acceptance is recorded separately.
