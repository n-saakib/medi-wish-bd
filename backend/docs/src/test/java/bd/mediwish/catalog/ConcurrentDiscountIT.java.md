# ConcurrentDiscountIT.java

Real PostgreSQL concurrency suite with independent verified Admin sessions, `CyclicBarrier` gates and controlled row/unique locks. Recursive `pg_blocking_pids` observation proves both write requests overlap before releasing the blocker; no sleep or retry can conceal a missing race.

Same-version value changes yield one success and one stale conflict. Identical simultaneous creates yield one 201/one 200, one durable Discount and one CREATED audit. End versus changed edit yields one success and a STALE_UPDATE loser, with one version/audit increment. A public read while an update is observed blocked returns the complete committed old tuple; after release it returns the complete new tuple with one update audit.

Each run owns its schema/application and uses the existing 15-second JDBC concurrency timeout. PostgreSQL lock observations and future five-run validation require the real migration/core implementation; test creation is not passing concurrency evidence.

Additional observed-lock races cover differing create payloads sharing one identity (201/ID_CONFLICT with persisted winner value), identical changed PUTs at the old version (two 200s, one UPDATED audit), and identical End-now calls (two 200s, one ENDED audit/version increment and durable ended timestamp).

The blocked-writer read finishes before commit and then checks a fresh read after commit. A separate materialization test registers an explicit, non-scanned `@Primary CurrentPrices` subclass and pauses after loading the Product but before querying candidate Discounts. A JDBC transaction atomically changes selling price, Category membership and both Category discounts, then commits before the read resumes. The in-flight anonymous HTTP read must return the complete old 100.00/10%/90.00 tuple; the fresh read returns the complete new 200.00/30%/140.00 tuple. A mixed old Product/new 40% candidate would produce 60.00 and fail. Bounded latches release in `finally`; no production synchronization hook is added. This prepared test requires execution before it counts as proof.

The differing-edit race binds the successful callable to its expected percentage and Admin, checks the response and complete durable semantic payload, and requires the UPDATED audit value, actor, timestamp and request correlation to match that acknowledged intent. The fresh effective price must match that winner rather than either candidate.

The differing-create and End-versus-update races also derive their expected value/status and Admin from the successful callable's position, never from response content. They require the exact success projection, durable semantic fields/timestamps and corresponding CREATED or ENDED/UPDATED audit snapshot, actor and request ID. Fresh price and applied-discount identity must agree with the independently known successful intent.
