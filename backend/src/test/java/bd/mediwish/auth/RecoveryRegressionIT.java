package bd.mediwish.auth;

import bd.mediwish.mail.EmailKind;
import bd.mediwish.user.UserRepository;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.context.annotation.Bean;
import org.springframework.transaction.annotation.Transactional;

import java.net.http.HttpResponse;
import java.sql.SQLException;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;
import java.util.regex.Pattern;

import static bd.mediwish.testsupport.ApiAssertions.assertError;
import static bd.mediwish.testsupport.ApiAssertions.assertOmits;
import static bd.mediwish.testsupport.ApiAssertions.json;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** T6 regression/security coverage for account recovery against the run-owned PostgreSQL schema. */
@Tag("integration")
@Tag("regression")
@Tag("security")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@ExtendWith(OutputCaptureExtension.class)
class RecoveryRegressionIT {
    private final AuthApi api = AuthApi.start(RecoveryRegressionConfiguration.class);

    @AfterAll
    void close() throws Exception {
        api.close();
    }

    @BeforeEach
    void resetMailAndTrackKey() throws Exception {
        api.drainMail();
        api.capturedMail().clear();
        api.track(api.app().bean(AuthProperties.class).recovery().codeKey());
    }

    @AfterEach
    void logsOmitSecrets(CapturedOutput output) throws Exception {
        api.drainMail();
        api.assertLogsOmitSecrets(output);
    }

    @Test
    void registrationWithoutEmailStillSignsInAndReadsAnUnverifiedEmptyEmail() throws Exception {
        var user = api.register(api.newUserWithoutEmail());

        var session = api.signIn(user);
        var profile = api.profileOf(session.accessToken());

        assertThat(profile.statusCode()).isEqualTo(200);
        assertThat(json(profile)).containsEntry("email", null).containsEntry("emailVerified", false);
    }

    @Test
    void resettingAClosingAccountDoesNotRestoreProfilePermissions() throws Exception {
        var user = api.registered();
        api.markEmailVerified(user);
        api.accountState(user, "CLOSURE_REQUESTED");
        String replacement = api.track("closing-reset-" + UUID.randomUUID().toString().substring(0, 10));

        String code = requestResetCode(user);
        assertNoContent(api.confirmReset(user.email(), code, replacement), 204);

        assertThat(api.database().single("SELECT account_state FROM users WHERE id = ?", String.class,
                api.userId(user))).isEqualTo("CLOSURE_REQUESTED");
        var newSession = api.session(api.login(user.username(), replacement));
        assertError(api.putProfile(newSession.accessToken(), AuthApi.profileEdit(0, null, user.email(), null)),
                409, "ACCOUNT_CLOSING");
        assertThat(api.database().single("SELECT account_state FROM users WHERE id = ?", String.class,
                api.userId(user))).isEqualTo("CLOSURE_REQUESTED");
    }

