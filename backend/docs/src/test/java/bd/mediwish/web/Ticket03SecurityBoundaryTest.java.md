# `Ticket03SecurityBoundaryTest.java`

Source: [`src/test/java/bd/mediwish/web/Ticket03SecurityBoundaryTest.java`](../../../../../../src/test/java/bd/mediwish/web/Ticket03SecurityBoundaryTest.java)

## Purpose

Adds focused Ticket 03 regression coverage for web-boundary cases not exercised by the existing bearer, CORS/CSRF, and controller tests. The tests use synthetic values and do not start PostgreSQL or exercise integration journeys.

## Verification

The suite rejects multiple, malformed, and oversized bearer header values before current-user verification, ignores an oversized refresh cookie at the web boundary, and checks that hosted refresh and CSRF cookies preserve their required Secure, HttpOnly, SameSite, and path boundaries. The refresh-cookie fixture supplies an absolute session-family expiry; clearing retains the same security scope. Rejected CORS uses the bounded 403/no-store envelope with a server-generated UUID shared exactly by response header and error body (not the supplied test label). Oversized `application/json`, charset-qualified JSON, and `application/*+json` login and registration bodies are rejected before controller deserialization; oversized text/plain or content-type-free bodies retain normal MVC 415 handling. JSON bodies remain bounded when the declared length is unknown or understated.
