# CombinedRecoveryMigrationIT

Reconstructs the standalone Ticket 05 schema using the immutable master changelog bodies through 017 plus 019, omitting 018 and any future changesets while retaining the original resource path. It seeds synthetic verified-email, session and password-reset rows, then applies the combined changelog to real PostgreSQL.

The regression verifies 019's checksum and all seeded data remain unchanged, the missing 018 applies exactly once with a null replacement binding, and application startup plus restart retain those invariants. Each invocation owns a guarded disposable schema and a JUnit temporary changelog directory. Existing migration suites cover empty installation, dev-to-combined and 09-to-combined upgrades.
