package bd.mediwish.auth;

import bd.mediwish.testsupport.TestAuthSettings;
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
    private StaffMfaController controller;
    private final MockHttpServletResponse response = new MockHttpServletResponse();

    @BeforeEach
    void setUp() {
        controller = new StaffMfaController(mfa,
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
                MfaStatus.VERIFIED, List.of("ABCD-EFGH")));
        assertThat(response.getHeader("Set-Cookie")).startsWith("MW_REFRESH=verified-refresh;");
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
