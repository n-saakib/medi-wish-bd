# Product image concurrency fixture unit checks

Mirrors `tests/productImageConcurrencySupport.test.ts`.

The unit suite keeps the real harness-schema guard and replaces only `spawn`, `psql` and Playwright polling. A controlled child exposes writable/readable streams and records lock SQL and cleanup; no subprocess, database or application server starts.

Cases refuse missing schemas, empty/malformed/injected/noncanonical ids, missing or non-loopback hosts, and missing/invalid/non-isolated ports before spawning. Positive cases check readiness, missing-row refusal, repeated-id set semantics, exact owned Product selection, the statement bound, callback pid and rollback/exit. Failure cases prove private diagnostics stay out of the result, callback errors survive cleanup, and the watchdog kills only its own unresponsive child. Observer cases verify recursive checked-role SQL rooted at the exact holder, exclusion of the root, pid/count validation and rejection of a queue shorter than expected. Mocked units protect the SQL boundary; native PostgreSQL characterization separately proves direct and transitive waiters are counted correctly. Race cases verify collection after releasing the lock and settlement of remaining commands when another command fails.

Run `npx vitest run --project unit tests/productImageConcurrencySupport.test.ts`. These deterministic units protect the fixture's isolation and cleanup; the corresponding E2E tests still require real PostgreSQL to prove queueing, concurrency and durable image invariants.
