# ConcurrentRecoveryIT.java

Source: [ConcurrentRecoveryIT.java](../../../../../../../src/test/java/bd/mediwish/auth/ConcurrentRecoveryIT.java)

## Purpose

Real HTTP requests and a run-owned PostgreSQL schema cover password-reset confirmation and issuance
races with old-code invalidation on replacement, reset versus email change, email change versus refresh, wrong-code locking, address-rate-limit
increments, a reset request whose email becomes stale while it waits for the User row, and cleanup that
must skip a locked issue counter.

## Deterministic ordering

For User-row races, a second JDBC transaction holds `SELECT ... FOR UPDATE`. The test observes the
recursive `pg_blocking_pids` chain until the expected application requests are waiting, then commits
the gate. This proves the operations overlap at their persistence boundary and avoids timing sleeps.
The refresh case holds the email-change request at that same User lock, completes a refresh for
another session, then releases the change and verifies the rotated session is revoked.

The counter-cleanup case ages a User's `issue:<id>` row past retention and inserts an aged unlocked
control row. A second JDBC transaction holds `SELECT ... FOR UPDATE` on the User's row, standing in
for an issuer that read it through `findByIdForUpdate`. A reset request for another address must return
`202` without waiting, its cleanup deletes the control row, and the locked row survives unchanged
after the gate commits.

The twelve-request address-limit case starts all HTTP calls from one latch. A test-only stepping Clock
advances enough between eligible user-code issuances to keep the per-User resend gap from masking the
separate address limit. The isolated test app uses a larger Hikari pool so all requests can execute
concurrently; assertions distinguish twelve recorded attempts from the ten requests that create an
audit event and captured message.

Every integration application and schema is closed by the test. The source is part of the Ticket 05
cumulative integration suite; execution results belong in the ticket evidence.
