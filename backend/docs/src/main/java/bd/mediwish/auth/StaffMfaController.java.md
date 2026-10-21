# `StaffMfaController.java`

Source: [`src/main/java/bd/mediwish/auth/StaffMfaController.java`](../../../../../../../src/main/java/bd/mediwish/auth/StaffMfaController.java)

## Purpose

HTTP adapter for `/api/auth/mfa`. It validates request input before invoking enrollment/challenge or recovery services, maps the approved once-only responses and sets refresh cookies through `RefreshCookieAdapter`.

## Routes

| Route | Authority | Behavior |
| --- | --- | --- |
| `POST /enrollment` | `MFA_ENROLLMENT` or `MFA_REPLACEMENT` | Existing `201` enrollment ID, seed, URI and expiry. No body. |
| `POST /enrollment/verify` | `MFA_ENROLLMENT` or `MFA_REPLACEMENT` | Existing typed enrollment ID/code body. Replacement assurance dispatches to `verifyReplacement`; first enrollment retains its original service. Both return a verified session, refresh cookie and once-only codes. Only replacement adds `contactNotice`. |
| `POST /verify` | `MFA_CHALLENGE` | Existing typed TOTP body, standard session and refresh cookie. |
| `POST /recovery` | `MFA_CHALLENGE` | Strict JSON object containing only string `backupCode`; parses D4 input and returns a replacement-only session and fixed-lifetime refresh cookie. |
| `POST /backup-codes` | Verified `MODERATOR` or higher | Strict JSON object containing only string `code`; returns fresh backup codes without changing cookies or sessions. |

## Input and response boundaries

Only the two new routes use exact-key JsonNode validation; objects with extra/missing keys, non-objects and non-string values are `400 INVALID_REQUEST` before recovery service calls. Backup-code input uses `BackupCodes.parse`. TOTP input removes literal spaces then requires six ASCII digits. Existing enrollment request binding remains unchanged; its ID must remain a canonical lower-case UUID.

The two new routes explicitly consume application/json, so unsupported media is bounded `415 INVALID_REQUEST`. Security includes all routes in Bearer protection, CSRF exemption and the 16 KiB JSON limit. All responses carry no-store and request correlation. Domain errors retain their existing bounded mapping, including committed wrong-code lockout and stale enrollment.

`EnrolledSessionResponse.contactNotice` is omitted when null, preserving first-enrollment JSON. The newly returned BackupCodesResponse and modified enrollment response have redacted toString values so credentials, contacts and codes cannot expand through those representations. Raw codes are returned only by successful enrollment/replacement/regeneration.

## Verification

StaffMfaControllerTest covers strict bodies, normalization, cookie mapping, first/replacement dispatch, notice omission and inclusion, redacted responses, malformed JSON and unsupported content types. StaffMfaSecurityTest executes the installed production filter chain across actors, verifies Bearer/CSRF boundaries and tests valid JSON at and above the 16 KiB limit. Real API/database acceptance is recorded separately.

T4 verification on 2026-10-19, working tree over `13968d1`: `.\mvnw.cmd -o test -Dtest=StaffMfaControllerTest,StaffMfaSecurityTest,SecurityConfigurationTest` passed 39 focused tests; `.\mvnw.cmd -o test` passed all 1,033 backend units with zero failures/errors/skips at 15:00:14 +06:00. Before security wiring, the production-chain/matcher gate had 10 expected failures in 31 tests. A separate controlled controller mutation had 2 expected failures in 8 tests for relaxed exact-key validation and null contactNotice serialization. Exact original controller bytes were restored before the full gate. These targeted faults are distinguished from missing-method compile-red; real HTTP/PostgreSQL/API acceptance is recorded separately.
