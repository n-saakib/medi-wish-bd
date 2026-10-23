# `StaffMfaRecoveryMigrationIT.java`

Source: [`src/test/java/bd/mediwish/auth/StaffMfaRecoveryMigrationIT.java`](../../../../../../../src/test/java/bd/mediwish/auth/StaffMfaRecoveryMigrationIT.java)

## Purpose and boundary

Tests the real Liquibase upgrade from populated pre-018 staff MFA data, then authenticates and redeems legacy codes through HTTP. The guarded PostgreSQL harness owns the isolated schema. Tags: `integration`, `migration`, `regression`.

The baseline changeset count is calculated from master-changelog entries preceding `018-staff-mfa-recovery`; it does not assume a fixed count or apply 018 early. The fixture contains a Moderator, an encrypted active factor, two Argon2 backup-code verifiers, and verified and restricted sessions with refresh generations.

## Observable checks

- Application startup applies 018; both new columns remain null on legacy rows and the factor remains active.
- The legacy verified refresh session still reaches staff pages; the restricted refresh session remains verification-required and receives `403 MFA_REQUIRED` there.
- Both pre-upgrade codes redeem through `/api/auth/mfa/recovery`, producing replacement sessions and paired consumption evidence. The first code records the original restricted presenting session.
- SQL probes reject replacing-plus-verified evidence and either half of the backup-code consumption pair with check-violation SQLSTATE `23514`; an unknown replacement factor fails with foreign-key SQLSTATE `23503`.
- Deleting the referenced factor preserves both replacement sessions and clears their replacement binding through `ON DELETE SET NULL`; the factor's backup codes cascade away.

## Helpers and verification

`insertStaffUser` commits the User and Moderator role together so the pre-018 deferred role-required trigger sees both rows; failed inserts roll back. `insertCode` and `insertSession` seed only the pre-018 schema. `refreshedAccess` sends the real CSRF/Origin refresh request. `redeem` exercises the public recovery route. `assertRejected` checks the expected SQLSTATE so unrelated database failures cannot satisfy a constraint probe. `update` runs Liquibase against the owned schema.

One integration test authored 2026-10-19 over `13968d1`. The first focused run on 2026-10-20 failed during fixture creation because the User insert committed before its required role. The fixture now inserts both in one explicit JDBC transaction; the corrected focused verification below establishes the upgrade result.

Verification: corrected fixture passed1/1 on2026-10-20 at13968d1 plus uncommitted work, guarded PostgreSQL18 UTF8 on55433. Combined recovery/upgrade gate passed20/20; disposable-role cleanup succeeded. Full T5 cumulative and joined UI gates remain separate.
