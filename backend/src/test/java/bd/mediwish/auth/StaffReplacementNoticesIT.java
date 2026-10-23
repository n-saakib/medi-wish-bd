package bd.mediwish.auth;

import bd.mediwish.mail.EmailKind;
import bd.mediwish.notification.CaptureSecurityNotifier;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import static org.assertj.core.api.Assertions.assertThat;

/** Ticket 05 mail and Ticket 09 replacement compose through real HTTP and PostgreSQL. */
@Tag("integration") @Tag("security") @Tag("regression")
@ExtendWith({OutputCaptureExtension.class, AuthApi.Shared.class})
class StaffReplacementNoticesIT {
    private final AuthApi api;
    StaffReplacementNoticesIT(AuthApi api) { this.api = api; }
    @AfterEach void logsOmitSecrets(CapturedOutput output) { api.assertLogsOmitSecrets(output); }

    @ParameterizedTest
    @CsvSource({
            "true,true,false,false,SENT",
            "false,true,false,false,SENT",
            "true,false,false,false,SENT",
            "true,true,true,false,SENT",
            "true,true,false,true,SENT",
            "true,true,true,true,FAILED",
            "false,false,false,false,NO_VERIFIED_CONTACT"
    })
    void committedReplacementNotifiesEveryVerifiedContactAndCommitsOneOutcomeAudit(
            boolean mobileVerified, boolean emailVerified, boolean mobileFails, boolean emailFails, String expected) throws Exception {
        var user = api.registered();
        api.grantRole(user, "MODERATOR");
        if (mobileVerified) api.verifyMobile(user);
        if (emailVerified) api.markEmailVerified(user);
        var enrolled = api.enroll(user);
        api.drainMail();
        api.capturedMail().clear();
        api.notifier().clear();
        if (mobileFails) api.notifier().failNext(CaptureSecurityNotifier.Failure.THROW);
        if (emailFails) api.capturedMail().failNext(1);
        try {
            var replaced = api.replace(user, enrolled);
            assertThat(replaced.contactNotice()).isEqualTo(expected);
            assertThat(replaced.backupCodes()).hasSize(10);
            assertThat(api.capturedMail().messages()).hasSize(emailVerified && !emailFails ? 1 : 0);
            assertThat(api.notifier().notices()).hasSize(mobileVerified && !mobileFails ? 1 : 0);
            if (emailVerified && !emailFails) {
                var notice = api.awaitMail(EmailKind.STAFF_AUTHENTICATOR_REPLACED, user.email());
                assertThat(notice.body()).contains("your staff authenticator was replaced")
                        .doesNotContain(user.email(), user.mobile(), user.username());
                if (mobileVerified && !mobileFails)
                    assertThat(notice.body()).isEqualTo(api.notifier().notices().getFirst().text());
            }
            assertThat(api.database().single("SELECT count(*) FROM security_audit_events WHERE subject_user_id=? "
                    + "AND event_type=?", Long.class, api.userId(user), "MFA_REPLACEMENT_NOTICE_" + expected)).isOne();
            assertThat(api.database().single("SELECT count(*) FROM security_audit_events WHERE subject_user_id=? "
                    + "AND event_type='MFA_FACTOR_REPLACED'", Long.class, api.userId(user))).isOne();
            assertThat(api.database().single("SELECT count(*) FROM staff_mfa_factors WHERE user_id=? AND status='ACTIVE'",
                    Long.class, api.userId(user))).isOne();
        } finally {
            api.notifier().clear();
            api.capturedMail().failNext(0);
            api.capturedMail().clear();
        }
    }
}
