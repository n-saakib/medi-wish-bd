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