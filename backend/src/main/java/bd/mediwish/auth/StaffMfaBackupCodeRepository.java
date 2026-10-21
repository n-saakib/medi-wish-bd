package bd.mediwish.auth;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public interface StaffMfaBackupCodeRepository extends JpaRepository<StaffMfaBackupCode, UUID> {
    List<StaffMfaBackupCode> findByFactorIdAndConsumedAtIsNull(UUID factorId);

    @Modifying(flushAutomatically = true)
    @Query("update StaffMfaBackupCode code set code.consumedAt = :at, code.consumedSessionId = :sessionId"
            + " where code.id = :id and code.factorId = :factorId and code.consumedAt is null")
    int consume(@Param("id") UUID id, @Param("factorId") UUID factorId, @Param("at") Instant at,
                @Param("sessionId") UUID sessionId);

    @Modifying(flushAutomatically = true)
    @Query("delete from StaffMfaBackupCode code where code.factorId = :factorId")
    int deleteByFactor(@Param("factorId") UUID factorId);

    @Modifying(flushAutomatically = true)
    @Query("delete from StaffMfaBackupCode code where code.factorId = :factorId and code.consumedAt is null")
    int deleteUnusedByFactor(@Param("factorId") UUID factorId);
}
