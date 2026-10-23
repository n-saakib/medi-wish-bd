package bd.mediwish.auth;

import bd.mediwish.user.User;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "user_sessions")
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
    @Column(name = "mfa_factor_id", updatable = false)
    private UUID mfaFactorId;
    @Column(name = "mfa_verified_at", updatable = false)
    private Instant mfaVerifiedAt;

    @Column(name = "mfa_replacing_factor_id", updatable = false)
    private UUID mfaReplacingFactorId;

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
    public Instant expiresAt() { return expiresAt; }
    public String revokedReason() { return revokedReason; }
    UUID mfaFactorId() { return mfaFactorId; }
    Instant mfaVerifiedAt() { return mfaVerifiedAt; }

    UUID mfaReplacingFactorId() { return mfaReplacingFactorId; }

    void markReplacing(UUID factorId) {
        if (mfaVerifiedAt != null) throw new IllegalStateException("verified session cannot replace a factor");
        mfaReplacingFactorId = factorId;
    }

    public boolean revoked() { return revokedAt != null; }

    public void touch(Instant at) { this.lastUsedAt = at; }

    /** Only a new session gets MFA evidence, when it replaces a restricted one; evidence is never added later. */
    void markMfaVerified(UUID factorId, Instant at) {
        mfaFactorId = factorId;
        mfaVerifiedAt = at;
    }

    void revoke(Instant at, RevocationReason reason) {
        if (revokedAt == null) {
            revokedAt = at;
            revokedReason = reason.code;
        }
    }
}
