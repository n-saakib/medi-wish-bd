package bd.mediwish.auth;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.UUID;

/** A staff User's authenticator: PENDING until its first code is verified, then ACTIVE. The seed is encrypted. */
@Entity
@Table(name = "staff_mfa_factors")
public class StaffMfaFactor {
    enum Status { PENDING, ACTIVE, REVOKED }

    @Id
    private UUID id;
    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private Status status;
    @Column(name = "secret_ciphertext", nullable = false, updatable = false)
    private byte[] secretCiphertext;
    @Column(name = "secret_nonce", nullable = false, updatable = false)
    private byte[] secretNonce;
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;
    @Column(name = "pending_expires_at")
    private Instant pendingExpiresAt;
    @Column(name = "activated_at")
    private Instant activatedAt;
    @Column(name = "revoked_at")
    private Instant revokedAt;
    @Column(name = "last_used_step", nullable = false)
    private long lastUsedStep;

    protected StaffMfaFactor() {}

    StaffMfaFactor(UUID id, UUID userId, MfaSecretCipher.Sealed secret, Instant createdAt, Instant pendingExpiresAt) {
        this.id = id;
        this.userId = userId;
        this.status = Status.PENDING;
        this.secretCiphertext = secret.ciphertext();
        this.secretNonce = secret.nonce();
        this.createdAt = createdAt;
        this.pendingExpiresAt = pendingExpiresAt;
        this.lastUsedStep = -1;
    }

    UUID id() { return id; }
    byte[] secretCiphertext() { return secretCiphertext; }
    byte[] secretNonce() { return secretNonce; }
    long lastUsedStep() { return lastUsedStep; }

    boolean pendingExpired(Instant at) {
        return !pendingExpiresAt.isAfter(at);
    }

    void activate(Instant at, long step) {
        status = Status.ACTIVE;
        activatedAt = at;
        pendingExpiresAt = null;
        lastUsedStep = step;
    }

    void recordUse(long step) {
        lastUsedStep = step;
    }
}
