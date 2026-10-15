# AddressChangeLimitIT.java

Source: [src/test/java/bd/mediwish/auth/AddressChangeLimitIT.java](../../../../../../../src/test/java/bd/mediwish/auth/AddressChangeLimitIT.java).

Exercises Ticket 12 observable address-book behavior against the real application and a guarded PostgreSQL 18 schema. Tests use synthetic values, the existing AuthApi client, and run-owned schema cleanup; no production test endpoint is added.

Uses a resettable address-only calendar to prove weekly/monthly limits, Dhaka half-open boundaries at microsecond precision, a week spanning months, pruning, exact allowance counts, retry/non-counting rules, each sole role and configuration overrides. Authentication tokens and address creation timestamps keep real time. The A10 recreate-after-removal limitation is pinned.
Additional fixtures pin both cutoff orderings and equal starts: GET/replay/identical/stale/invalid requests keep old history; deferred commit failure rolls pruning back; successful edit drops only rows strictly before the minimum start. Exact month/year starts reset only the month. Independent monthly override proves configuration reaches enforcement and allowance.
A seeded exact-start/exact-end fixture independently proves both SQL count ranges are half-open: week start counts, week end is excluded from week but counted in month, and month end is excluded from month.
A full weekly allowance with an obsolete row proves a limit refusal rolls the pre-count prune back; deleting afterward remains free and leaves the same history intact.
