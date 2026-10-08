# `tests/browser/catalogApi.spec.ts`

Source: [`../../../tests/browser/catalogApi.spec.ts`](../../../tests/browser/catalogApi.spec.ts)

## Purpose

Ticket 14's API behaviour through the real routes of the plan's §4.2, as the staff pages and any other HTTP client reach them, with the Playwright `request` API and the [`catalogSupport.ts`](catalogSupport.ts.md) actors. Database state is read with `psql` inside a rolled-back transaction. Every test is tagged `@t14` and `@t14-T4`.

## Tests

- **Access (E2E-14-07 to 12)** — anonymous callers get `401` with `WWW-Authenticate: Bearer` on every route; Customers and DeliveryPersons get `403 ACCESS_DENIED` and unverified staff `403 MFA_REQUIRED`; a Moderator's pricing call gets `403` whatever its body, and nothing changes; replacing ADMIN with MODERATOR in SQL stops pricing on the very next call while the catalog still answers, demotion to CUSTOMER (`removeRole`) stops the catalog too, and granting ADMIN again restores pricing; `DELETE` changes nothing; the CORS preflight from the frontend origin allows `PUT`.
- **Categories (13 to 16)** — create, idempotent retry, sorting across pages (read with `allCategories`, because the shared schema may put a test's category on any page), rename and deactivation by both roles; `CATEGORY_NAME_TAKEN` ignoring case; `STALE_UPDATE` with its exact message; names of 1–80 characters and strict request fields; an inactive category cannot be chosen but keeps its Products.
- **Products (17 to 25)** — a Moderator's Medicine is inactive, unpriced and `NEEDS_PRICE` with one `CREATED` row; kind-specific required fields, trimming and exact text limits; money, activation, `kind` and other unexpected fields are refused; `CATALOG_UPDATED` and no-op identical saves; `409 PRICE_REQUIRED` for both roles; Admin pricing, Moderator activation and history kept on deactivation; optional MRP with price ≤ MRP; exact decimal-string money from `0.01` to `9999999.99`, never coerced from JSON numbers.
- **Concurrency and audit (26 to 28)** — stale saves, shared-version forms and lost-response retries; concurrent saves, creates and case-twin category names (E2E-14-27 checks outcomes only; the deterministic interleaving is the backend `ConcurrentCatalogIT`); old and new values of price, MRP and review flag, newest first, at most 20.
- **Role hierarchy (45)** — each actor holds exactly one role (DECISIONS S6), read back with the spec's `storedRoles`; an Admin who never held MODERATOR renames a category, creates, edits, prices, activates and deactivates a Product; a Moderator edits it but is refused pricing; a DeliveryPerson and a Customer get `403 ACCESS_DENIED` on every catalog and pricing route; the stored prices are the Admin's.
- **Create retries (46)** — the same id with the same payload after trimming returns `200` and the stored Category or Product with no second `CREATED` row; the same id with a different category name (even in another case) or any different compared Product field returns `409 ID_CONFLICT` and changes nothing.
- **Create retries after later changes (50)** — the retry is compared with the stored record as it is now (C10): a category's original create still returns `200` after the category is deactivated and `409 ID_CONFLICT` after a rename; a Product's original create returns `200` with the current record and no new history row after pricing, activation and its category's deactivation, and `409 ID_CONFLICT` after a catalog edit (which keeps the unchanged inactive category), changing nothing.
- **Category paging (47)** — exact page keys, default page 0 and size 20, pages walked at size 7 never overlap and add up to `totalItems`, this run's categories come in name order, a page past the end is empty, invalid `page`, `size` or `includeInactive` → `400`; the 21st of 21 `0 Paged …` categories is never on the first page and is renamed and deactivated there.
- **List and privacy (29, 30)** — search on name, brand and generic with literal `%` and `_`, filters, paging, exact summary keys and invalid queries; the API log never holds product text, search terms or prices.

The valid 100-character query assertion is restricted to the test's own category: exact-limit fixtures from earlier cases legitimately contain long runs of `x`, so they must not turn a correct search into a false failure.

## Verification

The corrected T2/T3/T4 cumulative browser gate passed all 68 checks across Chrome and Edge on 2026-10-06. Every successful response is also checked for `Cache-Control: no-store` (`expectJson`). Run this gate with `npm run test:browser -- --grep @t14-T4` plus earlier Ticket 14 gates; dated ticket evidence records the commands and candidate identity, while later cumulative gates remain separate.
