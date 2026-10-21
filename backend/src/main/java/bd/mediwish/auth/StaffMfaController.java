package bd.mediwish.auth;

import bd.mediwish.user.UserProfile;
import bd.mediwish.notification.NoticeOutcome;
import com.fasterxml.jackson.annotation.JsonInclude;
import tools.jackson.databind.JsonNode;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Staff authenticator routes for a restricted session's Bearer token. Input shape is checked here, so a malformed
 * code is an invalid request and never counts as a failed attempt. A verification replaces the session and its
 * refresh cookie; verified enrollment and regeneration return fresh backup codes, once.
 */
@RestController
@RequestMapping("/api/auth/mfa")
class StaffMfaController {
    private static final Pattern CODE = Pattern.compile("[0-9]{6}");
    private static final Pattern CANONICAL_UUID =
            Pattern.compile("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}");

    private final StaffMfaService mfa;
    private final StaffMfaRecoveryService recovery;
    private final RefreshCookieAdapter refreshCookies;

    StaffMfaController(StaffMfaService mfa, StaffMfaRecoveryService recovery, RefreshCookieAdapter refreshCookies) {
        this.mfa = mfa;
        this.recovery = recovery;
        this.refreshCookies = refreshCookies;
    }

    record EnrollmentVerification(String enrollmentId, String code) {}

    record Verification(String code) {}

    record EnrolledSessionResponse(String accessToken, String tokenType, long expiresIn, UserProfile user,
                                   MfaStatus mfa, List<String> backupCodes,
                                   @JsonInclude(JsonInclude.Include.NON_NULL) NoticeOutcome contactNotice) {
        @Override
        public String toString() { return "EnrolledSessionResponse[redacted]"; }
    }

    record BackupCodesResponse(List<String> backupCodes) {
        @Override
        public String toString() { return "BackupCodesResponse[redacted]"; }
    }

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
        String parsedCode = code(request.code());
        AuthenticationService.AuthenticatedSession session;
        List<String> backupCodes;
        NoticeOutcome contactNotice;
        if (current.mfa() == MfaStatus.REPLACEMENT_REQUIRED) {
            var replaced = recovery.verifyReplacement(current.userId(), current.sessionId(), enrollmentId, parsedCode);
            session = replaced.session();
            backupCodes = replaced.backupCodes();
            contactNotice = replaced.contactNotice();
        } else {
            var enrolled = mfa.verifyEnrollment(current.userId(), current.sessionId(), enrollmentId, parsedCode);
            session = enrolled.session();
            backupCodes = enrolled.backupCodes();
            contactNotice = null;
        }
        refreshCookies.set(response, session.refreshToken(), session.refreshExpiresAt());
        return new EnrolledSessionResponse(session.accessToken(), "Bearer", session.expiresIn(), session.user(),
                session.mfa(), backupCodes, contactNotice);
    }

    @PostMapping("/verify")
    AuthController.SessionResponse verify(@AuthenticationPrincipal CurrentUserAuthentication.CurrentUser current,
                                          @RequestBody Verification request, HttpServletResponse response) {
        var session = mfa.verify(current.userId(), current.sessionId(), code(request.code()));
        refreshCookies.set(response, session.refreshToken(), session.refreshExpiresAt());
        return AuthController.SessionResponse.from(session);
    }

    @PostMapping(path = "/recovery", consumes = MediaType.APPLICATION_JSON_VALUE)
    AuthController.SessionResponse useBackupCode(@AuthenticationPrincipal CurrentUserAuthentication.CurrentUser current,
                                                @RequestBody JsonNode body, HttpServletResponse response) {
        object(body, Set.of("backupCode"));
        String parsedCode = BackupCodes.parse(text(body.get("backupCode")));
        var session = recovery.useBackupCode(current.userId(), current.sessionId(), parsedCode);
        refreshCookies.set(response, session.refreshToken(), session.refreshExpiresAt());
        return AuthController.SessionResponse.from(session);
    }

    @PostMapping(path = "/backup-codes", consumes = MediaType.APPLICATION_JSON_VALUE)
    BackupCodesResponse regenerate(@AuthenticationPrincipal CurrentUserAuthentication.CurrentUser current,
                                   @RequestBody JsonNode body) {
        object(body, Set.of("code"));
        String parsedCode = code(text(body.get("code")));
        return new BackupCodesResponse(recovery.regenerateBackupCodes(current.userId(), current.sessionId(), parsedCode));
    }

    private static void object(JsonNode body, Set<String> allowed) {
        if (body == null || !body.isObject() || !allowed.equals(Set.copyOf(body.propertyNames()))) {
            throw new InvalidRequestException();
        }
    }

    private static String text(JsonNode node) {
        if (node == null || !node.isString()) throw new InvalidRequestException();
        return node.asString();
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
