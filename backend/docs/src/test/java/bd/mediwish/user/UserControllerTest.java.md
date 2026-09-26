# `UserControllerTest.java`

Source: [`src/test/java/bd/mediwish/user/UserControllerTest.java`](../../../../../../src/test/java/bd/mediwish/user/UserControllerTest.java)

## Purpose

Tests the reduced User HTTP seam with a standalone MVC harness and request-correlation filter. Registration is intentionally tested through `AuthControllerTest` after the Ticket 03 controller split.

## Verification

The suite verifies that `/api/user/me` projects only the current verified principal, does not perform or require a second repository lookup, excludes password/role fields, and maps a missing principal to the bounded authentication error with a server-generated request ID.
