# `db.changelog-master.yaml`

Source: [`src/main/resources/db/changelog/db.changelog-master.yaml`](../../../../../../src/main/resources/db/changelog/db.changelog-master.yaml)

## Purpose and reasoning

This is the Liquibase changelog entry point configured by `application.yaml`. Its initial changeset records the application baseline by tagging the database; it intentionally creates no speculative product, customer or order tables. Starting with a tagged, tracked changeset gives later stories a stable migration history and lets tests prove that restart does not reapply it.

## Changeset

| Element | Behavior and use case |
| --- | --- |
| `id: 001-foundation` | Stable identifier for the initial baseline changeset. Once applied, do not edit it; append a new changeset for schema changes. |
| `author: medi-wish` | Identifies the owning application in Liquibase history. |
| `tagDatabase: application-baseline` | Tags the database at the foundation boundary for diagnostics and future rollback/release workflows. |

Liquibase owns schema evolution while Hibernate is configured only to validate. The changelog is applied in the configured schema, including the unique schema created by the integration harness.

## Verification

`HealthIT` checks that the changelog is applied, survives an application restart and does not reapply when existing data is present. `DependencyCompatibilityIT` repeats the migration and restart check with the optional integrations enabled.
