# `UserRepository.java`

Source: [`src/main/java/bd/mediwish/user/UserRepository.java`](../../../../../../../src/main/java/bd/mediwish/user/UserRepository.java)

Spring Data repository for shared User persistence.

| Member | Behavior |
| --- | --- |
| `existsByUsername`, `existsByMobile` | Registration uniqueness checks used by `UserService` before hashing. |
| `findByUsername`, `findByMobileAndMobileVerifiedTrue`, `findByEmailIgnoreCase` | Exact username, verified-mobile and case-insensitive email lookups for `AuthenticationService`. Email is unique ignoring case (changeset `009-unique-user-email`), so the email lookup returns at most one User; the service never calls it with `null`, which Spring Data would turn into `email IS NULL`. The unique `upper(email)` index serves it while preserving stored values. |
| `existsByRole(role)` | Whether any User holds the role; `FirstAdminProvisioningService` refuses when an `ADMIN` exists. |
| `findByIdForUpdate(id)` | Loads the User with a `PESSIMISTIC_WRITE` row lock. It serializes a User's staff MFA changes, which take it before any other lock of that User's rows; first-Admin provisioning takes it after claiming `staff_bootstrap`. |

Controllers and web adapters do not call these queries directly. Covered by `UserServiceTest`, `AuthenticationServiceTest`, `StaffMfaServiceTest`, `FirstAdminProvisioningTest` and, against PostgreSQL, `ConcurrentMfaIT` and `FirstAdminProvisioningIT`.
