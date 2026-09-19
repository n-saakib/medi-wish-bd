# `ConfigurationIT.java`

Source: [`src/test/java/bd/mediwish/health/ConfigurationIT.java`](../../../../../../../src/test/java/bd/mediwish/health/ConfigurationIT.java)

## Purpose and test boundary

This integration test checks startup failure hygiene for invalid datasource configuration. It supplies the same valid synthetic JWT and Argon2 dummy-verifier prerequisites used by isolated application tests, then uses a synthetic datasource password and malformed JDBC URL. This makes the assertion reach datasource URL validation instead of failing earlier on required auth configuration, while keeping all values out of captured startup output.

## Class and method

| Member | Behavior and reason |
| --- | --- |
| `ConfigurationIT` | Failsafe integration test tagged for integration and security behavior. `OutputCaptureExtension` makes the logging boundary observable. |
| `invalidDatasourceConfigurationFailsBeforeConnectingWithoutPrintingPassword(CapturedOutput output)` | Starts `MediWishApplication` with valid synthetic auth properties and an invalid datasource URL, requires an `IllegalArgumentException` mentioning JDBC URL validation, then requires a bounded failure log containing the generic failure marker but not the synthetic datasource password. |

The test deliberately asserts the root cause and privacy property rather than a vendor-specific full stack trace, keeping the contract useful across Spring Boot patch updates.

## Verification

Run as part of the default Maven `verify` lifecycle with the real PostgreSQL test environment available for the other integration tests. No development credentials or database mutation are used by this class.
