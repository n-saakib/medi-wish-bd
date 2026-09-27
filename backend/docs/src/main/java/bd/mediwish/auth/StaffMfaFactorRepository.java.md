# `StaffMfaFactorRepository.java`

Source: [`src/main/java/bd/mediwish/auth/StaffMfaFactorRepository.java`](../../../../../../../src/main/java/bd/mediwish/auth/StaffMfaFactorRepository.java)

Public Spring Data repository for `StaffMfaFactor`. Callers that change a factor hold the User's row lock first.

| Member | Behavior |
| --- | --- |
| `findPending(userId)` / `findActive(userId)` | The User's pending or active factor; the partial unique indexes allow at most one of each. |
| `findActiveId(userId)` | Only the active factor's ID. |
| `deletePending(userId)` | Bulk-deletes the pending factor, flushing before and clearing the persistence context after, so restarting enrollment replaces it. |
| `activeFactorIdOf(user)` | The active factor ID for a staff User, `null` otherwise; non-staff Users cause no query. `CurrentUserAuthentication` and `AuthenticationService` pass it to `StaffAccessPolicy`. |

The active-factor lookup is the one extra statement a staff request prepares (`ConcurrentMfaIT`). Covered by `StaffMfaServiceTest`, `CurrentUserAuthenticationTest` and the staff MFA integration tests.
