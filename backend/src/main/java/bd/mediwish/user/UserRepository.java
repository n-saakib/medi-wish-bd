package bd.mediwish.user;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;
import java.util.Collection;
import java.util.List;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
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

    /** Password sign-in locks the current User before creating a session. */
    @Lock(LockModeType.PESSIMISTIC_READ)
    @Query("select user from User user where user.id = :id")
    Optional<User> findByIdForShare(@Param("id") UUID id);

    /** Role changes lock actor and target in PostgreSQL UUID order. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select user from User user where user.id in :ids order by user.id")
    List<User> findAllByIdForUpdate(@Param("ids") Collection<UUID> ids);

    /** Prefix is escaped for LIKE and includes its trailing wildcard; null means no filter. */
    @Query(value = """
            select u.* from users u join user_roles r on r.user_id = u.id
            where (cast(:prefix as text) is null or u.username like :prefix escape '\\')
              and (cast(:role as text) is null or r.role = :role)
            order by u.username collate "C"
            """, countQuery = """
            select count(*) from users u join user_roles r on r.user_id = u.id
            where (cast(:prefix as text) is null or u.username like :prefix escape '\\')
              and (cast(:role as text) is null or r.role = :role)
            """, nativeQuery = true)
    Page<User> search(@Param("prefix") String prefix, @Param("role") String role, Pageable pageable);
}
