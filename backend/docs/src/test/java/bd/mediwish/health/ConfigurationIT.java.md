# `ConfigurationIT.java`

Source: [`src/test/java/bd/mediwish/health/ConfigurationIT.java`](../../../../../../../src/test/java/bd/mediwish/health/ConfigurationIT.java)

## Purpose and test boundary

This integration test checks startup failure hygiene for invalid datasource and auth configuration. It supplies the same valid synthetic JWT and Argon2 dummy-verifier prerequisites used by isolated application tests, then uses a synthetic datasource password and malformed JDBC URL. This makes the assertion reach datasource URL validation instead of failing earlier on required auth configuration, while keeping all values out of captured startup output.

## Class and method

| Member | Behavior and reason |
| --- | --- |
| `ConfigurationIT` | Failsafe integration test tagged for integration and security behavior. `OutputCaptureExtension` makes the logging boundary observable. |
| `invalidDatasourceConfigurationFailsBeforeConnectingWithoutPrintingPassword(CapturedOutput output)` | Starts `MediWishApplication` with valid synthetic auth properties and an invalid datasource URL, requires an `IllegalArgumentException` mentioning JDBC URL validation, then requires a bounded failure log containing the generic failure marker but not the synthetic datasource password. |

| `anInvalidAuthSettingFailsStartupWithAValidDatasource(...)` | With no active profile, so the hosted rules apply, and with a valid test datasource and explicit CORS origin, a non-secure refresh cookie fails startup with `hosted auth cookies must be Secure` and a JWT secret under 32 bytes fails with `auth JWT secret must be Base64 of at least 32 bytes`; a missing, non-Base64 or 24-byte recovery code key fails with `auth recovery code key must be Base64 of exactly 32 bytes`. The output omits the secret, the datasource password and the fixture recovery key. |
| `mailCaptureRefusesStartupWithoutALocalOrTestProfile(...)` | With no active profile, `app.mail.transport=memory` fails startup with the `app.mail.transport requires only local or test active profiles` rule, so capture adapters never serve hosted or unnamed profiles. The output omits the datasource password. |
| `run(properties, profiles...)` | Starts the application with the given profiles (none for the hosted rules) and the properties taking precedence. Only the `test` profile is named. |

The test deliberately asserts the root cause and privacy property rather than a vendor-specific full stack trace, keeping the contract useful across Spring Boot patch updates.

## Verification

Run as part of the default Maven `verify` lifecycle with the real PostgreSQL test environment available for the other integration tests. The auth cases create and drop one guarded test schema; no development credentials are used.

Verified 2026-09-27 on `ed1e006`: `./mvnw.cmd -o verify` passed 171 unit and 109 integration tests (1 expected compatibility skip); `./mvnw.cmd -o -Pcompatibility verify` passed 171 and 109 with no skip. `ConfigurationIT` ran 3 tests.

Verified 2026-10-20 on the Ticket 05 working tree (base `13968d1`, uncommitted): `.\mvnw.cmd -o verify -Dtest=NoSuchUnitTest -Dit.test=ConfigurationIT` ran 14 tests with 0 failures, covering the datasource, five auth rows (including the three recovery-key rows), six storage rows, the hosted-local refusal and the memory-capture refusal without a profile. Log: `.scratch/ticket05-implementation-20261019/ticket05-configurationit-20261020-rerun.log`.


Ticket 15 adds serving-startup refusal for missing/unsupported provider, relative storage roots, invalid or non-test namespaces under test, and hosted use of the local adapter. Cases use guarded real PostgreSQL and verify secrets remain absent from captured output.

Storage guard cases assert the direct IllegalStateException and bounded message: SmartInitializingSingleton validation runs after singleton creation, so Spring does not wrap this refusal. The hosted guard uses no active profile, valid hosted auth and a prod-check namespace, as required by the accepted plan. Existing datasource/auth cause assertions remain intact.

Ticket 09's shared integration properties select the capture notifier for test-profile applications. The two profileless hosted fixture methods explicitly override app.notification.security.adapter=disabled so their three auth/storage cases still isolate the intended startup guard. NotificationConfigurationTest separately proves capture is refused without local/test profiles; this fixture override does not change production notification policy or weaken the asserted auth/storage rules. Test-profile storage failures keep capture enabled.

Verified 2026-10-19 on ticket-09-staff-backup-code (base 13968d1, working tree): guarded offline verify selecting the three hosted cases reproduced two assertion failures before these fixture overrides (cookie and local-storage cases; short-JWT already reached its intended guard), with zero errors/skips. After the overrides, `verify -Dtest=NONE -Dsurefire.failIfNoSpecifiedTests=false -Dit.test=ConfigurationIT` passed all 10 ConfigurationIT cases, zero failures/errors/skips, at 15:08:31 +06 (1:21). The runner and throwaway-role cleanup both exited 0. Evidence: main checkout `.scratch/ticket09-implementation/backend-t4-hosted-configuration-red.log` and `backend-t4-configuration-green.log`.
