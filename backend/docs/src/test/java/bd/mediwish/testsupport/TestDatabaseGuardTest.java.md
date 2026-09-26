# `TestDatabaseGuardTest.java`

Source: [`src/test/java/bd/mediwish/testsupport/TestDatabaseGuardTest.java`](../../../../../../../src/test/java/bd/mediwish/testsupport/TestDatabaseGuardTest.java)

## Purpose

Database-free unit test of the `TestDatabase` destructive boundary: the `medi_wish_test`/run-owned schema allow-list; category-specific messages for a wrong database, version or role and for missing or blank roles; `CREATEDB` and `CREATEROLE` rejection; and literal `.env` parsing (values containing `=`, comments and malformed lines).

## Verification

5 tests; run alone with `./mvnw.cmd -o -Dtest=TestDatabaseGuardTest test` from `backend/`.

Verified 2026-09-26 on `72634a6`: `./mvnw.cmd -o verify` passed 171 unit and 106 integration tests (1 expected compatibility skip); `./mvnw.cmd -o -Pcompatibility verify` passed 171 and 106 with no skip.