    @Test
    void verificationResetAndEmailChangePreserveEveryUnrelatedTableAndResetIdentityState() throws Exception {
        var user = api.registered();
        api.verifyMobile(user);
        String token = api.signIn(user).accessToken();
        Map<String, String> unrelated = fingerprints();
        String hmacKey = api.track(api.app().bean(AuthProperties.class).recovery().codeKey());

        assertNoContent(api.requestVerification(token), 204);
        String verificationCode = AuthApi.codeFrom(api.awaitMail(EmailKind.EMAIL_VERIFICATION_CODE, user.email()));
        String verificationHash = api.accountCodes(user).getFirst().hash();
        assertThat(fingerprints()).isEqualTo(unrelated);
        var verified = api.confirmVerification(token, verificationCode);
        assertThat(verified.statusCode()).isEqualTo(200);
        assertThat(json(verified)).containsEntry("email", user.email()).containsEntry("emailVerified", true);
        assertThat(fingerprints()).isEqualTo(unrelated);
        assertProtectedRows(user, List.of(user.email(), user.password(), hmacKey, verificationHash),
                List.of(verificationCode));

        var beforeReset = recoveryState(user);
        api.ageLimits(Duration.ofSeconds(61));
        String resetCode = requestResetCode(user);
        String resetHash = api.accountCodes(user).getFirst().hash();
        assertThat(fingerprints()).isEqualTo(unrelated);
        String replacementPassword = api.track("profile-reset-" + UUID.randomUUID().toString().substring(0, 10));
        assertNoContent(api.confirmReset(user.email(), resetCode, replacementPassword), 204);
        assertThat(recoveryState(user)).isEqualTo(beforeReset);
        assertThat(fingerprints()).isEqualTo(unrelated);

        var replacementSession = api.session(api.login(user.username(), replacementPassword));
        String changedEmail = api.track("recovery-change." + UUID.randomUUID() + "@example.test");
        var change = api.putProfileWithPassword(replacementSession.accessToken(), beforeReset.profileVersion(),
                null, changedEmail, null, replacementPassword);
        assertThat(change.statusCode()).isEqualTo(200);
        assertThat(json(change)).containsEntry("email", changedEmail).containsEntry("emailVerified", false);
        assertThat(fingerprints()).isEqualTo(unrelated);
        assertProtectedRows(user, List.of(user.email(), changedEmail, user.password(), replacementPassword,
                hmacKey, verificationHash, resetHash), List.of(verificationCode, resetCode));
    }

    @Test
    void resetPreservesVerifiedAdminAndSuperAdminMfaRowsAndRestrictions() throws Exception {
        var owner = api.verifiedSuperAdmin();
        var admin = api.verifiedAdmin();
        api.markEmailVerified(owner.user());
        api.markEmailVerified(admin.user());

        var ownerRows = mfaRows(owner.user());
        var ownerState = recoveryState(owner.user());
        var ownerPassword = api.track("super-reset-" + UUID.randomUUID().toString().substring(0, 10));
        resetPassword(owner.user(), ownerPassword);
        assertThat(mfaRows(owner.user())).isEqualTo(ownerRows);
        assertThat(recoveryState(owner.user())).isEqualTo(ownerState);
        var ownerRestricted = api.session(api.login(owner.user().username(), ownerPassword), "VERIFICATION_REQUIRED");
        assertError(api.staffMe(ownerRestricted.accessToken()), 403, "MFA_REQUIRED");
        var ownerVerified = api.session(api.verifyMfa(ownerRestricted.accessToken(), AuthApi.totp(owner.enrolled().secret(), 1)),
                "VERIFIED");
        assertThat(json(api.staffMe(ownerVerified.accessToken()))).containsEntry("superAdmin", true);
        assertThat(api.database().single("SELECT super_admin_user_id FROM staff_bootstrap WHERE id = 1", UUID.class))
                .isEqualTo(api.userId(owner.user()));

        var adminRows = mfaRows(admin.user());
        var adminState = recoveryState(admin.user());
        var adminPassword = api.track("admin-reset-" + UUID.randomUUID().toString().substring(0, 10));
        resetPassword(admin.user(), adminPassword);
        assertThat(mfaRows(admin.user())).isEqualTo(adminRows);
        assertThat(recoveryState(admin.user())).isEqualTo(adminState);
        var adminRestricted = api.session(api.login(admin.user().username(), adminPassword), "VERIFICATION_REQUIRED");
        assertError(api.staffMe(adminRestricted.accessToken()), 403, "MFA_REQUIRED");
        var adminVerified = api.session(api.verifyMfa(adminRestricted.accessToken(), AuthApi.totp(admin.enrolled().secret(), 1)),
                "VERIFIED");
        assertThat(json(api.staffMe(adminVerified.accessToken()))).containsEntry("superAdmin", false);
    }

