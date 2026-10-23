# `AccountRecoveryMigrationIT.java`

Source: [`src/test/java/bd/mediwish/auth/AccountRecoveryMigrationIT.java`](../../../../../../../src/test/java/bd/mediwish/auth/AccountRecoveryMigrationIT.java)

## Purpose

Applies every changeset before `019-account-email-recovery` to an isolated PostgreSQL schema, seeds an existing staff account and its session and MFA state, then applies the full changelog. The test locates changeset `019` by ID instead of relying on a hard-coded changeset count.

## Upgrade behavior

The legacy Admin has an Argon2 password verifier, an email, an active MFA factor with a backup-code row, and a refreshable session already verified against that factor. The migration must preserve the password, email, role, complete session and refresh-token rows, factor, and backup-code row. The new `email_verified_at` value remains `NULL`, and both `account_codes` and `account_code_limits` start empty.

The real application must accept password sign-in with the expected MFA challenge, rotate the pre-existing verified session, and return the profile with the existing email and `emailVerified: false`. A direct update that removes the email while setting `email_verified_at` must fail with SQLSTATE `23514` from `ck_users_email_verified_needs_email`.

All fixture values are synthetic, and the guarded test database owns and removes its isolated schema. The test is tagged `integration` and `regression`.

## Verification

The test implementation has not yet been executed; record the focused integration command, result, date, and revision after running it.
