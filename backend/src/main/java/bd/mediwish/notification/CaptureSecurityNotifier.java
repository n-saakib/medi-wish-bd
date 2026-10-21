package bd.mediwish.notification;

import java.util.ArrayDeque;
import java.util.List;
import java.util.concurrent.CountDownLatch;

/** Local/test adapter. Captured payloads stay in memory and are never logged. */
public class CaptureSecurityNotifier implements SecurityNotifier {
    public enum Failure { THROW, HANG }
    private final ArrayDeque<SecurityNotice> notices = new ArrayDeque<>();
    private Failure nextFailure;

    public synchronized void failNext(Failure failure) { nextFailure = failure; }
    public synchronized List<SecurityNotice> notices() { return List.copyOf(notices); }
    public synchronized void clear() { notices.clear(); nextFailure = null; }

    @Override public NoticeOutcome send(SecurityNotice notice) {
        Failure failure;
        synchronized (this) { failure = nextFailure; nextFailure = null; }
        if (failure == Failure.THROW) throw new IllegalStateException("synthetic security notice failure");
        if (failure == Failure.HANG) {
            try { new CountDownLatch(1).await(); }
            catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); }
            return NoticeOutcome.FAILED;
        }
        synchronized (this) {
            if (notices.size() == 50) notices.removeFirst();
            notices.addLast(notice);
        }
        return NoticeOutcome.SENT;
    }
}
