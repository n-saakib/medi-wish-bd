# `StaffMfaSecurityTest.java`

Source: [StaffMfaSecurityTest.java](../../../../../../../src/test/java/bd/mediwish/web/StaffMfaSecurityTest.java)

Runs the production `SecurityConfiguration` filter chain over a minimal probe controller without PostgreSQL or service-side validation. The context supplies only synthetic authentication, auth properties and bounded error dependencies, following `CatalogSecurityTest`.

The actor matrix covers anonymous, Customer, DeliveryPerson, enrollment-required, challenge-required, replacement-required, verified Moderator and verified Admin callers across enrollment, enrollment verification, ordinary verification, recovery and backup-code regeneration. Enrollment accepts enrollment/replacement authority, verification and recovery accept challenge authority, and regeneration accepts verified staff. Every admitted request supplies a Bearer token without a CSRF cookie or header. Denied requests distinguish `AUTHENTICATION_REQUIRED` with its Bearer challenge, `MFA_REQUIRED` and `ACCESS_DENIED`. Every response retains no-store and request correlation headers.

For each new route, valid synthetic JSON plus whitespace reaches exactly 16 KiB and passes; one additional byte gets `400 INVALID_REQUEST`. The probe does not validate field formats, so the oversized case can pass only when the production body limiter is absent. This protects the actual limit rather than relying on a controller rejecting an enormous code field.

Parameterized cases isolate actor failures and both body-limit routes. Test execution and mutation evidence are recorded by the parent lane in the ticket evidence after coordinated Maven runs.

T4 verification on 2026-10-19, working tree over `13968d1`: `.\mvnw.cmd -o test -Dtest=StaffMfaControllerTest,StaffMfaSecurityTest,SecurityConfigurationTest` passed 39 focused tests; `.\mvnw.cmd -o test` passed all 1,033 backend units with zero failures/errors/skips at 15:00:14 +06:00. Before security wiring, the production-chain/matcher gate had 10 expected failures in 31 tests. A separate controlled controller mutation had 2 expected failures in 8 tests for relaxed exact-key validation and null contactNotice serialization. Exact original controller bytes were restored before the full gate. These targeted faults are distinguished from missing-method compile-red; real HTTP/PostgreSQL/API acceptance is recorded separately.
