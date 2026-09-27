# `StaffBootstrap.java`

Source: [`src/main/java/bd/mediwish/auth/StaffBootstrap.java`](../../../../../../../src/main/java/bd/mediwish/auth/StaffBootstrap.java)

JPA mapping for the single `staff_bootstrap` row (`id` is always `1`, `ID`). Its existence closes first-Admin provisioning for the life of the database, and `super_admin_user_id` names the Super Admin (S1). The mapping is read-only: it has only the protected JPA constructor, both columns are non-updatable, and the application never changes the row after insert. `FirstAdminProvisioningService` inserts it through the native `StaffBootstrapRepository.claim`, never through this entity. `superAdminUserId()` is `null` once the named User is deleted (`ON DELETE SET NULL`); the row itself stays. The singleton `CHECK (id = 1)` and the foreign key live only in the Liquibase changelog. Covered by `FirstAdminProvisioningIT` and `StaffMfaMigrationIT`.
