# `StaffMfaController.java`

Source: [`src/main/java/bd/mediwish/auth/StaffMfaController.java`](../../../../../../../src/main/java/bd/mediwish/auth/StaffMfaController.java)

## Purpose

Package-private HTTP adapter for `/api/auth/mfa`, used with a restricted staff session's Bearer token. It validates input shape, delegates to `StaffMfaService` and writes the replacement refresh cookie through `RefreshCookieAdapter`.

## Routes

| Route | Authority | Behavior |
| --- | --- | --- |
| `POST /enrollment` | `MFA_ENROLLMENT` | `201` with `{enrollmentId, secret, otpauthUri, expiresIn}`. No body. |
| `POST /enrollment/verify` | `MFA_ENROLLMENT` | Body `{enrollmentId, code}`. `200` with `{accessToken, tokenType: "Bearer", expiresIn, user, mfa: "VERIFIED", backupCodes}` and a new `MW_REFRESH` cookie for the verified session. The backup codes appear only in this response. |
| `POST /verify` | `MFA_CHALLENGE` | Body `{code}`. `200` with the standard `AuthController.SessionResponse` and a new refresh cookie. |

## Input rules

The code has spaces removed and must then be exactly six ASCII digits (`123 456` is accepted). The enrollment ID must be a lower-case canonical UUID. Anything else throws `InvalidRequestException` (`400 INVALID_REQUEST`) before the service runs, so a malformed value never counts as a failed attempt.

## Boundaries

The routes are in `SecurityConfiguration.MFA_ROUTES`: Bearer-only, CSRF-exempt and under the 16 KiB body limit. A session without the required authority gets `403 MFA_REQUIRED` (restricted staff) or `403 ACCESS_DENIED` (non-staff); no token gets `401`. Service errors map through `ApiExceptionHandler` to `400 MFA_CODE_INVALID`, `409 MFA_ENROLLMENT_STALE` and `429 TOO_MANY_ATTEMPTS`.

## Verification

`StaffMfaControllerTest` covers the verified response and cookie, the enrollment response with backup codes, and malformed codes and IDs that never reach the service or set a cookie. `StaffMfaIT` and `StaffMfaRegressionIT` cover the routes over HTTP, including CSRF exemption, missing Bearer and oversized bodies.
