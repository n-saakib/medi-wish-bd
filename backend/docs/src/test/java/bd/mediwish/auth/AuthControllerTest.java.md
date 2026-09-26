# `AuthControllerTest.java`

Source: [`src/test/java/bd/mediwish/auth/AuthControllerTest.java`](../../../../../../../src/test/java/bd/mediwish/auth/AuthControllerTest.java)

## Purpose

Tests the `/api/auth` controller at its public HTTP seam using Mockito-backed T2 services, standalone MockMvc and request correlation.

## Verification

The tests cover Ticket 02 registration projection compatibility and the bounded `INVALID_REQUEST` response for a whitespace-only registration password. Login accepts identifier/password lengths at their 320/128 limits (the password bound is wider than registration's 30) and rejects one character beyond either cap before authentication. Other cases cover safe login JSON, Bearer metadata, the bounded separate-origin CSRF bootstrap projection, no-store headers, server-generated UUID request correlation, refresh-cookie flags and path, and a refresh response whose cookie `Max-Age` equals only the remaining session-family lifetime. Bounded invalid-login errors, generic authentication failures, missing refresh credentials and idempotent logout cookie clearing remain covered. The logout mapping also passes every distinct, bounded nonblank `MW_REFRESH` value and ignores empty or oversized duplicates. These tests do not claim PostgreSQL revocation or CSRF filter integration.
