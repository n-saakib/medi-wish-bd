package bd.mediwish.auth;

import jakarta.persistence.EntityManagerFactory;
import org.hibernate.SessionFactory;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static bd.mediwish.testsupport.ApiAssertions.json;
import static org.assertj.core.api.Assertions.assertThat;

/** Search privacy, exact filters, byte ordering and a constant query budget through real HTTP/PostgreSQL. */
@Tag("integration")
@ExtendWith(OutputCaptureExtension.class)
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class AdminUserListIT {
    private final AuthApi api = AuthApi.start();
    private final AuthApi.VerifiedStaff admin;
    AdminUserListIT() throws Exception { admin = api.verifiedSuperAdmin(); }
    @AfterAll void close() throws Exception { api.close(); }

    @Test
    void literalPrefixExactRoleAndPagesUseByteOrderAndExcludePrivateFields(CapturedOutput output) throws Exception {
        String prefix = prefix();
        var names = List.of(prefix + ".ab", prefix + ".a_", prefix + ".a0", prefix + ".a.b");
        for (String name : names) named(name);
        var response = api.adminUsers(admin.token(), Map.of("username", "  " + prefix.toUpperCase() + ".a  ", "size", 2));
        assertThat(response.statusCode()).isEqualTo(200);
        Map<String, Object> body = json(response);
        assertThat(body).containsOnlyKeys("items", "page", "size", "totalItems")
                .containsEntry("page", 0).containsEntry("size", 2);
        assertThat(((Number) body.get("totalItems")).longValue()).isEqualTo(4);
        assertThat(items(body)).extracting(item -> item.get("username")).containsExactly(prefix + ".a.b", prefix + ".a0");
        for (var item : items(body)) assertThat(item).containsOnlyKeys("id", "username", "role", "staffMfa", "superAdmin", "createdAt");
        assertThat(items(json(api.adminUsers(admin.token(), Map.of("username", prefix, "size", 2, "page", 1)))))
                .extracting(item -> item.get("username")).containsExactly(prefix + ".a_", prefix + ".ab");
        assertThat(items(json(api.adminUsers(admin.token(), Map.of("username", prefix + ".a_")))))
                .extracting(item -> item.get("username")).containsExactly(prefix + ".a_");
        assertThat(items(json(api.adminUsers(admin.token(), Map.of("username", prefix + "%"))))).isEmpty();
        assertThat(items(json(api.adminUsers(admin.token(), Map.of("username", prefix + "\\"))))).isEmpty();
        api.assertLogsOmitSecrets(output);
    }

    @Test
    void mfaAndSuperAdminFlagsReflectTheExactRoleAndActiveFactor(CapturedOutput output) throws Exception {
        String prefix = prefix();
        var customer = named(prefix + "_c");
        var delivery = named(prefix + "_d");
        var moderator = named(prefix + "_m");
        var enrolled = named(prefix + "_a");
        api.grantRole(delivery, "DELIVERY_PERSON");
        api.grantRole(moderator, "MODERATOR");
        api.grantRole(enrolled, "ADMIN");
        api.enroll(enrolled);
        var records = items(json(api.adminUsers(admin.token(), Map.of("username", prefix))));
        assertThat(records).extracting(item -> item.get("staffMfa"))
                .containsExactly("ENROLLED", "NOT_REQUIRED", "NOT_REQUIRED", "SETUP_REQUIRED");
        assertThat(records).allSatisfy(item -> assertThat(item.get("superAdmin")).isEqualTo(false));
        assertThat(items(json(api.adminUsers(admin.token(), Map.of("username", prefix, "role", "CUSTOMER")))))
                .extracting(item -> item.get("username")).containsExactly(customer.username());
        assertThat(json(api.adminUser(admin.token(), api.userId(admin.user()))))
                .containsEntry("superAdmin", true).containsEntry("self", true).containsEntry("assignableRoles", List.of());
        api.assertLogsOmitSecrets(output);
    }

    @Test
    void queryCountDoesNotGrowWithThePage(CapturedOutput output) throws Exception {
        String prefix = prefix();
        for (int index = 0; index < 21; index++) named(prefix + "_" + String.format("%02d", index));
        var statistics = api.app().bean(EntityManagerFactory.class).unwrap(SessionFactory.class).getStatistics();
        statistics.setStatisticsEnabled(true);
        try {
            statistics.clear();
            assertThat(api.adminUsers(admin.token(), Map.of("username", prefix, "size", 1)).statusCode()).isEqualTo(200);
            long one = statistics.getPrepareStatementCount();
            statistics.clear();
            assertThat(items(json(api.adminUsers(admin.token(), Map.of("username", prefix, "size", 20))))).hasSize(20);
            long twenty = statistics.getPrepareStatementCount();
            assertThat(twenty).as("a page hydrates roles and MFA in batches, without per-User queries").isLessThanOrEqualTo(one + 1);
            assertThat(twenty).isLessThanOrEqualTo(12);
            var target = named(prefix + "_target");
            statistics.clear();
            assertThat(api.putRole(admin.token(), api.userId(target), "DELIVERY_PERSON", 0).statusCode()).isEqualTo(200);
            long command = statistics.getPrepareStatementCount();
            assertThat(command).isLessThanOrEqualTo(20);
            System.out.printf("T08 statements: search(size1)=%d, search(size20)=%d, role command=%d%n", one, twenty, command);
        } finally { statistics.setStatisticsEnabled(false); }
        api.assertLogsOmitSecrets(output);
    }

    private String prefix() { return "sort" + UUID.randomUUID().toString().substring(0, 8); }
    private AuthApi.User named(String name) throws Exception {
        var base = api.newUser();
        return api.register(new AuthApi.User(api.track(name), base.mobile(), base.email(), base.password()));
    }
    @SuppressWarnings("unchecked")
    static List<Map<String, Object>> items(Map<String, Object> page) { return (List<Map<String, Object>>) page.get("items"); }
}
