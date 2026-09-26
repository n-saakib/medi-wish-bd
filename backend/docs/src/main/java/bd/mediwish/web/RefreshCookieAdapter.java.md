# `RefreshCookieAdapter.java`

Source: [`src/main/java/bd/mediwish/web/RefreshCookieAdapter.java`](../../../../../../../src/main/java/bd/mediwish/web/RefreshCookieAdapter.java)

## Purpose

Keeps refresh-cookie serialization at the web boundary. The `MW_REFRESH` cookie is HttpOnly, Secure when `app.auth.cookie.secure` is enabled, SameSite=Lax, and scoped to `/api/auth`. Its `Max-Age` is calculated from the session family's absolute expiry, capped at the configured refresh lifetime, so rotation cannot extend browser retention beyond server validity. Clearing uses the same path and attributes with `Max-Age=0`.

Refresh parsing rejects duplicate, blank, or oversized incoming values. Logout uses a separate reader that collects distinct, nonblank candidates within the same 4,096-character bound, so every session family represented by a duplicate-cookie request can be revoked before the response clears the cookie. Invalid candidates are ignored, preserving idempotent logout when no usable credential is present. The adapter never logs, hashes or serializes raw values into JSON; session services receive them only through the controller-to-service seam.

The adapter uses the shared authentication `Clock` for expiry calculations; the duration/secure constructor remains available for isolated read-boundary tests.

## Verification

Cookie flags, family-expiry-bounded `Max-Age`, clearing and the oversized-value boundary are asserted through `AuthControllerTest` and `Ticket03SecurityBoundaryTest`; CSRF cookie behavior is asserted through `SecurityConfigurationTest`.
