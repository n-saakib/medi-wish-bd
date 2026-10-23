# `FirstAdminProvisioning.java`

Source: [`src/main/java/bd/mediwish/auth/FirstAdminProvisioning.java`](../../../../../../../src/main/java/bd/mediwish/auth/FirstAdminProvisioning.java)

## Purpose

Package-private `ApplicationRunner` that is the operator command for provisioning the first Admin (Ticket 06 D1). It does nothing unless `app.provisioning.first-admin-username` is non-blank. No HTTP route provisions or promotes an Admin.

## Behavior

| Step | Behavior |
| --- | --- |
| Property blank or absent | Returns at once; the serving application starts normally. `application.yaml` leaves the property empty. |
| Context is a `WebApplicationContext` | Throws `IllegalStateException("first-Admin provisioning requires spring.main.web-application-type=none")`, so startup fails and nothing is provisioned. The message names no username. |
| Otherwise | Calls `FirstAdminProvisioningService.provision(username)` and logs one line, `First-Admin provisioning provisioned` or `First-Admin provisioning refused: <outcome>`, where the outcome is the enum name in lower case with dashes. The username is never logged. |
| Exit | Closes the context through `SpringApplication.exit` and passes its code to the exit hook (`System::exit` in production): `0` when provisioned, `1` for every refusal. The package-private constructor takes an `IntConsumer` so tests capture the code instead. |

## Runbook: provision the first Admin

1. The owner registers a normal account through the storefront. Provisioning only promotes an existing registered User whose stored password verifier is usable; it never creates an account, and the database has no default account.
2. Build the jar (`./mvnw.cmd -o package` produces `target/medi-wish.jar`) and set the same environment the serving application uses for that database: the `DB_*` connection values and the `APP_AUTH_*` settings, including `APP_AUTH_JWT_SECRET`, `APP_AUTH_MFA_SECRET_KEY` and the independent `APP_AUTH_RECOVERY_CODE_KEY`. The command starts the full non-web context, so these settings are validated and Liquibase migrations run as at a normal startup.
3. Run the command once, as a separate process, never on a serving instance:

   ```powershell
   java -jar target/medi-wish.jar --spring.main.web-application-type=none --app.provisioning.first-admin-username=<registered username>
   ```

   The username is normalized like sign-in (trimmed, lower case).
4. Read the outcome from the exit code and the single log line:

   | Log line | Exit | Meaning |
   | --- | --- | --- |
   | `provisioned` | 0 | The User now holds `ADMIN` in addition to their existing roles and is the permanent Super Admin. |
   | `refused: bootstrap-used` | 1 | Provisioning already happened for this database; nothing changed. |
   | `refused: admin-exists` | 1 | Some User already holds `ADMIN`; nothing changed and provisioning stays open. |
   | `refused: user-not-found` | 1 | No registered User with a usable verifier has that username; nothing changed and provisioning stays open. |

5. Provisioning revokes every existing session of that User (`staff-provisioned`). The new Admin signs in again, gets a restricted session and must enroll an authenticator before any staff access (see `StaffMfaService`).

Starting the command without `--spring.main.web-application-type=none` fails at startup with the message above; setting the username on a serving process stops that process from starting. Success writes `staff_bootstrap` row 1 naming the Super Admin and a `FIRST_ADMIN_PROVISIONED` audit event. That row is permanent: every later run answers `refused: bootstrap-used`, even after every Admin has been removed, and the Super Admin never transfers to another User.

## Verification

`FirstAdminProvisioningTest` covers the blank-username no-op, exit code 0 only for `PROVISIONED` and the refusal inside a web context with a message that omits the username. `FirstAdminProvisioningIT` runs the command in a non-web context against PostgreSQL (provisioning, session revocation, the log lines with no secret, refusal after all Admins are removed) and proves the serving application fails to start with the property set.
