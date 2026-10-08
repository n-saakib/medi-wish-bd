# `UserTest.java`

Source: [`UserTest.java`](../../../../../../../src/test/java/bd/mediwish/user/UserTest.java)

Tests the User entity without PostgreSQL. Profile and mobile state: active account, version zero, profile edits, version increment and activation of a verified replacement mobile, with the username unchanged. Single role: registration assigns Customer and roles version zero, replacement removes the previous role, a repeat assignment is a no-op, the administrative version increment is explicit, and demotion removes the staff-MFA requirement. PostgreSQL integrity is verified separately in `StaffRoleMigrationIT` and `ProfileMigrationIT`.
