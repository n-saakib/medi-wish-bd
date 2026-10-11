package bd.mediwish.address;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import java.time.Clock;
import java.time.Instant;
import java.util.concurrent.atomic.AtomicReference;

/** Loaded explicitly by address limit tests; it never changes authentication time. */
public class MovableAddressChangeCalendar {
    @Bean @Primary
    Calendar fixedAddressChangeCalendar(Clock clock) { return new Calendar(clock); }

    public static class Calendar extends AddressChangeCalendar {
        private final AtomicReference<Instant> instant = new AtomicReference<>();
        public Calendar(Clock clock) { super(clock); }
        public void set(Instant value) { instant.set(value); }
        public void reset() { instant.set(null); }
        @Override public Instant now() {
            Instant value = instant.get();
            return value == null ? super.now() : value;
        }
    }
}
