# PublicCatalogControllerTest.java

Uses the standalone MVC boundary and a controlled public read model to check the three public JSON shapes, defaults and ignored query parameters, canonical page parsing, shared bounded 404 errors for malformed/repeated pages and UUIDs, and delegation of a past-last page to the service. The exact details projection assertion excludes staff fields. `PublicCatalogIT` covers database-backed behavior separately.

These tests were authored before the controller implementation. They passed in the 2026-10-21 final-tree backend run (`-o -Pcompatibility verify` on `c63359c` plus the Ticket 17 working tree: 999 unit and 348 integration tests, zero failures); see the [completion verification](<../../../../../../../../frontend/docs/ticket-17-e2e.md#completion-verification-2026-10-21>).
