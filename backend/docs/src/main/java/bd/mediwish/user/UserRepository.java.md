# UserRepository

Spring Data repository for shared User persistence. Registration checks username/mobile uniqueness; sign-in resolves exact username, verified mobile and optional case-insensitive email. The unique email expression index prevents ambiguous same-field email matches. `existsByRole` supports first-Admin provisioning.

`findByIdForUpdate` takes the User write lock before MFA changes. `findAllByIdForUpdate` locks both actor and target in PostgreSQL UUID order before assigning a role; `findByIdForShare` takes a shared User lock before password session insertion and bearer authentication reads. Authentication holds that lock across current session, role and factor reads, releasing it before route handling. These JPQL queries lock the User row inline before eager role hydration; `StaffRoleMappingIT` captures their actual SQL. FOR SHARE conflicts with role replacement's FOR NO KEY UPDATE but lets concurrent sign-ins coexist.

| Member | Behavior |
| --- | --- |
| `existsByUsername`, `existsByMobile` | Registration uniqueness checks used by `UserService` before hashing. |
| `existsByMobileAndIdNot`, `existsByEmailIgnoreCaseAndIdNot` | Reject contact values held by another User during profile changes. Database unique constraints remain the race backstop. |
| `findProfileById(id)` | Projects the User and left-joined pending mobile in one read without loading eager roles, so the profile is a consistent snapshot. |
| `findByUsername`, `findByMobileAndMobileVerifiedTrue`, `findByEmailIgnoreCase` | Exact username, verified-mobile and case-insensitive email lookups for `AuthenticationService`. Email is unique ignoring case (changeset `009-unique-user-email`), so the email lookup returns at most one User; the service never calls it with `null`, which Spring Data would turn into `email IS NULL`. The unique `upper(email)` index serves it while preserving stored values. |
| `existsByRole(role)` | Whether any User holds the role; `FirstAdminProvisioningService` refuses when an `ADMIN` exists. |
| `findByIdForUpdate(id)` | Loads the User with a `PESSIMISTIC_WRITE` row lock. Profile edits and mobile changes use it before checking account state or touching a pending row. MFA changes also take it before other locks of that User's rows. |

Controllers and web adapters do not call these queries directly. Covered by `UserServiceTest`, `AuthenticationServiceTest`, `StaffMfaServiceTest`, `FirstAdminProvisioningTest` and, against PostgreSQL, `ConcurrentMfaIT` and `FirstAdminProvisioningIT`.
`search(prefix, role, pageable)` returns bounded Users and a matching count. The caller supplies a LIKE-escaped prefix with its trailing wildcard, or null; role is an exact enum name or null. SQL orders usernames with C collation and uses an explicit backslash escape. The private role collection batches hydration in groups of 50. Queries bind all values; no username is placed in a URL or log.

Ticket 16 adds a batched username-only id projection for staff Discount editor and explicit-end history names. It avoids loading full personal User profiles for those lists.
