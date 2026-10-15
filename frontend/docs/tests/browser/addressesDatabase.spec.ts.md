# `tests/browser/addressesDatabase.spec.ts`

Checks Ticket 12's real `017-saved-addresses` migration inside the browser harness's guarded PostgreSQL schema.
Each raw SQL probe uses `rolledBackSql`, so accepted and refused fixtures leave no address rows or deleted Users.

- E2E-12-80 verifies exact table columns, text lengths, nullability, UUID/BIGINT/boolean/timestamptz types and the named primary, default and lookup indexes. PostgreSQL constraint metadata must identify actual primary keys with their accepted table, name and ordered columns; an ordinary unique index with a primary-key name cannot pass.
  If migration 017 is absent, it reports the missing tables before attempting to parse their column metadata.
- E2E-12-81 verifies positive boundary fixtures, required columns, text/mobile/version checks, length limits and both User foreign keys. Rolled-back inserts with omitted `is_default` and `version` prove their actual `false`/`0` defaults; omitting the client-supplied address id must fail its not-null constraint. These behavior checks do not depend on PostgreSQL's normalized default-expression text.
- E2E-12-82 proves the same address id and one default may exist in two Users' books, duplicate own ids and second defaults are refused, and the three-address cap remains an application rule rather than a schema count constraint (ADR-0009). Eleven change-log rows at the current timestamp also prove the installed schema accepts history beyond both default change limits; a subsequent query proves rollback leaves none. This schema probe does not exercise service configuration overrides or bypass API enforcement. Same-city, mixed-city and entirely non-Dhaka duplicate defaults must all violate the named default index, catching an incorrectly narrowed city predicate.
- E2E-12-83 proves User deletion cascades both tables and no foreign key references `saved_addresses`, the accepted Ticket 25 snapshot boundary (A4). Its cascade query must report no SQL error and exactly two rows, `1:1` before deletion and `0:0` afterwards, accepting native Windows CRLF and Unix LF line endings. It does not claim to exercise future Order snapshots.

E2E-12-82 also rejects duplicate defaults across null/non-null label combinations and initial/advanced versions. These behavioral fixtures catch an index that silently stops protecting edited or labelled rows without depending on PostgreSQL's predicate formatting.

Tags select `@t12`, T2 migration/data guarantees and regression boundary coverage. Every case first becomes executable after T2 installs the migration. Empty-database installation and pre-017 upgrade checks remain backend `AddressMigrationIT`; this suite exercises the schema installed by the real browser harness.
