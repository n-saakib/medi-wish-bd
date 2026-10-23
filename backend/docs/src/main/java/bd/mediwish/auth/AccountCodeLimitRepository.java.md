# `AccountCodeLimitRepository.java`

Source: [AccountCodeLimitRepository.java](../../../../../../../src/main/java/bd/mediwish/auth/AccountCodeLimitRepository.java)

The native PostgreSQL UPSERT records typed-address requests atomically and returns the updated counter state. Requests over the accepted limit are still counted. Account issue and password counters are serialized by their User row lock and read through findByIdForUpdate (PESSIMISTIC_WRITE), so the SKIP LOCKED prune cannot delete a counter that a transaction has read and will update or delete. Expired windows are pruned by age; this operation is not a row-count-bounded batch.

## Ticket 05 integration

Cleanup uses a single native DELETE over old keys selected FOR UPDATE SKIP LOCKED. It cannot wait on active counter updates, and reset requests invoke it only after all User work. The atomic address upsert returns the updated counter state inside the current transaction; all attempts are stored, including refusals above ten.
