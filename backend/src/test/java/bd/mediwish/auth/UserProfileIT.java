package bd.mediwish.auth;

import bd.mediwish.auth.AuthApi.User;
import bd.mediwish.user.MobileChangeService;
import bd.mediwish.user.ProfileService;
import jakarta.persistence.EntityManagerFactory;
import org.hibernate.SessionFactory;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

import static bd.mediwish.testsupport.ApiAssertions.assertError;
import static bd.mediwish.testsupport.ApiAssertions.json;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Ticket 11 owner-facing API contract and restart durability on its own guarded PostgreSQL schema. */
@Tag("integration")
@Tag("security")
@Tag("recovery")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@ExtendWith(OutputCaptureExtension.class)
class UserProfileIT {
    private final AuthApi api = AuthApi.start();

    @AfterAll
    void close() throws Exception {
        api.close();
    }

    @AfterEach
    void logsOmitProfileAndCredentialValues(CapturedOutput output) {
        api.assertLogsOmitSecrets(output);
    }

    @Test
    void savedFieldsAndPendingMobileSurviveRestartThenCancelAndActivationWork() throws Exception {
        User user = api.registered();
        var session = api.signIn(user);
        api.verifyMobile(user);
        String token = session.accessToken();
        String name = api.track("Restart Profile Tester");
        String email = api.track("restart." + UUID.randomUUID() + "@example.test");
        String dob = api.track("1990-05-01");
        String pending = api.newUser().mobile();

        var empty = json(api.profileOf(token));
        assertThat(empty).containsOnlyKeys("username", "fullName", "mobile", "mobileVerified", "pendingMobile",
                "email", "emailVerified", "dateOfBirth", "accountState", "version");
        assertThat(empty).containsEntry("username", user.username()).containsEntry("fullName", null)
                .containsEntry("dateOfBirth", null).containsEntry("pendingMobile", null).containsEntry("emailVerified", false)
                .containsEntry("accountState", "ACTIVE").containsEntry("version", 0);

        var saved = api.putProfile(token, api.profileEdit(user, 0, "  Restart   Profile Tester ", email.toUpperCase(), dob));
        assertThat(saved.statusCode()).isEqualTo(200);
        assertThat(json(saved)).containsEntry("fullName", name).containsEntry("email", email)
                .containsEntry("emailVerified", false)
                .containsEntry("dateOfBirth", dob).containsEntry("version", 1);
        assertThat(json(api.profile(token))).containsOnlyKeys("username", "mobile", "email", "mobileVerified")
                .containsEntry("email", email);

        assertThat(api.stageMobile(token, pending).statusCode()).isEqualTo(202);
        assertThat(json(api.profileOf(token))).containsEntry("mobile", user.mobile())
                .containsEntry("mobileVerified", true).containsEntry("pendingMobile", pending).containsEntry("version", 1);
        assertThat(api.login(user.mobile(), user.password()).statusCode()).isEqualTo(200);
        assertError(api.login(pending, user.password()), 401, "AUTHENTICATION_FAILED");

        api.app().restart();

        var durable = api.profileOf(token);
        assertThat(durable.statusCode()).isEqualTo(200);
        assertThat(json(durable)).containsEntry("fullName", name).containsEntry("email", email)
                .containsEntry("emailVerified", false)
                .containsEntry("dateOfBirth", dob).containsEntry("pendingMobile", pending).containsEntry("version", 1);
        assertThat(api.cancelMobile(token).statusCode()).isEqualTo(204);
        var repeatedCancel = api.cancelMobile(token);
        assertThat(repeatedCancel.statusCode()).isEqualTo(204);
        assertThat(repeatedCancel.body()).isEmpty();
        assertThat(json(api.profileOf(token))).containsEntry("pendingMobile", null);

        String applied = api.newUser().mobile();
        assertThat(api.stageMobile(token, applied).statusCode()).isEqualTo(202);
        api.activatePendingMobile(user);
        assertThat(json(api.profileOf(token))).containsEntry("mobile", applied).containsEntry("mobileVerified", true)
                .containsEntry("pendingMobile", null).containsEntry("version", 1).containsEntry("username", user.username());
        assertThat(api.login(applied, user.password()).statusCode()).isEqualTo(200);
        assertError(api.login(user.mobile(), user.password()), 401, "AUTHENTICATION_FAILED");
        assertThat(api.database().single("SELECT count(*) FROM user_mobile_changes WHERE user_id = "
                + "(SELECT id FROM users WHERE username = ?)", Long.class, user.username())).isZero();
        assertThat(api.profileOf(token).statusCode()).as("activation keeps the current session").isEqualTo(200);
    }

