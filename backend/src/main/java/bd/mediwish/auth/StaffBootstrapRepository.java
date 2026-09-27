package bd.mediwish.auth;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

public interface StaffBootstrapRepository extends JpaRepository<StaffBootstrap, Short> {
    /**
     * Claims the singleton row; 0 when it already exists. A concurrent claim waits on the primary key until this
     * transaction ends, so exactly one provisioning can ever commit.
     */
    @Modifying
    @Query(value = "INSERT INTO staff_bootstrap (id, super_admin_user_id, provisioned_at) VALUES (1, :userId, :at)"
            + " ON CONFLICT (id) DO NOTHING", nativeQuery = true)
    int claim(@Param("userId") UUID userId, @Param("at") Instant at);

    /** The Super Admin's User id (S1), empty before provisioning or once that User is deleted. */
    default Optional<UUID> superAdminUserId() {
        return findById(StaffBootstrap.ID).map(StaffBootstrap::superAdminUserId);
    }
}
