package bd.mediwish.user;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;
import java.util.UUID;

public interface UserRepository extends JpaRepository<User, UUID> {
    boolean existsByUsername(String username);
    boolean existsByMobile(String mobile);
    Optional<User> findByUsername(String username);
    Optional<User> findByMobileAndMobileVerifiedTrue(String mobile);
    Optional<User> findByEmailIgnoreCase(String email);

    @Query("select count(user) > 0 from User user join user.roles role where role = :role")
    boolean existsByRole(@Param("role") UserRole role);

    /** Serializes a User's staff MFA and provisioning changes; take it before any other lock of that User's rows. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select user from User user where user.id = :id")
    Optional<User> findByIdForUpdate(@Param("id") UUID id);
}
