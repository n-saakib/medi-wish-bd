# `SecurityConfiguration.java`

Source: [`src/main/java/bd/mediwish/web/SecurityConfiguration.java`](../../../../../../../src/main/java/bd/mediwish/web/SecurityConfiguration.java)

## Purpose and reasoning

The current development slice adds stateless HTTP Basic authentication for the shared User resource. Registration and health probes remain public; the common User profile route requires an authenticated User. Passwords are encoded with Argon2 before persistence and current role assignments are loaded from PostgreSQL for authorization. Local browser calls are limited by an explicit CORS allow-list.

`SecurityConfiguration` defines the shared HTTP security boundary. Staff and OAuth authentication remain out of scope. OTP verification is also deferred in this slice.

Authentication lookups apply the same trim/lowercase username normalization as registration, so accepted identifier normalization is consistent across both operations.

## Class and method

| Member | Behavior and use case |
| --- | --- |
| `SecurityConfiguration` | Package-private configuration class; its scope is the shared HTTP security policy. |
| `security(HttpSecurity http, ApiErrors errors)` | Builds one stateless `SecurityFilterChain`. It disables CSRF and request caching for the current HTTP Basic API, enables the configured CORS allow-list, permits error dispatches, permits `GET` and `HEAD` for `/actuator/health/liveness` and `/actuator/health/readiness`, permits registration, requires authentication for `/api/user/**`, denies all other requests, preserves the HTTP Basic challenge on 401 responses and routes bounded authentication/authorization failures through `ApiErrors.write`. |
| `passwordEncoder()` | Provides Spring Security's Argon2 encoder; the Bouncy Castle provider is a runtime dependency because Argon2 is the accepted password-verifier format. |
| `corsConfigurationSource(String allowedOrigins)` | Builds the browser allow-list from `app.cors.allowed-origins`, with the User API methods and `Authorization`, `Content-Type` and `X-Request-ID` headers enabled. |
| `isUnsafeHealthRequest(HttpServletRequest request)` | Keeps mutating requests to the public health paths as an explicit 403/`ACCESS_DENIED` contract while authentication failures elsewhere remain 401/`AUTHENTICATION_REQUIRED`. |

CSRF and other framework protections remain active unless a later, explicit feature decision changes them. A new public route must be added with its method and authorization rule in the same change as the route.

## Verification

`HealthIT` checks public health access, denied management/unknown routes, bounded errors and the 403 result for an unsafe health request. `DependencyCompatibilityIT` confirms optional API documentation remains protected.
