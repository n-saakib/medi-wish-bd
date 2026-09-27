package bd.mediwish.auth;

import bd.mediwish.user.UserProfile;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Staff authenticator routes for a restricted session's Bearer token. Input shape is checked here, so a malformed
 * code is an invalid request and never counts as a failed attempt. A verification replaces the session and its
 * refresh cookie; only enrollment returns the backup codes, once.
 */
@RestController
@RequestMapping("/api/auth/mfa")
class StaffMfaController {
    private static final Pattern CODE = Pattern.compile("[0-9]{6}");
    private static final Pattern CANONICAL_UUID =
            Pattern.compile("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}");

    private final StaffMfaService mfa;
    private final RefreshCookieAdapter refreshCookies;

    StaffMfaController(StaffMfaService mfa, RefreshCookieAdapter refreshCookies) {
        this.mfa = mfa;
        this.refreshCookies = refreshCookies;
    }

    record EnrollmentVerification(String enrollmentId, String code) {}

    record Verification(String code) {}

    record EnrolledSessionResponse(String accessToken, String tokenType, long expiresIn, UserProfile user,
                                   MfaStatus mfa, List<String> backupCodes) {}

    @PostMapping("/enrollment")
    @ResponseStatus(HttpStatus.CREATED)
    StaffMfaService.Enrollment startEnrollment(@AuthenticationPrincipal CurrentUserAuthentication.CurrentUser current) {
        return mfa.startEnrollment(current.userId(), current.sessionId());
    }

    @PostMapping("/enrollment/verify")
    EnrolledSessionResponse verifyEnrollment(@AuthenticationPrincipal CurrentUserAuthentication.CurrentUser current,
                                             @RequestBody EnrollmentVerification request,
                                             HttpServletResponse response) {
        UUID enrollmentId = enrollmentId(request.enrollmentId());
        var enrolled = mfa.verifyEnrollment(current.userId(), current.sessionId(), enrollmentId, code(request.code()));
        var session = enrolled.session();
        refreshCookies.set(response, session.refreshToken(), session.refreshExpiresAt());
        return new EnrolledSessionResponse(session.accessToken(), "Bearer", session.expiresIn(), session.user(),
                session.mfa(), enrolled.backupCodes());
    }

    @PostMapping("/verify")
    AuthController.SessionResponse verify(@AuthenticationPrincipal CurrentUserAuthentication.CurrentUser current,
                                          @RequestBody Verification request, HttpServletResponse response) {
        var session = mfa.verify(current.userId(), current.sessionId(), code(request.code()));
        refreshCookies.set(response, session.refreshToken(), session.refreshExpiresAt());
        return AuthController.SessionResponse.from(session);
    }

    /** Exactly six ASCII digits once spaces are removed; authenticator apps often show the code as "123 456". */
    private static String code(String raw) {
        String code = raw == null ? "" : raw.replace(" ", "");
        if (!CODE.matcher(code).matches()) throw new InvalidRequestException();
        return code;
    }

    private static UUID enrollmentId(String raw) {
        if (raw == null || !CANONICAL_UUID.matcher(raw).matches()) throw new InvalidRequestException();
        return UUID.fromString(raw);
    }
}
