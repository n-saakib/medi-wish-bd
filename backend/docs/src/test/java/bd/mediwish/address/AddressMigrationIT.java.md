# AddressMigrationIT.java

Source: [src/test/java/bd/mediwish/address/AddressMigrationIT.java](../../../../../../../src/test/java/bd/mediwish/address/AddressMigrationIT.java).

Exercises Ticket 12 observable address-book behavior against the real application and a guarded PostgreSQL 18 schema. Tests use synthetic values, the existing AuthApi client, and run-owned schema cleanup; no production test endpoint is added.

Runs the real complete Liquibase changelog and an upgrade located by changeset id 017-saved-addresses. Existing users/sessions remain unchanged, new tables are empty, composite/default constraints and field bounds refuse bad data, and both owner foreign keys cascade. Applied history is preserved; deployment recovery uses the previous jar with the additive schema intact.

The complete upgrade compares every existing User column except newly appended `email_verified_at`, and separately requires that column to be null. Existing identity fields and full session snapshots remain unchanged.
