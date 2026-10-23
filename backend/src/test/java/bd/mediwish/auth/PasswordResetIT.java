package bd.mediwish.auth;

import bd.mediwish.mail.EmailKind;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;

import java.net.http.HttpResponse;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.regex.Pattern;

import static bd.mediwish.testsupport.ApiAssertions.*;
import static org.assertj.core.api.Assertions.*;

/** I1: a captured real email code resets only its account and persists across an application restart. */
@Tag("integration")
@Tag("security")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@ExtendWith(OutputCaptureExtension.class)
class PasswordResetIT {
    private final AuthApi api = AuthApi.start();

    @AfterAll void close() throws Exception { api.close(); }
    @BeforeEach void protectKey() { api.track(api.app().bean(AuthProperties.class).recovery().codeKey()); }
    @AfterEach void logsOmitSecrets(CapturedOutput output) { api.assertLogsOmitSecrets(output); }

    @Test
    void aVerifiedEmailResetChangesThePasswordRevokesAllEarlierSessionsAndConsumesItsCode() throws Exception {
        var user = api.registered();
        var first = api.signIn(user);
        var second = api.signIn(user);
        api.markEmailVerified(user);
        String key = api.track(api.app().bean(AuthProperties.class).recovery().codeKey());
        String password = api.track("reset-new-" + UUID.randomUUID().toString().substring(0, 12));

        assertEmpty(api.requestReset(user.email().toUpperCase(Locale.ROOT)), 202);
        String code = AuthApi.codeFrom(api.awaitMail(EmailKind.PASSWORD_RESET_CODE, user.email()));
        var stored = api.accountCodes(user);
        assertThat(stored).hasSize(1);
        assertThat(stored.getFirst().purpose()).isEqualTo(AccountCodePurpose.PASSWORD_RESET);
        assertThat(stored.getFirst().hash().matches("[0-9a-f]{64}")).isTrue();
        assertThat(stored.getFirst().hash().equals(code)).isFalse();
        assertThat(stored.getFirst().sentTo()).isEqualTo(user.email());
        var other = api.registered();
        api.markEmailVerified(other);
        assertEmpty(api.requestReset(other.email()), 202);
        String otherCode = AuthApi.codeFrom(api.awaitMail(EmailKind.PASSWORD_RESET_CODE, other.email()));
        var otherBefore = api.accountCodes(other);

        assertEmpty(api.confirmReset(user.email(), code, password), 204);
        assertThat(api.accountCodes(other)).isEqualTo(otherBefore);

        assertError(api.login(user.username(), user.password()), 401, "AUTHENTICATION_FAILED");
        api.session(api.login(user.username(), password));
        assertError(api.refresh(first.refreshToken()), 401, "AUTHENTICATION_REQUIRED");
        assertError(api.profile(second.accessToken()), 401, "AUTHENTICATION_REQUIRED");
        assertThat(api.revoked(user, RevocationReason.PASSWORD_RESET)).isEqualTo(2);
        assertError(api.confirmReset(user.email(), code, password), 400, "CODE_INVALID");
        assertThat(api.accountCodes(user)).isEmpty();
        var notice = api.awaitMail(EmailKind.PASSWORD_CHANGED, user.email());
        assertThat(notice.body().contains(code) || notice.body().contains(password)).isFalse();
        assertThat(api.database().query("SELECT event_type FROM security_audit_events WHERE subject_user_id = ? "
                        + "AND event_type IN ('PASSWORD_RESET_REQUESTED','PASSWORD_RESET_COMPLETED') ORDER BY occurred_at,id",
                row -> row.getString(1), api.userId(user)))
                .containsExactly("PASSWORD_RESET_REQUESTED", "PASSWORD_RESET_COMPLETED");

        // C's code is consumed. Another account's digits cannot affect or consume D's independent code row.
        assertError(api.confirmReset(user.email(), otherCode, password), 400, "CODE_INVALID");
        assertThat(api.accountCodes(other)).isEqualTo(otherBefore);
        assertEmpty(api.confirmReset(other.email(), otherCode, password), 204);

        api.drainMail();
        long audits = api.database().single("SELECT count(*) FROM security_audit_events", Long.class);
        String unknown = api.track("unknown." + UUID.randomUUID() + "@example.test");
        assertEmpty(api.requestReset(unknown), 202);
        api.drainMail();
        assertThat(api.database().single("SELECT count(*) FROM security_audit_events", Long.class)).isEqualTo(audits);
        assertThat(api.capturedMail().messages().stream().anyMatch(mail -> mail.to().equals(unknown))).isFalse();
        assertProtectedStorage(user, List.of(user.email(), user.password(), password, key, stored.getFirst().hash()), code);
    }

    @Test
    void theIssuedCodeSurvivesRestartWithoutResendingMail() throws Exception {
        var user = api.registered();
        api.markEmailVerified(user);
        String password = api.track("restart-new-" + UUID.randomUUID().toString().substring(0, 12));
        assertEmpty(api.requestReset(user.email()), 202);
        String code = AuthApi.codeFrom(api.awaitMail(EmailKind.PASSWORD_RESET_CODE, user.email()));
        var rows = api.accountCodes(user);

        api.app().restart();

        assertThat(api.accountCodes(user)).isEqualTo(rows);
        api.drainMail();
        assertThat(api.capturedMail().messages()).isEmpty();
        assertEmpty(api.confirmReset(user.email(), code, password), 204);
        api.session(api.login(user.username(), password));
        api.awaitMail(EmailKind.PASSWORD_CHANGED, user.email());
        api.drainMail();
        assertThat(api.capturedMail().messages()).extracting(mail -> mail.kind())
                .containsExactly(EmailKind.PASSWORD_CHANGED);
    }

    private void assertProtectedStorage(AuthApi.User user, List<String> secrets, String code) throws Exception {
        String rows = api.database().single("SELECT coalesce(string_agg(value,'|'),'') FROM ("
                + "SELECT s::text AS value FROM user_sessions s WHERE user_id = ? UNION ALL "
                + "SELECT a::text AS value FROM security_audit_events a WHERE subject_user_id = ?) protected",
                String.class, api.userId(user), api.userId(user));
        assertOmits("audit/session rows", rows, secrets);
        assertThat(Pattern.compile("(?<![0-9])" + Pattern.quote(code) + "(?![0-9])").matcher(rows).find()).isFalse();
    }

    private static void assertEmpty(HttpResponse<String> response, int status) {
        assertThat(response.statusCode()).isEqualTo(status);
        assertThat(response.body()).isEmpty();
        assertThat(response.headers().allValues("Set-Cookie")).isEmpty();
    }
}
