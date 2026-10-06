package bd.mediwish.auth;

import bd.mediwish.auth.AuthApi.User;
import bd.mediwish.auth.FirstAdminProvisioningService.Outcome;
import bd.mediwish.testsupport.TestApplication;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.DefaultApplicationArguments;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.NestedExceptionUtils;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import static bd.mediwish.testsupport.ApiAssertions.assertError;
import static bd.mediwish.testsupport.ApiAssertions.json;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The operator command (D1) against a real schema. Each test owns its schema, because the claimed bootstrap row is
 * permanent. The command runs in a non-web context, as the runbook starts it; only its process exit is captured.
 */
@Tag("integration")
@Tag("security")
@ExtendWith(OutputCaptureExtension.class)
class FirstAdminProvisioningIT {
    @Test
    void theCommandProvisionsTheSuperAdminOnceAndNeverReopens(CapturedOutput output) throws Exception {
        try (AuthApi api = AuthApi.start()) {
            assertThat(api.database().single("SELECT count(*) FROM users", Long.class)).as("no default account")
                    .isZero();
            User owner = api.registered();
            var before = api.signIn(owner);

            assertThat(provision(api, owner.username())).isZero();

            assertError(api.profile(before.accessToken()), 401, "AUTHENTICATION_REQUIRED");
            assertError(api.refresh(before.refreshToken()), 401, "AUTHENTICATION_REQUIRED");
            assertThat(api.revoked(owner, RevocationReason.STAFF_PROVISIONED)).isOne();
            assertThat(api.database().query("SELECT role FROM user_roles WHERE user_id = ?",
                    row -> row.getString(1), api.userId(owner))).containsExactly("ADMIN");
            assertThat(api.database().single("SELECT roles_version FROM users WHERE id = ?",
                    Long.class, api.userId(owner))).isZero();
            assertThat(api.database().single("SELECT count(*) FROM user_role_changes", Long.class)).isZero();
            var enrolled = api.enroll(owner);
            assertThat(json(api.staffMe(enrolled.session().accessToken())))
                    .isEqualTo(Map.of("username", owner.username(), "roles", List.of("ADMIN"),
                            "superAdmin", true));
            assertThat(api.database().single("SELECT super_admin_user_id FROM staff_bootstrap WHERE id = 1",
                    UUID.class)).isEqualTo(api.userId(owner));
            assertThat(api.database().single("SELECT count(*) FROM security_audit_events WHERE subject_user_id = ? "
                    + "AND event_type = 'FIRST_ADMIN_PROVISIONED'", Long.class, api.userId(owner))).isOne();

            User other = api.registered();
            assertThat(provision(api, other.username())).isOne();
            api.removeRole(owner, "ADMIN");
            assertError(api.staffMe(enrolled.session().accessToken()), 403, "ACCESS_DENIED");
            assertThat(provision(api, other.username())).as("even with no Admin left").isOne();
            assertThat(api.database().single("SELECT super_admin_user_id FROM staff_bootstrap WHERE id = 1",
                    UUID.class)).as("the Super Admin never transfers").isEqualTo(api.userId(owner));
            assertThat(api.database().single("SELECT count(*) FROM user_roles WHERE role = 'ADMIN'", Long.class))
                    .isZero();

            assertThat(output.getAll()).contains("First-Admin provisioning provisioned")
                    .contains("First-Admin provisioning refused: bootstrap-used");
            api.assertLogsOmitSecrets(output);
        }
    }

    @Test
    void refusalsLeaveTheBootstrapOpenAndConcurrentRunsProvisionOnlyOne(CapturedOutput output) throws Exception {
        try (AuthApi api = AuthApi.start()) {
            User first = api.registered();
            User second = api.registered();

            assertThat(provision(api, "unknown_user")).isOne();
            api.grantRole(first, "ADMIN");
            assertThat(provision(api, second.username())).isOne();
            assertThat(output.getAll()).contains("refused: user-not-found").contains("refused: admin-exists");
            assertThat(api.database().single("SELECT count(*) FROM staff_bootstrap", Long.class)).isZero();
            api.removeRole(first, "ADMIN");

            try (var context = provisioningContext(api)) {
                var service = context.getBean(FirstAdminProvisioningService.class);
                var outcomes = List.of(first, second).parallelStream()
                        .map(user -> service.provision(user.username())).toList();
                assertThat(outcomes).containsExactlyInAnyOrder(Outcome.PROVISIONED, Outcome.BOOTSTRAP_USED);
            }
            assertThat(api.database().single("SELECT count(*) FROM user_roles WHERE role = 'ADMIN'", Long.class))
                    .isOne();
            api.assertLogsOmitSecrets(output);
        }
    }

    @Test
    void theCommandRefusesToStartInsideTheServingApplication() throws Exception {
        try (AuthApi api = AuthApi.start()) {
            User owner = api.registered();
            var properties = new HashMap<>(api.database().applicationProperties());
            properties.put("app.provisioning.first-admin-username", owner.username());

            assertThatThrownBy(() -> TestApplication.launch(properties).close())
                    .satisfies(failure -> assertThat(NestedExceptionUtils.getMostSpecificCause(failure))
                            .hasMessage("first-Admin provisioning requires spring.main.web-application-type=none"));
            assertThat(api.database().single("SELECT count(*) FROM staff_bootstrap", Long.class)).isZero();
        }
    }

    /** Runs the command as the operator would and returns its exit code. */
    private static int provision(AuthApi api, String username) throws Exception {
        var context = provisioningContext(api);
        var exit = new AtomicInteger(-1);
        new FirstAdminProvisioning(context, context.getBean(FirstAdminProvisioningService.class), username, exit::set)
                .run(new DefaultApplicationArguments());
        assertThat(context.isActive()).as("the command closes its context").isFalse();
        return exit.get();
    }

    private static ConfigurableApplicationContext provisioningContext(AuthApi api) {
        var properties = new HashMap<>(api.database().applicationProperties());
        properties.put("spring.main.web-application-type", "none");
        return TestApplication.launch(properties);
    }
}
