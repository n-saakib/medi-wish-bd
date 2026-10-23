package bd.mediwish.auth;

import bd.mediwish.mail.EmailKind;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;

import java.time.Duration;
import java.util.UUID;

import static bd.mediwish.testsupport.ApiAssertions.*;
import static org.assertj.core.api.Assertions.*;

/** Password-confirmed email changes cancel both purposes, notify verified old addresses and preserve only the caller. */
@Tag("integration")
@Tag("security")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@ExtendWith(OutputCaptureExtension.class)
class EmailChangeIT {
    private final AuthApi api = AuthApi.start();
    @AfterAll void close() throws Exception { api.close(); }
    @BeforeEach void protectKey() { api.track(api.app().bean(AuthProperties.class).recovery().codeKey()); }
    @AfterEach void logsOmitSecrets(CapturedOutput output) throws Exception {
        api.drainMail();
        api.assertLogsOmitSecrets(output);
    }

    @Test
    void aRefusedChangePreservesCodesAndSessionsButASuccessCancelsBothAndKeepsTheSavingSession() throws Exception {
        var user = api.registered();
        var first = api.signIn(user);
        var second = api.signIn(user);
        assertThat(api.requestVerification(first.accessToken()).statusCode()).isEqualTo(204);
        String verification = AuthApi.codeFrom(api.awaitMail(EmailKind.EMAIL_VERIFICATION_CODE, user.email()));
        api.markEmailVerified(user);
        api.ageLimits(Duration.ofSeconds(61));
        assertThat(api.requestReset(user.email()).statusCode()).isEqualTo(202);
        String reset = AuthApi.codeFrom(api.awaitMail(EmailKind.PASSWORD_RESET_CODE, user.email()));
        var before = api.accountCodes(user);
        assertThat(before).hasSize(2);
        String email = api.track("replacement." + UUID.randomUUID() + "@example.test");
        String wrongPassword = api.track("incorrect-" + UUID.randomUUID().toString().substring(0, 12));
        assertError(api.putProfileWithPassword(first.accessToken(), 0, "Must Not Save", email, null, wrongPassword),
                400, "CURRENT_PASSWORD_INVALID");
        assertThat(api.accountCodes(user)).isEqualTo(before);
        assertThat(json(api.profileOf(first.accessToken()))).containsEntry("email", user.email())
                .containsEntry("emailVerified", true).containsEntry("fullName", null).containsEntry("version", 0);
        assertThat(api.profile(second.accessToken()).statusCode()).isEqualTo(200);
        assertThat(api.revoked(user, RevocationReason.EMAIL_CHANGED)).isZero();

        var changed = api.putProfileWithPassword(first.accessToken(), 0, null, email, null, user.password());

        assertThat(changed.statusCode()).isEqualTo(200);
        assertThat(json(changed)).containsEntry("email", email).containsEntry("emailVerified", false).containsEntry("version", 1);
        assertThat(api.accountCodes(user)).isEmpty();
        assertError(api.confirmVerification(first.accessToken(), verification), 400, "CODE_INVALID");
        assertError(api.confirmReset(user.email(), reset, "replacement-password"), 400, "CODE_INVALID");
        assertError(api.profile(second.accessToken()), 401, "AUTHENTICATION_REQUIRED");
        assertError(api.refresh(second.refreshToken()), 401, "AUTHENTICATION_REQUIRED");
        assertThat(api.revoked(user, RevocationReason.EMAIL_CHANGED)).isOne();
        assertThat(json(api.profileOf(first.accessToken()))).containsEntry("email", email).containsEntry("emailVerified", false);
        api.session(api.refresh(first.refreshToken()));
        var notice = api.awaitMail(EmailKind.EMAIL_CHANGED, user.email());
        assertThat(notice.body().contains(verification) || notice.body().contains(reset)
                || notice.body().contains(user.password())).isFalse();
        api.drainMail();
        assertThat(api.capturedMail().messages().stream().filter(mail -> mail.kind() == EmailKind.EMAIL_CHANGED
                        && (mail.to().equals(user.email()) || mail.to().equals(email))).map(mail -> mail.to()).toList())
                .containsExactly(user.email());
    }

    @Test
    void onlyAVerifiedOldAddressReceivesANoticeIncludingWhenItIsCleared() throws Exception {
        var user = api.registered();
        String token = api.signIn(user).accessToken();
        String email = api.track("verified-old." + UUID.randomUUID() + "@example.test");
        assertThat(api.putProfileWithPassword(token, 0, null, email, null, user.password()).statusCode()).isEqualTo(200);
        api.drainMail();
        assertThat(api.capturedMail().messages().stream().anyMatch(mail -> mail.to().equals(user.email()))).isFalse();
        api.markEmailVerified(user);

        var cleared = api.putProfileWithPassword(token, 1, null, null, null, user.password());

        assertThat(cleared.statusCode()).isEqualTo(200);
        assertThat(json(cleared)).containsEntry("email", null).containsEntry("emailVerified", false).containsEntry("version", 2);
        api.awaitMail(EmailKind.EMAIL_CHANGED, email);
        assertThat(json(api.profileOf(token))).containsEntry("email", null).containsEntry("emailVerified", false);
    }

