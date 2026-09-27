# `db.changelog-master.yaml`

Source: [`src/main/resources/db/changelog/db.changelog-master.yaml`](../../../../../../src/main/resources/db/changelog/db.changelog-master.yaml)

## Purpose and reasoning

This is the Liquibase changelog entry point configured by `application.yaml`. Its initial changeset records the application baseline, the original registration table is retained as applied history, changeset `004-shared-users-and-roles` migrates it to the shared User table with persisted role assignments, and one unique case-insensitive expression index now both enforces unique optional email and serves the email lookup. Changeset 006's exact-match index remains in history and is removed by the later forward-only cleanup. Starting with tagged, append-only changesets gives later stories a stable migration history and lets tests prove that restart does not reapply it.

## Changesets

| Element | Behavior and use case |
| --- | --- |
| `id: 001-foundation` | Stable identifier for the initial baseline changeset. Once applied, do not edit it; append a new changeset for schema changes. |
| `author: medi-wish` | Identifies the owning application in Liquibase history. |
| `tagDatabase: application-baseline` | Tags the database at the foundation boundary for diagnostics and future rollback/release workflows. |
| `id: 002-customers` | Creates durable Customer identity data with unique username/mobile constraints, password verifier storage, optional email, mobile-verification state and creation timestamp. Its original database defaults remain unchanged for Liquibase checksum stability. |
| `id: 003-customer-java-owned-values` | Removes the `id` and `created_at` database defaults after the original changeset, leaving the Java constructor as the single application write-path owner without editing an applied changeset. |
| `id: 004-shared-users-and-roles` | Renames the applied identity table to `users`, creates the `user_roles` assignment table with a foreign key and composite primary key, and backfills existing rows with the `CUSTOMER` role. |
| `id: 005-user-password-sessions` | Adds durable session families and one-use refresh generations with UUID keys, `TIMESTAMPTZ` lifecycle fields, a lowercase SHA-256 digest bounded to `VARCHAR(64)`, family/user and session/generation uniqueness/index boundaries, and cascading foreign keys. |
| `id: 006-user-email-lookup` | Historically adds a non-unique B-tree index on `users.email`. Duplicate email remains allowed; the later 008 cleanup removes this index after sign-in adopted case-insensitive lookup. |
| `id: 007-user-email-case-insensitive-lookup` | Adds a non-unique B-tree expression index on `upper(users.email)` for case-insensitive email sign-in. It preserves all stored email values and does not introduce email uniqueness. |
| `id: 008-drop-unused-exact-email-index` | Drops the unused `idx_users_email` index without rewriting applied changesets; the expression index remains to support the case-insensitive lookup. |
| `id: 009-unique-user-email` | Its `sqlCheck` precondition counts non-null emails that repeat ignoring case and expects none. On a match it halts (`onFail: HALT`) with a message that names the rule but no address, and changes nothing; the operator resolves the duplicates and reruns it. Otherwise it drops `idx_users_email_upper` and, through `createIndex` with a `computed` column, creates the unique `uk_users_email_upper` on `upper(email)`, which allows any number of NULL emails. |
| `id: 010-staff-mfa` | Staff MFA and first-Admin provisioning (Ticket 06). Creates `staff_mfa_factors` (cascading User FK, `ck_staff_mfa_factors_status` for `PENDING`/`ACTIVE`/`REVOKED`, `BYTEA` ciphertext and nonce, `last_used_step` default `-1`) with the partial unique indexes `uq_staff_mfa_active` and `uq_staff_mfa_pending` on `user_id`, so a User has at most one active and one pending factor; `staff_mfa_backup_codes` (cascading factor FK, `idx_staff_mfa_backup_codes_factor`); `staff_mfa_throttle` (User ID primary key and cascading FK); `staff_bootstrap` (`SMALLINT` key with `ck_staff_bootstrap_singleton` `CHECK (id = 1)`, `super_admin_user_id` FK `ON DELETE SET NULL`); and `security_audit_events` (no free-text column, subject FK `ON DELETE SET NULL`, `idx_security_audit_events_subject` on `(subject_user_id, occurred_at)`). Adds nullable `mfa_factor_id` (FK to `staff_mfa_factors` `ON DELETE SET NULL`) and `mfa_verified_at` to `user_sessions`; existing sessions keep both `NULL`, which is a password-only session. |

Liquibase owns schema evolution while Hibernate is configured only to validate. User generates its UUID identifier and creation timestamp in the Java constructor; changeset `003-customer-java-owned-values` removes the original defaults without changing an applied changeset's checksum, and `004-shared-users-and-roles` preserves existing identities while moving them to the shared User vocabulary. The changelog is applied in the configured schema, including the unique schema created by the integration harness.

The Ticket 03 session tables retain consumed refresh generations through family expiry so replay can be distinguished from an unknown token; cleanup is intentionally deferred. The raw refresh value is never a schema field.

The nullable email column is unique ignoring case since changeset 009 (Ticket 03.03 D1), so email sign-in matches at most one User through the same `upper(email)` index. Schema history remains append-only, and no migration normalizes stored email values.

Changeset 010 changes no existing row. Authenticator seeds are stored only as AES-256-GCM ciphertext and backup codes only as Argon2 verifiers; no plain seed, code or username is a schema field.

## Verification

`HealthIT` checks that the changelog is applied, survives an application restart and does not reapply when existing data is present. `LegacyUserMigrationIT` migrates legacy rows through 009 and proves that duplicate legacy emails halt 009 with the rows unchanged; `RegistrationIT` and `SignInIT` exercise the unique index. `StaffMfaMigrationIT` applies 001–009, refreshes an existing Customer session after 010 (`mfa: NOT_REQUIRED`, no evidence) and checks the status check, the one-active and one-pending indexes and the bootstrap singleton. `DependencyCompatibilityIT` repeats the migration and restart check with the optional integrations enabled.
