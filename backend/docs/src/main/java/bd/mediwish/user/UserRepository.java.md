# UserRepository

Spring Data repository for shared User persistence. Registration checks username/mobile uniqueness; sign-in resolves exact username, verified mobile and optional case-insensitive email. The unique email expression index prevents ambiguous same-field email matches. `existsByRole` supports first-Admin provisioning.

`findByIdForUpdate` takes the User write lock before MFA changes. `findAllByIdForUpdate` locks both actor and target in PostgreSQL UUID order before assigning a role; `findByIdForShare` takes a shared User lock before password session insertion. These JPQL queries lock the User row inline before eager role hydration; `StaffRoleMappingIT` captures their actual SQL. FOR SHARE conflicts with role replacement's FOR NO KEY UPDATE but lets concurrent sign-ins coexist.

`search(prefix, role, pageable)` returns bounded Users and a matching count. The caller supplies a LIKE-escaped prefix with its trailing wildcard, or null; role is an exact enum name or null. SQL orders usernames with C collation and uses an explicit backslash escape. The private role collection batches hydration in groups of 50. Queries bind all values; no username is placed in a URL or log.
