# `ApiExceptionHandlerTest.java`

Source: [ApiExceptionHandlerTest.java](../../../../../../../src/test/java/bd/mediwish/web/ApiExceptionHandlerTest.java)

## Purpose

Standalone MockMvc test of `ApiExceptionHandler`: each domain failure, including `MfaCodeInvalidException` (400), `MfaEnrollmentStaleException` (409) and `TooManyAttemptsException` (429), maps to its bounded `ApiError` status and code, and unreadable JSON is an invalid request whose error does not echo the body.

## Verification

13 tests.

Verified 2026-09-27 on the working tree over `bef3b76`: `./mvnw.cmd -o test` passed all 238 unit tests.

Ticket 11 extends this bounded error seam with InvalidProfileException, STALE_UPDATE and ACCOUNT_CLOSING, including private field-name redaction.
Standalone MockMvc checks each domain failure maps to its bounded correlated status/code, including Ticket 08's STALE_UPDATE, ROLE_CHANGE_REFUSED and NOT_FOUND. Unreadable JSON never echoes private body text. Unsupported media retains 415 for existing routes and returns the frozen 400 INVALID_REQUEST on administrative User commands. Response envelopes expose no diagnostic values.

Catalog additions cover invalid field/money, denied direct commands, absent records, stale writes, unpriced activation, duplicate category names and reused create ids. Named category SQL uniqueness failures translate to CATEGORY_NAME_TAKEN; another constraint or SQL state remains INTERNAL_ERROR without private row data.


Ticket 15 covers image errors and exact multipart upload-route size mapping, including non-POST, non-UUID and unrelated route exclusions.

Verified 2026-10-12 on working changes over 7555e2d: focused Maven unit invocation passed 60 tests with no failures or skips, including ProductImageServiceTest. Evidence: .scratch/ticket15-implementation-20261012/t4-units.log. Full integration/browser acceptance remains separate.
Ticket 16 checks both new conflict exceptions map to 409 with their exact externalized English messages and a server requestId.
Ticket 12 extends the real advice mapping matrix with five address failures and verifies bounded correlated errors without private values.

The existing parameterized privacy and error-envelope assertions now include all three recovery exceptions.
