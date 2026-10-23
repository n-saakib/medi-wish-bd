package bd.mediwish.auth;

import bd.mediwish.notification.*;
import bd.mediwish.mail.*;
import bd.mediwish.user.User;
import bd.mediwish.user.UserRepository;
import org.junit.jupiter.api.*;
import org.mockito.ArgumentCaptor;
import org.springframework.context.MessageSource;
import org.springframework.context.support.ResourceBundleMessageSource;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class StaffReplacementNoticesTest {
    private final UserRepository users = mock(UserRepository.class);
    private final SecurityNotifier notifier = mock(SecurityNotifier.class);
    private final EmailTransport email = mock(EmailTransport.class);
    private final MessageSource messages = mock(MessageSource.class);
    private final SecurityAuditLog audit = mock(SecurityAuditLog.class);
    private final User user = new User("synthetic_staff", "01700000000", null, "hash");
    private StaffReplacementNotices notices;

    @BeforeEach void setUp() {
        when(users.findById(user.id())).thenReturn(Optional.of(user));
        when(messages.getMessage(eq("notice.STAFF_AUTHENTICATOR_REPLACED"), any(Object[].class), eq(Locale.ENGLISH)))
                .thenAnswer(call -> "Authenticator replaced on " + ((Object[]) call.getArgument(1))[0]);
        when(messages.getMessage(eq("mail.staffAuthenticatorReplaced.subject"), isNull(), eq(Locale.ENGLISH)))
                .thenReturn("Your staff authenticator was replaced");
        when(messages.getMessage(eq("mail.staffAuthenticatorReplaced.body"), any(Object[].class), eq(Locale.ENGLISH)))
                .thenAnswer(call -> "Authenticator replaced on " + ((Object[]) call.getArgument(1))[0]);
        notices = new StaffReplacementNotices(users, notifier, email, new MailProperties("memory", null), messages, audit,
                new NotificationProperties(null, Duration.ofSeconds(1)), Clock.fixed(Instant.parse("2026-10-19T08:00:00Z"), ZoneOffset.UTC));
    }
    @AfterEach void close() { notices.close(); }

    @Test void unverifiedContactsSkipDeliveryAndAudit() {
        user.updateProfile(null, "synthetic@example.test", null);
        assertThat(notices.notifyReplacement(user.id())).isEqualTo(NoticeOutcome.NO_VERIFIED_CONTACT);
        verifyNoInteractions(notifier, email, messages);
        verify(audit).recordInNewTransaction(SecurityAuditEvent.Type.MFA_REPLACEMENT_NOTICE_NO_VERIFIED_CONTACT, user.id());
    }

    @ParameterizedTest
    @CsvSource({"true,true", "false,true", "true,false"})
    void sendsEveryVerifiedContactAndExcludesUnverifiedContacts(boolean mobileVerified, boolean emailVerified) {
        user.updateProfile(null, "synthetic@example.test", null);
        if (mobileVerified) user.activateMobile(user.mobile());
        if (emailVerified) user.markEmailVerified(Instant.now());
        when(notifier.send(any())).thenReturn(NoticeOutcome.SENT);
        assertThat(notices.notifyReplacement(user.id())).isEqualTo(NoticeOutcome.SENT);
        if (mobileVerified) verify(notifier).send(any());
        else verifyNoInteractions(notifier);
        if (emailVerified) {
            var captured = ArgumentCaptor.forClass(EmailMessage.class);
            verify(email).send(captured.capture());
            assertThat(captured.getValue().to()).isEqualTo(user.email());
            assertThat(captured.getValue().kind()).isEqualTo(EmailKind.STAFF_AUTHENTICATOR_REPLACED);
            assertThat(captured.getValue().body()).contains("19 Oct 2026, 2:00 PM")
                    .doesNotContain(user.email(), user.mobile(), user.username());
        } else verifyNoInteractions(email);
        verify(audit).recordInNewTransaction(SecurityAuditEvent.Type.MFA_REPLACEMENT_NOTICE_SENT, user.id());
    }

    @ParameterizedTest
    @CsvSource({"SENT,true,SENT", "FAILED,false,SENT", "FAILED,true,FAILED", "NOT_CONFIGURED,true,FAILED"})
    void combinesChannelResultsWithSentThenFailedPrecedence(NoticeOutcome mobile, boolean emailFails, NoticeOutcome expected) {
        user.activateMobile(user.mobile());
        user.updateProfile(null, "synthetic@example.test", null);
        user.markEmailVerified(Instant.now());
        when(notifier.send(any())).thenReturn(mobile);
        if (emailFails) doThrow(new EmailDeliveryException()).when(email).send(any());
        assertThat(notices.notifyReplacement(user.id())).isEqualTo(expected);
        verify(notifier).send(any());
        verify(email).send(any());
    }

    @Test void disabledEmailIsNotReportedAsSentAndDoesNotInvokeItsNoOpTransport() {
        user.updateProfile(null, "synthetic@example.test", null);
        user.markEmailVerified(Instant.now());
        notices.close();
        notices = new StaffReplacementNotices(users, notifier, email, new MailProperties("disabled", null),
                messages, audit, new NotificationProperties(null, null), Clock.systemUTC());
        assertThat(notices.notifyReplacement(user.id())).isEqualTo(NoticeOutcome.NOT_CONFIGURED);
        verifyNoInteractions(email, notifier);
        user.activateMobile(user.mobile());
        when(notifier.send(any())).thenReturn(NoticeOutcome.NOT_CONFIGURED);
        assertThat(notices.notifyReplacement(user.id())).isEqualTo(NoticeOutcome.NOT_CONFIGURED);
        verify(audit, times(2)).recordInNewTransaction(SecurityAuditEvent.Type.MFA_REPLACEMENT_NOTICE_NOT_CONFIGURED, user.id());
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
        verify(audit).recordInNewTransaction(SecurityAuditEvent.Type.MFA_REPLACEMENT_NOTICE_SENT, user.id());
        verify(audit).recordInNewTransaction(SecurityAuditEvent.Type.MFA_REPLACEMENT_NOTICE_NOT_CONFIGURED, user.id());
    }

    @Test void realNoticeTemplatePreservesTheApostropheAndFormattedDate() {
        user.activateMobile(user.mobile());
        user.updateProfile(null, "synthetic@example.test", null);
        user.markEmailVerified(Instant.now());
        var source = new ResourceBundleMessageSource();
        source.setBasename("messages");
        notices.close();
        notices = new StaffReplacementNotices(users, notifier, email, new MailProperties("memory", null), source, audit,
                new NotificationProperties(null, null), Clock.fixed(Instant.parse("2026-10-19T08:00:00Z"), ZoneOffset.UTC));
        when(notifier.send(any())).thenReturn(NoticeOutcome.SENT);
        assertThat(notices.notifyReplacement(user.id())).isEqualTo(NoticeOutcome.SENT);
        var captured = ArgumentCaptor.forClass(SecurityNotice.class);
        verify(notifier).send(captured.capture());
        assertThat(captured.getValue().text()).isEqualTo("Medi Wish: your staff authenticator was replaced on 19 Oct 2026, 2:00 PM. If this wasn't you, contact the store owner.");
        var mail = ArgumentCaptor.forClass(EmailMessage.class);
        verify(email).send(mail.capture());
        assertThat(mail.getValue().subject()).isEqualTo("Your staff authenticator was replaced");
        assertThat(mail.getValue().body()).isEqualTo(captured.getValue().text());
    }

    @Test void bothHangingChannelsShareOneDeadlineAndAreCancelled() throws Exception {
        user.activateMobile(user.mobile());
        user.updateProfile(null, "synthetic@example.test", null);
        user.markEmailVerified(Instant.now());
        var started = new CountDownLatch(2);
        var interrupted = new CountDownLatch(2);
        when(notifier.send(any())).thenAnswer(call -> {
            awaitCancellation(started, interrupted);
            return NoticeOutcome.FAILED;
        });
        doAnswer(call -> { awaitCancellation(started, interrupted); return null; }).when(email).send(any());
        Assertions.assertTimeoutPreemptively(Duration.ofMillis(1900), () ->
                assertThat(notices.notifyReplacement(user.id())).isEqualTo(NoticeOutcome.FAILED));
        assertThat(started.getCount()).isZero();
        assertThat(interrupted.await(1, TimeUnit.SECONDS)).isTrue();
        verify(audit).recordInNewTransaction(SecurityAuditEvent.Type.MFA_REPLACEMENT_NOTICE_FAILED, user.id());
    }

    @Test void emailTimeoutDoesNotHideSuccessfulMobileDelivery() throws Exception {
        user.activateMobile(user.mobile());
        user.updateProfile(null, "synthetic@example.test", null);
        user.markEmailVerified(Instant.now());
        var interrupted = new CountDownLatch(1);
        when(notifier.send(any())).thenReturn(NoticeOutcome.SENT);
        doAnswer(call -> { awaitCancellation(new CountDownLatch(1), interrupted); return null; }).when(email).send(any());
        Assertions.assertTimeoutPreemptively(Duration.ofSeconds(3), () ->
                assertThat(notices.notifyReplacement(user.id())).isEqualTo(NoticeOutcome.SENT));
        assertThat(interrupted.await(1, TimeUnit.SECONDS)).isTrue();
        verify(audit).recordInNewTransaction(SecurityAuditEvent.Type.MFA_REPLACEMENT_NOTICE_SENT, user.id());
    }

    private static void awaitCancellation(CountDownLatch started, CountDownLatch interrupted) {
        started.countDown();
        try { new CountDownLatch(1).await(); }
        catch (InterruptedException cancellation) { interrupted.countDown(); Thread.currentThread().interrupt(); }
    }

    @Test void adapterFailureAndAuditFailureNeverEscape() {
        user.activateMobile(user.mobile());
        when(notifier.send(any())).thenThrow(new IllegalStateException("synthetic failure"));
        doThrow(new IllegalStateException("synthetic audit failure")).when(audit).recordInNewTransaction(any(), any());
        assertThat(notices.notifyReplacement(user.id())).isEqualTo(NoticeOutcome.FAILED);
        doReturn(NoticeOutcome.SENT).when(notifier).send(any());
        assertThat(notices.notifyReplacement(user.id())).isEqualTo(NoticeOutcome.SENT);
        verify(audit).recordInNewTransaction(SecurityAuditEvent.Type.MFA_REPLACEMENT_NOTICE_FAILED, user.id());
        verify(audit).recordInNewTransaction(SecurityAuditEvent.Type.MFA_REPLACEMENT_NOTICE_SENT, user.id());
    }

    @Test void lookupAndMessageFailuresAreFailedOutcomes() {
        when(users.findById(user.id())).thenThrow(new IllegalStateException("lookup failure"));
        assertThat(notices.notifyReplacement(user.id())).isEqualTo(NoticeOutcome.FAILED);
        doReturn(Optional.of(user)).when(users).findById(user.id());
        user.activateMobile(user.mobile());
        when(messages.getMessage(anyString(), any(Object[].class), any(Locale.class))).thenThrow(new IllegalStateException("message failure"));
        assertThat(notices.notifyReplacement(user.id())).isEqualTo(NoticeOutcome.FAILED);
        verifyNoInteractions(notifier);
        verify(audit, times(2)).recordInNewTransaction(SecurityAuditEvent.Type.MFA_REPLACEMENT_NOTICE_FAILED, user.id());
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
        verify(audit).recordInNewTransaction(SecurityAuditEvent.Type.MFA_REPLACEMENT_NOTICE_FAILED, user.id());
    }

    @Test void interruptedWaitStillAuditsOutsideTheInterruptAndRestoresIt() {
        user.activateMobile(user.mobile());
        when(notifier.send(any())).thenReturn(NoticeOutcome.SENT);
        var interruptedDuringAudit = new boolean[]{true};
        doAnswer(call -> { interruptedDuringAudit[0] = Thread.currentThread().isInterrupted(); return null; })
                .when(audit).recordInNewTransaction(any(), any());
        Thread.currentThread().interrupt();
        NoticeOutcome outcome;
        try { outcome = notices.notifyReplacement(user.id()); }
        finally { assertThat(Thread.interrupted()).as("interrupt restored").isTrue(); }
        assertThat(outcome).isEqualTo(NoticeOutcome.FAILED);
        assertThat(interruptedDuringAudit[0]).isFalse();
        verify(audit).recordInNewTransaction(SecurityAuditEvent.Type.MFA_REPLACEMENT_NOTICE_FAILED, user.id());
    }

}
