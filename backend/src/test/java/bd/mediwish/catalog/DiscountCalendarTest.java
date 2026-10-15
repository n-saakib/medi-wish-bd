package bd.mediwish.catalog;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;

import static org.assertj.core.api.Assertions.assertThat;

class DiscountCalendarTest {
    @ParameterizedTest
    @CsvSource({
            "2026-10-09T17:59:59.999999Z, 2026-10-09",
            "2026-10-09T18:00:00Z, 2026-10-10",
            "2026-12-31T17:59:59.999999Z, 2026-12-31",
            "2026-12-31T18:00:00Z, 2027-01-01"
    })
    void todayUsesDhakaMidnightRegardlessOfTheClocksOwnZone(String instant, String expected) {
        var calendar = new DiscountCalendar(Clock.fixed(Instant.parse(instant), ZoneOffset.UTC));
        assertThat(calendar.today()).isEqualTo(LocalDate.parse(expected));
    }
}
