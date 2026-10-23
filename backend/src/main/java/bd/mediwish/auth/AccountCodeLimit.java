package bd.mediwish.auth;

import jakarta.persistence.*;
import java.time.Duration;
import java.time.Instant;

@Entity @Table(name="account_code_limits")
public class AccountCodeLimit {
    @Id @Column(name="limit_key", length=96) private String limitKey;
    @Column(name="window_started_at", nullable=false) private Instant windowStartedAt;
    @Column(nullable=false) private int attempts;
    @Column(name="last_at", nullable=false) private Instant lastAt;

    protected AccountCodeLimit() {}
    AccountCodeLimit(String key, Instant start, int attempts, Instant lastAt) {
        this.limitKey=key; this.windowStartedAt=start; this.attempts=attempts; this.lastAt=lastAt;
    }
    AccountCodeRules.LimitWindow window() { return new AccountCodeRules.LimitWindow(windowStartedAt, attempts, lastAt); }
    int attempts() { return attempts; }

    /** A fresh entity also works after a code replacement clears the persistence context. */
    static AccountCodeLimit next(String key, AccountCodeRules.LimitWindow previous, Instant now, Duration lifetime) {
        boolean fresh = previous == null || !now.isBefore(previous.windowStartedAt().plus(lifetime));
        return new AccountCodeLimit(key, fresh ? now : previous.windowStartedAt(),
                fresh ? 1 : previous.count() + 1, now);
    }
}
