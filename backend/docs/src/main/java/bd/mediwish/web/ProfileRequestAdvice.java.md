# ProfileRequestAdvice.java

Source: [ProfileRequestAdvice.java](../../../../../../../src/main/java/bd/mediwish/web/ProfileRequestAdvice.java)

## Purpose

Controller-specific advice maps non-JSON bodies on the profile command contract to 400 INVALID_REQUEST through ApiErrors. Older authentication controllers retain their 415 contract. Because `ApiExceptionHandler` also handles `HttpMediaTypeNotSupportedException` (Ticket 08: `400` on admin User commands, otherwise `415`), this advice is `@Order(Ordered.HIGHEST_PRECEDENCE)` so it always wins for the profile controller. Request correlation and no-store headers come from RequestCorrelationFilter; no private request values enter responses or logs.

ProfileControllerTest checks both write routes with text/plain.

The same ordered controller-scoped advice applies to AddressBookController so non-JSON address bodies produce bounded 400 INVALID_REQUEST.
