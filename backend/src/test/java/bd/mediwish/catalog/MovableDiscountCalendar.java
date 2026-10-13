package bd.mediwish.catalog;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;

import java.time.Clock;
import java.time.LocalDate;
import java.util.concurrent.atomic.AtomicReference;

/** Explicit launch source only: never component-scanned, and never replaces the authentication Clock. */
final class MovableDiscountCalendar {
    @Bean("controlledDiscountCalendar")
    @Primary
    Calendar movableDiscountCalendar(Clock clock) {
        return new Calendar(clock);
    }

    static final class Calendar extends DiscountCalendar {
        private final AtomicReference<LocalDate> date = new AtomicReference<>();
        private final AtomicReference<LocalDate> firstRead = new AtomicReference<>();

        Calendar(Clock clock) { super(clock); }

        void set(LocalDate today) {
            firstRead.set(null);
            date.set(today);
        }

        // Arm only after fixtures are complete; the next request crosses midnight between calendar reads.
        void advanceAfterFirstRead(LocalDate beforeMidnight, LocalDate afterMidnight) {
            date.set(afterMidnight);
            firstRead.set(beforeMidnight);
        }

        @Override
        public LocalDate today() {
            LocalDate first = firstRead.getAndSet(null);
            if (first != null) return first;
            LocalDate fixed = date.get();
            return fixed == null ? super.today() : fixed;
        }
    }
}
