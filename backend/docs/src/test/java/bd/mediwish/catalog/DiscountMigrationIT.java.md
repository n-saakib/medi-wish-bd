# `DiscountMigrationIT.java`

Source: [DiscountMigrationIT.java](../../../../../../../src/test/java/bd/mediwish/catalog/DiscountMigrationIT.java)

Tests the accepted `016-discounts` changeset on a fresh PostgreSQL 18 schema and an occupied schema immediately before that changeset. The upgrade fixture includes an active priced Product and an inactive unpriced Product, with nonzero versions; complete row snapshots must survive unchanged.

Checks exact decimal columns and indexes, valid low/high flat amounts, target/kind/value/date constraints, whole percentage and finite-money guards, overflow SQL states, foreign keys and retained audit history. The Category deletion probe has no Product references and a positive delete control, so it proves the new discount FK independently. Derived Product history events must never be stored.

Uses the existing guarded `TestDatabase` and real Liquibase, with changeset position discovered by ID. Only the run's schema is removed. No production database or credentials are used. Future migration recovery uses an appended forward-fix changeset; existing applied changesets stay immutable.

Development gate: `./mvnw.cmd -o verify "-Dit.test=DiscountMigrationIT" -Dtest=none "-Dsurefire.failIfNoSpecifiedTests=false"`, inside the plan's test-role script. Before `016-discounts` exists, the missing-changeset assertion is intentionally red. This test does not claim a migration has been delivered or executed successfully.

In-range fractional percentages (1.50 and 98.50) independently exercise the integral-percent constraint; rejecting only 99.50 would be masked by the upper bound. Positive writes at 1 and 99 guard against rejecting the accepted endpoints.

Deletion probes assert PostgreSQL's exact 23001 RESTRICT violation, matching the declared ON DELETE RESTRICT foreign keys and the existing catalog regression contract. The initial prepared test expected 23503; real PostgreSQL execution on 2026-10-12 exposed and corrected that test expectation without changing schema behavior.
