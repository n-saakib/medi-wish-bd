# Product image concurrency fixture

Mirrors `tests/browser/productImageConcurrencySupport.ts`.

`withProductLock(ids, action)` starts one bounded `psql` child, holds row locks on the synthetic Products and passes the lock client's backend pid to the action. It waits for a readiness marker and verifies that every distinct requested Product id was returned in lock order before the action, and rolls back and reaps the child in `finally`; a five-second watchdog terminates only that child if cleanup hangs. Database diagnostics are consumed without printing them.

`blockedRequests(pid, count)` recursively follows `pg_blocking_pids` from the exact owned pid through waiters in the harness role until the expected number of HTTP transactions are actually queued. Same-row PostgreSQL waiters can block behind each other rather than naming the original holder; recursive traversal counts that chain. `UNION` deduplicates waiters and terminates cycles, and the root holder is excluded from the count. This proves overlap without arbitrary sleeps. It rejects invalid process ids and request counts before issuing SQL.

`race(ids, commands)` launches the commands under the lock, observes the queue, releases the lock and collects the HTTP results. If observation or any command fails, it settles every outstanding command before returning the failure, including synchronous command exceptions.

Every operation requires the checked `mw_browser_<12 hex>` schema. The lock also requires canonical lowercase Product UUIDs and an explicit loopback database host on isolated port 55432 or 55433; it always targets `medi_wish_test` and never falls back to port 5432. SQL goes through standard input, and no global Git, process or database settings change.

The recovery E2E suite uses these helpers against real PostgreSQL and independent HTTP actor sessions. `tests/productImageConcurrencySupport.test.ts` separately checks guards, readiness, scoped SQL, rollback, diagnostic suppression, the cleanup watchdog and outstanding-command settlement with controlled child streams. Those units validate fixture behavior, not PostgreSQL locking or image business rules.
