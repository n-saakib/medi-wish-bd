package bd.mediwish.auth;

import bd.mediwish.user.User;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "user_sessions", indexes = {
        @Index(name = "idx_user_sessions_user_revoked", columnList = "user_id, revoked_at"),
        @Index(name = "idx_user_sessions_expires", columnList = "expires_at")
})
public class UserSession {
    @Id
    private UUID id;
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;
    @Column(name = "created_at", nullable = false)
    private Instant createdAt;
    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;
    @Column(name = "last_used_at", nullable = false)
    private Instant lastUsedAt;
    @Column(name = "revoked_at")
    private Instant revokedAt;
    @Column(name = "revoked_reason", length = 64)
    private String revokedReason;

    protected UserSession() {}

    public UserSession(UUID id, User user, Instant createdAt, Instant expiresAt) {
        this.id = id;
        this.user = user;
        this.createdAt = createdAt;
        this.expiresAt = expiresAt;
        this.lastUsedAt = createdAt;
    }

    public UUID id() { return id; }
    public User user() { return user; }
    public Instant createdAt() { return createdAt; }
    public Instant expiresAt() { return expiresAt; }
    public Instant lastUsedAt() { return lastUsedAt; }
    public Instant revokedAt() { return revokedAt; }
    public String revokedReason() { return revokedReason; }

    public boolean revoked() { return revokedAt != null; }

    public void touch(Instant at) { this.lastUsedAt = at; }

    public void revoke(Instant at, String reason) {
        if (revokedAt == null) {
            revokedAt = at;
            revokedReason = reason;
        }
    }
}