    @Test
    void resetKeepsAnAdminPendingEnrollmentRestrictedToEnrollment() throws Exception {
        var user = api.registered();
        api.grantRole(user, "ADMIN");
        api.markEmailVerified(user);
        var enrollmentRequired = api.session(api.login(user.username(), user.password()), "ENROLLMENT_REQUIRED");
        api.startEnrollment(enrollmentRequired.accessToken());
        var beforeRows = mfaRows(user);
        String replacementPassword = api.track("pending-reset-" + UUID.randomUUID().toString().substring(0, 10));

        resetPassword(user, replacementPassword);

        assertThat(mfaRows(user)).isEqualTo(beforeRows);
        var afterReset = api.session(api.login(user.username(), replacementPassword), "ENROLLMENT_REQUIRED");
        assertError(api.staffMe(afterReset.accessToken()), 403, "MFA_REQUIRED");
    }

    @Test
    void unknownWrongAndExpiredCodesHaveTheSameBoundedPublicError() throws Exception {
        var user = api.registered();
        api.markEmailVerified(user);
        String actualCode = requestResetCode(user);
        String wrongCode = actualCode.equals("000000") ? "000001" : "000000";
        String password = "same-error-" + UUID.randomUUID().toString().substring(0, 10);
        String unknownEmail = api.track("same-error." + UUID.randomUUID() + "@example.test");

        var unknown = api.confirmReset(unknownEmail, "123456", password);
        var wrong = api.confirmReset(user.email(), wrongCode, password);
        api.expireCode(user, AccountCodePurpose.PASSWORD_RESET);
        var expired = api.confirmReset(user.email(), actualCode, password);

        for (var response : List.of(unknown, wrong, expired)) assertError(response, 400, "CODE_INVALID");
        assertThat(List.of(unknown, wrong, expired).stream().map(RecoveryRegressionIT::publicError).toList())
                .containsOnly(publicError(unknown));
    }

    @Test
    void failedCodeDeliveryIsUniformAuditedAndNotRetriedBeforeANewRequest() throws Exception {
        var user = api.registered();
        api.markEmailVerified(user);
        api.capturedMail().failNext(1);

        assertNoContent(api.requestReset(user.email()), 202);
        api.drainMail();
        var failedDeliveryCode = api.accountCodes(user);
        assertThat(failedDeliveryCode).hasSize(1);
        assertThat(api.capturedMail().messages()).isEmpty();
        assertThat(audits(user, "EMAIL_DELIVERY_FAILED")).isOne();

        api.ageLimits(Duration.ofSeconds(61));
        assertNoContent(api.requestReset(user.email()), 202);
        api.awaitMail(EmailKind.PASSWORD_RESET_CODE, user.email());
        api.drainMail();

        assertThat(api.accountCodes(user)).hasSize(1).doesNotContain(failedDeliveryCode.getFirst());
        assertThat(api.capturedMail().messages()).extracting(message -> message.kind())
                .containsExactly(EmailKind.PASSWORD_RESET_CODE);
        assertThat(audits(user, "EMAIL_DELIVERY_FAILED")).isOne();
        assertThat(audits(user, "PASSWORD_RESET_REQUESTED")).isEqualTo(2);
    }

    @Test
    void aFailedPasswordChangedNoticeDoesNotUndoTheCommittedReset() throws Exception {
        var user = api.registered();
        api.markEmailVerified(user);
        String resetCode = requestResetCode(user);
        String replacement = api.track("notice-reset-" + UUID.randomUUID().toString().substring(0, 10));
        api.capturedMail().failNext(1);

        assertNoContent(api.confirmReset(user.email(), resetCode, replacement), 204);
        api.drainMail();

        assertThat(api.accountCodes(user)).isEmpty();
        assertThat(audits(user, "PASSWORD_RESET_COMPLETED")).isOne();
        assertThat(audits(user, "EMAIL_DELIVERY_FAILED")).isOne();
        assertThat(api.capturedMail().messages()).extracting(message -> message.kind())
                .containsExactly(EmailKind.PASSWORD_RESET_CODE);
        api.session(api.login(user.username(), replacement));
        assertError(api.login(user.username(), user.password()), 401, "AUTHENTICATION_FAILED");
    }

