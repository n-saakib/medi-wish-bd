# `tests/browser/catalogDatabase.spec.ts`

Source: [`../../../tests/browser/catalogDatabase.spec.ts`](../../../tests/browser/catalogDatabase.spec.ts)

## Purpose

Ticket 14's database guarantees, checked with `psql` in the run's schema after the test API has migrated it. Each check runs in a transaction that is rolled back ([`rolledBackSql`](testApi.ts.md)), so no row is left behind. Every test is tagged `@t14` and `@t14-T2`.

## Tests

- **E2E-14-01** — no stock, reservation, batch, expiry or pack table or column exists; every money column (`selling_price`, `mrp` and the four history columns) is `numeric(9,2)`, so at most 9,999,999.99; no money column is `real` or `double precision`; the required columns exist.
- **E2E-14-02** — a valid row is accepted first, then the database refuses, by constraint name, an active unpriced Product, a price above the MRP, a zero or negative amount, a Medicine without its required fields, `10000000.00` (numeric field overflow) and the other invalid rows of plan §4.5.
- **E2E-14-03** — category names are unique ignoring case (`uk_product_categories_name`); deleting a referenced category, or a Product with history, fails on its `RESTRICT` foreign key; the change type `DELETED` is refused. The assertion accepts PostgreSQL's precise optional `RESTRICT setting of` wording while still requiring a foreign-key violation.

## Verification

The first `@t14-T[23]` browser run passed E2E-14-02 and all T3 cases in both browsers (8 passed, 4 failed overall). E2E-14-01 and E2E-14-03 failed in both browsers because Windows `psql` returned CRLF lines and PostgreSQL 18.6 included `RESTRICT setting of` in its foreign-key error text. The tests now split lines with `/\r?\n/` and accept that exact optional phrase. The corrected checks subsequently passed in both browser projects, including the 68-check T2/T3/T4 cumulative gate on 2026-10-06. Dated Ticket 14 evidence records the commands and candidate identity. Run this database slice with `npm run test:browser -- --grep @t14-T2`; later ticket and full-story gates remain separate.

E2E-14-02 additionally refuses active NaN selling price and NaN MRP through raw SQL using the forward finite-money guards. Existing finite positive controls remain.
