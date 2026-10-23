package bd.mediwish.auth;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** The protected verifier for one purpose; consumption and replacement delete this row. */
@Entity @Table(name = "account_codes")
public class AccountCode {
    @Id private UUID id;
    @Column(name="user_id", nullable=false) private UUID userId;
    @Enumerated(EnumType.STRING) @Column(nullable=false, length=32) private AccountCodePurpose purpose;
    @JdbcTypeCode(SqlTypes.CHAR) @Column(name="code_hash", nullable=false, length=64) private String codeHash;
    @Column(name="sent_to", nullable=false, length=320) private String sentTo;
    @Column(name="created_at", nullable=false) private Instant createdAt;
    @Column(name="expires_at", nullable=false) private Instant expiresAt;
    @Column(name="failed_attempts", nullable=false) private short failedAttempts;

    protected AccountCode() {}
    AccountCode(UUID id, UUID userId, AccountCodePurpose purpose, String codeHash, String sentTo,
                Instant createdAt, Instant expiresAt) {
        this.id=id; this.userId=userId; this.purpose=purpose; this.codeHash=codeHash;
        this.sentTo=sentTo; this.createdAt=createdAt; this.expiresAt=expiresAt;
    }
    UUID id() { return id; }
    UUID userId() { return userId; }
    AccountCodePurpose purpose() { return purpose; }
    String codeHash() { return codeHash; }
    String sentTo() { return sentTo; }
    Instant expiresAt() { return expiresAt; }
    int failedAttempts() { return failedAttempts; }
    void recordFailure() { failedAttempts++; }
}
