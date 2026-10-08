# `CatalogControllerTest.java`

Source: [`src/test/java/bd/mediwish/catalog/CatalogControllerTest.java`](../../../../../../../src/test/java/bd/mediwish/catalog/CatalogControllerTest.java)

## Purpose and boundary

Exercises the real catalog controller, JSON deserialization, production exception advice and request correlation through standalone MockMvc. Catalog services are the accepted HTTP seam's mocked boundary; no database or server is started. The synthetic verified principal is supplied through Spring Security's principal resolver. Authorization matchers and filter policy have separate web tests.

## Behavior

Category and product creation return 201 for a new result and 200 for a retry, preserving the stored activation, prices, counts and version. Medicine creation checks exactly the public product projection, including nullable string prices and history. Equipment creation admits omitted nullable medicine and optional text fields.

Category list checks the default inactive inclusion and page size, exact public page projection, explicit active-only pagination, an empty page beyond the result set, and ignored unknown query parameters. Pagination bounds and malformed integer/boolean query values must fail with bounded errors before either service is called.

Product list checks default filters and an exact public summary page: money stays a JSON string or null, and description, edit metadata and history are absent from list items. All status filters, literal search characters, uppercase canonical category UUIDs, review booleans, pagination, empty and 100-character search, and ignored unknown parameters are covered. Invalid recognized query values and 101-character search must be bounded before service calls.

Product detail checks the complete public projection, uppercase canonical UUIDs, malformed path IDs and the exact externalized not-found envelope. Category update checks its public projection and count, required string/boolean/integral version shapes, unknown fields and unreadable bodies. Versions must remain exact from zero through `Long.MAX_VALUE`; fractional, coerced, negative and overflowing values are refused before services.

Catalog update checks the exact public product projection, optional text and medicine fields omitted or null, required catalog and activation/review shapes, the full accepted version range, forbidden price/kind/ownership/inventory fields and canonical IDs. It leaves validation depending on the stored product kind and stale/no-op ordering to service tests.

Pricing checks decimal-string conversion and exact two-decimal response strings from 0.01 through 9,999,999.99, including valid leading zeros, equal price/MRP, omitted or null MRP and the full version range. Numeric JSON, scalar coercion, invalid ASCII decimal syntax, nonpositive amounts, excessive precision, oversized amounts, unknown fields and malformed IDs fail before services. Relationships between valid price and MRP remain service rules.

Each update route preserves bounded not-found and stale responses from its service. Category name collisions, unpriced activation and invalid catalog/pricing outcomes preserve the externalized error envelope, no-store header and a server-generated request ID without echoing submitted IDs or diagnostic fields. The seam verifies HTTP delegation and serialization; persistence, current-role enforcement and no-op/version ordering need their service and real-API tests.

Strict create cases reject unknown fields (including money, activation, ownership, version and inventory keys), missing/null required fields, scalar coercion, malformed UUIDs, unsupported kinds, non-object bodies and unreadable JSON. Each rejection must contain exactly the externalized INVALID_REQUEST envelope, carry a server-generated request ID, and leave both services untouched. Product text limits and rules needing the stored kind remain service tests.

## Verification

On 2026-10-06 at `8b6924c` plus Ticket 14 WIP, the adapter collaborator ran `.\mvnw.cmd -o '-Dmaven.repo.local=C:/Users/nsakib/.m2/repository' package` from `backend/`. It passed at 19:34:40 +06:00: 732 tests, zero failures/errors/skips, including all 427 controller cases, 24 exception-advice cases, 3 catalog-security cases and 14 shared security cases. The package produced the backend jar.

Each missing-handler tracer first failed with 404 or 405, then passed after its adapter was added. Query expansion exposed Spring coercion and ignored filters before strict catalog parsing was added. Focused green totals were 19 category-list, 33 product-list, 8 detail, 46 category-update, 95 catalog-update and 96 final pricing/update-error cases; the 130 existing create cases remained green in the full package.

These are HTTP adapter and unit results. This test-writing agent ran no Maven, database or server; real PostgreSQL, current-role/MFA enforcement, browser and cumulative integration gates belong to the owning root agent. No Ticket 14 completion is inferred from this suite.
