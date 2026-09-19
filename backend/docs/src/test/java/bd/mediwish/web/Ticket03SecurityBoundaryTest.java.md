# `Ticket03SecurityBoundaryTest.java`

Source: [`src/test/java/bd/mediwish/web/Ticket03SecurityBoundaryTest.java`](../../../../../../src/test/java/bd/mediwish/web/Ticket03SecurityBoundaryTest.java)

## Purpose

Adds focused Ticket 03 regression coverage for web-boundary cases not exercised by the existing bearer, CORS/CSRF, and controller tests. The tests use synthetic values and do not start PostgreSQL or exercise integration journeys.

## Verification

The suite rejects multiple, malformed, and oversized bearer header values before current-user verification, ignores an oversized refresh cookie at the web boundary, and checks that hosted refresh and CSRF cookies preserve their required Secure, HttpOnly, SameSite, and path boundaries. It also verifies that refresh-cookie clearing retains the same security scope.
