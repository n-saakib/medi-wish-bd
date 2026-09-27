package bd.mediwish.auth;

import bd.mediwish.user.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;
import java.util.UUID;

/** Callers hold the User's row lock ({@code UserRepository.findByIdForUpdate}) before reading a factor to change it. */
public interface StaffMfaFactorRepository extends JpaRepository<StaffMfaFactor, UUID> {
    @Query("select factor from StaffMfaFactor factor where factor.userId = :userId"
            + " and factor.status = bd.mediwish.auth.StaffMfaFactor.Status.PENDING")
    Optional<StaffMfaFactor> findPending(@Param("userId") UUID userId);

    @Query("select factor from StaffMfaFactor factor where factor.userId = :userId"
            + " and factor.status = bd.mediwish.auth.StaffMfaFactor.Status.ACTIVE")
    Optional<StaffMfaFactor> findActive(@Param("userId") UUID userId);

    @Query("select factor.id from StaffMfaFactor factor where factor.userId = :userId"
            + " and factor.status = bd.mediwish.auth.StaffMfaFactor.Status.ACTIVE")
    Optional<UUID> findActiveId(@Param("userId") UUID userId);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from StaffMfaFactor factor where factor.userId = :userId"
            + " and factor.status = bd.mediwish.auth.StaffMfaFactor.Status.PENDING")
    void deletePending(@Param("userId") UUID userId);

    /** The active factor that staff access is checked against; only staff Users are looked up. */
    default UUID activeFactorIdOf(User user) {
        return user.hasStaffRole() ? findActiveId(user.id()).orElse(null) : null;
    }
}
