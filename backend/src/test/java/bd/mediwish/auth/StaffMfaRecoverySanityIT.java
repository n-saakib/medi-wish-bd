package bd.mediwish.auth;

import jakarta.persistence.EntityManagerFactory;
import org.hibernate.SessionFactory;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

import static bd.mediwish.testsupport.ApiAssertions.assertError;
import static org.assertj.core.api.Assertions.assertThat;

/** The shortest backup-code recovery, one refusal and recorded cost figures (Ticket 09, T7); no latency threshold (Ticket 59). */
@Tag("integration") @Tag("sanity")
@ExtendWith({OutputCaptureExtension.class, AuthApi.Shared.class})
class StaffMfaRecoverySanityIT {
    private final AuthApi api;
    StaffMfaRecoverySanityIT(AuthApi api) { this.api = api; }
    @AfterEach void logsOmitSecrets(CapturedOutput output) { api.assertLogsOmitSecrets(output); }

    /** The fixture (application, schema, enrolled Moderator) is prepared first; only the HTTP journey is timed. */
    @Test void theShortestRecoveryReachesStaffAccessAndAWrongCodeIsRefused() throws Exception {
        var user = staff(); var enrolled = api.enroll(user);
        long started = System.nanoTime();
        String challenge = api.session(api.login(user.username(), user.password()), "VERIFICATION_REQUIRED").accessToken();
        assertError(api.useBackupCode(challenge, absentBackupCode(enrolled.backupCodes())), 400, "MFA_CODE_INVALID");
        var replacing = api.session(api.useBackupCode(challenge, enrolled.backupCodes().getFirst()), "REPLACEMENT_REQUIRED");
        var pending = api.startEnrollment(replacing.accessToken());
        var response = api.verifyEnrollment(replacing.accessToken(), pending.get("enrollmentId"),
                api.authenticatorCode((String) pending.get("secret"), 0));
        var verified = api.session(response, "VERIFIED");
        api.backupCodes(response); // tracks the fresh codes so the log check covers them
        assertThat(api.staffMe(verified.accessToken()).statusCode()).isEqualTo(200);
        Duration journey = Duration.ofNanos(System.nanoTime() - started);
        System.out.printf("T9-T7 sanity: HTTP journey (fixture excluded) ms=%d%n", journey.toMillis());
        assertThat(journey).isLessThan(Duration.ofSeconds(10));
    }

    /**
     * Worst-case match cost (ten unused codes, no match) and the statements prepared by one successful recovery call
     * and one replacement verify call. Counts are per HTTP call, so authentication and filter queries are included.
     */
    @Test void recordsRecoveryCostAndPreparedStatements() throws Exception {
        var user = staff(); var enrolled = api.enroll(user);
        String challenge = api.session(api.login(user.username(), user.password()), "VERIFICATION_REQUIRED").accessToken();
        assertThat(api.database().single("SELECT count(*) FROM staff_mfa_backup_codes b JOIN staff_mfa_factors f ON f.id=b.factor_id "
                + "WHERE f.user_id=? AND f.status='ACTIVE' AND b.consumed_at IS NULL", Long.class, api.userId(user))).isEqualTo(10);
        String absent = absentBackupCode(enrolled.backupCodes());
        var millis = new ArrayList<Long>();
        for (int call = 0; call < 5; call++) {
            api.clearMfaThrottle(user);
            long started = System.nanoTime();
            assertError(api.useBackupCode(challenge, absent), 400, "MFA_CODE_INVALID");
            millis.add(Duration.ofNanos(System.nanoTime() - started).toMillis());
        }
        api.clearMfaThrottle(user);
        millis.sort(null);
        var statistics = api.app().bean(EntityManagerFactory.class).unwrap(SessionFactory.class).getStatistics();
        statistics.setStatisticsEnabled(true);
        try {
            statistics.clear();
            var replacing = api.session(api.useBackupCode(challenge, enrolled.backupCodes().getFirst()), "REPLACEMENT_REQUIRED");
            long recovery = statistics.getPrepareStatementCount();
            var pending = api.startEnrollment(replacing.accessToken());
            String code = api.authenticatorCode((String) pending.get("secret"), 0);
            statistics.clear();
            api.session(api.verifyEnrollment(replacing.accessToken(), pending.get("enrollmentId"), code), "VERIFIED");
            long verify = statistics.getPrepareStatementCount();
            System.out.printf("T9-T7 no-match /recovery ms: median=%d max=%d; statements: /recovery=%d, replacement verify=%d%n",
                    millis.get(2), millis.get(4), recovery, verify);
            assertThat(recovery).isPositive(); assertThat(verify).isPositive();
        } finally {
            statistics.setStatisticsEnabled(false);
        }
    }

    private AuthApi.User staff() throws Exception {
        var user = api.registered(); api.grantRole(user, "MODERATOR"); return user;
    }
    /** Eleven distinct valid codes cannot all occur among ten. */
    private static String absentBackupCode(List<String> codes) {
        return "ABCDEFGHJKM".chars().mapToObj(letter -> "ZZZZ-ZZZ" + (char) letter)
                .filter(candidate -> !codes.contains(candidate)).findFirst().orElseThrow();
    }
}
