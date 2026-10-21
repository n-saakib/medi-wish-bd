# AddressMigrationIT.java

Source: [src/test/java/bd/mediwish/address/AddressMigrationIT.java](../../../../../../../src/test/java/bd/mediwish/address/AddressMigrationIT.java).

Exercises Ticket 12 observable address-book behavior against the real application and a guarded PostgreSQL 18 schema. Tests use synthetic values, the existing AuthApi client, and run-owned schema cleanup; no production test endpoint is added.

Runs the real complete Liquibase changelog and an upgrade located by changeset id 017-saved-addresses. Existing users/sessions remain unchanged, new tables are empty, composite/default constraints and field bounds refuse bad data, and both owner foreign keys cascade. Applied history is preserved; deployment recovery uses the previous jar with the additive schema intact.

The upgrade compares every pre-existing session field through JSONB snapshots with only the additive Ticket 09 column `mfa_replacing_factor_id` excluded on both sides. It separately asserts that the new replacement binding is null after the upgrade. This preserves the legacy session-value check when changeset 018 adds a nullable field; it does not treat the extra field as changed legacy data. The compatibility correction was authored 2026-10-20 after the cumulative run exposed composite-row text gaining a trailing null field; the corrected focused run passed3/3 on PostgreSQL18 UTF8 loopback55433 on2026-10-20 at13968d1 plus uncommitted work, with task-owned role cleanup succeeding. Full cumulative verification remains a separate gate.
