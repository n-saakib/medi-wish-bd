# `StaffMfaBackupCode.java`

Source: [`src/main/java/bd/mediwish/auth/StaffMfaBackupCode.java`](../../../../../../../src/main/java/bd/mediwish/auth/StaffMfaBackupCode.java)

JPA mapping for one backup code in `staff_mfa_backup_codes`: ID, `factor_id`, `code_verifier` (the Argon2 verifier of the dash-free code, never the code), `created_at` and nullable `consumed_at`. All but `consumed_at` are non-updatable. `StaffMfaService` saves ten per activated factor; no code consumes them yet (Ticket 09). Rows cascade with their factor. Covered by `StaffMfaServiceTest` and `StaffMfaIT`, which checks ten `$argon2id$` verifiers.
