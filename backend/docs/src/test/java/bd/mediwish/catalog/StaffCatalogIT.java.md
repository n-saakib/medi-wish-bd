# `StaffCatalogIT.java`

Source: [`src/test/java/bd/mediwish/catalog/StaffCatalogIT.java`](../../../../../../../src/test/java/bd/mediwish/catalog/StaffCatalogIT.java)

## Purpose

Exercises the Moderator create → unpriced refusal → Admin pricing → activation → review flag → deactivation path over real HTTP and PostgreSQL. It checks exact decimal storage, ordered audit changes, inactive equipment without MRP, filtering, literal search characters, restart durability, anonymous access and the create retry contract (`201`, `200`, `ID_CONFLICT`).

## Verification

Three integration tests passed in the guarded PostgreSQL18 run on2026-10-06 at23:30:16, HEAD8b6924c plus WIP, alongside735units and all three StaffCategoryIT cases. Command: offline Maven verify with `-Dit.test=StaffCatalogIT,StaffCategoryIT` and explicit disposable TEST_DB credentials. The run released its own schemas and role; Ticket14 evidence contains the full command and result. Final full backend and compatibility cumulative gates also passed on2026-10-07; the backend index records final counts and logs.
