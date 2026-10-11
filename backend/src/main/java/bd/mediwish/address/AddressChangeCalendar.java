package bd.mediwish.address;

import org.springframework.stereotype.Component;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;

/** Separate allowance calendar so tests never move authentication or creation timestamps. */
@Component
public class AddressChangeCalendar {
    private final Clock clock;
    public AddressChangeCalendar(Clock clock) { this.clock = clock; }
    public Instant now() { return clock.instant().truncatedTo(ChronoUnit.MICROS); }
}
