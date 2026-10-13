# `tests/productImageSupport.test.ts`

Guards for public URL generation, optimizer origin and owned storage namespace/path confinement; deliberate optimizer attack inputs remain unmodified.

Run `npx vitest run --project unit tests/productImageSupport.test.ts`. These test synthetic fixture integrity and filesystem/input guards without a backend, browser or real storage writes. Execution results are recorded in the Ticket 15 E2E evidence.

Storage checks bind the exact worktree storage root and current schema suffix, refuse namespace/Product symlinks and never select a sibling run directory.

Successful image response guard tests accept correlated no-store responses and fail for missing/empty correlation, missing no-store or failed statuses. The browser/API helper applies the guard to successful lists, uploads/replays, alt edits, reorder and remove.

Projection characterization accepts null, ordinary text, NBSP/BOM edge characters and exactly 160 UTF-16 code units; it rejects empty or ASCII-padded stored text, ISO controls and 161 code units. These assertions distinguish the accepted Java catalog rules from JavaScript trim semantics.
