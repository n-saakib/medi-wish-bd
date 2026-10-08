# `StaffCategoryIT.java`

Source: [`src/test/java/bd/mediwish/catalog/StaffCategoryIT.java`](../../../../../../../src/test/java/bd/mediwish/catalog/StaffCategoryIT.java)

## Purpose

Checks case-insensitive category name uniqueness, rename and deactivation, retained product references and product counts. A new product cannot use an inactive category, while an existing product can keep it. Twenty-five mixed-case categories exercise stable three-page ordering, totals, inactive filtering and page bounds through HTTP. An idempotent category create retry compares the normalized current name and returns the current inactive record without writing.

## Verification

Three integration tests passed in the guarded PostgreSQL18 run on2026-10-06 at23:30:16, HEAD8b6924c plus WIP, alongside735units and all three StaffCatalogIT cases. Command: offline Maven verify with `-Dit.test=StaffCatalogIT,StaffCategoryIT` and explicit disposable TEST_DB credentials. The run released its own schemas and role; Ticket14 evidence contains the full command and result. Final full backend and compatibility cumulative gates also passed on2026-10-07; the backend index records final counts and logs.
