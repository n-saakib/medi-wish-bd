package bd.mediwish.auth;

import bd.mediwish.auth.AuthApi.User;
import jakarta.persistence.EntityManagerFactory;
import org.hibernate.SessionFactory;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;

import java.net.http.HttpResponse;
import java.util.Map;

import static bd.mediwish.testsupport.ApiAssertions.assertError;
import static bd.mediwish.testsupport.ApiAssertions.json;
import static org.assertj.core.api.Assertions.assertThat;

/**
 * Simultaneous MFA requests for one User are serialized by the User row lock, and enrollment is persisted, so a
 * restart between its two steps loses nothing. This class owns its application because it restarts it.
 */
@Tag("integration")
@Tag("recovery")
@Tag("security")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class ConcurrentMfaIT {
    private final AuthApi api = AuthApi.start();

    @AfterAll
    void close() throws Exception {
        api.close();
    }

    @Test
    void theSameCodeSentTwiceAtOnceVerifiesOnlyOneSession() throws Exception {
        User admin = staff();
        var enrolled = api.enroll(admin);
        String first = challenge(admin);
        String second = challenge(admin);
        String code = AuthApi.totp(enrolled.secret(), 1);

        var responses = AuthApi.race(() -> api.verifyMfa(first, code), () -> api.verifyMfa(second, code));

        assertThat(responses).extracting(HttpResponse::statusCode).containsExactlyInAnyOrder(200, 400);
        var loser = responses.stream().filter(response -> response.statusCode() == 400).findFirst().orElseThrow();
        assertError(loser, 400, "MFA_CODE_INVALID");
        api.session(responses.stream().filter(response -> response.statusCode() == 200).findFirst().orElseThrow(),
                "VERIFIED");
        assertThat(api.revoked(admin, RevocationReason.MFA_VERIFIED)).isEqualTo(2);
    }

    @Test
    void simultaneousEnrollmentStartsLeaveOnePendingFactorAndTheLoserIsStale() throws Exception {
        User admin = staff();
        String restricted = api.session(api.login(admin.username(), admin.password()), "ENROLLMENT_REQUIRED")
                .accessToken();
        Map<String, String> bearer = Map.of("Authorization", "Bearer " + restricted);

        var responses = AuthApi.race(() -> api.post("/api/auth/mfa/enrollment", bearer, null),
                () -> api.post("/api/auth/mfa/enrollment", bearer, null));

        assertThat(responses).extracting(HttpResponse::statusCode).containsExactly(201, 201);
        var enrollments = responses.stream().map(response -> json(response)).toList();
        enrollments.forEach(enrollment -> api.track((String) enrollment.get("secret")));
        String pendingId = api.database().single("SELECT id::text FROM staff_mfa_factors WHERE user_id = ? "
                + "AND status = 'PENDING'", String.class, api.userId(admin));
        var winner = enrollments.stream().filter(e -> e.get("enrollmentId").equals(pendingId)).findFirst().orElseThrow();
        var loser = enrollments.stream().filter(e -> e != winner).findFirst().orElseThrow();
        assertError(api.verifyEnrollment(restricted, loser.get("enrollmentId"),
                AuthApi.totp((String) loser.get("secret"), 0)), 409, "MFA_ENROLLMENT_STALE");
        api.session(api.verifyEnrollment(restricted, winner.get("enrollmentId"),
                AuthApi.totp((String) winner.get("secret"), 0)), "VERIFIED");
    }

    @Test
    void aPendingEnrollmentSurvivesARestart() throws Exception {
        User admin = staff();
        var restricted = api.session(api.login(admin.username(), admin.password()), "ENROLLMENT_REQUIRED");
        var enrollment = api.startEnrollment(restricted.accessToken());

        api.app().restart();

        api.session(api.verifyEnrollment(restricted.accessToken(), enrollment.get("enrollmentId"),
                AuthApi.totp((String) enrollment.get("secret"), 0)), "VERIFIED");
    }

    /** T7: the statements one authorized request prepares; the staff check adds only the active-factor lookup. */
    @Test
    void anAuthorizedRequestPreparesAFewIndexedStatements() throws Exception {
        User customer = api.registered();
        String customerToken = api.signIn(customer).accessToken();
        User admin = staff();
        String staffToken = api.enroll(admin).session().accessToken();
        var statistics = api.app().bean(EntityManagerFactory.class).unwrap(SessionFactory.class).getStatistics();
        statistics.setStatisticsEnabled(true);
        try {
            statistics.clear();
            assertThat(api.profile(customerToken).statusCode()).isEqualTo(200);
            long customerProfile = statistics.getPrepareStatementCount();
            statistics.clear();
            assertThat(api.profile(staffToken).statusCode()).isEqualTo(200);
            long staffProfile = statistics.getPrepareStatementCount();
            statistics.clear();
            assertThat(api.staffMe(staffToken).statusCode()).isEqualTo(200);
            long staffMe = statistics.getPrepareStatementCount();
            System.out.printf("T7 statements: customer /api/user/me=%d, staff /api/user/me=%d, /api/staff/me=%d%n",
                    customerProfile, staffProfile, staffMe);
            assertThat(staffProfile).isEqualTo(customerProfile + 1);
            assertThat(staffMe).isEqualTo(staffProfile + 1);
        } finally {
            statistics.setStatisticsEnabled(false);
        }
    }

    private User staff() throws Exception {
        User user = api.registered();
        api.grantRole(user, "ADMIN");
        return user;
    }

    private String challenge(User admin) throws Exception {
        return api.session(api.login(admin.username(), admin.password()), "VERIFICATION_REQUIRED").accessToken();
    }
}
