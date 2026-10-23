# ConcurrentProfileIT.java

Source: [ConcurrentProfileIT.java](../../../../../../../src/test/java/bd/mediwish/auth/ConcurrentProfileIT.java)

## Purpose

A dedicated guarded PostgreSQL schema and real application exercise stale-edit serialization, identical retry idempotency, pending-row replacement, uniqueness rollback, stale pending IDs and closure guards.

## Deterministic concurrency

An independent JDBC transaction holds the caller's row or an uncommitted unique identifier. Before release, awaitBlocked reads that connection's pg_backend_pid() and follows the recursive pg_blocking_pids waiting chain. It requires the expected one or two contenders to depend on that gate, including the second row-lock waiter behind the first; unrelated ungranted locks cannot satisfy the barrier. Bounded polling observes database state instead of assuming a scheduling delay.

HTTP futures assert 200/409 outcomes, version and returned profile state. A unique email failure rolls back name/version/email together; a unique mobile failure retains the pending row and original contact. Activation uses MobileChangeService directly, never an HTTP verifier.

Both closure orderings are covered. A closure committed before the blocked PUT yields ACCOUNT_CLOSING. For the reverse order, a run-schema deferred trigger pauses the real PUT at commit on a held advisory lock; the closure must wait behind the PUT in the same causal chain. Releasing the gate permits the saved edit to commit first and the closure to apply afterwards, preserving both the edit and CLOSURE_REQUESTED.

Tests remove the temporary trigger/function and close connections, workers, application and their own schema. Observation deadlines stay below the application socket timeout.

The email-collision PUT supplies current-password reauthentication so it still reaches the uncommitted unique-index collision and proves full profile rollback under Ticket 05.
