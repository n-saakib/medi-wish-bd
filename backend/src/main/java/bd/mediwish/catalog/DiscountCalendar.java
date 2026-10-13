package bd.mediwish.catalog;

import org.springframework.stereotype.Component;
import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;

@Component
public class DiscountCalendar {

    public static final ZoneId ZONE = ZoneId.of("Asia/Dhaka");

    private final Clock clock;

    public DiscountCalendar(Clock clock) {
        this.clock = clock;
    }

    public LocalDate today() {
        return LocalDate.now(clock.withZone(ZONE));
    }

}
