# `RefreshCookieAdapter.java`

Source: [`src/main/java/bd/mediwish/auth/RefreshCookieAdapter.java`](../../../../../../../src/main/java/bd/mediwish/auth/RefreshCookieAdapter.java)

## Purpose

Package-private auth component that owns the `MW_REFRESH` cookie (its name is a private constant), so no cookie policy reaches `AuthenticationService` or `SessionService`. Only `AuthController` uses it.

## Behavior

| Member | Behavior |
| --- | --- |
| `read(request)` | Empty when no `MW_REFRESH` cookie was sent (the controller answers refresh with `204`). Throws `AuthenticationRequiredException` when the cookie is duplicated, blank or longer than `MAX_VALUE_LENGTH` (4,096 characters). |
| `readAll(request)` | Every distinct usable value, so logout can revoke each session a duplicated cookie represents; unusable values are dropped. |
| `set(response, value, expiresAt)` | Adds the cookie with `Max-Age` equal to the time from the shared auth `Clock` to the session's absolute expiry, so rotation never extends browser retention past server validity. |
| `clear(response)` | Adds the same cookie with an empty value and `Max-Age=0`. |

Every cookie is `HttpOnly`, `SameSite=Lax`, scoped to `Path=/api/auth` and `Secure` according to `AuthProperties.cookie().secure()`. Raw values are never logged, hashed here or written to JSON.

## Verification

`AuthControllerTest` asserts cookie attributes, remaining-lifetime `Max-Age`, clearing on rejected, unusable or duplicated cookies and logout of each distinct value. `SessionIT` and `ConcurrentSessionIT` cover the cookie over real HTTP and PostgreSQL.
