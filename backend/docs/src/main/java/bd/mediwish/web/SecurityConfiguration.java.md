# `SecurityConfiguration.java`

Source: [`src/main/java/bd/mediwish/web/SecurityConfiguration.java`](../../../../../../../src/main/java/bd/mediwish/web/SecurityConfiguration.java)

## Purpose and reasoning

`SecurityConfiguration` defines the initial security boundary before customer, staff and OAuth authentication exist. The policy is explicit: only health probes are public, every other request is denied, and no session or saved-request state is created. This prevents an unfinished feature from becoming accidentally public and leaves later feature packages to add authorization deliberately.

## Class and method

| Member | Behavior and use case |
| --- | --- |
| `SecurityConfiguration` | Package-private configuration class; its scope is the shared HTTP security policy. |
| `security(HttpSecurity http, ApiErrors errors)` | Builds one stateless `SecurityFilterChain`. It disables request caching, permits error dispatches, permits `GET` and `HEAD` for `/actuator/health/liveness` and `/actuator/health/readiness`, denies all other requests, and routes authentication and access-denied failures through `ApiErrors.write` with 401 and 403 respectively. |

CSRF and other framework protections remain active unless a later, explicit feature decision changes them. A new public route must be added with its method and authorization rule in the same change as the route.

## Verification

`HealthIT` checks public health access, denied management/unknown routes, bounded errors and the 403 result for an unsafe health request. `DependencyCompatibilityIT` confirms optional API documentation remains protected.