    @Test
    void mailRegisteredInsideARolledBackTransactionIsNeverSent() throws Exception {
        var user = api.registered();
        String syntheticCode = api.track("rollback-code-" + UUID.randomUUID());

        assertThatThrownBy(() -> api.app().bean(RollbackMailProbe.class)
                .registerMailThenRollback(user.username(), syntheticCode))
                .isInstanceOf(RollbackAfterMailRegistration.class);
        api.drainMail();

        assertThat(api.capturedMail().messages()).isEmpty();
        assertThat(audits(user, "EMAIL_DELIVERY_FAILED")).isZero();
    }

    @Test
    void retryingAResetWhoseResponseWasLostReturnsInvalidWhileTheNewPasswordWorks() throws Exception {
        var user = api.registered();
        api.markEmailVerified(user);
        String code = requestResetCode(user);
        String replacement = api.track("lost-response-" + UUID.randomUUID().toString().substring(0, 10));

        // The server commits, but the caller discards this response and retries the same command.
        assertNoContent(api.confirmReset(user.email(), code, replacement), 204);
        assertError(api.confirmReset(user.email(), code, replacement), 400, "CODE_INVALID");

        api.session(api.login(user.username(), replacement));
        assertError(api.login(user.username(), user.password()), 401, "AUTHENTICATION_FAILED");
    }

    @Test
    void auditAndSessionRowsNeverContainRecoveryCredentialsOrTheHmacKey() throws Exception {
        var user = api.registered();
        api.markEmailVerified(user);
        String key = api.track(api.app().bean(AuthProperties.class).recovery().codeKey());
        String code = requestResetCode(user);
        String replacement = api.track("privacy-reset-" + UUID.randomUUID().toString().substring(0, 10));
        String hash = api.accountCodes(user).getFirst().hash();

        assertNoContent(api.confirmReset(user.email(), code, replacement), 204);
        api.drainMail();

        assertProtectedRows(user, List.of(user.email(), user.password(), replacement, key, hash), List.of(code));
    }

    private String requestResetCode(AuthApi.User user) throws Exception {
        assertNoContent(api.requestReset(user.email()), 202);
        return AuthApi.codeFrom(api.awaitMail(EmailKind.PASSWORD_RESET_CODE, user.email()));
    }

    private void resetPassword(AuthApi.User user, String replacement) throws Exception {
        String code = requestResetCode(user);
        assertNoContent(api.confirmReset(user.email(), code, replacement), 204);
    }

    private UserRecoveryState recoveryState(AuthApi.User user) throws SQLException {
        return api.database().query("SELECT u.roles_version, u.profile_version, u.mobile, u.mobile_verified, "
                        + "u.email_verified_at, r.role FROM users u JOIN user_roles r ON r.user_id = u.id "
                        + "WHERE u.id = ?", row -> new UserRecoveryState(row.getLong(1), row.getLong(2),
                        row.getString(3), row.getBoolean(4), instant(row.getTimestamp(5)), row.getString(6)),
                api.userId(user)).getFirst();
    }

    private MfaRows mfaRows(AuthApi.User user) throws SQLException {
        UUID id = api.userId(user);
        String factors = api.database().single("SELECT count(*)::text || ':' || coalesce(md5(string_agg("
                        + "f::text, '|' ORDER BY f::text)), '') FROM staff_mfa_factors f WHERE f.user_id = ?",
                String.class, id);
        String backupCodes = api.database().single("SELECT count(*)::text || ':' || coalesce(md5(string_agg("
                        + "b::text, '|' ORDER BY b::text)), '') FROM staff_mfa_backup_codes b "
                        + "JOIN staff_mfa_factors f ON f.id = b.factor_id WHERE f.user_id = ?",
                String.class, id);
        return new MfaRows(factors, backupCodes);
    }

