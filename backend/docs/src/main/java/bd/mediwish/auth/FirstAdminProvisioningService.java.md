# `FirstAdminProvisioningService.java`

Source: [`src/main/java/bd/mediwish/auth/FirstAdminProvisioningService.java`](../../../../../../../src/main/java/bd/mediwish/auth/FirstAdminProvisioningService.java)

## Purpose

Package-private service that grants `ADMIN` to one registered User, exactly once for the life of the database, and records that User as the Super Admin (S1). `FirstAdminProvisioning` is its only caller.

## Operations

| Member | Behavior |
| --- | --- |
| `decide(bootstrapUsed, adminExists, userEligible)` | Fixed refusal order: `BOOTSTRAP_USED`, then `ADMIN_EXISTS`, then `USER_NOT_FOUND`; otherwise `PROVISIONED`. |
| `provision(username)` | In one `TransactionOperations` transaction: finds the User by the normalized username, keeping it only when `PasswordVerifierPolicy` accepts its verifier; claims `staff_bootstrap` row 1 through `StaffBootstrapRepository.claim` (with a `null` User when none was found); checks `UserRepository.existsByRole(ADMIN)` only when the claim succeeded; and decides. A refusal marks the transaction rollback-only, so a claimed row from a refused run is not kept. `PROVISIONED` locks the User row (`findByIdForUpdate`), adds `ADMIN` to the existing roles, saves, revokes every active session with `RevocationReason.STAFF_PROVISIONED` and records `FIRST_ADMIN_PROVISIONED` with no session. |

`Outcome` is `PROVISIONED`, `BOOTSTRAP_USED`, `ADMIN_EXISTS` or `USER_NOT_FOUND`.

## Boundaries

- Claiming the singleton row first serializes concurrent runs on its primary key: the second waits, then sees the committed row and refuses with `BOOTSTRAP_USED`.
- The claimed row is never updated or deleted by the application, so provisioning never reopens, even when every Admin is later removed.
- The service logs nothing. The audit row holds only the event type, the User ID and no request ID (the command runs outside a request).

## Verification

`FirstAdminProvisioningTest` covers the refusal order, the grant with session revocation and audit, an unknown User, and a used bootstrap that is refused without checking for Admins. `FirstAdminProvisioningIT` covers the refusals that leave the bootstrap open and two concurrent runs that provision exactly one User against PostgreSQL.
