# ConcurrentProductImageIT.java

Real HTTP and PostgreSQL regression checks for Product-image commands. Controlled Product row locks and a recursive PostgreSQL lock-queue observer establish overlapping requests without sleeps. Covers last-slot enforcement, identical-id replay with zero/seven existing images, optimistic alt-text edits, complete-order stale checks, removal/reorder position compaction, cancelled response followed by durable replay, and restart adoption of matching orphan bytes. Mismatching orphan bytes remain untouched.

Uses the existing guarded run-owned database and storage namespace, a longer JDBC timeout, bounded queue/future deadlines and finally-released locks. Does not weaken or alter production behavior. Actual results are recorded in the Ticket 15 evidence after execution.
