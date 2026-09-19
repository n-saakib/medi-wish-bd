# `AuthControllerTest.java`

Source: [`src/test/java/bd/mediwish/auth/AuthControllerTest.java`](../../../../../../src/test/java/bd/mediwish/auth/AuthControllerTest.java)

## Purpose

Tests the `/api/auth` controller at its public HTTP seam using Mockito-backed T2 services, standalone MockMvc and request correlation.

## Verification

The tests cover Ticket 02 registration projection compatibility, safe login JSON, Bearer metadata, the bounded separate-origin CSRF bootstrap projection, no-store/correlation headers, refresh-cookie flags and path, bounded invalid-login errors, generic authentication failures, missing refresh credentials and idempotent logout cookie clearing. They do not claim PostgreSQL rotation or CSRF filter integration.
