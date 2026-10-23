# `RoleAssignmentServiceTest.java`

Source: [RoleAssignmentServiceTest.java](../../../../../../../src/test/java/bd/mediwish/auth/RoleAssignmentServiceTest.java)

Command/read boundary tests: applied role/version/session revocation; same-role stale retry writes nothing; stale/refused commands preserve state; locked current actor role and session are rechecked; self-noop locks one ID. A valid page beyond JPA integer offset range must return no items with the filtered total. Real integration tests prove atomicity and actual database locks.

A factor replaced while the request waited also invalidates the actor's MFA evidence before a same-role no-op can return success.

Verified 2026-10-05 at 10:07 Asia/Dhaka, working tree over `8b6924c`: `./mvnw.cmd -o '-Dmaven.compiler.useIncrementalCompilation=false' '-Dtest=AdminUserControllerTest,RoleAssignmentServiceTest,StaffAccessPolicyTest,StaffMfaControllerTest,SecurityConfigurationTest,AuthRequestBodyLimitFilterTest,ApiExceptionHandlerTest,ApiErrorsTest' test` passed 100 focused unit tests (9 in this class), with no failures, errors or skips. The valid large-page case first failed at the repository offset boundary, then passed after the bounded-total fix. Earlier build attempts ended before tests because two Maven processes rewrote the same target output, and because a dotted Maven property was unquoted in PowerShell; neither is test-success evidence.

Ticket 09 adapts synthetic session evidence to `MfaEvidence(factorId, verifiedAt, replacingFactorId)` with a null replacement binding in these existing scenarios; their original behavior assertions remain unchanged.
