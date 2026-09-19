# `RefreshCookieAdapter.java`

Source: [`src/main/java/bd/mediwish/web/RefreshCookieAdapter.java`](../../../../../../../src/main/java/bd/mediwish/web/RefreshCookieAdapter.java)

## Purpose

Keeps refresh-cookie serialization at the web boundary. The `MW_REFRESH` cookie is HttpOnly, Secure when `app.auth.cookie.secure` is enabled, SameSite=Lax, scoped to `/api/auth`, and given the configured refresh lifetime. Clearing uses the same path and attributes with `Max-Age=0`.

The adapter rejects duplicate, blank, or oversized incoming cookie values and bounds outgoing values to 4,096 characters. It never logs, hashes or serializes the raw value into JSON. Session services receive the raw value only through the controller-to-service seam.

Spring explicitly selects the configuration constructor because the adapter also exposes a two-argument constructor for isolated cookie-flag tests.

## Verification

Cookie flags, clearing and the oversized-value boundary are asserted through `AuthControllerTest` and `Ticket03SecurityBoundaryTest`; CSRF cookie behavior is asserted through `SecurityConfigurationTest`.
