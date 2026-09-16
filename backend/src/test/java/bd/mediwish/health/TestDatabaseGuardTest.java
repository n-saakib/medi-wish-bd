package bd.mediwish.health;

import org.junit.jupiter.api.Test;
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
}
