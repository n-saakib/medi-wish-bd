package bd.mediwish.auth;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

/** Wrong MFA codes per User (D3): too many within the window lock MFA verification for the lockout. */
@Entity
@Table(name = "staff_mfa_throttle")
public class StaffMfaThrottle {
    @Id
    @Column(name = "user_id")
    private UUID userId;
    @Column(name = "failed_count", nullable = false)
    private int failedCount;
    @Column(name = "window_started_at", nullable = false)
    private Instant windowStartedAt;
    @Column(name = "locked_until")
    private Instant lockedUntil;

    protected StaffMfaThrottle() {}

    StaffMfaThrottle(UUID userId, Instant now) {
        this.userId = userId;
        this.windowStartedAt = now;
    }

    boolean isLocked(Instant now) {
        return lockedUntil != null && lockedUntil.isAfter(now);
    }

    /** Counts one wrong code; returns true when this failure locks verification. */
    boolean recordFailure(Instant now, int maxFailedAttempts, Duration window, Duration lockout) {
        if (lockedUntil != null || !windowStartedAt.plus(window).isAfter(now)) reset(now);
        failedCount++;
        if (failedCount < maxFailedAttempts) return false;
        lockedUntil = now.plus(lockout);
        return true;
    }

    void reset(Instant now) {
        failedCount = 0;
        windowStartedAt = now;
        lockedUntil = null;
    }

    int failedCount() { return failedCount; }
}