    @Test
    void normalizedRetriesAreNoOpsButDifferentStaleValuesAndClosingWritesAreRefused() throws Exception {
        User user = api.registered();
        String token = api.signIn(user).accessToken();
        String name = api.track("Normalized Profile");
        String body = AuthApi.profileEdit(0, name, user.email(), null);
        assertThat(json(api.putProfile(token, body))).containsEntry("version", 1);
        assertThat(json(api.putProfile(token, AuthApi.profileEdit(0, "  Normalized   Profile ", user.email(), null))))
                .containsEntry("version", 1);
        assertError(api.putProfile(token, AuthApi.profileEdit(0, "Different Name", user.email(), null)),
                409, "STALE_UPDATE");
        String mobile = api.newUser().mobile();
        assertThat(api.stageMobile(token, mobile).statusCode()).isEqualTo(202);
        var before = json(api.profileOf(token));
        api.accountState(user, "CLOSURE_REQUESTED");
        assertError(api.putProfile(token, body), 409, "ACCOUNT_CLOSING");
        assertError(api.putProfile(token, AuthApi.profileEdit(1, name, user.email(), "1899-12-31")),
                409, "ACCOUNT_CLOSING");
        assertError(api.stageMobile(token, api.newUser().mobile()), 409, "ACCOUNT_CLOSING");
        assertError(api.cancelMobile(token), 409, "ACCOUNT_CLOSING");
        before.put("accountState", "CLOSURE_REQUESTED");
        assertThat(json(api.profileOf(token))).isEqualTo(before);
    }

    @Test
    void aUsersTokenReadsAndChangesOnlyThatUsersProfile() throws Exception {
        User owner = api.registered();
        String ownerToken = api.signIn(owner).accessToken();
        String privateName = api.track("Owner Private Profile");
        assertThat(api.putProfile(ownerToken, AuthApi.profileEdit(0, privateName, owner.email(), "1992-04-04"))
                .statusCode()).isEqualTo(200);
        var before = json(api.profileOf(ownerToken));
        User other = api.registered();
        String otherToken = api.signIn(other).accessToken();
        assertThat(json(api.profileOf(otherToken))).containsEntry("username", other.username())
                .containsEntry("fullName", null);
        assertThat(api.putProfile(otherToken, AuthApi.profileEdit(0, "Another Profile", other.email(), null))
                .statusCode()).isEqualTo(200);
        var foreign = api.send("GET", "/api/user/" + api.userId(owner) + "/profile",
                Map.of("Authorization", "Bearer " + otherToken), null);
        assertThat(foreign.statusCode()).isIn(401, 403, 404);
        assertThat(foreign.body()).doesNotContain(privateName);
        assertThat(json(api.profileOf(ownerToken))).isEqualTo(before);
    }

    @Test
    void onlyTheAcceptedOwnerRoutesAreMappedAndNoneActivateAMobile() throws Exception {
        String token = api.signIn(api.registered()).accessToken();
        assertThat(api.profileOf(token).statusCode()).isEqualTo(200);
        var mappings = api.app().bean(org.springframework.web.servlet.handler.HandlerMappingIntrospector.class)
                .getHandlerMappings().stream().filter(RequestMappingHandlerMapping.class::isInstance)
                .map(RequestMappingHandlerMapping.class::cast)
                .flatMap(mapping -> mapping.getHandlerMethods().keySet().stream()).collect(Collectors.toSet());
        Set<String> profileMappings = mappings.stream().flatMap(mapping -> mapping.getPatternValues().stream()
                        .filter(path -> path.startsWith("/api/user/me"))
                        .flatMap(path -> mapping.getMethodsCondition().getMethods().stream()
                                .map(method -> method.name() + " " + path)))
                .collect(Collectors.toSet());
        assertThat(profileMappings).containsExactlyInAnyOrder("GET /api/user/me", "GET /api/user/me/profile",
                "PUT /api/user/me/profile", "POST /api/user/me/mobile-change", "DELETE /api/user/me/mobile-change",
                "POST /api/user/me/email-verification", "POST /api/user/me/email-verification/confirm",
                "GET /api/user/me/addresses", "POST /api/user/me/addresses",
                "PUT /api/user/me/addresses/{id}", "DELETE /api/user/me/addresses/{id}");
        assertThat(mappings.stream().flatMap(mapping -> mapping.getPatternValues().stream())
                .filter(path -> path.contains("mobile")).toList()).containsOnly("/api/user/me/mobile-change");
    }

    @Test
    void theProfileReadUsesAtMostTwoPreparedStatements() throws Exception {
        User user = api.registered();
        String token = api.signIn(user).accessToken();
        assertThat(api.stageMobile(token, api.newUser().mobile()).statusCode()).isEqualTo(202);
        var statistics = api.app().bean(EntityManagerFactory.class).unwrap(SessionFactory.class).getStatistics();
        statistics.setStatisticsEnabled(true);
        try {
            statistics.clear();
            var profile = api.app().bean(ProfileService.class).profile(api.userId(user));
            assertThat(profile.username()).isEqualTo(user.username());
            long readQueries = statistics.getPrepareStatementCount();
            assertThat(readQueries).as("profile service query count").isBetween(1L, 2L);
            statistics.clear();
            api.app().bean(ProfileService.class).update(api.userId(user), api.sessionId(user),
                    new bd.mediwish.user.ProfileEdit("Query Count Profile", user.email(), null, 0L, null));
            long saveQueries = statistics.getPrepareStatementCount();
            assertThat(saveQueries).as("save lock, roles, pending, email check and update").isBetween(2L, 6L);
            System.out.println("Ticket 11 service query counts: GET=" + readQueries + ", PUT=" + saveQueries);
        } finally {
            statistics.setStatisticsEnabled(false);
        }
    }
}
