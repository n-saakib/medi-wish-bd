package bd.mediwish.auth;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;

import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;

import static bd.mediwish.testsupport.ApiAssertions.json;
import static org.assertj.core.api.Assertions.assertThat;

/** R1: profile and verified-mobile writes leave every other schema table and the username untouched. */
@Tag("integration")
@Tag("regression")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class UserProfileRegressionIT {
    private final AuthApi api = AuthApi.start();

    @AfterAll
    void close() throws Exception {
        api.close();
    }

    @Test
    void profileSaveStageCancelAndActivationPreserveUnrelatedRowsAndTheUsername() throws Exception {
        var user = api.registered();
        String token = api.signIn(user).accessToken();
        Map<String, String> before = fingerprints();
        assertThat(before).containsKey("user_roles");
        assertThat(before.get("user_roles")).startsWith("1:");
        String email = "profile.regression." + UUID.randomUUID() + "@example.test";

        var saved = api.putProfile(token, AuthApi.profileEdit(0, "Regression Profile", email, "1990-05-01"));
        assertThat(saved.statusCode()).isEqualTo(200);
        assertThat(json(saved)).containsEntry("fullName", "Regression Profile").containsEntry("email", email)
                .containsEntry("dateOfBirth", "1990-05-01").containsEntry("version", 1);
        assertUnrelatedRowsAndUsername(before, user, token);

        String cancelledMobile = api.newUser().mobile();
        assertThat(api.stageMobile(token, cancelledMobile).statusCode()).isEqualTo(202);
        assertThat(json(api.profileOf(token))).containsEntry("pendingMobile", cancelledMobile)
                .containsEntry("mobile", user.mobile()).containsEntry("version", 1);
        assertUnrelatedRowsAndUsername(before, user, token);

        assertThat(api.cancelMobile(token).statusCode()).isEqualTo(204);
        assertThat(json(api.profileOf(token))).containsEntry("pendingMobile", null)
                .containsEntry("mobile", user.mobile()).containsEntry("version", 1);
        assertUnrelatedRowsAndUsername(before, user, token);

        String activatedMobile = api.newUser().mobile();
        assertThat(api.stageMobile(token, activatedMobile).statusCode()).isEqualTo(202);
        assertUnrelatedRowsAndUsername(before, user, token);
        api.activatePendingMobile(user);
        assertThat(json(api.profileOf(token))).containsEntry("pendingMobile", null)
                .containsEntry("mobile", activatedMobile).containsEntry("mobileVerified", true).containsEntry("version", 1);
        assertUnrelatedRowsAndUsername(before, user, token);
    }

    private void assertUnrelatedRowsAndUsername(Map<String, String> before, AuthApi.User user, String token) throws Exception {
        var response = api.profileOf(token);
        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(json(response)).containsEntry("username", user.username());
        assertThat(fingerprints()).isEqualTo(before);
    }

    private Map<String, String> fingerprints() throws Exception {
        var tables = api.database().query("""
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = ? AND table_type = 'BASE TABLE'
                  AND table_name NOT IN ('users', 'user_mobile_changes', 'user_sessions', 'user_session_refresh_tokens')
                  AND table_name NOT LIKE 'databasechangelog%'
                ORDER BY table_name
                """, row -> row.getString(1), api.database().schema());
        Map<String, String> fingerprints = new TreeMap<>();
        for (String table : tables) {
            // Metadata names are quoted as identifiers; data is never copied into test diagnostics.
            String quotedTable = "\"" + table.replace("\"", "\"\"") + "\"";
            String value = api.database().single("SELECT count(*)::text || ':' || "
                    + "coalesce(md5(string_agg(t::text, '|' ORDER BY t::text)), '') FROM " + quotedTable + " t", String.class);
            fingerprints.put(table, value);
        }
        return fingerprints;
    }
}
