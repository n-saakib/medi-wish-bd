package bd.mediwish.auth;

import bd.mediwish.user.UserRole;
import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

/** One committed administrative transition; identifiers survive actor/target deletion as nullable foreign keys. */
@Entity
@Table(name = "user_role_changes")
public class UserRoleChange {
    @Id private UUID id;
    @Column(name = "occurred_at", nullable = false, updatable = false) private Instant occurredAt;
    @Column(name = "actor_user_id", updatable = false) private UUID actorUserId;
    @Column(name = "target_user_id", updatable = false) private UUID targetUserId;
    @Enumerated(EnumType.STRING) @Column(name = "old_role", nullable = false, length = 32, updatable = false) private UserRole oldRole;
    @Enumerated(EnumType.STRING) @Column(name = "new_role", nullable = false, length = 32, updatable = false) private UserRole newRole;
    @Column(name = "request_id", length = 64, updatable = false) private String requestId;

    protected UserRoleChange() {}
    UserRoleChange(UUID actor, UUID target, UserRole oldRole, UserRole newRole, Instant at, String requestId) {
        this.id = UUID.randomUUID();
        this.actorUserId = actor; this.targetUserId = target;
        this.oldRole = oldRole; this.newRole = newRole; this.occurredAt = at; this.requestId = requestId;
    }
}
