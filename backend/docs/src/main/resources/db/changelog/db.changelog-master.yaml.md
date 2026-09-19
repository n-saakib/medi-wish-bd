# `db.changelog-master.yaml`

Source: [`src/main/resources/db/changelog/db.changelog-master.yaml`](../../../../../../src/main/resources/db/changelog/db.changelog-master.yaml)

## Purpose and reasoning

This is the Liquibase changelog entry point configured by `application.yaml`. Its initial changeset records the application baseline, the original registration table is retained as applied history, and the latest changeset migrates it to the shared User table with persisted role assignments. Starting with tagged, append-only changesets gives later stories a stable migration history and lets tests prove that restart does not reapply it.

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

Liquibase owns schema evolution while Hibernate is configured only to validate. User generates its UUID identifier and creation timestamp in the Java constructor; changeset `003-customer-java-owned-values` removes the original defaults without changing an applied changeset's checksum, and `004-shared-users-and-roles` preserves existing identities while moving them to the shared User vocabulary. The changelog is applied in the configured schema, including the unique schema created by the integration harness.

The Ticket 03 session tables retain consumed refresh generations through family expiry so replay can be distinguished from an unknown token; cleanup is intentionally deferred. The raw refresh value is never a schema field.

## Verification

`HealthIT` checks that the changelog is applied, survives an application restart and does not reapply when existing data is present. `DependencyCompatibilityIT` repeats the migration and restart check with the optional integrations enabled.
