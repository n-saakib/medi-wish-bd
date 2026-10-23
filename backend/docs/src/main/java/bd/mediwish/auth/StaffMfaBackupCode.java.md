# `StaffMfaBackupCode.java`

Source: [`src/main/java/bd/mediwish/auth/StaffMfaBackupCode.java`](../../../../../../../src/main/java/bd/mediwish/auth/StaffMfaBackupCode.java)

JPA mapping for one backup code in `staff_mfa_backup_codes`: ID, `factor_id`, `code_verifier` (the Argon2 verifier of the dash-free code, never the code), `created_at` and nullable `consumed_at`/`consumed_session_id`. The verifier and factor identity remain non-updatable. `StaffMfaService` saves ten per first enrollment; recovery atomically consumes a row with the presenting restricted session ID. Both consumed fields must be null together or set together (changeset 018). Rows cascade with their factor. Covered by `StaffMfaServiceTest` and `StaffMfaIT`, which checks ten `$argon2id$` verifiers.

Package-private `id()` and `codeVerifier()` support matching outside the transaction; `StaffMfaBackupCodeRepository.consume` conditionally writes the consumption inside the User-locked transaction. No raw backup code is stored.