    private long audits(AuthApi.User user, String kind) throws SQLException {
        return api.database().single("SELECT count(*) FROM security_audit_events "
                + "WHERE subject_user_id = ? AND event_type = ?", Long.class, api.userId(user), kind);
    }

    private void assertProtectedRows(AuthApi.User user, List<String> secrets, List<String> codes) throws SQLException {
        String rows = api.database().single("SELECT coalesce(string_agg(value, '|'), '') FROM ("
                        + "SELECT s::text AS value FROM user_sessions s WHERE s.user_id = ? UNION ALL "
                        + "SELECT a::text FROM security_audit_events a WHERE a.subject_user_id = ?) protected",
                String.class, api.userId(user), api.userId(user));
        assertOmits("audit/session rows", rows, secrets);
        for (String code : codes) {
            assertThat(Pattern.compile("(?<![0-9])" + Pattern.quote(code) + "(?![0-9])")
                    .matcher(rows).find()).isFalse();
        }
    }

    /** Same deterministic row-count plus full-row digest used by the Ticket 11 profile regression check. */
    private Map<String, String> fingerprints() throws SQLException {
        var tables = api.database().query("SELECT table_name FROM information_schema.tables "
                        + "WHERE table_schema = ? AND table_type = 'BASE TABLE' "
                        + "AND table_name NOT IN ('users', 'account_codes', 'account_code_limits', 'user_sessions', "
                        + "'user_session_refresh_tokens', 'security_audit_events') "
                        + "AND table_name NOT LIKE 'databasechangelog%' ORDER BY table_name",
                row -> row.getString(1), api.database().schema());
        Map<String, String> values = new TreeMap<>();
        for (String table : tables) {
            String quoted = "\"" + table.replace("\"", "\"\"") + "\"";
            String fingerprint = api.database().single("SELECT count(*)::text || ':' || coalesce(md5("
                    + "string_agg(t::text, '|' ORDER BY t::text)), '') FROM " + quoted + " t", String.class);
            values.put(table, fingerprint);
        }
        return values;
    }

    private static Instant instant(java.sql.Timestamp timestamp) {
        return timestamp == null ? null : timestamp.toInstant();
    }

    private static Map<String, Object> publicError(HttpResponse<String> response) {
        Map<String, Object> error = json(response);
        return Map.of("code", error.get("code"), "message", error.get("message"));
    }

    private static void assertNoContent(HttpResponse<String> response, int status) {
        assertThat(response.statusCode()).isEqualTo(status);
        assertThat(response.body()).isEmpty();
        assertThat(response.headers().allValues("Set-Cookie")).isEmpty();
    }

    private record UserRecoveryState(long rolesVersion, long profileVersion, String mobile, boolean mobileVerified,
                                     Instant emailVerifiedAt, String role) {}
    private record MfaRows(String factorDigest, String backupCodeDigest) {}

    @TestConfiguration(proxyBeanMethods = false)
    static class RecoveryRegressionConfiguration {
        @Bean
        RollbackMailProbe rollbackMailProbe(UserRepository users, AccountMail mail) {
            return new RollbackMailProbe(users, mail);
        }
    }

    static class RollbackMailProbe {
        private final UserRepository users;
        private final AccountMail mail;

        RollbackMailProbe(UserRepository users, AccountMail mail) {
            this.users = users;
            this.mail = mail;
        }

        @Transactional
        public void registerMailThenRollback(String username, String code) {
            var user = users.findByUsername(username).orElseThrow();
            mail.resetCode(user, code);
            throw new RollbackAfterMailRegistration();
        }
    }

    static final class RollbackAfterMailRegistration extends RuntimeException {}
}
