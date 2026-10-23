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

/** Verification uses the caller's saved email, has a distinct purpose and persists without bumping profile version. */
@Tag("integration")
@Tag("security")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@ExtendWith(OutputCaptureExtension.class)
class EmailVerificationIT {
    private final AuthApi api = AuthApi.start();
    @AfterAll void close() throws Exception { api.close(); }
    @BeforeEach void protectKey() { api.track(api.app().bean(AuthProperties.class).recovery().codeKey()); }
    @AfterEach void logsOmitSecrets(CapturedOutput output) throws Exception {
        api.drainMail();
        api.assertLogsOmitSecrets(output);
    }

    @Test
    void aCapturedCodeVerifiesTheSavedAddressWithoutChangingItsProfileVersion() throws Exception {
        var user = api.registered();
        String token = api.signIn(user).accessToken();
        assertThat(json(api.profileOf(token))).containsEntry("emailVerified", false).containsEntry("version", 0);

        assertThat(api.requestVerification(token).statusCode()).isEqualTo(204);
        String code = AuthApi.codeFrom(api.awaitMail(EmailKind.EMAIL_VERIFICATION_CODE, user.email()));
        assertThat(api.accountCodes(user)).hasSize(1);
        var confirmed = api.confirmVerification(token, code);
        assertThat(confirmed.statusCode()).isEqualTo(200);
        assertThat(json(confirmed)).containsEntry("email", user.email()).containsEntry("emailVerified", true)
                .containsEntry("version", 0);
        assertThat(json(api.profileOf(token))).containsEntry("emailVerified", true).containsEntry("version", 0);
        assertThat(api.database().single("SELECT email_verified_at IS NOT NULL FROM users WHERE id = ?",
                Boolean.class, api.userId(user))).isTrue();
        assertThat(api.accountCodes(user)).isEmpty();

        // Already verified is idempotent even while the shared issuance gap is active.
        assertThat(api.requestVerification(token).statusCode()).isEqualTo(204);
        api.drainMail();
        assertThat(api.capturedMail().messages().stream().filter(mail -> mail.to().equals(user.email())).count()).isOne();
    }

    @Test
    void aSignedInUserCannotVerifyWithAnotherUsersCode() throws Exception {
        var owner = api.registered();
        var other = api.registered();
        String ownerToken = api.signIn(owner).accessToken();
        String otherToken = api.signIn(other).accessToken();
        assertThat(api.requestVerification(ownerToken).statusCode()).isEqualTo(204);
        String ownerCode = AuthApi.codeFrom(api.awaitMail(EmailKind.EMAIL_VERIFICATION_CODE, owner.email()));

        assertError(api.confirmVerification(otherToken, ownerCode), 400, "CODE_INVALID");
        assertThat(json(api.profileOf(otherToken))).containsEntry("emailVerified", false);
        assertThat(api.accountCodes(owner)).hasSize(1);

        assertThat(api.confirmVerification(ownerToken, ownerCode).statusCode()).isEqualTo(200);
        assertThat(json(api.profileOf(ownerToken))).containsEntry("emailVerified", true);
        assertThat(json(api.profileOf(otherToken))).containsEntry("emailVerified", false);
    }

    @Test
    void codesFromOnePurposeCannotConsumeTheOtherPurposeRow() throws Exception {
        var user = api.registered();
        String token = api.signIn(user).accessToken();
        assertThat(api.requestVerification(token).statusCode()).isEqualTo(204);
        String verification = AuthApi.codeFrom(api.awaitMail(EmailKind.EMAIL_VERIFICATION_CODE, user.email()));
        // Accepted fixture: retain the live verification row while making this account reset-eligible.
        api.markEmailVerified(user);
        api.ageLimits(Duration.ofSeconds(61));
        assertThat(api.requestReset(user.email()).statusCode()).isEqualTo(202);
        String reset = AuthApi.codeFrom(api.awaitMail(EmailKind.PASSWORD_RESET_CODE, user.email()));
        var both = api.accountCodes(user);
        assertThat(both).extracting(AuthApi.AccountCodeRow::purpose)
                .containsExactlyInAnyOrder(AccountCodePurpose.EMAIL_VERIFICATION, AccountCodePurpose.PASSWORD_RESET);
        assertThat(both.get(0).id()).isNotEqualTo(both.get(1).id());
        assertThat(both.get(0).hash().equals(both.get(1).hash())).isFalse();
        String password = api.track("purpose-new-" + UUID.randomUUID().toString().substring(0, 12));
        if (!verification.equals(reset)) {
            assertError(api.confirmReset(user.email(), verification, password), 400, "CODE_INVALID");
        }
        api.database().update("UPDATE users SET email_verified_at = NULL WHERE id = ?", api.userId(user));
        if (!verification.equals(reset)) {
            assertError(api.confirmVerification(token, reset), 400, "CODE_INVALID");
        }
        assertThat(api.confirmVerification(token, verification).statusCode()).isEqualTo(200);
        assertThat(api.confirmReset(user.email(), reset, password).statusCode()).isEqualTo(204);
        assertThat(api.accountCodes(user)).isEmpty();
        api.session(api.login(user.username(), password));
    }

    @Test
    void aPasswordProtectedEmailChangeCancelsTheOldVerificationCode() throws Exception {
        var user = api.registered();
        String token = api.signIn(user).accessToken();
        assertThat(api.requestVerification(token).statusCode()).isEqualTo(204);
        String oldCode = AuthApi.codeFrom(api.awaitMail(EmailKind.EMAIL_VERIFICATION_CODE, user.email()));
        assertThat(api.accountCodes(user)).hasSize(1);
        String changed = api.track("changed." + UUID.randomUUID() + "@example.test");

        var saved = api.putProfileWithPassword(token, 0, null, changed, null, user.password());

        assertThat(saved.statusCode()).isEqualTo(200);
        assertThat(json(saved)).containsEntry("email", changed).containsEntry("emailVerified", false);
        assertThat(api.accountCodes(user)).isEmpty();
        assertError(api.confirmVerification(token, oldCode), 400, "CODE_INVALID");
        assertThat(json(api.profileOf(token))).containsEntry("email", changed).containsEntry("emailVerified", false);
    }

    @Test
    void aMissingEmailAndAClosingAccountCannotRequestOrConfirmVerification() throws Exception {
        var missing = api.register(api.newUserWithoutEmail());
        String missingToken = api.signIn(missing).accessToken();
        assertError(api.requestVerification(missingToken), 409, "EMAIL_REQUIRED");
        assertError(api.confirmVerification(missingToken, "123456"), 409, "EMAIL_REQUIRED");
        assertThat(api.accountCodes(missing)).isEmpty();

        var closing = api.registered();
        String closingToken = api.signIn(closing).accessToken();
        api.accountState(closing, "CLOSURE_REQUESTED");
        assertError(api.requestVerification(closingToken), 409, "ACCOUNT_CLOSING");
        assertError(api.confirmVerification(closingToken, "123456"), 409, "ACCOUNT_CLOSING");
        assertThat(api.accountCodes(closing)).isEmpty();
        api.drainMail();
        assertThat(api.capturedMail().messages().stream().anyMatch(mail -> mail.to().equals(closing.email()))).isFalse();
    }
}
