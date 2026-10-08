package bd.mediwish.auth;

import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;

import static bd.mediwish.testsupport.ApiAssertions.assertError;
import static bd.mediwish.testsupport.ApiAssertions.json;
import static org.assertj.core.api.Assertions.assertThat;

/** Statement failures and application restarts preserve atomicity and safe retry semantics. */
@Tag("integration")
@Tag("regression")
@ExtendWith(OutputCaptureExtension.class)
class RoleChangeRecoveryIT {
    @Test void aRevocationFailureRollsBackTheRoleVersionAuditAndAllSessions(CapturedOutput output) throws Exception {
        rollbackAt("user_sessions", "UPDATE", "NEW.revoked_reason = 'role-changed'", output);
    }
    @Test void anAuditFailureRollsBackTheRoleVersionAuditAndAllSessions(CapturedOutput output) throws Exception {
        rollbackAt("user_role_changes", "INSERT", "TRUE", output);
    }
    private void rollbackAt(String table, String event, String condition, CapturedOutput output) throws Exception {
        try (var api = AuthApi.start()) {
            var admin = api.verifiedAdmin();
            var target = api.registered();
            var id = api.userId(target);
            var first = api.signIn(target);
            var second = api.signIn(target);
            try (var failure = failWrite(api, table, event, condition)) {
                assertError(api.putRole(admin.token(), id, "MODERATOR", 0), 500, "INTERNAL_ERROR");
            }
            assertThat(json(api.adminUser(admin.token(), id))).containsEntry("role", "CUSTOMER");
            assertThat(api.database().single("SELECT roles_version FROM users WHERE id = ?", Long.class, id)).isZero();
            assertThat(api.database().single("SELECT count(*) FROM user_role_changes WHERE target_user_id = ?", Long.class, id)).isZero();
            assertThat(api.revoked(target, RevocationReason.ROLE_CHANGED)).isZero();
            assertThat(api.profile(first.accessToken()).statusCode()).isEqualTo(200);
            assertThat(api.profile(second.accessToken()).statusCode()).isEqualTo(200);
            assertThat(api.putRole(admin.token(), id, "MODERATOR", 0).statusCode()).isEqualTo(200);
            assertThat(api.revoked(target, RevocationReason.ROLE_CHANGED)).isEqualTo(2);
            api.assertLogsOmitSecrets(output);
        }
    }
    /** An ordinary trigger fails the targeted SQL statement, rather than waiting until commit. */
    private AutoCloseable failWrite(AuthApi api, String table, String event, String condition) throws Exception {
        String marker = api.track("synthetic-role-write-failure-" + java.util.UUID.randomUUID());
        api.database().update("CREATE FUNCTION fail_role_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF "
                + condition + " THEN RAISE EXCEPTION '" + marker + "'; END IF; RETURN NEW; END $$");
        api.database().update("CREATE TRIGGER fail_role_write AFTER " + event + " ON " + table
                + " FOR EACH ROW EXECUTE FUNCTION fail_role_write()");
        return () -> {
            api.database().update("DROP TRIGGER fail_role_write ON " + table);
            api.database().update("DROP FUNCTION fail_role_write()");
        };
    }
    @Test void afterRestartTheLostResponseRetryIsANoopAndANewerSessionSurvives(CapturedOutput output) throws Exception {
        try (var api = AuthApi.start()) {
            var admin = api.verifiedAdmin();
            var target = api.registered();
            var id = api.userId(target);
            var before = api.signIn(target);
            assertThat(api.putRole(admin.token(), id, "DELIVERY_PERSON", 0).statusCode()).isEqualTo(200);
            var after = api.signIn(target);
            api.app().restart();
            var restricted = api.session(api.login(admin.user().username(), admin.user().password()), "VERIFICATION_REQUIRED");
            var verified = api.session(api.verifyMfa(restricted.accessToken(), AuthApi.totp(admin.enrolled().secret(), 1)), "VERIFIED");
            var retry = api.putRole(verified.accessToken(), id, "DELIVERY_PERSON", 0);
            assertThat(retry.statusCode()).isEqualTo(200);
            assertThat(((Number) json(retry).get("rolesVersion")).longValue()).isEqualTo(1);
            assertThat(api.database().single("SELECT count(*) FROM user_role_changes WHERE target_user_id = ?", Long.class, id)).isOne();
            assertThat(api.profile(after.accessToken()).statusCode()).isEqualTo(200);
            assertError(api.profile(before.accessToken()), 401, "AUTHENTICATION_REQUIRED");
            assertError(api.refresh(before.refreshToken()), 401, "AUTHENTICATION_REQUIRED");
            assertError(api.putRole(verified.accessToken(), id, "MODERATOR", 0), 409, "STALE_UPDATE");
            assertThat(api.profile(after.accessToken()).statusCode()).isEqualTo(200);
            api.assertLogsOmitSecrets(output);
        }
    }
}
