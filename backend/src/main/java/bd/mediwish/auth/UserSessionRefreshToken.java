package bd.mediwish.auth;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "user_session_refresh_tokens",
        uniqueConstraints = {
                @UniqueConstraint(name = "uk_session_refresh_token_hash", columnNames = "token_hash"),
                @UniqueConstraint(name = "uk_session_refresh_generation", columnNames = {"session_id", "generation"})
        },
        indexes = {
                @Index(name = "idx_session_refresh_session_expires", columnList = "session_id, expires_at")
        })
public class UserSessionRefreshToken {
    @Id
    private UUID id;
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "session_id", nullable = false)
    private UserSession session;
    @Column(nullable = false)
    private long generation;
    @Column(name = "token_hash", nullable = false, length = 64)
    private String tokenHash;
    @Column(name = "issued_at", nullable = false)
    private Instant issuedAt;
    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;
    @Column(name = "consumed_at")
    private Instant consumedAt;

    protected UserSessionRefreshToken() {}

    public UserSessionRefreshToken(UUID id, UserSession session, long generation, String tokenHash,
                                   Instant issuedAt, Instant expiresAt) {
        this.id = id;
        this.session = session;
        this.generation = generation;
        this.tokenHash = tokenHash;
        this.issuedAt = issuedAt;
        this.expiresAt = expiresAt;
    }

    public UUID id() { return id; }
    public UserSession session() { return session; }
    public long generation() { return generation; }
    public String tokenHash() { return tokenHash; }
    public Instant issuedAt() { return issuedAt; }
    public Instant expiresAt() { return expiresAt; }
    public Instant consumedAt() { return consumedAt; }

    public boolean consumed() { return consumedAt != null; }
    public void consume(Instant at) { consumedAt = at; }
}
