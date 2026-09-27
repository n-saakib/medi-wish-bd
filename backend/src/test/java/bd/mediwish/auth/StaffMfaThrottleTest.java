package bd.mediwish.auth;

import org.junit.jupiter.api.Test;

import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class StaffMfaThrottleTest {
    private static final Instant NOW = Instant.parse("2026-09-27T10:00:00Z");
    private static final Duration WINDOW = Duration.ofMinutes(15);
    private static final Duration LOCKOUT = Duration.ofMinutes(15);

    private final StaffMfaThrottle throttle = new StaffMfaThrottle(UUID.randomUUID(), NOW);

    @Test
    void theFifthWrongCodeInTheWindowLocksVerificationForTheLockout() {
        for (int attempt = 1; attempt <= 4; attempt++) {
            assertThat(fail(NOW.plusSeconds(attempt))).isFalse();
        }
        assertThat(fail(NOW.plusSeconds(5))).isTrue();
        assertThat(throttle.isLocked(NOW.plusSeconds(5))).isTrue();
        assertThat(throttle.isLocked(NOW.plusSeconds(5).plus(LOCKOUT).minusMillis(1))).isTrue();
        assertThat(throttle.isLocked(NOW.plusSeconds(5).plus(LOCKOUT))).isFalse();
    }

    @Test
    void failuresOutsideTheWindowStartANewCount() {
        for (int attempt = 0; attempt < 4; attempt++) fail(NOW);
        assertThat(fail(NOW.plus(WINDOW))).isFalse();
        assertThat(throttle.failedCount()).isEqualTo(1);
    }

    @Test
    void anExpiredLockStartsAFreshCount() {
        for (int attempt = 0; attempt < 5; attempt++) fail(NOW);
        assertThat(fail(NOW.plus(LOCKOUT))).isFalse();
        assertThat(throttle.failedCount()).isEqualTo(1);
    }

    @Test
    void aSuccessfulVerificationClearsTheCount() {
        for (int attempt = 0; attempt < 4; attempt++) fail(NOW);
        throttle.reset(NOW);
        assertThat(fail(NOW)).isFalse();
        assertThat(throttle.failedCount()).isEqualTo(1);
    }

    @Test
    void backupCodesAreTenDistinctUnambiguousCodesStoredWithoutTheirSeparator() {
        var codes = BackupCodes.generate(new SecureRandom());
        assertThat(codes).hasSize(BackupCodes.COUNT).doesNotHaveDuplicates()
                .allMatch(code -> code.matches("[A-HJKMNP-TV-Z2-9]{4}-[A-HJKMNP-TV-Z2-9]{4}"));
        assertThat(BackupCodes.normalize("ABCD-EFGH")).isEqualTo("ABCDEFGH");
    }

    private boolean fail(Instant at) {
        return throttle.recordFailure(at, 5, WINDOW, LOCKOUT);
    }
}
