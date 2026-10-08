# `ApiExceptionHandler.java`

Source: [`src/main/java/bd/mediwish/web/ApiExceptionHandler.java`](../../../../../../../src/main/java/bd/mediwish/web/ApiExceptionHandler.java)

Package-private production advice maps controller/domain failures to the shared externalized `{code, message, requestId}` envelope. It returns no submitted field, SQL diagnostic or exception text and logs nothing.

| Failure | Response |
| --- | --- |
| Invalid authentication/registration/catalog/money request or unreadable JSON | `400 INVALID_REQUEST` |
| Duplicate User | `409 DUPLICATE_USER` |
| Authentication failed/required | Matching `401` code |
| Invalid MFA code, stale enrollment, throttle | `400 MFA_CODE_INVALID`, `409 MFA_ENROLLMENT_STALE`, `429 TOO_MANY_ATTEMPTS` |
| Catalog command access denied | `403 ACCESS_DENIED` |
| Missing catalog record | `404 NOT_FOUND` |
| Stale changed intent, unpriced activation, category name collision, reused create id | `409 STALE_UPDATE`, `PRICE_REQUIRED`, `CATEGORY_NAME_TAKEN`, `ID_CONFLICT` |
| Database/transaction failure | Named category uniqueness becomes `409 CATEGORY_NAME_TAKEN`; other failures remain `500 INTERNAL_ERROR` |

`persistenceFailure` examines the exception cause chain only for Hibernate constraint `uk_product_categories_name` and SQL state `23505`. Translation happens after the service transaction has rolled back; it performs no read or retry in the aborted transaction. Other constraints and SQL states cannot become category name collisions.

Security exceptions from the chain use its bounded access handler. CORS, bearer and body-limit filters write through ApiErrors directly. RequestCorrelationFilter supplies server correlation and no-store to all responses; framework/container failures reach ApiErrorController.

ApiExceptionHandlerTest proves each mapping, named constraint/state selectivity and unreadable JSON redaction. CatalogControllerTest uses this real advice for strict HTTP shape failures.
The stale-update handler consumes the shared web.StaleUpdateException so catalog and other staff features reuse the same HTTP error contract.

Shared-contract correction verification on 2026-10-08, revision b357d50 plus Ticket 14 completion changes: guarded offline Maven `verify` passed 746 unit tests and 160 executed integration tests (one compatibility-only skip) at 09:56:32 Asia/Dhaka in 4:31. Guarded `-Pcompatibility verify` passed 746 unit tests and all 161 integration tests at 10:03:49 in 6:22, with zero failures/errors/skips. Both runs released their owned schemas and role; the final mw_run role count was zero. Existing service and HTTP seam tests preserve the same no-op/stale behavior after moving the exception to the shared web package. Logs: main-checkout `.scratch/ticket14-verification/completion-full-backend-20261008.log` and `completion-full-compatibility-20261008.log`. These are automated backend gates; final manual browser evidence remains separately required.
