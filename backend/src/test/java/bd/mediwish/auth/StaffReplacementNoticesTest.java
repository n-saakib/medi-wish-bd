package bd.mediwish.auth;

import bd.mediwish.notification.*;
import bd.mediwish.user.User;
import bd.mediwish.user.UserRepository;
import org.junit.jupiter.api.*;
import org.mockito.ArgumentCaptor;
import org.springframework.context.MessageSource;
import org.springframework.context.support.ResourceBundleMessageSource;
import org.springframework.transaction.support.TransactionOperations;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class StaffReplacementNoticesTest {
    private final UserRepository users = mock(UserRepository.class);
    private final SecurityNotifier notifier = mock(SecurityNotifier.class);
    private final MessageSource messages = mock(MessageSource.class);
    private final SecurityAuditLog audit = mock(SecurityAuditLog.class);
    private final User user = new User("synthetic_staff", "01700000000", null, "hash");
    private StaffReplacementNotices notices;

    @BeforeEach void setUp() {
        when(users.findById(user.id())).thenReturn(Optional.of(user));
        when(messages.getMessage(eq("notice.STAFF_AUTHENTICATOR_REPLACED"), any(Object[].class), eq(Locale.ENGLISH)))
                .thenAnswer(call -> "Authenticator replaced on " + ((Object[]) call.getArgument(1))[0]);
        notices = new StaffReplacementNotices(users, notifier, messages, audit, TransactionOperations.withoutTransaction(),
                new NotificationProperties(null, Duration.ofSeconds(1)), Clock.fixed(Instant.parse("2026-10-19T08:00:00Z"), ZoneOffset.UTC));
    }
    @AfterEach void close() { notices.close(); }

    @Test void unverifiedMobileSkipsDeliveryAndAudits() {
        assertThat(notices.notifyReplacement(user.id())).isEqualTo(NoticeOutcome.NO_VERIFIED_CONTACT);
        verifyNoInteractions(notifier, messages);
        verify(audit).record(SecurityAuditEvent.Type.MFA_REPLACEMENT_NOTICE_NO_VERIFIED_CONTACT, user.id(), null);
    }

    @Test void sentAndDisabledOutcomesAreAuditedAndTextContainsOnlyTheDate() {
        user.activateMobile(user.mobile());
        when(notifier.send(any())).thenReturn(NoticeOutcome.SENT, NoticeOutcome.NOT_CONFIGURED);
        assertThat(notices.notifyReplacement(user.id())).isEqualTo(NoticeOutcome.SENT);
        assertThat(notices.notifyReplacement(user.id())).isEqualTo(NoticeOutcome.NOT_CONFIGURED);
        var captured = ArgumentCaptor.forClass(SecurityNotice.class);
        verify(notifier, times(2)).send(captured.capture());
        assertThat(captured.getValue().mobile()).isEqualTo(user.mobile());
        assertThat(captured.getValue().text()).contains("19 Oct 2026, 2:00 PM").doesNotContain(user.username(), user.mobile());
        verify(audit).record(SecurityAuditEvent.Type.MFA_REPLACEMENT_NOTICE_SENT, user.id(), null);
        verify(audit).record(SecurityAuditEvent.Type.MFA_REPLACEMENT_NOTICE_NOT_CONFIGURED, user.id(), null);
    }

    @Test void realNoticeTemplatePreservesTheApostropheAndFormattedDate() {
        user.activateMobile(user.mobile());
        var source = new ResourceBundleMessageSource();
        source.setBasename("messages");
        notices.close();
        notices = new StaffReplacementNotices(users, notifier, source, audit, TransactionOperations.withoutTransaction(),
                new NotificationProperties(null, null), Clock.fixed(Instant.parse("2026-10-19T08:00:00Z"), ZoneOffset.UTC));
        when(notifier.send(any())).thenReturn(NoticeOutcome.SENT);
        assertThat(notices.notifyReplacement(user.id())).isEqualTo(NoticeOutcome.SENT);
        var captured = ArgumentCaptor.forClass(SecurityNotice.class);
        verify(notifier).send(captured.capture());
        assertThat(captured.getValue().text()).isEqualTo("Medi Wish: your staff authenticator was replaced on 19 Oct 2026, 2:00 PM. If this wasn't you, contact the store owner.");
    }

    @Test void adapterFailureAndAuditFailureNeverEscape() {
        user.activateMobile(user.mobile());
        when(notifier.send(any())).thenThrow(new IllegalStateException("synthetic failure"));
        doThrow(new IllegalStateException("synthetic audit failure")).when(audit).record(any(), any(), any());
        assertThat(notices.notifyReplacement(user.id())).isEqualTo(NoticeOutcome.FAILED);
        doReturn(NoticeOutcome.SENT).when(notifier).send(any());
        assertThat(notices.notifyReplacement(user.id())).isEqualTo(NoticeOutcome.SENT);
        verify(audit).record(SecurityAuditEvent.Type.MFA_REPLACEMENT_NOTICE_FAILED, user.id(), null);
        verify(audit).record(SecurityAuditEvent.Type.MFA_REPLACEMENT_NOTICE_SENT, user.id(), null);
    }

    @Test void lookupAndMessageFailuresAreFailedOutcomes() {
        when(users.findById(user.id())).thenThrow(new IllegalStateException("lookup failure"));
        assertThat(notices.notifyReplacement(user.id())).isEqualTo(NoticeOutcome.FAILED);
        doReturn(Optional.of(user)).when(users).findById(user.id());
        user.activateMobile(user.mobile());
        when(messages.getMessage(anyString(), any(Object[].class), any(Locale.class))).thenThrow(new IllegalStateException("message failure"));
        assertThat(notices.notifyReplacement(user.id())).isEqualTo(NoticeOutcome.FAILED);
        verifyNoInteractions(notifier);
        verify(audit, times(2)).record(SecurityAuditEvent.Type.MFA_REPLACEMENT_NOTICE_FAILED, user.id(), null);
    }

    @Test void hangingAdapterIsCancelledAtTheDeadline() throws Exception {
        user.activateMobile(user.mobile());
        var started = new CountDownLatch(1);
        var interrupted = new CountDownLatch(1);
        when(notifier.send(any())).thenAnswer(call -> {
            started.countDown();
            try { new CountDownLatch(1).await(); }
            catch (InterruptedException interruption) { interrupted.countDown(); Thread.currentThread().interrupt(); }
            return NoticeOutcome.FAILED;
        });
        Assertions.assertTimeoutPreemptively(Duration.ofSeconds(3), () -> assertThat(notices.notifyReplacement(user.id())).isEqualTo(NoticeOutcome.FAILED));
        assertThat(started.getCount()).isZero();
        assertThat(interrupted.await(1, TimeUnit.SECONDS)).isTrue();
        verify(audit).record(SecurityAuditEvent.Type.MFA_REPLACEMENT_NOTICE_FAILED, user.id(), null);
    }

    @Test void interruptedWaitStillAuditsOutsideTheInterruptAndRestoresIt() {
        user.activateMobile(user.mobile());
        when(notifier.send(any())).thenReturn(NoticeOutcome.SENT);
        var interruptedDuringAudit = new boolean[]{true};
        doAnswer(call -> { interruptedDuringAudit[0] = Thread.currentThread().isInterrupted(); return null; })
                .when(audit).record(any(), any(), any());
        Thread.currentThread().interrupt();
        NoticeOutcome outcome;
        try { outcome = notices.notifyReplacement(user.id()); }
        finally { assertThat(Thread.interrupted()).as("interrupt restored").isTrue(); }
        assertThat(outcome).isEqualTo(NoticeOutcome.FAILED);
        assertThat(interruptedDuringAudit[0]).isFalse();
        verify(audit).record(SecurityAuditEvent.Type.MFA_REPLACEMENT_NOTICE_FAILED, user.id(), null);
    }

}
