package bd.mediwish.notification;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import java.util.concurrent.*;
import static org.assertj.core.api.Assertions.*;

@ExtendWith(OutputCaptureExtension.class)
class CaptureSecurityNotifierTest {
    private final CaptureSecurityNotifier notifier = new CaptureSecurityNotifier();
    private final SecurityNotice notice = new SecurityNotice("01700000000", "synthetic private notice");

    @Test void captureIsBoundedCopiedClearableAndSilent(CapturedOutput output) {
        assertThat(notifier.send(notice)).isEqualTo(NoticeOutcome.SENT);
        var snapshot = notifier.notices();
        for (int i = 0; i < 51; i++) notifier.send(new SecurityNotice("01700000000", "notice " + i));
        assertThat(snapshot).containsExactly(notice);
        assertThat(notifier.notices()).hasSize(50);
        assertThat(notifier.notices().getFirst().text()).isEqualTo("notice 1");
        notifier.clear();
        assertThat(notifier.notices()).isEmpty();
        assertThat(output.getAll()).doesNotContain(notice.mobile(), notice.text());
        assertThat(notice.toString()).isEqualTo("SecurityNotice[redacted]");
    }

    @Test void throwControlIsConsumedOnce() {
        notifier.failNext(CaptureSecurityNotifier.Failure.THROW);
        assertThatThrownBy(() -> notifier.send(notice)).isInstanceOf(IllegalStateException.class);
        assertThat(notifier.send(notice)).isEqualTo(NoticeOutcome.SENT);
        assertThat(notifier.notices()).containsExactly(notice);
    }

    @Test void hangControlStopsOnInterruptionAndIsConsumedOnce() throws Exception {
        notifier.failNext(CaptureSecurityNotifier.Failure.HANG);
        var finished = new CountDownLatch(1);
        Thread thread = Thread.ofVirtual().start(() -> {
            try { notifier.send(notice); } finally { finished.countDown(); }
        });
        try {
            assertThat(finished.await(100, TimeUnit.MILLISECONDS)).isFalse();
            thread.interrupt();
            assertThat(finished.await(1, TimeUnit.SECONDS)).isTrue();
            assertThat(notifier.send(notice)).isEqualTo(NoticeOutcome.SENT);
            assertThat(notifier.notices()).containsExactly(notice);
        } finally { thread.interrupt(); }
    }
}
