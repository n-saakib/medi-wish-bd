# `RoleAssignmentService.java`

Source: [RoleAssignmentService.java](../../../../../../../src/main/java/bd/mediwish/auth/RoleAssignmentService.java)

Administrative single-role commands and bounded reads. search escapes literal LIKE metacharacters, delegates C-collated sorting and paging to UserRepository, and batches active authenticator identifiers. detail returns the current role/version, permitted selections and latest 20 joined audit entries.

changeRole locks actor and target User rows in UUID order (one ID for self requests), rechecks the active actor session and current verified ADMIN evidence, and invokes RoleChangePolicy. A same-role no-op precedes stale/self/Admin-change checks and writes nothing. An applied command replaces the role, increments its version, inserts one correlated audit row, revokes all active target sessions with ROLE_CHANGED, and flushes in one transaction. User locks precede session locks; a failure rolls back all writes.

Public records UserSummary, UserRoles, UserPage and RoleChange contain no contacts, credentials or diagnostics. Deleted actors have null usernames. Missing targets, refused/stale commands and lost actor authorization produce bounded errors. Unit tests cover command/read outcomes; real database tests prove migration, atomic rollback, revocation and concurrent writer behavior.

A valid page whose offset exceeds JPA's integer range returns an empty page with the filtered total, read using a bounded first-page query; it does not turn a valid large page into a server error.
