# StaffMfaFactorWriteScanTest.java

Ticket 09 T6 unit test for regression R1. Scans the compiled production classes with Spring's bundled ASM reader; no Spring context, HTTP or database.

- Proves the only production method that calls `StaffMfaFactor.revoke` is the replacement lambda inside `StaffMfaRecoveryService.verifyReplacement`. Session `revoke` calls are not counted because the check matches the factor receiver type.
- Proves the only query string that writes factor rows is `StaffMfaFactorRepository.deletePending`, which deletes pending enrollments only.
- A later mobile or email password recovery (Tickets 04 and 05) that revoked a factor or bulk-deleted active factors would fail here. Ticket 10 must update this test if it legitimately reuses `StaffMfaFactor.revoke`.
- Fixed by source: no test data, no secrets.
