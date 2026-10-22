# PublicCatalogControllerTest.java

Uses the standalone MVC boundary and a controlled public read model to check the three public JSON shapes, defaults and ignored query parameters, canonical page parsing, shared bounded 404 errors for malformed/repeated pages and UUIDs, and delegation of a past-last page to the service. The exact details projection assertion excludes staff fields. `PublicCatalogIT` covers database-backed behavior separately.

These tests were authored before the controller implementation. Maven execution is deferred while the shared Ticket 17 baseline owns `backend/target`; this page records test intent, not a passing result.
