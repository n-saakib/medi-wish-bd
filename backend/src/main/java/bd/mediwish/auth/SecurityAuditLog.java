package bd.mediwish.auth;

import org.slf4j.MDC;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.util.UUID;

/** Writes audit rows inside the caller's transaction, so a row commits exactly when the change it records does. */
@Component
class SecurityAuditLog {
    private final SecurityAuditEventRepository events;
    private final Clock clock;

    SecurityAuditLog(SecurityAuditEventRepository events, Clock clock) {
        this.events = events;
        this.clock = clock;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    void record(SecurityAuditEvent.Type type, UUID subjectUserId, UUID sessionId) {
        // RequestCorrelationFilter's server-generated UUID; the provisioning command runs outside a request and has none.
        events.save(new SecurityAuditEvent(clock.instant(), type, subjectUserId, sessionId, MDC.get("requestId")));
    }
}
