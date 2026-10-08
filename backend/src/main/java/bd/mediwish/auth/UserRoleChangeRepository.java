package bd.mediwish.auth;

import bd.mediwish.user.UserRole;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Bounded history with a left join so deleted actors still have a history entry. */
public interface UserRoleChangeRepository extends JpaRepository<UserRoleChange, UUID> {
    interface History {
        Instant getOccurredAt();
        String getActorUsername();
        UserRole getOldRole();
        UserRole getNewRole();
    }

    @Query("select change.occurredAt as occurredAt, actor.username as actorUsername, change.oldRole as oldRole,"
            + " change.newRole as newRole from UserRoleChange change left join User actor on actor.id = change.actorUserId"
            + " where change.targetUserId = :targetId order by change.occurredAt desc, change.id desc")
    List<History> findLatestForTarget(@Param("targetId") UUID targetId, Pageable page);
}
