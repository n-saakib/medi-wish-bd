package bd.mediwish.catalog;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.regex.Pattern;

/** Exact positive BDT within the catalog's NUMERIC(9,2) boundary. */
public final class Money implements Comparable<Money> {
    private static final Pattern DECIMAL = Pattern.compile("[0-9]{1,7}(\\.[0-9]{1,2})?");
    private final BigDecimal value;

    private Money(BigDecimal value) { this.value = value; }

    public static Money parse(String raw) {
        if (raw == null || !DECIMAL.matcher(raw).matches()) throw new InvalidMoneyException();
        BigDecimal value = new BigDecimal(raw).setScale(2, RoundingMode.UNNECESSARY);
        if (value.signum() <= 0) throw new InvalidMoneyException();
        return new Money(value);
    }

    public BigDecimal value() { return value; }
    @Override public int compareTo(Money other) { return value.compareTo(other.value); }
    @Override public String toString() { return value.toPlainString(); }
}
