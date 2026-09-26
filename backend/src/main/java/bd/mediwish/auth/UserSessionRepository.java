package bd.mediwish.auth;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import jakarta.persistence.LockModeType;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface UserSessionRepository extends JpaRepository<UserSession, UUID> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select session from UserSession session where session.id = :id")
    Optional<UserSession> findByIdForUpdate(@Param("id") UUID id);

    // Every query that locks several sessions locks them in ID order, so two of them cannot deadlock.
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select session from UserSession session where session.user.id = :userId and session.revokedAt is null"
            + " order by session.id")
    List<UserSession> findActiveByUserIdForUpdate(@Param("userId") UUID userId);

    /** Locks the sessions the refresh tokens belong to without locking the tokens, which a refresh locks first. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select session from UserSession session where session.id in (select token.session.id"
            + " from UserSessionRefreshToken token where token.tokenHash in :tokenHashes) order by session.id")
    List<UserSession> findByRefreshTokenHashesForUpdate(@Param("tokenHashes") Collection<String> tokenHashes);
}
