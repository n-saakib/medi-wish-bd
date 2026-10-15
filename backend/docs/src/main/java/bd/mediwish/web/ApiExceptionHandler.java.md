# `ApiExceptionHandler.java`

Source: [ApiExceptionHandler.java](../../../../../../../src/main/java/bd/mediwish/web/ApiExceptionHandler.java)

Maps controller/domain failures to the correlated bounded envelope without logging exception text. Validation, registration shape and unreadable JSON are INVALID_REQUEST; duplicate identities conflict; authentication, MFA and throttle failures retain existing codes. Persistence/transaction failures become INTERNAL_ERROR.

Ticket 08 maps StaleUpdateException to 409 STALE_UPDATE, RoleChangeRefusedException to 409 ROLE_CHANGE_REFUSED and UserNotFoundException to 404 NOT_FOUND. Unsupported media on administrative User routes is 400 INVALID_REQUEST as frozen for those commands; existing credential routes retain 415 INVALID_REQUEST. Security AccessDeniedException still reaches the security denial handler. Filter failures use ApiErrors directly.

| Exception | Response |
| --- | --- |
| `InvalidRequestException`, `UserService.InvalidRegistrationException`, `HttpMessageNotReadableException`, `InvalidProfileException`, `InvalidCatalogException`, `InvalidMoneyException` | `400 INVALID_REQUEST` |
| `StaleUpdateException` (shared, `bd.mediwish.web`; Tickets 08, 11 and 14) | `409 STALE_UPDATE` |
| `CatalogAccessDeniedException` | `403 ACCESS_DENIED` |
| `CatalogNotFoundException` | `404 NOT_FOUND` |
| `PriceRequiredException`, `CategoryNameTakenException`, `IdConflictException` | `409 PRICE_REQUIRED`, `CATEGORY_NAME_TAKEN`, `ID_CONFLICT` |
| `RoleChangeRefusedException` | `409 ROLE_CHANGE_REFUSED` |
| `UserNotFoundException` | `404 NOT_FOUND` |
| `HttpMediaTypeNotSupportedException` | `400 INVALID_REQUEST` on `/api/admin/users/**`, otherwise `415 INVALID_REQUEST` |
| `AccountClosingException` | `409 ACCOUNT_CLOSING` |
| `UserService.DuplicateUserException` | `409 DUPLICATE_USER` |
| `AuthenticationFailedException` | `401 AUTHENTICATION_FAILED` |
| `AuthenticationRequiredException` (including `SessionReplayException`) | `401 AUTHENTICATION_REQUIRED` |
| `MfaCodeInvalidException` | `400 MFA_CODE_INVALID` |
| `MfaEnrollmentStaleException` | `409 MFA_ENROLLMENT_STALE` |
| `TooManyAttemptsException` | `429 TOO_MANY_ATTEMPTS` |
| `DataAccessException`, `TransactionException` | `409 CATEGORY_NAME_TAKEN` for the named category uniqueness violation, otherwise `500 INTERNAL_ERROR` |

`persistenceFailure` examines the exception cause chain only for Hibernate constraint `uk_product_categories_name` and SQL state `23505`. Translation happens after the service transaction has rolled back; it performs no read or retry in the aborted transaction. Other constraints and SQL states cannot become category name collisions.

Security exceptions from the chain use its bounded access handler. CORS, bearer and body-limit filters write through ApiErrors directly. RequestCorrelationFilter supplies server correlation and no-store to all responses; framework/container failures reach ApiErrorController.

ApiExceptionHandlerTest proves each mapping, named constraint/state selectivity and unreadable JSON redaction. CatalogControllerTest uses this real advice for strict HTTP shape failures.
The stale-update handler consumes the shared web.StaleUpdateException so catalog and other staff features reuse the same HTTP error contract.

`ApiExceptionHandlerTest` maps each listed failure, including the three MFA failures and Ticket 08's role and not-found failures, to its status and code and proves unreadable JSON is `400` without echoing the body. The auth integration tests cover these errors over real HTTP and PostgreSQL, including captured-log privacy.

It also covers Ticket 14's catalog failures, including the named category uniqueness translation, without echoing row data.


Ticket 15 maps invalid images, image limit and storage outages to IMAGE_INVALID, IMAGE_LIMIT_REACHED and STORAGE_UNAVAILABLE. Multipart size exceptions use IMAGE_INVALID only for POST on the exact UUID-shaped image upload route; all other multipart shape/size errors use INVALID_REQUEST. The product image ordering unique constraint maps to STALE_UPDATE. Inputs and storage diagnostics never enter ordinary error bodies.
Ticket 16 maps DiscountEndedException to 409 DISCOUNT_ENDED and DiscountExceedsPriceException to 409 DISCOUNT_EXCEEDS_PRICE. Both retain the exact three-field correlated envelope without exception details.
Ticket 12 maps five address domain exceptions to bounded INVALID_REQUEST, NOT_FOUND, ID_CONFLICT, ADDRESS_BOOK_FULL and ADDRESS_CHANGE_LIMIT_REACHED responses; field and persistence details remain private.