    @Test
    void aCorrectPasswordOnADuplicateSaveKeepsPriorFailuresUntilAnEmailChangeCommits() throws Exception {
        var user = api.registered();
        var other = api.registered();
        var first = api.signIn(user);
        var second = api.signIn(user);
        assertThat(api.requestVerification(first.accessToken()).statusCode()).isEqualTo(204);
        api.awaitMail(EmailKind.EMAIL_VERIFICATION_CODE, user.email());
        api.markEmailVerified(user);
        var codes = api.accountCodes(user);
        String available = api.track("available." + UUID.randomUUID() + "@example.test");
        String wrong = api.track("incorrect-" + UUID.randomUUID().toString().substring(0, 12));
        for (int attempt = 0; attempt < 2; attempt++) {
            assertError(api.putProfileWithPassword(first.accessToken(), 0, null, available, null, wrong),
                    400, "CURRENT_PASSWORD_INVALID");
        }
        String key = "password:" + api.userId(user);
        assertThat(api.limitRows().stream().filter(row -> row.key().equals(key)).map(AuthApi.LimitRow::attempts).toList())
                .containsExactly(2);
        api.drainMail();
        long mailCount = api.capturedMail().messages().stream().filter(mail -> mail.to().equals(user.email())).count();

        assertError(api.putProfileWithPassword(first.accessToken(), 0, null, other.email(), null, user.password()),
                409, "DUPLICATE_USER");

        assertThat(api.limitRows().stream().filter(row -> row.key().equals(key)).map(AuthApi.LimitRow::attempts).toList())
                .containsExactly(2);
        assertThat(api.accountCodes(user)).isEqualTo(codes);
        assertThat(json(api.profileOf(first.accessToken()))).containsEntry("email", user.email())
                .containsEntry("emailVerified", true).containsEntry("version", 0);
        assertThat(api.profile(second.accessToken()).statusCode()).isEqualTo(200);
        assertThat(api.revoked(user, RevocationReason.EMAIL_CHANGED)).isZero();
        assertThat(api.database().single("SELECT count(*) FROM security_audit_events WHERE subject_user_id = ? "
                + "AND event_type = 'EMAIL_CHANGED'", Long.class, api.userId(user))).isZero();
        api.drainMail();
        assertThat(api.capturedMail().messages().stream().filter(mail -> mail.to().equals(user.email())).count())
                .isEqualTo(mailCount);

        assertThat(api.putProfileWithPassword(first.accessToken(), 0, null, available, null, user.password()).statusCode())
                .isEqualTo(200);
        assertThat(api.limitRows().stream().anyMatch(row -> row.key().equals(key))).isFalse();
        assertThat(api.accountCodes(user)).isEmpty();
        assertThat(api.profile(first.accessToken()).statusCode()).isEqualTo(200);
        assertError(api.profile(second.accessToken()), 401, "AUTHENTICATION_REQUIRED");
        api.awaitMail(EmailKind.EMAIL_CHANGED, user.email());
    }

    @Test
    void fiveDurableWrongPasswordsBlockEvenTheRightPasswordUntilTheHourEnds() throws Exception {
        var user = api.registered();
        String token = api.signIn(user).accessToken();
        String email = api.track("limited." + UUID.randomUUID() + "@example.test");
        String wrong = api.track("incorrect-" + UUID.randomUUID().toString().substring(0, 12));
        for (int attempt = 0; attempt < 5; attempt++) {
            assertError(api.putProfileWithPassword(token, 0, null, email, null, wrong), 400, "CURRENT_PASSWORD_INVALID");
        }
        String key = "password:" + api.userId(user);
        assertThat(api.limitRows().stream().filter(row -> row.key().equals(key)).map(AuthApi.LimitRow::attempts).toList())
                .containsExactly(5);
        assertError(api.putProfileWithPassword(token, 0, null, email, null, user.password()), 429, "TOO_MANY_ATTEMPTS");
        assertThat(json(api.profileOf(token))).containsEntry("email", user.email()).containsEntry("version", 0);

        api.ageLimits(Duration.ofHours(1).plusSeconds(1));

        assertThat(api.putProfileWithPassword(token, 0, null, email, null, user.password()).statusCode()).isEqualTo(200);
        assertThat(api.limitRows().stream().anyMatch(row -> row.key().equals(key))).isFalse();
    }
}
