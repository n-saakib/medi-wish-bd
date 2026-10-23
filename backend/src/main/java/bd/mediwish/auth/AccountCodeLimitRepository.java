package bd.mediwish.auth;

import org.springframework.data.jpa.repository.*;
import org.springframework.data.repository.query.Param;
import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.Optional;

interface AccountCodeLimitRepository extends JpaRepository<AccountCodeLimit, String> {
    /** A held row lock makes the SKIP LOCKED prune leave a counter alone until its update commits. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select counter from AccountCodeLimit counter where counter.limitKey = :key")
    Optional<AccountCodeLimit> findByIdForUpdate(@Param("key") String key);

    /** PostgreSQL serializes increments even for previously unseen typed addresses. */
    @Query(value="""
            INSERT INTO account_code_limits (limit_key, window_started_at, attempts, last_at)
            VALUES (:key, :now, 1, :now)
            ON CONFLICT (limit_key) DO UPDATE SET
              window_started_at = CASE WHEN account_code_limits.window_started_at <= :cutoff THEN :now ELSE account_code_limits.window_started_at END,
              attempts = CASE WHEN account_code_limits.window_started_at <= :cutoff THEN 1 ELSE account_code_limits.attempts + 1 END,
              last_at = :now
            RETURNING *
            """, nativeQuery=true)
    AccountCodeLimit recordAddressRequest(@Param("key") String key, @Param("now") Instant now,
                                          @Param("cutoff") Instant cutoff);

    @Modifying(flushAutomatically=true)
    @Query(value="""
            DELETE FROM account_code_limits WHERE limit_key IN (
              SELECT limit_key FROM account_code_limits WHERE window_started_at < :cutoff
              FOR UPDATE SKIP LOCKED
            )
            """, nativeQuery=true)
    int pruneBefore(@Param("cutoff") Instant cutoff);
}
