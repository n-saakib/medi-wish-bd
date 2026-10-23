package bd.mediwish.auth;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.UUID;

/** One security audit row; it has no free-text column, so no secret can be written into it. */
@Entity
@Table(name = "security_audit_events")
public class SecurityAuditEvent {
    public enum Type {
        FIRST_ADMIN_PROVISIONED,
        MFA_ENROLLMENT_STARTED,
        MFA_ENROLLMENT_ACTIVATED,
        MFA_VERIFIED,
        MFA_VERIFICATION_FAILED,
        MFA_ATTEMPTS_LOCKED,
        EMAIL_VERIFICATION_REQUESTED,
        EMAIL_VERIFIED,
        EMAIL_CHANGED,
        PASSWORD_RESET_REQUESTED,
        PASSWORD_RESET_COMPLETED,
        ACCOUNT_CODE_FAILED,
        ACCOUNT_CODE_LOCKED,
        CURRENT_PASSWORD_FAILED,
        EMAIL_DELIVERY_FAILED,
        MFA_RECOVERY_STARTED,
        MFA_RECOVERY_CODE_REJECTED,
        MFA_FACTOR_REPLACED,
        MFA_BACKUP_CODES_REGENERATED,
        MFA_REPLACEMENT_NOTICE_SENT,
        MFA_REPLACEMENT_NOTICE_FAILED,
        MFA_REPLACEMENT_NOTICE_NO_VERIFIED_CONTACT,
        MFA_REPLACEMENT_NOTICE_NOT_CONFIGURED
    }

    @Id
    private UUID id;
    @Column(name = "occurred_at", nullable = false, updatable = false)
    private Instant occurredAt;
    @Enumerated(EnumType.STRING)
    @Column(name = "event_type", nullable = false, length = 64, updatable = false)
    private Type eventType;
    @Column(name = "subject_user_id", updatable = false)
    private UUID subjectUserId;
    @Column(name = "session_id", updatable = false)
    private UUID sessionId;
    @Column(name = "request_id", length = 64, updatable = false)
    private String requestId;

    protected SecurityAuditEvent() {}

    SecurityAuditEvent(Instant occurredAt, Type eventType, UUID subjectUserId, UUID sessionId, String requestId) {
        this.id = UUID.randomUUID();
        this.occurredAt = occurredAt;
        this.eventType = eventType;
        this.subjectUserId = subjectUserId;
        this.sessionId = sessionId;
        this.requestId = requestId;
    }
}
