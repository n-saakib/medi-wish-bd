package bd.mediwish.catalog;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;
import static org.assertj.core.api.Assertions.*;

class MoneyTest {
    @ParameterizedTest
    @ValueSource(strings = {"0.01", "1", "1.5", "1.50", "9999999.99", "000001.50"})
    void acceptsExactPositiveBdtWithinTheStorageBoundary(String value) {
        assertThat(Money.parse(value).value().scale()).isEqualTo(2);
    }
    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {" ", "0", "0.00", "-1", "+1", "1.005", "1e3", "1,000", " 1.00", "1.00 ", "12345678", "10000000.00", "NaN", "Infinity", ".50", "1.", "১.০০"})
    void refusesInvalidOrRoundedMoney(String value) {
        assertThatThrownBy(() -> Money.parse(value)).isInstanceOf(InvalidMoneyException.class);
    }
    @Test
    void displaysTwoDecimalsAndComparesNumericValue() {
        assertThat(Money.parse("1.5").toString()).isEqualTo("1.50");
        assertThat(Money.parse("1.5").compareTo(Money.parse("1.50"))).isZero();
        assertThat(Money.parse("0.01").compareTo(Money.parse("1"))).isNegative();
    }
}
