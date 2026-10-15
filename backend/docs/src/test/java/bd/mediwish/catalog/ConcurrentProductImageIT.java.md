# ConcurrentProductImageIT.java

Real HTTP and PostgreSQL regression checks for Product-image commands. Controlled Product row locks and a recursive PostgreSQL lock-queue observer establish overlapping requests without sleeps. Covers last-slot enforcement, identical-id replay with zero/seven existing images, optimistic alt-text edits, complete-order stale checks, removal/reorder position compaction, cancelled response followed by durable replay, and restart adoption of matching orphan bytes. Mismatching orphan bytes remain untouched.

Uses the existing guarded run-owned database and storage namespace, a longer JDBC timeout, bounded queue/future deadlines and finally-released locks. Does not weaken or alter production behavior. Actual results are recorded in the Ticket 15 evidence after execution.

A second application sharing the database/storage pauses an upload inside storage put. A competing upload for another Product must join the observed PostgreSQL lock queue, then return ID_CONFLICT after the owner commits without creating a loser object. Removing the winner leaves a durable retired ID: another upload conflicts, both Products have no image rows, no objects remain and its public URL is 404. The gate always releases in finally; the test never waits for a blocked competitor to finish before releasing its owner.
