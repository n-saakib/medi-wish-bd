package bd.mediwish.auth;

import bd.mediwish.testsupport.TestAuthSettings;
import bd.mediwish.notification.NoticeOutcome;
import bd.mediwish.web.WebTestFixtures;
import tools.jackson.databind.json.JsonMapper;
import bd.mediwish.user.UserProfile;
import bd.mediwish.user.UserRole;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockHttpServletResponse;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class StaffMfaControllerTest {
    private static final Instant NOW = Instant.parse("2026-09-27T10:00:00Z");
    private static final UserProfile PROFILE = new UserProfile("owner_1", "01700000000", null, false);
    private static final CurrentUserAuthentication.CurrentUser RESTRICTED = new CurrentUserAuthentication.CurrentUser(
            UUID.randomUUID(), UUID.randomUUID(), PROFILE, Set.of(UserRole.ADMIN),
            MfaStatus.VERIFICATION_REQUIRED, Set.of(StaffAccessPolicy.MFA_CHALLENGE));
    private static final AuthenticationService.AuthenticatedSession VERIFIED = new AuthenticationService
            .AuthenticatedSession("access", 900, "verified-refresh", NOW.plus(Duration.ofDays(30)), PROFILE,
            MfaStatus.VERIFIED);

    @Mock StaffMfaService mfa;
    @Mock StaffMfaRecoveryService recovery;
    private final JsonMapper mapper = JsonMapper.builder().build();
    private StaffMfaController controller;
    private final MockHttpServletResponse response = new MockHttpServletResponse();

    @BeforeEach
    void setUp() {
        controller = new StaffMfaController(mfa, recovery,
                new RefreshCookieAdapter(TestAuthSettings.properties(), Clock.fixed(NOW, ZoneOffset.UTC)));
    }

    @Test
    void aVerifiedCodeReplacesTheRefreshCookieAndReturnsTheVerifiedSession() {
        when(mfa.verify(RESTRICTED.userId(), RESTRICTED.sessionId(), "123456")).thenReturn(VERIFIED);

        var body = controller.verify(RESTRICTED, new StaffMfaController.Verification("123 456"), response);

        assertThat(body).isEqualTo(new AuthController.SessionResponse("access", "Bearer", 900, PROFILE,
                MfaStatus.VERIFIED));
        assertThat(response.getHeader("Set-Cookie")).startsWith("MW_REFRESH=verified-refresh; Path=/api/auth;");
    }

    @Test
    void enrollmentReturnsTheBackupCodesWithTheVerifiedSession() {
        UUID enrollmentId = UUID.randomUUID();
        when(mfa.verifyEnrollment(RESTRICTED.userId(), RESTRICTED.sessionId(), enrollmentId, "654321"))
                .thenReturn(new StaffMfaService.EnrolledSession(VERIFIED, List.of("ABCD-EFGH")));

        var body = controller.verifyEnrollment(RESTRICTED,
                new StaffMfaController.EnrollmentVerification(enrollmentId.toString(), "654321"), response);

        assertThat(body).isEqualTo(new StaffMfaController.EnrolledSessionResponse("access", "Bearer", 900, PROFILE,
                MfaStatus.VERIFIED, List.of("ABCD-EFGH"), null));
        assertThat(response.getHeader("Set-Cookie")).startsWith("MW_REFRESH=verified-refresh;");
        assertThat(mapper.valueToTree(body).has("contactNotice")).isFalse();
        assertThat(body.toString()).isEqualTo("EnrolledSessionResponse[redacted]");
    }

    @Test
    void newCodeRoutesRejectWrongShapesAndMalformedCodesWithoutRecoveryCalls() {
        for (String json : new String[]{"{}", "[]", "null", "\"x\"", "{\"backupCode\":12345678}",
                "{\"backupCode\":null}", "{\"backupCode\":true}", "{\"backupCode\":[\"ABCD-2345\"]}",
                "{\"backupCode\":\"ABCD-2345\",\"extra\":1}", "{\"code\":\"123456\"}",
                "{\"backupCode\":\"ABCI-2345\"}", "{\"backupCode\":\"ABCD--2345\"}",
                "{\"backupCode\":\"" + "A".repeat(300) + "\"}"}) {
            assertThatThrownBy(() -> controller.useBackupCode(RESTRICTED, mapper.readTree(json), response))
                    .isInstanceOf(InvalidRequestException.class);
        }
        for (String json : new String[]{"{}", "[]", "null", "\"123456\"", "{\"code\":123456}",
                "{\"code\":null}", "{\"code\":true}", "{\"code\":[\"123456\"]}",
                "{\"code\":\"123456\",\"extra\":1}", "{\"code\":\"123456\",\"backupCode\":\"x\"}",
                "{\"code\":\"12345\"}", "{\"code\":\"١٢٣٤٥٦\"}", "{\"code\":\"" + "1".repeat(300) + "\"}"}) {
            assertThatThrownBy(() -> controller.regenerate(RESTRICTED, mapper.readTree(json)))
                    .isInstanceOf(InvalidRequestException.class);
        }
        assertThatThrownBy(() -> controller.useBackupCode(RESTRICTED, null, response)).isInstanceOf(InvalidRequestException.class);
        assertThatThrownBy(() -> controller.regenerate(RESTRICTED, null)).isInstanceOf(InvalidRequestException.class);
        verifyNoInteractions(recovery, mfa);
        assertThat(response.getHeader("Set-Cookie")).isNull();
    }

    @Test
    void recoveryNormalizesTheCodeAndSetsTheFixedLifetimeReplacementCookie() {
        var replacement = new AuthenticationService.AuthenticatedSession("replacement-access", 600, "replacement-refresh",
                NOW.plusSeconds(600), PROFILE, MfaStatus.REPLACEMENT_REQUIRED);
        when(recovery.useBackupCode(RESTRICTED.userId(), RESTRICTED.sessionId(), "ABCD2345")).thenReturn(replacement);

        var body = controller.useBackupCode(RESTRICTED, mapper.readTree("{\"backupCode\":\" abcd-2345 \"}"), response);

        assertThat(body).isEqualTo(AuthController.SessionResponse.from(replacement));
        assertThat(response.getHeader("Set-Cookie")).startsWith("MW_REFRESH=replacement-refresh; Path=/api/auth; Max-Age=600;");
        verifyNoInteractions(mfa);
    }

    @Test
    void regenerationNormalizesTotpAndReturnsCodesWithoutChangingTheCookie() {
        when(recovery.regenerateBackupCodes(RESTRICTED.userId(), RESTRICTED.sessionId(), "123456"))
                .thenReturn(List.of("ABCD-2345"));

        var body = controller.regenerate(RESTRICTED, mapper.readTree("{\"code\":\"123 456\"}"));

        assertThat(body.backupCodes()).containsExactly("ABCD-2345");
        assertThat(body.toString()).isEqualTo("BackupCodesResponse[redacted]");
        assertThat(response.getHeader("Set-Cookie")).isNull();
        verifyNoInteractions(mfa);
    }

    @Test
    void replacementVerificationDispatchesToRecoveryAndIncludesTheNotice() {
        var current = new CurrentUserAuthentication.CurrentUser(RESTRICTED.userId(), RESTRICTED.sessionId(), PROFILE,
                Set.of(UserRole.ADMIN), MfaStatus.REPLACEMENT_REQUIRED, Set.of(StaffAccessPolicy.MFA_REPLACEMENT));
        UUID enrollmentId = UUID.randomUUID();
        when(recovery.verifyReplacement(current.userId(), current.sessionId(), enrollmentId, "654321"))
                .thenReturn(new StaffMfaRecoveryService.ReplacedSession(VERIFIED, List.of("ABCD-2345"), NoticeOutcome.SENT));

        var body = controller.verifyEnrollment(current,
                new StaffMfaController.EnrollmentVerification(enrollmentId.toString(), "654 321"), response);

        assertThat(body.contactNotice()).isEqualTo(NoticeOutcome.SENT);
        assertThat(body.backupCodes()).containsExactly("ABCD-2345");
        assertThat(mapper.valueToTree(body).get("contactNotice").asString()).isEqualTo("SENT");
        assertThat(response.getHeader("Set-Cookie")).startsWith("MW_REFRESH=verified-refresh;");
        verifyNoInteractions(mfa);
    }

    @Test
    void newRoutesBoundMalformedJsonAndRejectNonJsonContentTypes() throws Exception {
        var mvc = WebTestFixtures.catalogMvc(controller);
        for (String path : new String[]{"/api/auth/mfa/recovery", "/api/auth/mfa/backup-codes"}) {
            mvc.perform(post(path).contentType("text/plain").content("{\"code\":\"123456\"}"))
                    .andExpect(status().isUnsupportedMediaType()).andExpect(jsonPath("$.code").value("INVALID_REQUEST"))
                    .andExpect(header().string("Cache-Control", "no-store")).andExpect(header().exists("X-Request-ID"));
            mvc.perform(post(path).contentType("application/json").content("{"))
                    .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
        }
        verifyNoInteractions(recovery, mfa);
    }

    @Test
    void aMalformedCodeOrEnrollmentIdIsAnInvalidRequestAndNeverAnAttempt() {
        for (String code : new String[]{null, "", "12345", "1234567", "12a456", "١٢٣٤٥٦", "123-456"}) {
            assertThatThrownBy(() -> controller.verify(RESTRICTED, new StaffMfaController.Verification(code), response))
                    .as(String.valueOf(code)).isInstanceOf(InvalidRequestException.class);
        }
        String upper = UUID.randomUUID().toString().toUpperCase(Locale.ROOT);
        for (String id : new String[]{null, "", "not-a-uuid", upper}) {
            assertThatThrownBy(() -> controller.verifyEnrollment(RESTRICTED,
                    new StaffMfaController.EnrollmentVerification(id, "123456"), response))
                    .isInstanceOf(InvalidRequestException.class);
        }
        verifyNoInteractions(mfa);
        assertThat(response.getHeader("Set-Cookie")).isNull();
    }
}
