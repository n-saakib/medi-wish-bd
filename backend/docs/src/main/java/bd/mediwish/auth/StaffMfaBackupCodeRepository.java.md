# `StaffMfaBackupCodeRepository.java`

Source: [`src/main/java/bd/mediwish/auth/StaffMfaBackupCodeRepository.java`](../../../../../../../src/main/java/bd/mediwish/auth/StaffMfaBackupCodeRepository.java)

Public Spring Data repository for `StaffMfaBackupCode`. First enrollment saves ten protected verifiers. Recovery loads only unused rows for the active factor and matches them outside the transaction.

| Operation | Behavior |
| --- | --- |
| `findByFactorIdAndConsumedAtIsNull` | Returns unused verifiers for one factor. |
| `consume(id, factorId, at, sessionId)` | Conditional update of both consumed fields only while `consumed_at IS NULL`; zero updated rows is a counted wrong-code result. |
| `deleteByFactor` | Deletes used and unused old-factor rows at verified replacement. |
| `deleteUnusedByFactor` | Deletes only unused active-factor rows before regeneration inserts ten new verifiers. |

Mutations flush pending changes but never clear the persistence context, preserving the locked User and managed factors. Callers own the User lock and transaction. Unit tests protect decision/ordering; PostgreSQL integration is required to prove atomic updates and constraint behavior.
