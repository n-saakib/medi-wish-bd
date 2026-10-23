package bd.mediwish.mail;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.function.Predicate;

/** Controlled local/test mailbox; snapshots are immutable and waits use notification, not polling. */
public final class InMemoryEmailTransport implements EmailTransport {
    private final List<EmailMessage> captured = new ArrayList<>();
    private int remainingFailures;

    @Override
    public synchronized void send(EmailMessage message) {
        if (remainingFailures > 0) {
            remainingFailures--;
            throw new EmailDeliveryException();
        }
        captured.add(message);
        notifyAll();
    }

    public synchronized void failNext(int sends) { remainingFailures = sends; }

    public synchronized List<EmailMessage> messages() { return List.copyOf(captured); }
    public synchronized void clear() { captured.clear(); }

    public synchronized EmailMessage awaitMessage(Predicate<EmailMessage> match, Duration timeout)
            throws InterruptedException {
        long deadline = System.nanoTime() + timeout.toNanos();
        while (true) {
            for (EmailMessage message : captured) if (match.test(message)) return message;
            long remaining = deadline - System.nanoTime();
            if (remaining <= 0) throw new IllegalStateException("Mail was not received before the timeout");
            TimeUnit.NANOSECONDS.timedWait(this, remaining);
        }
    }
}
