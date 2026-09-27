package bd.mediwish.auth;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.UUID;

/** The Argon2 verifier of one backup code, never the code; Ticket 09 consumes it. */
@Entity
@Table(name = "staff_mfa_backup_codes")
public class StaffMfaBackupCode {
    @Id
    private UUID id;
    @Column(name = "factor_id", nullable = false, updatable = false)
    private UUID factorId;
    @Column(name = "code_verifier", nullable = false, updatable = false)
    private String codeVerifier;
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;
    @Column(name = "consumed_at")
    private Instant consumedAt;

    protected StaffMfaBackupCode() {}

    StaffMfaBackupCode(UUID id, UUID factorId, String codeVerifier, Instant createdAt) {
        this.id = id;
        this.factorId = factorId;
        this.codeVerifier = codeVerifier;
        this.createdAt = createdAt;
    }
}
