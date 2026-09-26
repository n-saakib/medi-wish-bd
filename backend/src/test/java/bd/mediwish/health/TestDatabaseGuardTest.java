package bd.mediwish.health;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;

import static org.assertj.core.api.Assertions.*;

class TestDatabaseGuardTest {
    @Test
    void refusesDevelopmentDatabaseAndNonOwnedSchemas() {
        var validSchema = "mw_it_0123456789abcdef0123456789abcdef";
        assertThatCode(() -> TestDatabase.validateTarget("medi_wish_test", validSchema)).doesNotThrowAnyException();
        for (String database : new String[]{"medi_wish_dev", "postgres", "", "medi_wish_test?x=1"}) {
            assertThatThrownBy(() -> TestDatabase.validateTarget(database, validSchema))
                    .isInstanceOf(IllegalArgumentException.class);
        }
        for (String schema : new String[]{"public", "mw_it_other_run", validSchema + ";DROP TABLE x"}) {
            assertThatThrownBy(() -> TestDatabase.validateTarget("medi_wish_test", schema))
                    .isInstanceOf(IllegalArgumentException.class);
        }
        assertThatThrownBy(() -> TestDatabase.validateTarget(null, validSchema)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> TestDatabase.validateTarget("medi_wish_test", null)).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void refusesConnectionsOutsideTheConfiguredNonSuperuserTestRole() {
        assertThatCode(() -> TestDatabase.validateTestDatabaseConnection(
                "medi_wish_test", 180001, "medi_wish_test_runner", "medi_wish_test_runner", false, false, false))
                .doesNotThrowAnyException();

        assertThatThrownBy(() -> TestDatabase.validateTestDatabaseConnection(
                "medi_wish_dev", 180001, "medi_wish_test_runner", "medi_wish_test_runner", false, false, false))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("Integration tests require medi_wish_test");
        assertThatThrownBy(() -> TestDatabase.validateTestDatabaseConnection(
                "medi_wish_test", 170000, "medi_wish_test_runner", "medi_wish_test_runner", false, false, false))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("Integration tests require PostgreSQL 18");
        assertThatThrownBy(() -> TestDatabase.validateTestDatabaseConnection(
                "medi_wish_test", 180001, "postgres", "medi_wish_test_runner", false, false, false))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("Integration tests require the configured PostgreSQL test role");
        assertThatThrownBy(() -> TestDatabase.validateTestDatabaseConnection(
                "medi_wish_test", 180001, "medi_wish_test_runner", "medi_wish_test_runner", true, false, false))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("Integration test role must not have SUPERUSER, CREATEDB, or CREATEROLE");
        assertThatThrownBy(() -> TestDatabase.validateTestDatabaseConnection(
                "medi_wish_test", 180001, null, "medi_wish_test_runner", false, false, false))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("Integration tests require the configured PostgreSQL test role");
        assertThatThrownBy(() -> TestDatabase.validateTestDatabaseConnection(
                "medi_wish_test", 180001, " ", "medi_wish_test_runner", false, false, false))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("Integration tests require the configured PostgreSQL test role");
        assertThatThrownBy(() -> TestDatabase.validateTestDatabaseConnection(
                "medi_wish_test", 180001, "medi_wish_test_runner", null, false, false, false))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("Integration tests require the configured PostgreSQL test role");
    }

    @Test
    void refusesRolesWithCreatedbPrivilege() {
        assertThatThrownBy(() -> TestDatabase.validateTestDatabaseConnection(
                "medi_wish_test", 180001, "medi_wish_test_runner", "medi_wish_test_runner", false, true, false))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("Integration test role must not have SUPERUSER, CREATEDB, or CREATEROLE");
    }

    @Test
    void refusesRolesWithCreaterolePrivilege() {
        assertThatThrownBy(() -> TestDatabase.validateTestDatabaseConnection(
                "medi_wish_test", 180001, "medi_wish_test_runner", "medi_wish_test_runner", false, false, true))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("Integration test role must not have SUPERUSER, CREATEDB, or CREATEROLE");
    }

    @Test
    void readsLiteralDotEnvValuesWithoutEvaluatingOrExposingThem() throws IOException {
        var file = Files.createTempFile("medi-wish-test", ".env");
        try {
            Files.writeString(file, "# comment\nTEST_DB_NAME=medi_wish_test\nTEST_DB_PASSWORD=abc=123\nnot-a-setting\n");
            assertThat(TestDatabase.readDotEnv(file))
                    .containsEntry("TEST_DB_NAME", "medi_wish_test")
                    .containsEntry("TEST_DB_PASSWORD", "abc=123")
                    .doesNotContainKey("not-a-setting");
        } finally {
            Files.deleteIfExists(file);
        }
    }
}
