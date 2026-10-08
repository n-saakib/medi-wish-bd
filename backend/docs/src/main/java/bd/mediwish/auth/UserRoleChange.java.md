# `UserRoleChange.java`

Source: [UserRoleChange.java](../../../../../../../src/main/java/bd/mediwish/auth/UserRoleChange.java)

A committed administrative transition in user_role_changes: random UUID, time, actor/target IDs, distinct old/new roles and the MDC request ID. No free-text profile/secret value is stored. Database checks enforce the role names; nullable identifier foreign keys use ON DELETE SET NULL. Retention on account closure remains Ticket 47's decision.

The package-private constructor belongs to RoleAssignmentService. Provisioning, refusals and same-role no-ops create no row. The repository supplies smaller joined history projections. Real migration and role tests verify constraints and correlated evidence.
