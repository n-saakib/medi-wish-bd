package bd.mediwish.auth;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.UUID;

/**
 * The one row that records the first-Admin provisioning. Its existence closes provisioning for the life of the
 * database, and it names the Super Admin (S1). The application never changes it after insert.
 */
@Entity
@Table(name = "staff_bootstrap")
public class StaffBootstrap {
    static final short ID = 1;

    @Id
    private short id;
    @Column(name = "super_admin_user_id", updatable = false)
    private UUID superAdminUserId;
    @Column(name = "provisioned_at", nullable = false, updatable = false)
    private Instant provisionedAt;

    protected StaffBootstrap() {}

    public UUID superAdminUserId() { return superAdminUserId; }
}
