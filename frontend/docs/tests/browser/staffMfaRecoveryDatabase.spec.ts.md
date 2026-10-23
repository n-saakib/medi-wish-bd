# `tests/browser/staffMfaRecoveryDatabase.spec.ts`

Source: [`../../../tests/browser/staffMfaRecoveryDatabase.spec.ts`](../../../tests/browser/staffMfaRecoveryDatabase.spec.ts)

## Purpose

Ticket 09's database checks on the schema the test API migrated: changeset `018-staff-mfa-recovery` (plan §4.4). Every write runs in a rolled-back transaction through [`rolledBackSql`](testApi.ts.md). Tag `@t09-T2`, also `@t09-migration`. Written before the feature; the tests fail until T2's changeset is in the built jar.

## Tests

- **E2E-09-50:** `018` runs directly after `017-saved-addresses` and before nothing older. It adds the nullable `uuid` columns `user_sessions.mfa_replacing_factor_id` and `staff_mfa_backup_codes.consumed_session_id`; `fk_user_sessions_mfa_replacing_factor` references `staff_mfa_factors(id)` with `ON DELETE SET NULL`; `ck_user_sessions_replacing_unverified` and `ck_staff_mfa_backup_codes_consumed` exist; `consumed_session_id` has no foreign key; the three existing MFA indexes remain.
- **E2E-09-51:** selects the two active sessions by their verified evidence, ignoring the revoked restricted family retained by first enrollment; a verified session cannot also be replacing a factor, while an unverified one can; an unknown factor id is refused and deleting the factor clears the binding; `consumed_at` and `consumed_session_id` are set together or not at all, and the session id need not exist.
- **E2E-09-52:** Ticket 06 sign-in and enrollment rows leave both new columns empty.

## Running

Build the backend jar, then `npm run test:browser -- --grep "@t09-T2" --project chrome`.
