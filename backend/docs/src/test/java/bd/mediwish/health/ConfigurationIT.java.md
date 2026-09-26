# `ConfigurationIT.java`

Source: [`src/test/java/bd/mediwish/health/ConfigurationIT.java`](../../../../../../../src/test/java/bd/mediwish/health/ConfigurationIT.java)

## Purpose and test boundary

This integration test checks startup failure hygiene for invalid datasource and auth configuration. It supplies the same valid synthetic JWT and Argon2 dummy-verifier prerequisites used by isolated application tests, then uses a synthetic datasource password and malformed JDBC URL. This makes the assertion reach datasource URL validation instead of failing earlier on required auth configuration, while keeping all values out of captured startup output.

## Class and method

| Member | Behavior and reason |
| --- | --- |
| `ConfigurationIT` | Failsafe integration test tagged for integration and security behavior. `OutputCaptureExtension` makes the logging boundary observable. |
| `invalidDatasourceConfigurationFailsBeforeConnectingWithoutPrintingPassword(CapturedOutput output)` | Starts `MediWishApplication` with valid synthetic auth properties and an invalid datasource URL, requires an `IllegalArgumentException` mentioning JDBC URL validation, then requires a bounded failure log containing the generic failure marker but not the synthetic datasource password. |

| `anInvalidAuthSettingFailsStartupWithAValidDatasource(...)` | With no active profile, so the hosted rules apply, and with a valid test datasource and explicit CORS origin, a non-secure refresh cookie fails startup with `hosted auth cookies must be Secure` and a JWT secret under 32 bytes fails with `auth JWT secret must be Base64 of at least 32 bytes`; the output omits the secret and the datasource password. |
| `run(properties, profiles...)` | Starts the application with the given profiles (none for the hosted rules) and the properties taking precedence. Only the `test` profile is named. |

The test deliberately asserts the root cause and privacy property rather than a vendor-specific full stack trace, keeping the contract useful across Spring Boot patch updates.

## Verification

Run as part of the default Maven `verify` lifecycle with the real PostgreSQL test environment available for the other integration tests. The auth cases create and drop one guarded test schema; no development credentials are used.

Verified 2026-09-27 on `ed1e006`: `./mvnw.cmd -o verify` passed 171 unit and 109 integration tests (1 expected compatibility skip); `./mvnw.cmd -o -Pcompatibility verify` passed 171 and 109 with no skip. `ConfigurationIT` ran 3 tests.
